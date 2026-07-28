use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// Represents a running (or stopped) AI agent session launched in an external terminal.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentSession {
    pub id: String,
    /// The type of agent: "claude", "codex", or "custom".
    pub agent_type: String,
    /// Human-readable name shown in the terminal window title, e.g. "Claude 1".
    pub display_name: String,
    /// Current lifecycle status: "running" or "stopped".
    pub status: String,
    /// OS process ID of the spawned terminal, if available.
    pub pid: Option<u32>,
    /// The project this session belongs to.
    pub project_id: String,
    /// Context/instructions injected into the agent session.
    pub instructions: Option<String>,
    /// ISO-8601 timestamp of when the session was created.
    pub created_at: String,
}

/// Parameters for launching one or more agent sessions.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LaunchRequest {
    /// The type of agent to launch: "claude", "codex", or "custom".
    pub agent_type: String,
    /// How many parallel sessions to spawn (1-6).
    pub count: u32,
    /// The project these sessions belong to.
    pub project_id: String,
    /// Filesystem path to the project root (used as working directory).
    pub project_path: String,
    /// Optional initial instructions/prompt to pass to the agent CLI.
    pub instructions: Option<String>,
}

/// Shared, thread-safe container for active agent sessions keyed by session ID.
pub type AgentSessionState = Arc<Mutex<HashMap<String, AgentSession>>>;
