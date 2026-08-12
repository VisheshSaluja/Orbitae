//! Claude implementation of [`AgentBackend`] over bidirectional `stream-json`.
//!
//! Spawns `claude --input-format stream-json --output-format stream-json
//! --verbose` and keeps it alive for the whole session: each [`send`] writes a
//! user turn to stdin as a stream-json message, and context is retained across
//! turns (verified by the Phase-2 spike). stdout events are parsed into
//! [`BackendEvent`]s and pushed to the sink; stderr is surfaced.

use std::io::{BufRead, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;

use super::{events_from_line, AgentBackend, BackendEvent, BackendSession, EventSink, SessionConfig};
use crate::modules::orchestrator::error::{OrchestratorError, Result};

/// The Claude Code backend.
pub struct ClaudeBackend;

impl AgentBackend for ClaudeBackend {
    fn id(&self) -> &'static str {
        "claude"
    }

    fn start(&self, config: SessionConfig, sink: EventSink) -> Result<Box<dyn BackendSession>> {
        let mut cmd = build_command(&config);
        cmd.stdin(Stdio::piped());
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        let mut child = cmd
            .spawn()
            .map_err(|e| OrchestratorError::Backend(format!("failed to spawn claude: {e}")))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| OrchestratorError::Backend("failed to capture stdin".into()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| OrchestratorError::Backend("failed to capture stdout".into()))?;
        let stderr = child.stderr.take();
        let pid = child.id();

        // stdout: parse stream-json → semantic events → sink; signal exit on EOF.
        let out_sink = sink.clone();
        std::thread::spawn(move || {
            let reader = std::io::BufReader::new(stdout);
            for line in reader.lines().map_while(std::result::Result::ok) {
                let line = line.trim();
                if line.is_empty() {
                    continue;
                }
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(line) {
                    for ev in events_from_line(&json) {
                        out_sink(ev);
                    }
                }
            }
            out_sink(BackendEvent::Exited(None));
        });

        // stderr: surface each line.
        if let Some(stderr) = stderr {
            let err_sink = sink.clone();
            std::thread::spawn(move || {
                let reader = std::io::BufReader::new(stderr);
                for line in reader.lines().map_while(std::result::Result::ok) {
                    if !line.trim().is_empty() {
                        tracing::warn!("claude stderr: {}", line);
                        err_sink(BackendEvent::Stderr(line));
                    }
                }
            });
        }

        Ok(Box::new(ClaudeSession {
            stdin: Mutex::new(stdin),
            child: Mutex::new(child),
            pid,
        }))
    }
}

/// A live Claude session.
struct ClaudeSession {
    stdin: Mutex<ChildStdin>,
    child: Mutex<Child>,
    pid: u32,
}

impl BackendSession for ClaudeSession {
    fn send(&self, text: &str) -> Result<()> {
        let msg = serde_json::json!({
            "type": "user",
            "message": { "role": "user", "content": text }
        });
        let line = format!("{msg}\n");
        let mut stdin = self
            .stdin
            .lock()
            .map_err(|e| OrchestratorError::Backend(format!("stdin lock poisoned: {e}")))?;
        stdin
            .write_all(line.as_bytes())
            .map_err(|e| OrchestratorError::Backend(format!("failed to write turn: {e}")))?;
        stdin
            .flush()
            .map_err(|e| OrchestratorError::Backend(format!("failed to flush turn: {e}")))?;
        Ok(())
    }

    fn stop(&self) -> Result<()> {
        let mut child = self
            .child
            .lock()
            .map_err(|e| OrchestratorError::Backend(format!("child lock poisoned: {e}")))?;
        let _ = child.kill();
        Ok(())
    }

    fn pid(&self) -> Option<u32> {
        Some(self.pid)
    }
}

/// Build the `claude` command for a bidirectional stream-json session.
///
/// `--verbose` is mandatory with `stream-json` (the CLI rejects it otherwise);
/// the permission mode reuses the agent-session mapping.
fn build_command(config: &SessionConfig) -> Command {
    let mut cmd = Command::new("claude");
    cmd.args([
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--verbose",
        "--print",
    ]);
    cmd.args(config.permission_mode.cli_args());

    if let Some(model) = &config.model {
        cmd.args(["--model", model]);
    }

    // Minimal, explicit environment (mirrors the agent-session spawn).
    for key in ["PATH", "HOME", "SHELL"] {
        if let Ok(val) = std::env::var(key) {
            cmd.env(key, val);
        }
    }
    cmd.env("TERM", "xterm-256color");
    cmd.env("LANG", "en_US.UTF-8");
    cmd.current_dir(&config.cwd);
    cmd
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::agent_sessions::events::TaskPermissionMode;

    #[test]
    fn command_has_required_flags() {
        let cfg = SessionConfig {
            cwd: "/tmp".into(),
            model: Some("claude-sonnet-5".into()),
            permission_mode: TaskPermissionMode::AcceptEdits,
        };
        let cmd = build_command(&cfg);
        let args: Vec<String> = cmd
            .get_args()
            .map(|a| a.to_string_lossy().to_string())
            .collect();
        for expected in [
            "--input-format",
            "stream-json",
            "--output-format",
            "--verbose",
            "--permission-mode",
            "acceptEdits",
            "--model",
            "claude-sonnet-5",
        ] {
            assert!(args.contains(&expected.to_string()), "missing {expected}");
        }
    }

    #[test]
    fn skip_mode_uses_dangerous_flag() {
        let cfg = SessionConfig {
            cwd: "/tmp".into(),
            model: None,
            permission_mode: TaskPermissionMode::Skip,
        };
        let cmd = build_command(&cfg);
        let args: Vec<String> = cmd
            .get_args()
            .map(|a| a.to_string_lossy().to_string())
            .collect();
        assert!(args.contains(&"--dangerously-skip-permissions".to_string()));
        assert!(!args.contains(&"--model".to_string()));
    }
}
