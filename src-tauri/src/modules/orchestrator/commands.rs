//! Tauri IPC surface for the plan-first orchestrator.
//!
//! Sessions live in an in-memory registry (like the embedded/autonomous agent
//! maps). Each session has its own mutex so a long-running turn on one session
//! doesn't block operations on another. Because [`PlanSession`] operations block
//! (they wait on the agent), every command runs the work on a blocking thread.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use sqlx::SqlitePool;
use tauri::{command, AppHandle, Emitter, State};

use super::backend::{claude::ClaudeBackend, BackendEvent, SessionConfig};
use super::error::OrchestratorError;
use super::models::{Plan, SessionStatus};
use super::plan_ops::StepEdit;
use super::planner::lite::LitePlanner;
use super::session::{BeginParams, PlanSession};
use super::store::NullStore;
use crate::modules::agent_sessions::commands::resolve_task_permission_mode;
use crate::modules::agent_sessions::events::TaskPermissionMode;
use crate::shared::validation;

/// String label persisted for a permission mode.
fn permission_label(mode: TaskPermissionMode) -> &'static str {
    match mode {
        TaskPermissionMode::AcceptEdits => "acceptEdits",
        TaskPermissionMode::Skip => "skip",
    }
}

/// Format a streamed execution event into a terminal-friendly line.
fn format_exec_event(ev: &BackendEvent) -> String {
    match ev {
        BackendEvent::SessionStarted { model } => format!("▸ executing (model: {model})"),
        BackendEvent::AssistantText(t) => t.clone(),
        BackendEvent::ToolUse { name, detail } => {
            if detail.is_empty() {
                format!("▸ {name}")
            } else {
                format!("▸ {name}  {detail}")
            }
        }
        BackendEvent::Completed { is_error, cost_usd, duration_ms, .. } => {
            let label = if *is_error { "failed" } else { "done" };
            format!(
                "━━ {label} · {:.1}s · ${:.4}",
                *duration_ms as f64 / 1000.0,
                cost_usd
            )
        }
        BackendEvent::Stderr(s) => format!("[stderr] {s}"),
        BackendEvent::Exited(_) => String::new(),
    }
}

/// In-memory registry of live orchestration sessions, each independently locked.
pub type PlanSessionMap = Arc<Mutex<HashMap<String, Arc<Mutex<PlanSession>>>>>;

/// A snapshot of a session for the frontend.
#[derive(serde::Serialize)]
pub struct SessionView {
    pub session_id: String,
    pub status: SessionStatus,
    pub task: String,
    pub plan: Option<Plan>,
}

impl SessionView {
    fn of(s: &PlanSession) -> Self {
        SessionView {
            session_id: s.session().id.clone(),
            status: s.session().status,
            task: s.session().task.clone(),
            plan: s.plan().cloned(),
        }
    }
}

/// Look up a session and run a blocking operation on it off the async runtime.
async fn run_on_session<T, F>(
    map: PlanSessionMap,
    session_id: String,
    f: F,
) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(&mut PlanSession) -> Result<T, OrchestratorError> + Send + 'static,
{
    let session = {
        let guard = map.lock().map_err(|e| format!("registry lock: {e}"))?;
        guard.get(&session_id).cloned()
    }
    .ok_or_else(|| format!("session not found: {session_id}"))?;

    tokio::task::spawn_blocking(move || {
        let mut s = session.lock().map_err(|e| format!("session lock: {e}"))?;
        f(&mut s).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("task join: {e}"))?
}

/// Start a plan-first session: produce the first plan for a task.
#[command]
pub async fn orchestrator_begin(
    map: State<'_, PlanSessionMap>,
    pool: State<'_, SqlitePool>,
    project_id: String,
    project_path: String,
    task: String,
    use_gsd: bool,
    model: Option<String>,
) -> Result<SessionView, String> {
    validation::validate_id(&project_id).map_err(|e| e.to_string())?;
    validation::validate_path(&project_path).map_err(|e| e.to_string())?;
    validation::validate_content(&task, "task").map_err(|e| e.to_string())?;
    if task.trim().is_empty() {
        return Err("task cannot be empty".into());
    }
    if let Some(ref m) = model {
        if m.starts_with('-') {
            return Err("invalid model name".into());
        }
    }

    // Execution honors the project's Safe/Full permission toggle.
    let permission_mode = resolve_task_permission_mode(pool.inner(), &project_id).await;

    let map = map.inner().clone();
    let cwd = crate::shared::utils::expand_path(&project_path);

    tokio::task::spawn_blocking(move || -> Result<SessionView, String> {
        let config = SessionConfig {
            cwd,
            model,
            permission_mode,
        };
        // The GSD toggle selects the thorough vs lean planner.
        let planner: Box<dyn super::planner::Planner> = if use_gsd {
            Box::new(super::planner::gsd::GsdPlanner)
        } else {
            Box::new(LitePlanner)
        };
        let session = PlanSession::begin(
            &ClaudeBackend,
            planner,
            Arc::new(NullStore),
            config,
            BeginParams {
                project_id,
                task,
                use_gsd,
                permission_mode: permission_label(permission_mode).into(),
            },
        )
        .map_err(|e| e.to_string())?;

        let view = SessionView::of(&session);
        let id = view.session_id.clone();
        map.lock()
            .map_err(|e| format!("registry lock: {e}"))?
            .insert(id, Arc::new(Mutex::new(session)));
        Ok(view)
    })
    .await
    .map_err(|e| format!("task join: {e}"))?
}

/// Execute the confirmed plan, streaming progress lines to the frontend via
/// `orchestrator-progress-{session_id}` events. Returns the final session view.
#[command]
pub async fn orchestrator_execute(
    map: State<'_, PlanSessionMap>,
    app_handle: AppHandle,
    session_id: String,
) -> Result<SessionView, String> {
    validation::validate_id(&session_id).map_err(|e| e.to_string())?;

    let session = {
        let guard = map
            .inner()
            .lock()
            .map_err(|e| format!("registry lock: {e}"))?;
        guard.get(&session_id).cloned()
    }
    .ok_or_else(|| format!("session not found: {session_id}"))?;

    let channel = format!("orchestrator-progress-{session_id}");
    tokio::task::spawn_blocking(move || -> Result<SessionView, String> {
        let mut s = session.lock().map_err(|e| format!("session lock: {e}"))?;
        s.execute(|ev| {
            let line = format_exec_event(ev);
            if !line.is_empty() {
                let _ = app_handle.emit(&channel, line);
            }
        })
        .map_err(|e| e.to_string())?;
        Ok(SessionView::of(&s))
    })
    .await
    .map_err(|e| format!("task join: {e}"))?
}

/// List the installed skills the orchestrator can apply.
#[command]
pub async fn orchestrator_list_skills() -> Result<Vec<super::models::SkillDef>, String> {
    Ok(super::skills::builtin_skills())
}

/// Get the current snapshot of a session.
#[command]
pub async fn orchestrator_get(
    map: State<'_, PlanSessionMap>,
    session_id: String,
) -> Result<SessionView, String> {
    validation::validate_id(&session_id).map_err(|e| e.to_string())?;
    run_on_session(map.inner().clone(), session_id, |s| Ok(SessionView::of(s))).await
}

/// Edit a step's title and/or detail — authoritative (preserved on revision).
#[command]
pub async fn orchestrator_edit_step(
    map: State<'_, PlanSessionMap>,
    session_id: String,
    step_id: String,
    title: Option<String>,
    detail_md: Option<String>,
) -> Result<SessionView, String> {
    validation::validate_id(&session_id).map_err(|e| e.to_string())?;
    validation::validate_id(&step_id).map_err(|e| e.to_string())?;
    run_on_session(map.inner().clone(), session_id, move |s| {
        s.edit_step(
            &step_id,
            StepEdit {
                title,
                detail_md,
                ..Default::default()
            },
        )?;
        Ok(SessionView::of(s))
    })
    .await
}

/// Ask a question about a step or design decision; returns the answer.
#[command]
pub async fn orchestrator_ask(
    map: State<'_, PlanSessionMap>,
    session_id: String,
    question: String,
    step_id: Option<String>,
) -> Result<String, String> {
    validation::validate_id(&session_id).map_err(|e| e.to_string())?;
    validation::validate_content(&question, "question").map_err(|e| e.to_string())?;
    run_on_session(map.inner().clone(), session_id, move |s| {
        s.ask(&question, step_id)
    })
    .await
}

/// Request a change; produces a new plan version preserving user edits.
#[command]
pub async fn orchestrator_revise(
    map: State<'_, PlanSessionMap>,
    session_id: String,
    feedback: String,
) -> Result<SessionView, String> {
    validation::validate_id(&session_id).map_err(|e| e.to_string())?;
    validation::validate_content(&feedback, "feedback").map_err(|e| e.to_string())?;
    run_on_session(map.inner().clone(), session_id, move |s| {
        s.revise(&feedback)?;
        Ok(SessionView::of(s))
    })
    .await
}

/// Approve a single step.
#[command]
pub async fn orchestrator_approve_step(
    map: State<'_, PlanSessionMap>,
    session_id: String,
    step_id: String,
) -> Result<SessionView, String> {
    validation::validate_id(&session_id).map_err(|e| e.to_string())?;
    validation::validate_id(&step_id).map_err(|e| e.to_string())?;
    run_on_session(map.inner().clone(), session_id, move |s| {
        s.approve_step(&step_id)?;
        Ok(SessionView::of(s))
    })
    .await
}

/// Approve every step.
#[command]
pub async fn orchestrator_approve_all(
    map: State<'_, PlanSessionMap>,
    session_id: String,
) -> Result<SessionView, String> {
    validation::validate_id(&session_id).map_err(|e| e.to_string())?;
    run_on_session(map.inner().clone(), session_id, |s| {
        s.approve_all()?;
        Ok(SessionView::of(s))
    })
    .await
}

/// Confirm the plan (all steps must be approved) and move to execution.
#[command]
pub async fn orchestrator_confirm(
    map: State<'_, PlanSessionMap>,
    session_id: String,
) -> Result<SessionView, String> {
    validation::validate_id(&session_id).map_err(|e| e.to_string())?;
    run_on_session(map.inner().clone(), session_id, |s| {
        s.confirm()?;
        Ok(SessionView::of(s))
    })
    .await
}

/// Cancel a session, stop the agent, and remove it from the registry.
#[command]
pub async fn orchestrator_cancel(
    map: State<'_, PlanSessionMap>,
    session_id: String,
) -> Result<(), String> {
    validation::validate_id(&session_id).map_err(|e| e.to_string())?;
    let map = map.inner().clone();
    run_on_session(map.clone(), session_id.clone(), |s| s.cancel()).await?;
    map.lock()
        .map_err(|e| format!("registry lock: {e}"))?
        .remove(&session_id);
    Ok(())
}
