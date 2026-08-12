//! Agent backend abstraction — the multi-backend seam.
//!
//! An [`AgentBackend`] starts a persistent, bidirectional agent session. The
//! app sends user turns with [`BackendSession::send`] and receives semantic
//! [`BackendEvent`]s through a sink. Claude is the only implementation today;
//! Codex/Gemini slot in as additional impls without touching the orchestration
//! loop or UI.
//!
//! The transport (validated by a spike, spec §6) is Claude's bidirectional
//! `stream-json`: multi-turn context is retained across `send` calls on one
//! live process.

pub mod claude;

use std::sync::Arc;

use super::error::Result;

/// A semantic event emitted by an agent session. Raw stream-json is mapped into
/// these so the rest of the engine never parses backend-specific wire formats.
#[derive(Debug, Clone, PartialEq)]
pub enum BackendEvent {
    /// The session initialized; carries the resolved model.
    SessionStarted { model: String },
    /// A chunk of assistant prose.
    AssistantText(String),
    /// The assistant invoked a tool (name + short human detail).
    ToolUse { name: String, detail: String },
    /// A turn finished. Costs/tokens are for that turn.
    Completed {
        is_error: bool,
        cost_usd: f64,
        duration_ms: i64,
        input_tokens: i64,
        output_tokens: i64,
    },
    /// A line the process wrote to stderr.
    Stderr(String),
    /// The backend process exited.
    Exited(Option<i32>),
}

/// Sink the backend pushes events into. Cloned across reader threads, so it must
/// be `Send + Sync`.
pub type EventSink = Arc<dyn Fn(BackendEvent) + Send + Sync>;

/// Configuration for starting a session.
#[derive(Debug, Clone)]
pub struct SessionConfig {
    /// Working directory (already expanded) the agent runs in.
    pub cwd: String,
    /// Optional model override; `None` uses the backend default.
    pub model: Option<String>,
    /// Permission handling for the session.
    pub permission_mode: crate::modules::agent_sessions::events::TaskPermissionMode,
}

/// A live, bidirectional agent session.
pub trait BackendSession: Send + Sync {
    /// Send a user turn. Context is retained across calls on the same session.
    fn send(&self, text: &str) -> Result<()>;
    /// Terminate the session.
    fn stop(&self) -> Result<()>;
    /// OS process id, if available.
    fn pid(&self) -> Option<u32>;
}

/// A backend capable of starting agent sessions (Claude, Codex, Gemini, …).
pub trait AgentBackend: Send + Sync {
    /// Stable identifier, e.g. `"claude"`.
    fn id(&self) -> &'static str;
    /// Start a session; events are delivered to `sink` until the process exits.
    fn start(&self, config: SessionConfig, sink: EventSink) -> Result<Box<dyn BackendSession>>;
}

/// Map one parsed stream-json line into zero or more semantic events.
///
/// A single `assistant` line can carry both prose and multiple tool calls, so
/// this returns a `Vec`. Internal `system` chatter (hooks) and unknown types
/// yield nothing.
pub(crate) fn events_from_line(json: &serde_json::Value) -> Vec<BackendEvent> {
    match json.get("type").and_then(|t| t.as_str()) {
        Some("system") => {
            if json.get("subtype").and_then(|s| s.as_str()) != Some("init") {
                return vec![];
            }
            let model = json
                .get("model")
                .and_then(|m| m.as_str())
                .unwrap_or("unknown")
                .to_string();
            vec![BackendEvent::SessionStarted { model }]
        }
        Some("assistant") => {
            let content = match json.pointer("/message/content").and_then(|c| c.as_array()) {
                Some(arr) => arr,
                None => return vec![],
            };
            let mut out = Vec::new();
            for block in content {
                match block.get("type").and_then(|t| t.as_str()) {
                    Some("text") => {
                        if let Some(text) = block.get("text").and_then(|t| t.as_str()) {
                            if !text.trim().is_empty() {
                                out.push(BackendEvent::AssistantText(text.to_string()));
                            }
                        }
                    }
                    Some("tool_use") => {
                        let name = block
                            .get("name")
                            .and_then(|t| t.as_str())
                            .unwrap_or("tool")
                            .to_string();
                        out.push(BackendEvent::ToolUse {
                            name,
                            detail: tool_detail(block),
                        });
                    }
                    _ => {}
                }
            }
            out
        }
        Some("result") => {
            let getf = |ptr: &str| json.pointer(ptr).and_then(|v| v.as_i64()).unwrap_or(0);
            vec![BackendEvent::Completed {
                is_error: json.get("is_error").and_then(|e| e.as_bool()).unwrap_or(false),
                cost_usd: json.get("total_cost_usd").and_then(|c| c.as_f64()).unwrap_or(0.0),
                duration_ms: json.get("duration_ms").and_then(|d| d.as_i64()).unwrap_or(0),
                input_tokens: getf("/usage/input_tokens"),
                output_tokens: getf("/usage/output_tokens"),
            }]
        }
        _ => vec![],
    }
}

/// Short human-readable detail for a tool_use content block.
fn tool_detail(block: &serde_json::Value) -> String {
    let input = match block.get("input") {
        Some(i) => i,
        None => return String::new(),
    };
    for key in ["file_path", "command", "query", "pattern", "path"] {
        if let Some(v) = input.get(key).and_then(|v| v.as_str()) {
            let truncated: String = v.chars().take(60).collect();
            return if v.chars().count() > 60 {
                format!("{truncated}…")
            } else {
                truncated
            };
        }
    }
    String::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn init_yields_session_started() {
        let j = serde_json::json!({"type":"system","subtype":"init","model":"claude-sonnet-5"});
        assert_eq!(
            events_from_line(&j),
            vec![BackendEvent::SessionStarted { model: "claude-sonnet-5".into() }]
        );
    }

    #[test]
    fn hook_system_is_ignored() {
        let j = serde_json::json!({"type":"system","subtype":"hook_started"});
        assert!(events_from_line(&j).is_empty());
    }

    #[test]
    fn assistant_yields_text_then_tool() {
        let j = serde_json::json!({
            "type":"assistant",
            "message":{"content":[
                {"type":"text","text":"I'll read it."},
                {"type":"tool_use","name":"Read","input":{"file_path":"src/main.rs"}}
            ]}
        });
        let evs = events_from_line(&j);
        assert_eq!(evs.len(), 2);
        assert_eq!(evs[0], BackendEvent::AssistantText("I'll read it.".into()));
        assert_eq!(evs[1], BackendEvent::ToolUse { name: "Read".into(), detail: "src/main.rs".into() });
    }

    #[test]
    fn result_yields_completed() {
        let j = serde_json::json!({
            "type":"result","is_error":false,"total_cost_usd":0.05,"duration_ms":1200,
            "usage":{"input_tokens":10,"output_tokens":20}
        });
        assert_eq!(
            events_from_line(&j),
            vec![BackendEvent::Completed {
                is_error: false, cost_usd: 0.05, duration_ms: 1200,
                input_tokens: 10, output_tokens: 20,
            }]
        );
    }
}
