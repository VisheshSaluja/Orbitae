use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

/// An embedded interactive PTY agent session managed by Orbitae.
pub struct EmbeddedSession {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
}

/// Thread-safe container for active embedded PTY sessions.
pub type EmbeddedSessionMap = Arc<Mutex<HashMap<String, EmbeddedSession>>>;

/// Spawn an interactive agent session inside a PTY.
///
/// Output is streamed to the frontend via Tauri events (`agent-output-{id}`).
/// Input from the user is sent via `write_to_embedded_session`.
pub fn spawn_embedded(
    session_id: &str,
    agent_type: &str,
    project_path: &str,
    model: Option<&str>,
    instructions: Option<&str>,
    rows: u16,
    cols: u16,
    sessions: &EmbeddedSessionMap,
    app_handle: &AppHandle,
) -> Result<u32, String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to open PTY: {}", e))?;

    let expanded_path = crate::shared::utils::expand_path(project_path);

    let mut cmd = build_agent_command(agent_type, &expanded_path, model, instructions, session_id)?;
    cmd.cwd(&expanded_path);

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn agent process: {}", e))?;

    let pid = child.process_id().unwrap_or(0);
    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to clone PTY reader: {}", e))?;

    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to take PTY writer: {}", e))?;

    {
        let mut map = sessions.lock().map_err(|e| format!("Lock error: {}", e))?;
        map.insert(
            session_id.to_string(),
            EmbeddedSession {
                writer,
                master: pair.master,
            },
        );
    }

    let sid = session_id.to_string();
    let handle = app_handle.clone();
    let sessions_ref = sessions.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = handle.emit(&format!("agent-output-{}", sid), &data);
                }
                Err(_) => break,
            }
        }
        let _ = handle.emit(&format!("agent-exit-{}", sid), ());
        if let Ok(mut map) = sessions_ref.lock() {
            map.remove(&sid);
        }
    });

    std::thread::spawn(move || {
        let mut child = child;
        let _ = child.wait();
    });

    Ok(pid)
}

/// Send raw bytes (keystrokes) to an interactive session's PTY.
pub fn write_input(
    sessions: &EmbeddedSessionMap,
    session_id: &str,
    data: &[u8],
) -> Result<(), String> {
    let mut map = sessions.lock().map_err(|e| format!("Lock error: {}", e))?;
    let session = map
        .get_mut(session_id)
        .ok_or_else(|| format!("Embedded session not found: {}", session_id))?;

    session
        .writer
        .write_all(data)
        .map_err(|e| format!("Failed to write to PTY: {}", e))?;
    session
        .writer
        .flush()
        .map_err(|e| format!("Failed to flush PTY: {}", e))?;
    Ok(())
}

/// Resize the PTY for an interactive session.
pub fn resize(
    sessions: &EmbeddedSessionMap,
    session_id: &str,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    let map = sessions.lock().map_err(|e| format!("Lock error: {}", e))?;
    let session = map
        .get(session_id)
        .ok_or_else(|| format!("Embedded session not found: {}", session_id))?;

    session
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("PTY resize failed: {}", e))
}

/// Stop an embedded PTY session by dropping its handles (sends SIGHUP).
pub fn stop(sessions: &EmbeddedSessionMap, session_id: &str) -> Result<(), String> {
    let mut map = sessions.lock().map_err(|e| format!("Lock error: {}", e))?;
    map.remove(session_id);
    Ok(())
}

/// Check if an embedded PTY session is still alive.
pub fn is_alive(sessions: &EmbeddedSessionMap, session_id: &str) -> bool {
    sessions
        .lock()
        .map(|map| map.contains_key(session_id))
        .unwrap_or(false)
}

/// Build the CLI command for an interactive PTY agent.
fn build_agent_command(
    agent_type: &str,
    project_path: &str,
    model: Option<&str>,
    instructions: Option<&str>,
    session_id: &str,
) -> Result<CommandBuilder, String> {
    let program = match agent_type {
        "claude" => "claude",
        "codex" => "codex",
        "custom" => "zsh",
        _ => return Err(format!("Unknown agent type: {}", agent_type)),
    };

    let mut cmd = CommandBuilder::new(program);

    if agent_type == "claude" {
        if let Some(m) = model {
            cmd.arg("--model");
            cmd.arg(m);
        }

        if let Some(instr) = instructions {
            let ctx_path = crate::shared::utils::ctx_file_path_str(session_id);
            std::fs::write(&ctx_path, instr)
                .map_err(|e| format!("Failed to write context file: {}", e))?;
            cmd.arg(format!(
                "Read and follow the instructions in {}",
                ctx_path
            ));
        }
    } else if agent_type == "codex" {
        if let Some(instr) = instructions {
            cmd.arg(instr);
        }
    } else if agent_type == "custom" {
        cmd.arg("-l");
    }

    if let Ok(path) = std::env::var("PATH") {
        cmd.env("PATH", path);
    }
    if let Ok(home) = std::env::var("HOME") {
        cmd.env("HOME", home);
    }
    if let Ok(shell) = std::env::var("SHELL") {
        cmd.env("SHELL", shell);
    }
    if let Ok(term) = std::env::var("TERM") {
        cmd.env("TERM", term);
    } else {
        cmd.env("TERM", "xterm-256color");
    }
    cmd.env("LANG", "en_US.UTF-8");
    cmd.cwd(project_path);

    Ok(cmd)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsStr;

    #[test]
    fn build_claude_command_with_model() {
        let cmd =
            build_agent_command("claude", "/tmp/test", Some("claude-sonnet-5"), None, "test-id")
                .unwrap();
        let argv = cmd.get_argv();
        assert_eq!(argv[0], OsStr::new("claude"));
        assert!(argv.iter().any(|a| a == OsStr::new("--model")));
        assert!(argv.iter().any(|a| a == OsStr::new("claude-sonnet-5")));
    }

    #[test]
    fn build_claude_command_no_model() {
        let cmd =
            build_agent_command("claude", "/tmp/test", None, None, "test-id").unwrap();
        let argv = cmd.get_argv();
        assert_eq!(argv[0], OsStr::new("claude"));
        assert!(!argv.iter().any(|a| a == OsStr::new("--model")));
    }

    #[test]
    fn build_custom_command() {
        let cmd =
            build_agent_command("custom", "/tmp/test", None, None, "test-id").unwrap();
        let argv = cmd.get_argv();
        assert_eq!(argv[0], OsStr::new("zsh"));
        assert!(argv.iter().any(|a| a == OsStr::new("-l")));
    }

    #[test]
    fn build_unknown_agent_fails() {
        let result = build_agent_command("unknown", "/tmp/test", None, None, "test-id");
        assert!(result.is_err());
    }
}
