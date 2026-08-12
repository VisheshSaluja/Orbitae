//! Domain models for the plan-first orchestration engine.
//!
//! These are the transport/domain types shared across the service, repository,
//! and Tauri IPC boundary. IDs and timestamps are strings (UUID / RFC3339) to
//! match the existing agent-session convention and to serialize cleanly over IPC;
//! the repository layer maps them to their Postgres `UUID` / `TIMESTAMPTZ` columns.

use serde::{Deserialize, Serialize};

/// The default organization id used for solo/local (non-multitenant) use.
///
/// Every orchestration row is tenant-scoped; solo installs all belong to this
/// single org until the enterprise multitenancy tier is activated.
pub const LOCAL_ORG_ID: &str = "00000000-0000-0000-0000-000000000001";

/// Lifecycle state of an orchestration session.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionStatus {
    Planning,
    Reviewing,
    Executing,
    Done,
    Errored,
    Cancelled,
}

/// Review state of a specific plan version.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlanStatus {
    Draft,
    Reviewing,
    Confirmed,
}

/// Execution state of an individual plan step.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StepStatus {
    Pending,
    Approved,
    Done,
    Failed,
}

/// The phase of the loop a skill applies to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SkillPhase {
    Plan,
    Execute,
    Review,
    Any,
}

/// One orchestration lifecycle for a complex task.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrchestrationSession {
    pub id: String,
    pub org_id: String,
    pub project_id: String,
    pub task: String,
    pub backend: String,
    pub use_gsd: bool,
    /// Reuses the agent-session permission model ("acceptEdits" | "skip").
    pub permission_mode: String,
    pub status: SessionStatus,
    pub created_by: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// A versioned plan. A new version is created each time the user accepts a
/// revision request; user-edited steps are carried forward verbatim.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Plan {
    pub id: String,
    pub session_id: String,
    pub version: i32,
    pub goal: String,
    /// Markdown overview (rendered richly in the UI, never as raw pipes/slashes).
    pub summary_md: String,
    pub status: PlanStatus,
    pub steps: Vec<PlanStep>,
    pub created_at: String,
}

/// A single step in a plan. Hybrid: structured skeleton + rich markdown body.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanStep {
    pub id: String,
    pub ordinal: i32,
    pub title: String,
    /// Markdown body (may contain Mermaid fences / GFM tables), rendered richly.
    pub detail_md: String,
    /// Suggested agent/model for this step (used by SP2 model-tiered delegation).
    pub model: Option<String>,
    pub files: Vec<String>,
    pub commands: Vec<String>,
    pub status: StepStatus,
    /// When true, the user edited this step and the planner must not overwrite it.
    pub user_edited: bool,
}

/// An answer to a user question about a step or design decision. Does not mutate
/// the plan — it is a clarification the developer requested.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanQa {
    pub id: String,
    pub session_id: String,
    pub step_id: Option<String>,
    pub question: String,
    pub answer: String,
    pub created_at: String,
}

/// A bounded, human-facing record of an influential agent decision.
///
/// Deliberately small: it is rendered for the developer to trace *why* something
/// was done, and is NOT re-injected into the agent's context on every turn
/// (only fetched on an explicit "why did you..." query). This is the guard
/// against hallucination and input-token bloat.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Decision {
    pub id: String,
    pub session_id: String,
    pub step_id: Option<String>,
    pub summary: String,
    pub rationale: String,
    pub tradeoffs: Option<String>,
    pub alternatives: Option<String>,
    pub created_at: String,
}

/// A registered, upgradable skill (e.g. GSD, ponytail). Invoked by reference so
/// the underlying open-source skill upgrades independently of the app.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillDef {
    pub id: String,
    pub name: String,
    pub version: String,
    pub source: String,
    pub phase: SkillPhase,
    pub backends: Vec<String>,
    /// Backend-specific invocation details (skill name, slash command, prompt).
    pub invocation: serde_json::Value,
    pub enabled: bool,
}

/// One entry in a session's ordered, authoritative event stream. `seq` is
/// monotonic per session so a reconnecting client can replay from its last seen
/// sequence number — the foundation for the remote sub-project.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrchestrationEvent {
    pub id: String,
    pub session_id: String,
    pub seq: i64,
    #[serde(rename = "type")]
    pub event_type: String,
    pub payload: serde_json::Value,
    pub created_at: String,
}

/// Maximum lengths for decision-trail fields, enforced by `DecisionRecorder` so
/// the trail stays scannable and cheap. Public so tests and the recorder share them.
pub const DECISION_SUMMARY_MAX: usize = 160;
pub const DECISION_TEXT_MAX: usize = 600;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_status_serializes_snake_case() {
        let json = serde_json::to_string(&SessionStatus::Reviewing).unwrap();
        assert_eq!(json, "\"reviewing\"");
    }

    #[test]
    fn event_type_field_renamed_to_type() {
        let ev = OrchestrationEvent {
            id: "e1".into(),
            session_id: "s1".into(),
            seq: 1,
            event_type: "plan_ready".into(),
            payload: serde_json::json!({}),
            created_at: "2026-08-12T00:00:00Z".into(),
        };
        let v = serde_json::to_value(&ev).unwrap();
        assert_eq!(v["type"], "plan_ready");
        assert!(v.get("event_type").is_none());
    }

    #[test]
    fn plan_step_roundtrips() {
        let step = PlanStep {
            id: "st1".into(),
            ordinal: 0,
            title: "Add migration".into(),
            detail_md: "## Approach\n...".into(),
            model: Some("sonnet".into()),
            files: vec!["migrations_pg/0001.sql".into()],
            commands: vec![],
            status: StepStatus::Pending,
            user_edited: false,
        };
        let round: PlanStep =
            serde_json::from_str(&serde_json::to_string(&step).unwrap()).unwrap();
        assert_eq!(round.title, "Add migration");
        assert_eq!(round.model.as_deref(), Some("sonnet"));
        assert!(!round.user_edited);
    }
}
