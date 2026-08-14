//! Planning strategies — turn a task (or a change request) into a plan draft.
//!
//! A [`Planner`] drives a live [`Conversation`] to produce a [`PlanDraft`]: the
//! raw, id-less shape the agent emits. The `PlanSession` service assigns ids,
//! ordinals, and versions when persisting the draft as a `Plan`.
//!
//! [`lite::LitePlanner`] is the lean, ponytail-style default; `GsdPlanner`
//! (Phase 6) will implement the same trait by driving the GSD skill.

pub mod gsd;
pub mod lite;

use serde::{Deserialize, Serialize};

use super::conversation::Conversation;
use super::error::Result;

/// A plan as emitted by the agent, before persistence assigns ids/ordinals.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PlanDraft {
    pub goal: String,
    pub summary_md: String,
    pub steps: Vec<StepDraft>,
}

/// One step of a [`PlanDraft`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StepDraft {
    pub title: String,
    pub detail_md: String,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub files: Vec<String>,
    #[serde(default)]
    pub commands: Vec<String>,
}

/// Produces and revises plans over a conversation.
///
/// `Send` so a `Box<dyn Planner>` can live inside a `PlanSession` held in the
/// app's session registry across threads.
pub trait Planner: Send {
    /// Produce the first plan for a task.
    fn produce(&self, convo: &Conversation, task: &str) -> Result<PlanDraft>;

    /// Revise the current plan given a change request. Relies on the session
    /// retaining the current plan in context (no re-send needed).
    fn revise(&self, convo: &Conversation, feedback: &str) -> Result<PlanDraft>;
}
