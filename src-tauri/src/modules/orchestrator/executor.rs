//! Model-tiered step executor.
//!
//! Runs a confirmed plan by giving **each step its own subagent on the step's
//! assigned model** (haiku/sonnet/opus). Sequential today — safe in the shared
//! repo, no merge conflicts — and it makes the model tiering provable and
//! visible ("step 2 → haiku"). Parallelizing independent (disjoint-file) steps
//! via a git-worktree pool is the documented fast-follow.
//!
//! Each step subagent gets a **focused prompt** (goal + prior outcomes + this
//! step), not the whole project context — narrow scope is cheaper, which is the
//! token moat in action.

use super::backend::{AgentBackend, BackendEvent, SessionConfig};
use super::conversation::Conversation;
use super::error::Result;
use super::models::{Plan, PlanStep};

/// Resolve a step's suggested tier to a concrete model, defaulting to mid-tier.
fn step_model(step: &PlanStep) -> String {
    match step.model.as_deref() {
        Some(m) if !m.trim().is_empty() => m.trim().to_string(),
        _ => "sonnet".to_string(),
    }
}

/// The result of running one step's subagent.
pub struct StepOutcome {
    pub step_id: String,
    pub ok: bool,
    pub summary: String,
}

/// Execute the plan's steps sequentially, each on its own model-tiered subagent.
/// `on_event` receives every backend event tagged with the step it belongs to.
pub fn run_tiered<F: FnMut(&BackendEvent, &PlanStep)>(
    backend: &dyn AgentBackend,
    base: &SessionConfig,
    plan: &Plan,
    mut on_event: F,
) -> Result<Vec<StepOutcome>> {
    let mut outcomes = Vec::new();
    let mut prior: Vec<String> = Vec::new();

    for step in &plan.steps {
        let cfg = SessionConfig {
            model: Some(step_model(step)),
            ..base.clone()
        };
        let convo = Conversation::start(backend, cfg)?;
        let prompt = build_step_prompt(&plan.goal, &prior, step);
        let out = convo.ask_streaming(&prompt, |ev| on_event(ev, step))?;
        let _ = convo.stop();

        let ok = !out.is_error;
        prior.push(format!("- {} ({})", step.title, if ok { "done" } else { "FAILED" }));
        outcomes.push(StepOutcome {
            step_id: step.id.clone(),
            ok,
            summary: out.text.clone(),
        });
        if !ok {
            break; // stop the pipeline on the first failed step
        }
    }
    Ok(outcomes)
}

/// Build a focused prompt for a single step's subagent.
fn build_step_prompt(goal: &str, prior: &[String], step: &PlanStep) -> String {
    let prior_block = if prior.is_empty() {
        "(this is the first step)".to_string()
    } else {
        prior.join("\n")
    };
    let files = if step.files.is_empty() {
        String::new()
    } else {
        format!("\nRelevant files: {}", step.files.join(", "))
    };
    format!(
        "You are implementing ONE step of an approved plan. Be lean — make only \
         the change this step calls for, and actually apply it.\n\n\
         Overall goal: {goal}\n\n\
         Completed so far:\n{prior_block}\n\n\
         YOUR STEP: {title}\n{detail}{files}\n\n\
         Do the work now. When finished, reply with a one-line summary of what you changed.",
        title = step.title,
        detail = step.detail_md,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::orchestrator::models::{PlanStatus, StepStatus};

    fn step(title: &str, model: Option<&str>) -> PlanStep {
        PlanStep {
            id: format!("id-{title}"),
            ordinal: 0,
            title: title.into(),
            detail_md: "detail".into(),
            model: model.map(String::from),
            files: vec![],
            commands: vec![],
            status: StepStatus::Approved,
            user_edited: false,
        }
    }

    #[test]
    fn step_model_defaults_to_sonnet() {
        assert_eq!(step_model(&step("a", None)), "sonnet");
        assert_eq!(step_model(&step("a", Some("haiku"))), "haiku");
        assert_eq!(step_model(&step("a", Some(""))), "sonnet");
    }

    #[test]
    fn step_prompt_is_focused_and_names_the_step() {
        let p = build_step_prompt("Add auth", &["- Setup (done)".into()], &step("Add login", None));
        assert!(p.contains("Add auth"));
        assert!(p.contains("Add login"));
        assert!(p.contains("Setup (done)"));
        assert!(p.to_lowercase().contains("one step"));
    }

    #[test]
    fn run_tiered_runs_each_step_and_reports_ok() {
        use crate::modules::orchestrator::backend::BackendEvent;
        use crate::modules::orchestrator::conversation::test_support::{test_config, MockBackend};

        let backend = MockBackend {
            scripts: vec![vec![
                BackendEvent::AssistantText("did it".into()),
                BackendEvent::Completed {
                    is_error: false,
                    cost_usd: 0.0,
                    duration_ms: 1,
                    input_tokens: 1,
                    output_tokens: 1,
                },
            ]],
        };
        let plan = Plan {
            id: "p".into(),
            session_id: "s".into(),
            version: 1,
            goal: "g".into(),
            summary_md: "s".into(),
            status: PlanStatus::Confirmed,
            steps: vec![step("a", Some("haiku")), step("b", Some("opus"))],
            created_at: "now".into(),
        };
        let mut events = 0;
        let outcomes = run_tiered(&backend, &test_config(), &plan, |_, _| events += 1).unwrap();
        assert_eq!(outcomes.len(), 2);
        assert!(outcomes.iter().all(|o| o.ok));
        assert!(events > 0);
    }

    // Guard that a Plan with tiered steps is the shape run_tiered expects.
    #[test]
    fn plan_shape_smoke() {
        let plan = Plan {
            id: "p".into(),
            session_id: "s".into(),
            version: 1,
            goal: "g".into(),
            summary_md: "s".into(),
            status: PlanStatus::Confirmed,
            steps: vec![step("a", Some("haiku")), step("b", Some("opus"))],
            created_at: "now".into(),
        };
        assert_eq!(plan.steps.len(), 2);
        assert_eq!(step_model(&plan.steps[1]), "opus");
    }
}
