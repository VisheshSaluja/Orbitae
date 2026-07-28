use super::models::{AgentSession, AgentSessionState, LaunchRequest};
use anyhow::{Context, Result};
use chrono::Utc;
use uuid::Uuid;

/// Maximum number of concurrent agent sessions that can be launched at once.
const MAX_SESSION_COUNT: u32 = 6;

/// Service layer for managing external AI agent terminal sessions.
pub struct AgentSessionService;

impl AgentSessionService {
    /// Launch one or more AI agent sessions in external Terminal.app windows.
    ///
    /// Each session opens a new native terminal window, injects the appropriate
    /// API key as an environment variable, changes to the project directory, and
    /// runs the agent CLI.
    pub fn launch_sessions(
        request: &LaunchRequest,
        api_key: Option<&str>,
    ) -> Result<Vec<AgentSession>> {
        if request.count == 0 || request.count > MAX_SESSION_COUNT {
            anyhow::bail!(
                "Session count must be between 1 and {}, got {}",
                MAX_SESSION_COUNT,
                request.count
            );
        }

        let mut sessions = Vec::with_capacity(request.count as usize);

        for i in 1..=request.count {
            let id = Uuid::new_v4().to_string();
            let display_name = build_display_name(&request.agent_type, i);
            let cli_command = build_cli_command(
                &request.agent_type,
                &request.project_path,
                api_key,
                request.instructions.as_deref(),
            );

            let pid = launch_terminal_window(&display_name, &cli_command)?;

            let session = AgentSession {
                id,
                agent_type: request.agent_type.clone(),
                display_name,
                status: "running".to_string(),
                pid: Some(pid),
                project_id: request.project_id.clone(),
                instructions: request.instructions.clone(),
                created_at: Utc::now().to_rfc3339(),
            };

            sessions.push(session);
        }

        Ok(sessions)
    }

    /// Arrange all Terminal.app windows in a tiled layout on the screen.
    ///
    /// Supports layouts for 1-6 windows: fullscreen, side-by-side, grids, etc.
    pub fn tile_windows(session_count: u32) -> Result<()> {
        if session_count == 0 {
            return Ok(());
        }

        let script = build_tile_applescript(session_count);

        std::process::Command::new("osascript")
            .arg("-e")
            .arg(&script)
            .output()
            .context("Failed to execute tiling AppleScript")?;

        Ok(())
    }

    /// Return a snapshot of all tracked agent sessions.
    pub fn list_sessions(state: &AgentSessionState) -> Vec<AgentSession> {
        let sessions = state.lock().expect("AgentSessionState lock poisoned");
        sessions.values().cloned().collect()
    }

    /// Stop a running agent session by killing its process and updating state.
    pub fn stop_session(state: &AgentSessionState, session_id: &str) -> Result<()> {
        let mut sessions = state.lock().expect("AgentSessionState lock poisoned");
        let session = sessions
            .get_mut(session_id)
            .ok_or_else(|| anyhow::anyhow!("Session not found: {}", session_id))?;

        if session.status == "stopped" {
            return Ok(());
        }

        if let Some(pid) = session.pid {
            kill_process(pid)?;
        }

        session.status = "stopped".to_string();
        Ok(())
    }
}

/// Build a human-readable display name for the terminal window title.
fn build_display_name(agent_type: &str, index: u32) -> String {
    let label = match agent_type {
        "claude" => "Claude",
        "codex" => "Codex",
        "custom" => "Terminal",
        other => other,
    };
    format!("{} {}", label, index)
}

/// Build the shell command string to execute inside the terminal window.
///
/// This includes environment variable exports, directory change, and the agent CLI invocation.
fn build_cli_command(
    agent_type: &str,
    project_path: &str,
    api_key: Option<&str>,
    instructions: Option<&str>,
) -> String {
    let mut parts: Vec<String> = Vec::new();

    // Inject API key as environment variable
    if let Some(key) = api_key {
        let env_var = match agent_type {
            "claude" => "ANTHROPIC_API_KEY",
            "codex" => "OPENAI_API_KEY",
            _ => "",
        };
        if !env_var.is_empty() {
            // Single-quote the key value and escape any embedded single quotes
            let escaped_key = key.replace('\'', "'\\''");
            parts.push(format!("export {}='{}'", env_var, escaped_key));
        }
    }

    // Change to project directory
    let escaped_path = project_path.replace('\'', "'\\''");
    parts.push(format!("cd '{}'", escaped_path));

    // Build the agent CLI invocation
    let agent_cmd = match agent_type {
        "claude" => {
            if let Some(instr) = instructions {
                let escaped_instr = instr.replace('\'', "'\\''");
                format!("claude --print '{}'", escaped_instr)
            } else {
                "claude".to_string()
            }
        }
        "codex" => {
            if let Some(instr) = instructions {
                let escaped_instr = instr.replace('\'', "'\\''");
                format!("codex '{}'", escaped_instr)
            } else {
                "codex".to_string()
            }
        }
        _ => {
            // Custom: just open a shell, optionally echo instructions
            if let Some(instr) = instructions {
                let escaped_instr = instr.replace('\'', "'\\''");
                format!("echo '{}'; exec $SHELL", escaped_instr)
            } else {
                "exec $SHELL".to_string()
            }
        }
    };

    parts.push(agent_cmd);
    parts.join("; ")
}

/// Launch a new Terminal.app window via AppleScript, executing the given command.
///
/// Returns the PID of the spawned `osascript` process.
#[cfg(target_os = "macos")]
fn launch_terminal_window(display_name: &str, command: &str) -> Result<u32> {
    // Escape for AppleScript string (double-quote context): backslash, double-quote, and newlines
    let escaped_cmd = command.replace('\\', "\\\\").replace('"', "\\\"").replace('\n', "\\n").replace('\r', "\\r");
    let escaped_name = display_name.replace('\\', "\\\\").replace('"', "\\\"");

    let script = format!(
        r#"tell application "Terminal"
    activate
    do script "{escaped_cmd}"
    set custom title of tab 1 of front window to "{escaped_name}"
end tell"#
    );

    let child = std::process::Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .spawn()
        .context("Failed to spawn osascript for terminal launch")?;

    Ok(child.id())
}

#[cfg(not(target_os = "macos"))]
fn launch_terminal_window(_display_name: &str, _command: &str) -> Result<u32> {
    anyhow::bail!("Agent session launching is currently only supported on macOS")
}

/// Build the AppleScript to tile Terminal.app windows on screen.
///
/// Supports layouts for 1 through 6 windows:
/// - 1: fullscreen
/// - 2: left half + right half
/// - 3: 3 equal columns
/// - 4: 2x2 grid
/// - 5: 3 on top + 2 on bottom
/// - 6: 3x2 grid
fn build_tile_applescript(count: u32) -> String {
    // We compute window bounds based on screen dimensions obtained at runtime.
    // The Finder desktop bounds give us {x, y, width, height} of the visible area.
    let mut script = String::from(
        r#"tell application "Finder"
    set screenBounds to bounds of window of desktop
    set screenWidth to item 3 of screenBounds
    set screenHeight to item 4 of screenBounds
end tell

tell application "Terminal"
    set windowCount to count of windows
"#,
    );

    // Generate bounds assignments for each window position
    let bounds_list = compute_tile_bounds(count);

    for (i, bounds_expr) in bounds_list.iter().enumerate() {
        let window_index = i + 1;
        script.push_str(&format!(
            "    if windowCount >= {window_index} then\n        set bounds of window {window_index} to {bounds_expr}\n    end if\n"
        ));
    }

    script.push_str("end tell\n");
    script
}

/// Return AppleScript expressions for window bounds, using screenWidth/screenHeight variables.
fn compute_tile_bounds(count: u32) -> Vec<String> {
    match count {
        1 => vec![
            "{0, 0, screenWidth, screenHeight}".to_string(),
        ],
        2 => vec![
            "{0, 0, screenWidth div 2, screenHeight}".to_string(),
            "{screenWidth div 2, 0, screenWidth, screenHeight}".to_string(),
        ],
        3 => {
            let w = "screenWidth div 3";
            vec![
                format!("{{0, 0, {w}, screenHeight}}"),
                format!("{{{w}, 0, {w} * 2, screenHeight}}"),
                format!("{{{w} * 2, 0, screenWidth, screenHeight}}"),
            ]
        }
        4 => {
            let hw = "screenWidth div 2";
            let hh = "screenHeight div 2";
            vec![
                format!("{{0, 0, {hw}, {hh}}}"),
                format!("{{{hw}, 0, screenWidth, {hh}}}"),
                format!("{{0, {hh}, {hw}, screenHeight}}"),
                format!("{{{hw}, {hh}, screenWidth, screenHeight}}"),
            ]
        }
        5 => {
            let tw = "screenWidth div 3";
            let hh = "screenHeight div 2";
            vec![
                // Top row: 3 windows
                format!("{{0, 0, {tw}, {hh}}}"),
                format!("{{{tw}, 0, {tw} * 2, {hh}}}"),
                format!("{{{tw} * 2, 0, screenWidth, {hh}}}"),
                // Bottom row: 2 windows
                format!("{{0, {hh}, screenWidth div 2, screenHeight}}"),
                format!("{{screenWidth div 2, {hh}, screenWidth, screenHeight}}"),
            ]
        }
        6 => {
            let tw = "screenWidth div 3";
            let hh = "screenHeight div 2";
            vec![
                // Top row
                format!("{{0, 0, {tw}, {hh}}}"),
                format!("{{{tw}, 0, {tw} * 2, {hh}}}"),
                format!("{{{tw} * 2, 0, screenWidth, {hh}}}"),
                // Bottom row
                format!("{{0, {hh}, {tw}, screenHeight}}"),
                format!("{{{tw}, {hh}, {tw} * 2, screenHeight}}"),
                format!("{{{tw} * 2, {hh}, screenWidth, screenHeight}}"),
            ]
        }
        _ => vec![],
    }
}

/// Kill a process by PID using SIGTERM.
#[cfg(unix)]
fn kill_process(pid: u32) -> Result<()> {
    use std::process::Command;

    let status = Command::new("kill")
        .arg(pid.to_string())
        .status()
        .context(format!("Failed to send SIGTERM to PID {}", pid))?;

    if !status.success() {
        tracing::warn!(pid, "kill command exited with non-zero status — process may already be dead");
    }

    Ok(())
}

#[cfg(not(unix))]
fn kill_process(pid: u32) -> Result<()> {
    anyhow::bail!("Process termination is not implemented on this platform for PID {}", pid)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_display_name_formats_correctly() {
        assert_eq!(build_display_name("claude", 1), "Claude 1");
        assert_eq!(build_display_name("codex", 3), "Codex 3");
        assert_eq!(build_display_name("custom", 2), "Terminal 2");
        assert_eq!(build_display_name("aider", 1), "aider 1");
    }

    #[test]
    fn build_cli_command_claude_with_key_and_instructions() {
        let cmd = build_cli_command("claude", "/tmp/project", Some("sk-ant-123"), Some("fix bugs"));
        assert!(cmd.contains("export ANTHROPIC_API_KEY='sk-ant-123'"));
        assert!(cmd.contains("cd '/tmp/project'"));
        assert!(cmd.contains("claude --print 'fix bugs'"));
    }

    #[test]
    fn build_cli_command_codex_without_instructions() {
        let cmd = build_cli_command("codex", "/tmp/project", Some("sk-openai-456"), None);
        assert!(cmd.contains("export OPENAI_API_KEY='sk-openai-456'"));
        assert!(cmd.contains("codex"));
        assert!(!cmd.contains("--print"));
    }

    #[test]
    fn build_cli_command_custom_no_key() {
        let cmd = build_cli_command("custom", "/tmp/project", None, None);
        assert!(!cmd.contains("export"));
        assert!(cmd.contains("cd '/tmp/project'"));
        assert!(cmd.contains("exec $SHELL"));
    }

    #[test]
    fn build_cli_command_escapes_single_quotes_in_key() {
        let cmd = build_cli_command("claude", "/tmp/project", Some("key'with'quotes"), None);
        assert!(cmd.contains("key'\\''with'\\''quotes"));
    }

    #[test]
    fn tile_bounds_count_matches() {
        for count in 1..=6 {
            let bounds = compute_tile_bounds(count);
            assert_eq!(bounds.len() as u32, count, "Wrong bounds count for {}", count);
        }
    }

    #[test]
    fn tile_applescript_contains_window_references() {
        let script = build_tile_applescript(4);
        assert!(script.contains("window 1"));
        assert!(script.contains("window 4"));
    }
}
