//! The `PlanSession` service — the orchestration lifecycle.
//!
//! Owns the live [`Conversation`] and a [`Planner`], and drives one task from
//! `Planning → Reviewing → Executing`: produce a plan, let the developer
//! edit/ask/revise/approve, then confirm. It composes the pure [`plan_ops`]
//! functions with the conversation and a [`PlanStore`], so the flow is fully
//! testable with an in-memory store and a scripted backend.
//!
//! Execution of a confirmed plan is Phase 5.

use std::sync::Arc;

use super::backend::{AgentBackend, SessionConfig};
use super::conversation::Conversation;
use super::error::{OrchestratorError, Result};
use super::models::{
    OrchestrationSession, Plan, PlanQa, PlanStatus, SessionStatus, StepStatus, LOCAL_ORG_ID,
};
use super::plan_ops::{apply_step_edit, can_confirm, draft_to_plan, merge_revision, StepEdit};
use super::planner::Planner;

/// Instruction that flips the session from planning to implementation. The plan
/// is already in the session's context (same conversation), so this stays lean.
const EXECUTION_PROMPT: &str = "The plan above is approved. Implement it now, \
     working through the steps in order. Be lean — make the minimal changes that \
     fully accomplish each step, and actually apply the edits and run the necessary \
     commands. When finished, give a brief summary of what changed.";

fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

/// Parameters for starting a new orchestration session.
pub struct BeginParams {
    pub project_id: String,
    pub task: String,
    pub use_gsd: bool,
    pub permission_mode: String,
}

/// A live plan-first orchestration session.
pub struct PlanSession {
    session: OrchestrationSession,
    plan: Option<Plan>,
    convo: Conversation,
    planner: Box<dyn Planner>,
    store: Arc<dyn super::store::PlanStore>,
}

impl PlanSession {
    /// Start a session: persist it, open the agent conversation, produce plan v1.
    pub fn begin(
        backend: &dyn AgentBackend,
        planner: Box<dyn Planner>,
        store: Arc<dyn super::store::PlanStore>,
        config: SessionConfig,
        params: BeginParams,
    ) -> Result<Self> {
        let session = OrchestrationSession {
            id: new_id(),
            org_id: LOCAL_ORG_ID.to_string(),
            project_id: params.project_id,
            task: params.task.clone(),
            backend: backend.id().to_string(),
            use_gsd: params.use_gsd,
            permission_mode: params.permission_mode,
            status: SessionStatus::Planning,
            created_by: None,
            created_at: now(),
            updated_at: now(),
        };
        store.save_session(&session)?;

        let convo = Conversation::start(backend, config)?;
        let draft = planner.produce(&convo, &params.task)?;
        let plan = draft_to_plan(&draft, &session.id, 1);
        store.save_plan(&plan)?;
        store.update_session_status(&session.id, SessionStatus::Reviewing)?;

        let mut session = session;
        session.status = SessionStatus::Reviewing;

        Ok(Self {
            session,
            plan: Some(plan),
            convo,
            planner,
            store,
        })
    }

    /// The session's metadata.
    pub fn session(&self) -> &OrchestrationSession {
        &self.session
    }

    /// The current plan version.
    pub fn plan(&self) -> Option<&Plan> {
        self.plan.as_ref()
    }

    fn plan_mut(&mut self) -> Result<&mut Plan> {
        self.plan
            .as_mut()
            .ok_or_else(|| OrchestratorError::NotFound("no active plan".into()))
    }

    fn require_plan(&self) -> Result<&Plan> {
        self.plan
            .as_ref()
            .ok_or_else(|| OrchestratorError::NotFound("no active plan".into()))
    }

    /// Apply a developer edit to a step (authoritative — preserved on revision).
    pub fn edit_step(&mut self, step_id: &str, edit: StepEdit) -> Result<()> {
        let plan_id = self.require_plan()?.id.clone();
        let step = self
            .plan_mut()?
            .steps
            .iter_mut()
            .find(|s| s.id == step_id)
            .ok_or_else(|| OrchestratorError::NotFound(format!("step {step_id}")))?;
        apply_step_edit(step, edit);
        let step = step.clone();
        self.store.update_step(&plan_id, &step)
    }

    /// Ask a question about a step or design decision; returns the answer and
    /// records the exchange. Does not mutate the plan.
    pub fn ask(&self, question: &str, step_id: Option<String>) -> Result<String> {
        let out = self.convo.ask(question)?;
        if out.is_error {
            return Err(OrchestratorError::Backend(format!(
                "question turn failed: {}",
                out.stderr.trim()
            )));
        }
        let qa = PlanQa {
            id: new_id(),
            session_id: self.session.id.clone(),
            step_id,
            question: question.to_string(),
            answer: out.text.clone(),
            created_at: now(),
        };
        self.store.save_qa(&qa)?;
        Ok(out.text)
    }

    /// Request a change; produces a new plan version preserving user-edited steps.
    pub fn revise(&mut self, feedback: &str) -> Result<()> {
        let draft = self.planner.revise(&self.convo, feedback)?;
        let prev = self.require_plan()?;
        let merged = merge_revision(prev, &draft, prev.version + 1);
        self.store.save_plan(&merged)?;
        self.plan = Some(merged);
        Ok(())
    }

    /// Approve a single step.
    pub fn approve_step(&mut self, step_id: &str) -> Result<()> {
        let plan_id = self.require_plan()?.id.clone();
        let step = self
            .plan_mut()?
            .steps
            .iter_mut()
            .find(|s| s.id == step_id)
            .ok_or_else(|| OrchestratorError::NotFound(format!("step {step_id}")))?;
        step.status = StepStatus::Approved;
        let step = step.clone();
        self.store.update_step(&plan_id, &step)
    }

    /// Approve every step at once.
    pub fn approve_all(&mut self) -> Result<()> {
        let plan_id = self.require_plan()?.id.clone();
        let steps: Vec<_> = {
            let plan = self.plan_mut()?;
            for s in &mut plan.steps {
                s.status = StepStatus::Approved;
            }
            plan.steps.clone()
        };
        for step in &steps {
            self.store.update_step(&plan_id, step)?;
        }
        Ok(())
    }

    /// Confirm the plan (requires every step approved) and move to execution.
    pub fn confirm(&mut self) -> Result<()> {
        {
            let plan = self.require_plan()?;
            if !can_confirm(plan) {
                return Err(OrchestratorError::Validation(
                    "every step must be approved before confirming".into(),
                ));
            }
        }
        if let Some(plan) = self.plan.as_mut() {
            plan.status = PlanStatus::Confirmed;
            self.store.save_plan(plan)?;
        }
        self.session.status = SessionStatus::Executing;
        self.store
            .update_session_status(&self.session.id, SessionStatus::Executing)
    }

    /// Execute the confirmed plan through the live session, streaming each event
    /// to `on_event`. On success every step is marked done and the session
    /// completes; on failure the session is marked errored.
    ///
    /// Requires the session to be in `Executing` (i.e. [`confirm`] already ran).
    /// ponytail: holds the session for the whole run — cancel-during-execution is
    /// a follow-up; today the run completes or the session is closed.
    pub fn execute<F: FnMut(&super::backend::BackendEvent)>(
        &mut self,
        on_event: F,
    ) -> Result<()> {
        if self.session.status != SessionStatus::Executing {
            return Err(OrchestratorError::Validation(
                "plan must be confirmed before executing".into(),
            ));
        }

        let out = self.convo.ask_streaming(EXECUTION_PROMPT, on_event)?;

        if out.is_error {
            self.session.status = SessionStatus::Errored;
            self.store
                .update_session_status(&self.session.id, SessionStatus::Errored)?;
            return Err(OrchestratorError::Backend(format!(
                "execution failed: {}",
                out.stderr.trim()
            )));
        }

        if let Some(plan) = self.plan.as_mut() {
            for step in &mut plan.steps {
                step.status = StepStatus::Done;
            }
        }
        self.session.status = SessionStatus::Done;
        self.store
            .update_session_status(&self.session.id, SessionStatus::Done)
    }

    /// Cancel the session and stop the underlying agent.
    pub fn cancel(&mut self) -> Result<()> {
        let _ = self.convo.stop();
        self.session.status = SessionStatus::Cancelled;
        self.store
            .update_session_status(&self.session.id, SessionStatus::Cancelled)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::orchestrator::backend::BackendEvent;
    use crate::modules::orchestrator::conversation::test_support::{test_config, MockBackend};
    use crate::modules::orchestrator::planner::lite::LitePlanner;
    use crate::modules::orchestrator::store::memory::InMemoryStore;

    fn completed() -> BackendEvent {
        BackendEvent::Completed {
            is_error: false,
            cost_usd: 0.0,
            duration_ms: 1,
            input_tokens: 1,
            output_tokens: 1,
        }
    }

    fn plan_json(goal: &str, steps: &[&str]) -> String {
        let steps: Vec<_> = steps
            .iter()
            .map(|t| {
                serde_json::json!({
                    "title": t, "detail_md": "detail", "model": "sonnet",
                    "files": [], "commands": []
                })
            })
            .collect();
        serde_json::json!({ "goal": goal, "summary_md": "s", "steps": steps }).to_string()
    }

    fn begin_session(store: Arc<InMemoryStore>, scripts: Vec<Vec<BackendEvent>>) -> PlanSession {
        let backend = MockBackend { scripts };
        PlanSession::begin(
            &backend,
            Box::new(LitePlanner),
            store,
            test_config(),
            BeginParams {
                project_id: "proj".into(),
                task: "build a thing".into(),
                use_gsd: false,
                permission_mode: "acceptEdits".into(),
            },
        )
        .unwrap()
    }

    #[test]
    fn begin_produces_plan_and_enters_reviewing() {
        let store = Arc::new(InMemoryStore::default());
        let s = begin_session(
            store.clone(),
            vec![vec![
                BackendEvent::AssistantText(plan_json("Goal", &["A", "B"])),
                completed(),
            ]],
        );
        assert_eq!(s.session().status, SessionStatus::Reviewing);
        assert_eq!(s.plan().unwrap().steps.len(), 2);
        assert_eq!(store.plan_count(), 1);
        assert_eq!(store.session_status(&s.session().id), Some(SessionStatus::Reviewing));
    }

    #[test]
    fn edit_then_confirm_requires_all_approved() {
        let store = Arc::new(InMemoryStore::default());
        let mut s = begin_session(
            store.clone(),
            vec![vec![
                BackendEvent::AssistantText(plan_json("Goal", &["A", "B"])),
                completed(),
            ]],
        );
        let step0 = s.plan().unwrap().steps[0].id.clone();

        // Edit locks the step; confirm still blocked until all approved.
        s.edit_step(&step0, StepEdit { detail_md: Some("mine".into()), ..Default::default() }).unwrap();
        assert!(s.plan().unwrap().steps[0].user_edited);
        assert!(s.confirm().is_err());

        s.approve_all().unwrap();
        s.confirm().unwrap();
        assert_eq!(s.session().status, SessionStatus::Executing);
        assert_eq!(s.plan().unwrap().status, PlanStatus::Confirmed);
    }

    #[test]
    fn revise_bumps_version_and_preserves_edit() {
        let store = Arc::new(InMemoryStore::default());
        let mut s = begin_session(
            store.clone(),
            vec![
                // begin → plan v1
                vec![BackendEvent::AssistantText(plan_json("Goal", &["Keep", "Drop"])), completed()],
                // revise → plan v2 (same "Keep" title, plus a new step)
                vec![BackendEvent::AssistantText(plan_json("Goal", &["Keep", "New"])), completed()],
            ],
        );
        let keep_id = s.plan().unwrap().steps[0].id.clone();
        s.edit_step(&keep_id, StepEdit { detail_md: Some("EDITED".into()), ..Default::default() }).unwrap();

        s.revise("change it").unwrap();
        let plan = s.plan().unwrap();
        assert_eq!(plan.version, 2);
        let keep = plan.steps.iter().find(|s| s.title == "Keep").unwrap();
        assert_eq!(keep.detail_md, "EDITED"); // authoritative edit preserved
        assert!(keep.user_edited);
        assert!(plan.steps.iter().any(|s| s.title == "New"));
        assert_eq!(store.plan_count(), 2);
    }

    #[test]
    fn execute_marks_done_and_streams_events() {
        let store = Arc::new(InMemoryStore::default());
        let mut s = begin_session(
            store.clone(),
            vec![
                vec![BackendEvent::AssistantText(plan_json("Goal", &["A", "B"])), completed()],
                vec![BackendEvent::AssistantText("Implementing…".into()), completed()],
            ],
        );
        s.approve_all().unwrap();
        s.confirm().unwrap();

        let mut count = 0;
        s.execute(|_| count += 1).unwrap();

        assert_eq!(s.session().status, SessionStatus::Done);
        assert!(s.plan().unwrap().steps.iter().all(|st| st.status == StepStatus::Done));
        assert!(count > 0, "execution should stream events");
    }

    #[test]
    fn execute_requires_confirmation() {
        let store = Arc::new(InMemoryStore::default());
        let mut s = begin_session(
            store,
            vec![vec![BackendEvent::AssistantText(plan_json("Goal", &["A"])), completed()]],
        );
        // Still in Reviewing — execute must refuse.
        assert!(s.execute(|_| {}).is_err());
    }

    #[test]
    fn ask_records_qa_without_changing_plan() {
        let store = Arc::new(InMemoryStore::default());
        let s = begin_session(
            store.clone(),
            vec![
                vec![BackendEvent::AssistantText(plan_json("Goal", &["A"])), completed()],
                vec![BackendEvent::AssistantText("Because it's simpler.".into()), completed()],
            ],
        );
        let answer = s.ask("why this approach?", None).unwrap();
        assert!(answer.contains("simpler"));
        assert_eq!(store.qa_count(), 1);
        assert_eq!(s.plan().unwrap().version, 1); // unchanged
    }
}
