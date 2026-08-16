//! SQLite persistence adapter for orchestration state.
//!
//! Implements [`PlanStore`] against the app's existing `SqlitePool`, so plans
//! survive restarts and can be reopened. Writes come from the synchronous
//! `PlanSession` (running on a blocking thread), so they bridge to async sqlx
//! via the runtime handle. Reads are plain async functions called from async
//! commands.
//!
//! Schema is portable to the Postgres tier (same domain model); only the SQL
//! dialect and the sync/async bridge differ.

use serde::Serialize;
use sqlx::{Row, SqlitePool};
use tokio::runtime::Handle;

use super::error::{OrchestratorError, Result};
use super::models::{
    OrchestrationSession, Plan, PlanQa, PlanStatus, PlanStep, SessionStatus, StepStatus,
};
use super::store::PlanStore;

/// A fully-loaded plan session (session + latest plan + persisted execution).
pub struct LoadedPlan {
    pub session: OrchestrationSession,
    pub plan: Option<Plan>,
    pub result: Option<String>,
    pub log: Option<String>,
}

/// A compact summary of a persisted plan session, for the Plans list.
#[derive(Debug, Clone, Serialize)]
pub struct PlanSummary {
    pub session_id: String,
    pub task: String,
    pub goal: Option<String>,
    pub status: SessionStatus,
    pub version: Option<i32>,
    pub step_count: i64,
    pub updated_at: String,
}

/// The snake_case string a status enum serializes to (for storage).
fn status_str<T: Serialize>(v: &T) -> String {
    serde_json::to_value(v)
        .ok()
        .and_then(|x| x.as_str().map(String::from))
        .unwrap_or_default()
}

fn parse_session_status(s: &str) -> SessionStatus {
    match s {
        "planning" => SessionStatus::Planning,
        "executing" => SessionStatus::Executing,
        "done" => SessionStatus::Done,
        "errored" => SessionStatus::Errored,
        "cancelled" => SessionStatus::Cancelled,
        _ => SessionStatus::Reviewing,
    }
}

fn parse_plan_status(s: &str) -> PlanStatus {
    match s {
        "draft" => PlanStatus::Draft,
        "confirmed" => PlanStatus::Confirmed,
        _ => PlanStatus::Reviewing,
    }
}

fn parse_step_status(s: &str) -> StepStatus {
    match s {
        "approved" => StepStatus::Approved,
        "done" => StepStatus::Done,
        "failed" => StepStatus::Failed,
        _ => StepStatus::Pending,
    }
}

/// SQLite-backed store. Holds a runtime handle to run async sqlx from the
/// synchronous `PlanStore` methods (which execute on a blocking thread).
pub struct SqliteStore {
    pool: SqlitePool,
    handle: Handle,
}

impl SqliteStore {
    pub fn new(pool: SqlitePool, handle: Handle) -> Self {
        Self { pool, handle }
    }

    fn run<F, T>(&self, fut: F) -> Result<T>
    where
        F: std::future::Future<Output = std::result::Result<T, sqlx::Error>>,
    {
        self.handle
            .block_on(fut)
            .map_err(|e| OrchestratorError::Database(e.to_string()))
    }
}

impl PlanStore for SqliteStore {
    fn save_session(&self, s: &OrchestrationSession) -> Result<()> {
        self.run(async {
            sqlx::query(
                "INSERT OR REPLACE INTO orch_sessions \
                 (id, project_id, task, backend, use_gsd, permission_mode, status, created_at, updated_at) \
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&s.id)
            .bind(&s.project_id)
            .bind(&s.task)
            .bind(&s.backend)
            .bind(s.use_gsd as i32)
            .bind(&s.permission_mode)
            .bind(status_str(&s.status))
            .bind(&s.created_at)
            .bind(&s.updated_at)
            .execute(&self.pool)
            .await
            .map(|_| ())
        })
    }

    fn update_session_status(&self, id: &str, status: SessionStatus) -> Result<()> {
        self.run(async {
            sqlx::query("UPDATE orch_sessions SET status = ?, updated_at = ? WHERE id = ?")
                .bind(status_str(&status))
                .bind(chrono::Utc::now().to_rfc3339())
                .bind(id)
                .execute(&self.pool)
                .await
                .map(|_| ())
        })
    }

    fn save_plan(&self, plan: &Plan) -> Result<()> {
        self.run(async {
            let mut tx = self.pool.begin().await?;
            sqlx::query(
                "INSERT OR REPLACE INTO orch_plans \
                 (id, session_id, version, goal, summary_md, status, created_at) \
                 VALUES (?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&plan.id)
            .bind(&plan.session_id)
            .bind(plan.version)
            .bind(&plan.goal)
            .bind(&plan.summary_md)
            .bind(status_str(&plan.status))
            .bind(&plan.created_at)
            .execute(&mut *tx)
            .await?;

            sqlx::query("DELETE FROM orch_plan_steps WHERE plan_id = ?")
                .bind(&plan.id)
                .execute(&mut *tx)
                .await?;

            for step in &plan.steps {
                sqlx::query(
                    "INSERT INTO orch_plan_steps \
                     (id, plan_id, ordinal, title, detail_md, model, files, commands, status, user_edited) \
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                )
                .bind(&step.id)
                .bind(&plan.id)
                .bind(step.ordinal)
                .bind(&step.title)
                .bind(&step.detail_md)
                .bind(&step.model)
                .bind(serde_json::to_string(&step.files).unwrap_or_else(|_| "[]".into()))
                .bind(serde_json::to_string(&step.commands).unwrap_or_else(|_| "[]".into()))
                .bind(status_str(&step.status))
                .bind(step.user_edited as i32)
                .execute(&mut *tx)
                .await?;
            }

            tx.commit().await
        })
    }

    fn update_step(&self, _plan_id: &str, step: &PlanStep) -> Result<()> {
        self.run(async {
            sqlx::query(
                "UPDATE orch_plan_steps SET \
                 title = ?, detail_md = ?, model = ?, files = ?, commands = ?, status = ?, user_edited = ? \
                 WHERE id = ?",
            )
            .bind(&step.title)
            .bind(&step.detail_md)
            .bind(&step.model)
            .bind(serde_json::to_string(&step.files).unwrap_or_else(|_| "[]".into()))
            .bind(serde_json::to_string(&step.commands).unwrap_or_else(|_| "[]".into()))
            .bind(status_str(&step.status))
            .bind(step.user_edited as i32)
            .bind(&step.id)
            .execute(&self.pool)
            .await
            .map(|_| ())
        })
    }

    fn save_qa(&self, qa: &PlanQa) -> Result<()> {
        self.run(async {
            sqlx::query(
                "INSERT INTO orch_plan_qa (id, session_id, step_id, question, answer, created_at) \
                 VALUES (?, ?, ?, ?, ?, ?)",
            )
            .bind(&qa.id)
            .bind(&qa.session_id)
            .bind(&qa.step_id)
            .bind(&qa.question)
            .bind(&qa.answer)
            .bind(&qa.created_at)
            .execute(&self.pool)
            .await
            .map(|_| ())
        })
    }
}

// ---- async reads (called directly from async commands) ---------------------

/// List recent plan sessions for a project, newest first.
pub async fn list_plan_summaries(
    pool: &SqlitePool,
    project_id: &str,
    limit: i64,
) -> Result<Vec<PlanSummary>> {
    let rows = sqlx::query(
        "SELECT s.id, s.task, s.status, s.updated_at, \
                p.goal, p.version, \
                (SELECT COUNT(*) FROM orch_plan_steps st WHERE st.plan_id = p.id) AS step_count \
         FROM orch_sessions s \
         LEFT JOIN orch_plans p ON p.session_id = s.id \
            AND p.version = (SELECT MAX(version) FROM orch_plans p2 WHERE p2.session_id = s.id) \
         WHERE s.project_id = ? \
         ORDER BY s.updated_at DESC LIMIT ?",
    )
    .bind(project_id)
    .bind(limit)
    .fetch_all(pool)
    .await
    .map_err(|e| OrchestratorError::Database(e.to_string()))?;

    Ok(rows
        .iter()
        .map(|r| PlanSummary {
            session_id: r.get::<String, _>("id"),
            task: r.get::<String, _>("task"),
            goal: r.get::<Option<String>, _>("goal"),
            status: parse_session_status(&r.get::<String, _>("status")),
            version: r.get::<Option<i64>, _>("version").map(|v| v as i32),
            step_count: r.get::<i64, _>("step_count"),
            updated_at: r.get::<String, _>("updated_at"),
        })
        .collect())
}

/// Persist the execution log and result summary onto a session.
pub async fn save_execution(
    pool: &SqlitePool,
    session_id: &str,
    log: &str,
    result: &str,
) -> Result<()> {
    sqlx::query("UPDATE orch_sessions SET log = ?, result = ? WHERE id = ?")
        .bind(log)
        .bind(result)
        .bind(session_id)
        .execute(pool)
        .await
        .map(|_| ())
        .map_err(|e| OrchestratorError::Database(e.to_string()))
}

/// Record the pre-execution working-tree snapshot (a git tree SHA) so validation
/// can diff only what the run produced.
pub async fn save_base_tree(pool: &SqlitePool, session_id: &str, tree: &str) -> Result<()> {
    sqlx::query("UPDATE orch_sessions SET base_tree = ? WHERE id = ?")
        .bind(tree)
        .bind(session_id)
        .execute(pool)
        .await
        .map(|_| ())
        .map_err(|e| OrchestratorError::Database(e.to_string()))
}

/// Read the pre-execution snapshot for a session, if one was captured.
pub async fn get_base_tree(pool: &SqlitePool, session_id: &str) -> Result<Option<String>> {
    let row = sqlx::query("SELECT base_tree FROM orch_sessions WHERE id = ?")
        .bind(session_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| OrchestratorError::Database(e.to_string()))?;
    Ok(row.and_then(|r| r.get::<Option<String>, _>("base_tree")))
}

/// Persist the developer's pending plan annotations (opaque JSON) on a session.
pub async fn save_annotations(pool: &SqlitePool, session_id: &str, annotations: &str) -> Result<()> {
    sqlx::query("UPDATE orch_sessions SET annotations = ? WHERE id = ?")
        .bind(annotations)
        .bind(session_id)
        .execute(pool)
        .await
        .map(|_| ())
        .map_err(|e| OrchestratorError::Database(e.to_string()))
}

/// Read the pending plan annotations for a session (`"[]"` when none).
pub async fn get_annotations(pool: &SqlitePool, session_id: &str) -> Result<String> {
    let row = sqlx::query("SELECT annotations FROM orch_sessions WHERE id = ?")
        .bind(session_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| OrchestratorError::Database(e.to_string()))?;
    Ok(row
        .and_then(|r| r.get::<Option<String>, _>("annotations"))
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "[]".to_string()))
}

/// Mark plans left `executing` as `errored` — their run died with the app.
pub async fn reconcile_executing(pool: &SqlitePool) -> Result<u64> {
    let r = sqlx::query("UPDATE orch_sessions SET status = 'errored' WHERE status = 'executing'")
        .execute(pool)
        .await
        .map_err(|e| OrchestratorError::Database(e.to_string()))?;
    Ok(r.rows_affected())
}

/// Delete a session and all its plans, steps, and Q&A.
pub async fn delete_session(pool: &SqlitePool, session_id: &str) -> Result<()> {
    let mut tx = pool
        .begin()
        .await
        .map_err(|e| OrchestratorError::Database(e.to_string()))?;
    let db = |e: sqlx::Error| OrchestratorError::Database(e.to_string());

    sqlx::query(
        "DELETE FROM orch_plan_steps WHERE plan_id IN \
         (SELECT id FROM orch_plans WHERE session_id = ?)",
    )
    .bind(session_id)
    .execute(&mut *tx)
    .await
    .map_err(db)?;
    sqlx::query("DELETE FROM orch_plans WHERE session_id = ?")
        .bind(session_id)
        .execute(&mut *tx)
        .await
        .map_err(db)?;
    sqlx::query("DELETE FROM orch_plan_qa WHERE session_id = ?")
        .bind(session_id)
        .execute(&mut *tx)
        .await
        .map_err(db)?;
    sqlx::query("DELETE FROM orch_sessions WHERE id = ?")
        .bind(session_id)
        .execute(&mut *tx)
        .await
        .map_err(db)?;

    tx.commit().await.map_err(db)
}

/// Load a session, its latest plan (with steps), and any persisted execution.
pub async fn load_session(pool: &SqlitePool, session_id: &str) -> Result<Option<LoadedPlan>> {
    let srow = sqlx::query(
        "SELECT id, project_id, task, backend, use_gsd, permission_mode, status, created_at, updated_at, result, log \
         FROM orch_sessions WHERE id = ?",
    )
    .bind(session_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| OrchestratorError::Database(e.to_string()))?;

    let srow = match srow {
        Some(r) => r,
        None => return Ok(None),
    };

    let result: Option<String> = srow.get("result");
    let log: Option<String> = srow.get("log");

    let session = OrchestrationSession {
        id: srow.get::<String, _>("id"),
        org_id: super::models::LOCAL_ORG_ID.to_string(),
        project_id: srow.get::<String, _>("project_id"),
        task: srow.get::<String, _>("task"),
        backend: srow.get::<String, _>("backend"),
        use_gsd: srow.get::<i64, _>("use_gsd") != 0,
        permission_mode: srow.get::<String, _>("permission_mode"),
        status: parse_session_status(&srow.get::<String, _>("status")),
        created_by: None,
        created_at: srow.get::<String, _>("created_at"),
        updated_at: srow.get::<String, _>("updated_at"),
    };

    let prow = sqlx::query(
        "SELECT id, session_id, version, goal, summary_md, status, created_at \
         FROM orch_plans WHERE session_id = ? ORDER BY version DESC LIMIT 1",
    )
    .bind(session_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| OrchestratorError::Database(e.to_string()))?;

    let plan = match prow {
        None => None,
        Some(pr) => {
            let plan_id: String = pr.get("id");
            let step_rows = sqlx::query(
                "SELECT id, ordinal, title, detail_md, model, files, commands, status, user_edited \
                 FROM orch_plan_steps WHERE plan_id = ? ORDER BY ordinal",
            )
            .bind(&plan_id)
            .fetch_all(pool)
            .await
            .map_err(|e| OrchestratorError::Database(e.to_string()))?;

            let steps = step_rows
                .iter()
                .map(|r| PlanStep {
                    id: r.get::<String, _>("id"),
                    ordinal: r.get::<i64, _>("ordinal") as i32,
                    title: r.get::<String, _>("title"),
                    detail_md: r.get::<String, _>("detail_md"),
                    model: r.get::<Option<String>, _>("model"),
                    files: serde_json::from_str(&r.get::<String, _>("files")).unwrap_or_default(),
                    commands: serde_json::from_str(&r.get::<String, _>("commands")).unwrap_or_default(),
                    status: parse_step_status(&r.get::<String, _>("status")),
                    user_edited: r.get::<i64, _>("user_edited") != 0,
                })
                .collect();

            Some(Plan {
                id: plan_id,
                session_id: pr.get::<String, _>("session_id"),
                version: pr.get::<i64, _>("version") as i32,
                goal: pr.get::<String, _>("goal"),
                summary_md: pr.get::<String, _>("summary_md"),
                status: parse_plan_status(&pr.get::<String, _>("status")),
                steps,
                created_at: pr.get::<String, _>("created_at"),
            })
        }
    };

    Ok(Some(LoadedPlan {
        session,
        plan,
        result,
        log,
    }))
}
