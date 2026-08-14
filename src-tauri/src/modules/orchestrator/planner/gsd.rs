//! The GSD (get-shit-done) planner — the thorough, methodology-driven variant.
//!
//! Unlike [`super::lite::LitePlanner`], this planner first grounds itself in the
//! actual codebase and applies GSD's rigor — explicit dependency ordering, risk
//! awareness, and a verification step per unit of work — before emitting the
//! plan. It reuses the shared JSON schema, parsing, and repair path so the
//! output is interchangeable with the lean planner's; only the depth differs.
//!
//! If the GSD skill suite is installed in the agent's environment, the prompt
//! invites it to apply that methodology; otherwise the same principles are
//! followed inline. Full integration with GSD's `.planning/` workspace lifecycle
//! is a later enhancement — this keeps the loop backend-agnostic and reliable.

use super::lite::{build_revise_prompt, parse_or_repair, SCHEMA_BLOCK};
use super::{PlanDraft, Planner};
use crate::modules::orchestrator::conversation::Conversation;
use crate::modules::orchestrator::error::{OrchestratorError, Result};

/// Thorough planner: grounds in the codebase, applies GSD rigor, same schema.
pub struct GsdPlanner;

impl Planner for GsdPlanner {
    fn produce(&self, convo: &Conversation, task: &str) -> Result<PlanDraft> {
        let out = convo.ask(&build_gsd_prompt(task))?;
        if out.is_error {
            return Err(OrchestratorError::Planner(format!(
                "planner turn failed: {}",
                out.stderr.trim()
            )));
        }
        parse_or_repair(convo, &out.text)
    }

    fn revise(&self, convo: &Conversation, feedback: &str) -> Result<PlanDraft> {
        let out = convo.ask(&build_revise_prompt(feedback))?;
        if out.is_error {
            return Err(OrchestratorError::Planner(format!(
                "revision turn failed: {}",
                out.stderr.trim()
            )));
        }
        parse_or_repair(convo, &out.text)
    }
}

fn build_gsd_prompt(task: &str) -> String {
    format!(
        "You are producing a rigorous implementation plan for a developer to \
         review. Apply the get-shit-done (GSD) methodology: if the GSD skills are \
         available in your environment, use their planning approach; otherwise \
         follow these principles directly.\n\n\
         First, ground yourself in the actual codebase — read the key files, \
         scripts, and conventions relevant to the task. Do NOT write code or make \
         changes yet; only investigate and plan.\n\n\
         TASK:\n{task}\n\n\
         Then output ONLY a JSON object (optionally in a ```json fence) with this \
         exact shape:\n{SCHEMA_BLOCK}\n\n\
         Requirements for a GSD-grade plan:\n\
         - Ground every step in what the code actually is — reference real files.\n\
         - Order steps strictly by dependency; call out risks in the step detail.\n\
         - Include a verification step (tests or a concrete check) for the work.\n\
         - Set \"model\" per step by difficulty: haiku for mechanical, sonnet for \
         normal, opus for hard reasoning.\n\
         - Be complete but lean — no filler steps.\n\
         - Output the JSON object and nothing else."
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gsd_prompt_grounds_and_forbids_early_code() {
        let p = build_gsd_prompt("add auth");
        assert!(p.contains("codebase"));
        assert!(p.contains("verification"));
        assert!(p.to_lowercase().contains("do not write code"));
        assert!(p.contains("add auth"));
    }
}
