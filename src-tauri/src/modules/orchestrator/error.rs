//! Typed errors for the orchestrator module.
//!
//! Commands surface these to the frontend as strings via the `Serialize` impl,
//! so the IPC boundary never leaks a raw `String` from deep in the stack.

/// Errors produced anywhere in the orchestration engine.
#[derive(Debug, thiserror::Error)]
pub enum OrchestratorError {
    /// Input failed validation at a trust boundary.
    #[error("validation error: {0}")]
    Validation(String),

    /// A referenced session/plan/step does not exist.
    #[error("not found: {0}")]
    NotFound(String),

    /// The agent backend (Claude/Codex/…) failed to start, stream, or respond.
    #[error("backend error: {0}")]
    Backend(String),

    /// The planner failed to produce or revise a plan.
    #[error("planner error: {0}")]
    Planner(String),

    /// The planner returned output that could not be parsed into a valid plan.
    #[error("invalid plan output: {0}")]
    InvalidPlan(String),

    /// A database/persistence operation failed.
    #[error("database error: {0}")]
    Database(String),
}

impl serde::Serialize for OrchestratorError {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

/// Convenience alias for orchestrator results.
pub type Result<T> = std::result::Result<T, OrchestratorError>;
