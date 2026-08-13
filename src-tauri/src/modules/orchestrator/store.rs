//! Persistence abstraction for orchestration state.
//!
//! `PlanSession` depends on this trait, not on Postgres directly, so the whole
//! lifecycle is testable with an in-memory store and the real `sqlx` adapter
//! (Phase 1 continued) drops in behind the same interface once the onboarding DB
//! path is settled.

use super::error::Result;
use super::models::{OrchestrationSession, Plan, PlanQa, PlanStep, SessionStatus};

/// Writes orchestration state to durable storage.
pub trait PlanStore: Send + Sync {
    /// Persist a newly-created session.
    fn save_session(&self, session: &OrchestrationSession) -> Result<()>;
    /// Update a session's lifecycle status.
    fn update_session_status(&self, id: &str, status: SessionStatus) -> Result<()>;
    /// Persist a plan version and its steps.
    fn save_plan(&self, plan: &Plan) -> Result<()>;
    /// Update a single step (after an edit or status change).
    fn update_step(&self, plan_id: &str, step: &PlanStep) -> Result<()>;
    /// Persist a question/answer exchange.
    fn save_qa(&self, qa: &PlanQa) -> Result<()>;
}

/// A no-op store: orchestration state lives only in the in-memory session
/// registry. Used until the Postgres adapter is wired (persistence enables
/// reconnect and the remote sub-project); the loop is fully functional without
/// it, just not durable across restarts.
pub struct NullStore;

impl PlanStore for NullStore {
    fn save_session(&self, _session: &OrchestrationSession) -> Result<()> {
        Ok(())
    }
    fn update_session_status(&self, _id: &str, _status: SessionStatus) -> Result<()> {
        Ok(())
    }
    fn save_plan(&self, _plan: &Plan) -> Result<()> {
        Ok(())
    }
    fn update_step(&self, _plan_id: &str, _step: &PlanStep) -> Result<()> {
        Ok(())
    }
    fn save_qa(&self, _qa: &PlanQa) -> Result<()> {
        Ok(())
    }
}

#[cfg(test)]
pub(crate) mod memory {
    //! In-memory `PlanStore` for tests.
    use super::*;
    use std::sync::Mutex;

    #[derive(Default)]
    pub struct InMemoryStore {
        inner: Mutex<Inner>,
    }

    #[derive(Default)]
    struct Inner {
        pub sessions: Vec<OrchestrationSession>,
        pub plans: Vec<Plan>,
        pub qa: Vec<PlanQa>,
        pub step_updates: usize,
    }

    impl InMemoryStore {
        pub fn plan_count(&self) -> usize {
            self.inner.lock().unwrap().plans.len()
        }
        pub fn session_status(&self, id: &str) -> Option<SessionStatus> {
            self.inner
                .lock()
                .unwrap()
                .sessions
                .iter()
                .find(|s| s.id == id)
                .map(|s| s.status)
        }
        pub fn qa_count(&self) -> usize {
            self.inner.lock().unwrap().qa.len()
        }
    }

    impl PlanStore for InMemoryStore {
        fn save_session(&self, session: &OrchestrationSession) -> Result<()> {
            self.inner.lock().unwrap().sessions.push(session.clone());
            Ok(())
        }
        fn update_session_status(&self, id: &str, status: SessionStatus) -> Result<()> {
            let mut inner = self.inner.lock().unwrap();
            if let Some(s) = inner.sessions.iter_mut().find(|s| s.id == id) {
                s.status = status;
            }
            Ok(())
        }
        fn save_plan(&self, plan: &Plan) -> Result<()> {
            self.inner.lock().unwrap().plans.push(plan.clone());
            Ok(())
        }
        fn update_step(&self, _plan_id: &str, _step: &PlanStep) -> Result<()> {
            self.inner.lock().unwrap().step_updates += 1;
            Ok(())
        }
        fn save_qa(&self, qa: &PlanQa) -> Result<()> {
            self.inner.lock().unwrap().qa.push(qa.clone());
            Ok(())
        }
    }
}
