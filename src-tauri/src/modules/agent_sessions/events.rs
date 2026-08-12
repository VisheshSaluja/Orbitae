use sqlx::SqlitePool;
use std::collections::HashMap;
use std::io::BufRead;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

use super::models::AgentSessionState;

/// Tracks a running autonomous (task-mode) agent process.
pub struct AutonomousSession {
    pid: u32,
}

/// Thread-safe container for autonomous task sessions, keyed by session ID.
pub type AutonomousSessionMap = Arc<Mutex<HashMap<String, AutonomousSession>>>;

/// Spawn an autonomous task-mode agent session.
///
/// Runs `claude --print --output-format stream-json` for structured output.
/// Each JSON event is logged to SQLite and emitted to the frontend.
/// Returns the child process PID.
pub fn spawn_autonomous(
    session_id: &str,
    project_path: &str,
    model: Option<&str>,
    prompt: &str,
    sessions: &AutonomousSessionMap,
    pool: &SqlitePool,
    app_handle: &AppHandle,
    agent_state: &AgentSessionState,
) -> Result<u32, String> {
    let expanded = crate::shared::utils::expand_path(project_path);

    let ctx_path = format!("/tmp/orbitae-ctx-{}.md", session_id);
    write_restricted_file(&ctx_path, prompt)
        .map_err(|e| format!("Failed to write context file: {}", e))?;

    let mut cmd = build_task_command(&expanded, model, &ctx_path)?;
    cmd.current_dir(&expanded);
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn task: {}", e))?;

    let pid = child.id();
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to capture stdout".to_string())?;

    {
        let mut map = sessions.lock().map_err(|e| format!("Lock error: {}", e))?;
        map.insert(session_id.to_string(), AutonomousSession { pid });
    }

    let rt = tokio::runtime::Handle::current();
    let sid = session_id.to_string();
    let pool = pool.clone();
    let handle = app_handle.clone();
    let sessions_ref = sessions.clone();
    let state_ref = agent_state.clone();
    let ctx_cleanup = ctx_path.clone();

    std::thread::spawn(move || {
        let reader = std::io::BufReader::new(stdout);
        for line in reader.lines().map_while(Result::ok) {
            if line.trim().is_empty() {
                continue;
            }

            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&line) {
                let event_type = json
                    .get("type")
                    .and_then(|t| t.as_str())
                    .unwrap_or("unknown")
                    .to_string();

                let _ = handle.emit(&format!("agent-event-{}", sid), &json);

                let display = format_event_for_display(&json);
                if !display.is_empty() {
                    let _ = handle.emit(&format!("agent-output-{}", sid), &display);
                }

                let pool = pool.clone();
                let sid_clone = sid.clone();
                let et = event_type;
                rt.spawn(async move {
                    let repo =
                        super::event_repository::SessionEventRepository::new(pool);
                    if let Err(e) = repo.insert(&sid_clone, &et, &line).await {
                        tracing::warn!("Failed to log session event: {}", e);
                    }
                });
            } else {
                let _ = handle.emit(
                    &format!("agent-output-{}", sid),
                    &format!("{}\r\n", line),
                );
            }
        }

        let _ = handle.emit(&format!("agent-exit-{}", sid), ());
        if let Ok(mut map) = sessions_ref.lock() {
            map.remove(&sid);
        }
        if let Ok(mut state) = state_ref.lock() {
            if let Some(session) = state.get_mut(&sid) {
                session.status = "stopped".to_string();
            }
        }
        let _ = std::fs::remove_file(&ctx_cleanup);
    });

    std::thread::spawn(move || {
        let _ = child.wait();
    });

    Ok(pid)
}

/// Check if an autonomous session is still running.
pub fn is_autonomous_alive(sessions: &AutonomousSessionMap, session_id: &str) -> bool {
    sessions
        .lock()
        .map(|map| map.contains_key(session_id))
        .unwrap_or(false)
}

/// Stop an autonomous session by sending SIGTERM.
pub fn stop_autonomous(sessions: &AutonomousSessionMap, session_id: &str) -> Result<(), String> {
    let mut map = sessions.lock().map_err(|e| format!("Lock error: {}", e))?;
    if let Some(session) = map.remove(session_id) {
        let _ = std::process::Command::new("kill")
            .args(["-15", &session.pid.to_string()])
            .status();
    }
    let ctx_path = format!("/tmp/orbitae-ctx-{}.md", session_id);
    let _ = std::fs::remove_file(&ctx_path);
    Ok(())
}

/// Write a file with owner-only permissions (0600 on Unix).
fn write_restricted_file(path: &str, content: &str) -> std::io::Result<()> {
    use std::io::Write;
    #[cfg(unix)]
    use std::os::unix::fs::OpenOptionsExt;

    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create(true).truncate(true);
    #[cfg(unix)]
    opts.mode(0o600);
    let mut file = opts.open(path)?;
    file.write_all(content.as_bytes())
}

/// Build the CLI command for `claude --print --output-format stream-json`.
fn build_task_command(
    project_path: &str,
    model: Option<&str>,
    ctx_path: &str,
) -> Result<std::process::Command, String> {
    let mut cmd = std::process::Command::new("claude");
    cmd.args(["--print", "--output-format", "stream-json"]);

    if let Some(m) = model {
        cmd.args(["--model", m]);
    }

    cmd.arg(format!("Read and follow the instructions in {}", ctx_path));

    if let Ok(path) = std::env::var("PATH") {
        cmd.env("PATH", path);
    }
    if let Ok(home) = std::env::var("HOME") {
        cmd.env("HOME", home);
    }
    if let Ok(shell) = std::env::var("SHELL") {
        cmd.env("SHELL", shell);
    }
    cmd.env("TERM", "xterm-256color");
    cmd.env("LANG", "en_US.UTF-8");
    cmd.current_dir(project_path);

    Ok(cmd)
}

/// Convert a JSON event from `--output-format stream-json` into terminal-friendly text.
fn format_event_for_display(json: &serde_json::Value) -> String {
    match json.get("type").and_then(|t| t.as_str()) {
        Some("system") => {
            let model = json
                .get("model")
                .and_then(|m| m.as_str())
                .unwrap_or("unknown");
            format!("\x1b[90m▸ session started (model: {})\x1b[0m\r\n", model)
        }
        Some("assistant") => {
            if let Some(content) = json.pointer("/message/content") {
                if let Some(arr) = content.as_array() {
                    let text: Vec<&str> = arr
                        .iter()
                        .filter_map(|c| {
                            if c.get("type").and_then(|t| t.as_str()) == Some("text") {
                                c.get("text").and_then(|t| t.as_str())
                            } else {
                                None
                            }
                        })
                        .collect();
                    if !text.is_empty() {
                        return format!("{}\r\n", text.join(""));
                    }
                }
            }
            String::new()
        }
        Some("tool_use") => {
            let tool = json
                .get("tool")
                .or_else(|| json.get("name"))
                .and_then(|t| t.as_str())
                .unwrap_or("unknown");

            let detail = extract_tool_detail(json);
            if detail.is_empty() {
                format!("\x1b[36m▸ {}\x1b[0m\r\n", tool)
            } else {
                format!("\x1b[36m▸ {}\x1b[0m \x1b[90m{}\x1b[0m\r\n", tool, detail)
            }
        }
        Some("result") => {
            let input_tokens = json
                .pointer("/usage/input_tokens")
                .and_then(|t| t.as_i64())
                .unwrap_or(0);
            let output_tokens = json
                .pointer("/usage/output_tokens")
                .and_then(|t| t.as_i64())
                .unwrap_or(0);
            let cost = json
                .get("cost_usd")
                .and_then(|c| c.as_f64())
                .unwrap_or(0.0);
            let duration_ms = json
                .get("duration_ms")
                .and_then(|d| d.as_i64())
                .unwrap_or(0);
            let duration_s = duration_ms as f64 / 1000.0;

            format!(
                "\r\n\x1b[90m━━━ Done | {:.1}s | {}in + {}out tokens | ${:.4}\x1b[0m\r\n",
                duration_s, input_tokens, output_tokens, cost
            )
        }
        _ => String::new(),
    }
}

/// Extract a short detail string from a tool_use event for display.
fn extract_tool_detail(json: &serde_json::Value) -> String {
    let input = match json.get("input") {
        Some(i) => i,
        None => return String::new(),
    };

    if let Some(path) = input.get("file_path").and_then(|p| p.as_str()) {
        return truncate_path(path);
    }
    if let Some(cmd) = input.get("command").and_then(|c| c.as_str()) {
        let truncated: String = cmd.chars().take(60).collect();
        if cmd.len() > 60 {
            return format!("{}...", truncated);
        }
        return truncated;
    }
    if let Some(query) = input.get("query").and_then(|q| q.as_str()) {
        let truncated: String = query.chars().take(40).collect();
        return truncated;
    }
    String::new()
}

/// Truncate a file path to show only the last 2-3 components.
fn truncate_path(path: &str) -> String {
    let parts: Vec<&str> = path.split('/').filter(|p| !p.is_empty()).collect();
    if parts.len() <= 3 {
        return path.to_string();
    }
    format!(".../{}", parts[parts.len() - 3..].join("/"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn format_tool_use_with_file() {
        let json = serde_json::json!({
            "type": "tool_use",
            "tool": "Read",
            "input": {"file_path": "src/main.rs"}
        });
        let display = format_event_for_display(&json);
        assert!(display.contains("Read"));
        assert!(display.contains("src/main.rs"));
    }

    #[test]
    fn format_result_event() {
        let json = serde_json::json!({
            "type": "result",
            "cost_usd": 0.05,
            "duration_ms": 12000,
            "usage": {"input_tokens": 5000, "output_tokens": 2000}
        });
        let display = format_event_for_display(&json);
        assert!(display.contains("Done"));
        assert!(display.contains("5000in"));
        assert!(display.contains("2000out"));
    }

    #[test]
    fn truncate_long_path() {
        assert_eq!(
            truncate_path("/home/user/projects/big-app/src/components/auth/Login.tsx"),
            ".../components/auth/Login.tsx"
        );
    }

    #[test]
    fn short_path_unchanged() {
        assert_eq!(truncate_path("src/main.rs"), "src/main.rs");
    }

    #[test]
    fn format_system_event() {
        let json = serde_json::json!({
            "type": "system",
            "model": "claude-sonnet-5"
        });
        let display = format_event_for_display(&json);
        assert!(display.contains("claude-sonnet-5"));
    }
}
