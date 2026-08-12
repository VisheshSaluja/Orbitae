//! Multi-turn conversation over a live agent session.
//!
//! Wraps a started [`BackendSession`] and its event stream into a simple
//! request/response primitive: [`Conversation::ask`] sends a user turn and
//! blocks until that turn completes, returning the accumulated assistant text.
//! Because the underlying session retains context across turns (verified by the
//! Phase-2 spike), callers can iterate — plan, then revise, then answer a
//! question — on one process without re-sending prior context.

use std::sync::mpsc::{channel, Receiver, RecvTimeoutError};
use std::sync::Arc;
use std::time::Duration;

use super::backend::{AgentBackend, BackendEvent, BackendSession, SessionConfig};
use super::error::{OrchestratorError, Result};

/// Idle timeout between events within a single turn. A turn that keeps streaming
/// resets the clock; only a genuine stall trips it.
pub const DEFAULT_TURN_TIMEOUT: Duration = Duration::from_secs(180);

/// The result of one completed turn.
#[derive(Debug, Clone)]
pub struct TurnOutput {
    /// Concatenated assistant prose for the turn.
    pub text: String,
    /// Whether the backend reported the turn as an error.
    pub is_error: bool,
    /// Any stderr captured during the turn.
    pub stderr: String,
}

/// A live, multi-turn conversation with an agent.
pub struct Conversation {
    session: Box<dyn BackendSession>,
    rx: Receiver<BackendEvent>,
}

impl Conversation {
    /// Start a session on `backend` and wrap it for multi-turn use.
    pub fn start(backend: &dyn AgentBackend, config: SessionConfig) -> Result<Self> {
        let (tx, rx) = channel();
        let sink: Arc<dyn Fn(BackendEvent) + Send + Sync> = Arc::new(move |ev| {
            let _ = tx.send(ev);
        });
        let session = backend.start(config, sink)?;
        Ok(Self { session, rx })
    }

    /// Send a user turn and block until it completes.
    pub fn ask(&self, prompt: &str) -> Result<TurnOutput> {
        self.ask_with_timeout(prompt, DEFAULT_TURN_TIMEOUT)
    }

    /// Like [`ask`], with an explicit idle timeout.
    pub fn ask_with_timeout(&self, prompt: &str, timeout: Duration) -> Result<TurnOutput> {
        self.session.send(prompt)?;
        let mut text = String::new();
        let mut stderr = String::new();
        loop {
            match self.rx.recv_timeout(timeout) {
                Ok(BackendEvent::AssistantText(t)) => text.push_str(&t),
                Ok(BackendEvent::Completed { is_error, .. }) => {
                    return Ok(TurnOutput { text, is_error, stderr });
                }
                Ok(BackendEvent::Stderr(s)) => {
                    stderr.push_str(&s);
                    stderr.push('\n');
                }
                Ok(BackendEvent::Exited(_)) => {
                    let detail = if stderr.trim().is_empty() {
                        String::new()
                    } else {
                        format!(": {}", stderr.trim())
                    };
                    return Err(OrchestratorError::Backend(format!(
                        "session exited before completing the turn{detail}"
                    )));
                }
                Ok(_) => {}
                Err(RecvTimeoutError::Timeout) => {
                    return Err(OrchestratorError::Backend("turn timed out".into()));
                }
                Err(RecvTimeoutError::Disconnected) => {
                    return Err(OrchestratorError::Backend("backend disconnected".into()));
                }
            }
        }
    }

    /// Terminate the underlying session.
    pub fn stop(&self) -> Result<()> {
        self.session.stop()
    }
}

#[cfg(test)]
pub(crate) mod test_support {
    //! A scripted mock backend for exercising the conversation/planner logic
    //! without spawning a real agent. Each `send` replays the configured events.
    use super::*;
    use std::sync::Mutex;

    /// A backend whose sessions replay a fixed script of events on every turn.
    pub struct MockBackend {
        /// One script per turn; the Nth `ask` replays the Nth script (the last
        /// script repeats if more turns are asked than scripts provided).
        pub scripts: Vec<Vec<BackendEvent>>,
    }

    impl AgentBackend for MockBackend {
        fn id(&self) -> &'static str {
            "mock"
        }
        fn start(
            &self,
            _config: SessionConfig,
            sink: Arc<dyn Fn(BackendEvent) + Send + Sync>,
        ) -> Result<Box<dyn BackendSession>> {
            Ok(Box::new(MockSession {
                sink,
                scripts: self.scripts.clone(),
                turn: Mutex::new(0),
            }))
        }
    }

    struct MockSession {
        sink: Arc<dyn Fn(BackendEvent) + Send + Sync>,
        scripts: Vec<Vec<BackendEvent>>,
        turn: Mutex<usize>,
    }

    impl BackendSession for MockSession {
        fn send(&self, _text: &str) -> Result<()> {
            let mut turn = self.turn.lock().unwrap();
            let idx = (*turn).min(self.scripts.len().saturating_sub(1));
            if let Some(script) = self.scripts.get(idx) {
                for ev in script {
                    (self.sink)(ev.clone());
                }
            }
            *turn += 1;
            Ok(())
        }
        fn stop(&self) -> Result<()> {
            Ok(())
        }
        fn pid(&self) -> Option<u32> {
            None
        }
    }

    /// Build a `SessionConfig` for tests.
    pub fn test_config() -> SessionConfig {
        SessionConfig {
            cwd: "/tmp".into(),
            model: None,
            permission_mode:
                crate::modules::agent_sessions::events::TaskPermissionMode::AcceptEdits,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::test_support::*;
    use super::*;

    #[test]
    fn ask_accumulates_text_until_completed() {
        let backend = MockBackend {
            scripts: vec![vec![
                BackendEvent::AssistantText("Hello ".into()),
                BackendEvent::AssistantText("world".into()),
                BackendEvent::Completed {
                    is_error: false,
                    cost_usd: 0.0,
                    duration_ms: 1,
                    input_tokens: 1,
                    output_tokens: 1,
                },
            ]],
        };
        let convo = Conversation::start(&backend, test_config()).unwrap();
        let out = convo.ask("hi").unwrap();
        assert_eq!(out.text, "Hello world");
        assert!(!out.is_error);
    }

    #[test]
    fn exit_before_completion_is_an_error() {
        let backend = MockBackend {
            scripts: vec![vec![BackendEvent::Exited(Some(1))]],
        };
        let convo = Conversation::start(&backend, test_config()).unwrap();
        assert!(convo.ask("hi").is_err());
    }
}
