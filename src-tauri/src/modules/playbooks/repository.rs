use super::models::{PlaybookRun, StepRun};
use anyhow::Result;
use sqlx::SqlitePool;

pub struct PlaybookRunRepository {
    pool: SqlitePool,
}

impl PlaybookRunRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    /// Creates a new playbook run record.
    pub async fn create_run(&self, id: &str, playbook_id: &str, project_id: &str) -> Result<PlaybookRun> {
        sqlx::query("INSERT INTO playbook_runs (id, playbook_id, project_id, status) VALUES (?, ?, ?, 'pending')")
            .bind(id)
            .bind(playbook_id)
            .bind(project_id)
            .execute(&self.pool)
            .await?;

        self.get_run(id).await?.ok_or_else(|| anyhow::anyhow!("Run not found after insert"))
    }

    /// Gets a run by ID.
    pub async fn get_run(&self, id: &str) -> Result<Option<PlaybookRun>> {
        let run = sqlx::query_as::<_, PlaybookRun>(
            "SELECT id, playbook_id, project_id, status, started_at, finished_at, created_at FROM playbook_runs WHERE id = ?"
        )
            .bind(id)
            .fetch_optional(&self.pool)
            .await?;
        Ok(run)
    }

    /// Gets all runs for a project, most recent first.
    pub async fn get_project_runs(&self, project_id: &str, limit: i64) -> Result<Vec<PlaybookRun>> {
        let runs = sqlx::query_as::<_, PlaybookRun>(
            "SELECT id, playbook_id, project_id, status, started_at, finished_at, created_at FROM playbook_runs WHERE project_id = ? ORDER BY created_at DESC LIMIT ?"
        )
            .bind(project_id)
            .bind(limit)
            .fetch_all(&self.pool)
            .await?;
        Ok(runs)
    }

    /// Updates run status and timestamps.
    pub async fn update_run_status(&self, id: &str, status: &str) -> Result<()> {
        let now = chrono::Utc::now().to_rfc3339();
        match status {
            "running" => {
                sqlx::query("UPDATE playbook_runs SET status = ?, started_at = ? WHERE id = ?")
                    .bind(status).bind(&now).bind(id)
                    .execute(&self.pool).await?;
            }
            "passed" | "failed" | "aborted" => {
                sqlx::query("UPDATE playbook_runs SET status = ?, finished_at = ? WHERE id = ?")
                    .bind(status).bind(&now).bind(id)
                    .execute(&self.pool).await?;
            }
            _ => {
                sqlx::query("UPDATE playbook_runs SET status = ? WHERE id = ?")
                    .bind(status).bind(id)
                    .execute(&self.pool).await?;
            }
        }
        Ok(())
    }

    /// Creates a step run record.
    pub async fn create_step_run(
        &self,
        id: &str,
        run_id: &str,
        step_id: &str,
        step_name: &str,
        step_type: &str,
    ) -> Result<StepRun> {
        sqlx::query(
            "INSERT INTO step_runs (id, run_id, step_id, step_name, step_type, status, attempt) VALUES (?, ?, ?, ?, ?, 'pending', 1)"
        )
            .bind(id).bind(run_id).bind(step_id).bind(step_name).bind(step_type)
            .execute(&self.pool)
            .await?;

        self.get_step_run(id).await?.ok_or_else(|| anyhow::anyhow!("Step run not found after insert"))
    }

    /// Gets a step run by ID.
    pub async fn get_step_run(&self, id: &str) -> Result<Option<StepRun>> {
        let step = sqlx::query_as::<_, StepRun>(
            "SELECT id, run_id, step_id, step_name, step_type, status, exit_code, stdout, stderr, started_at, finished_at, attempt FROM step_runs WHERE id = ?"
        )
            .bind(id)
            .fetch_optional(&self.pool)
            .await?;
        Ok(step)
    }

    /// Gets all step runs for a run.
    pub async fn get_run_steps(&self, run_id: &str) -> Result<Vec<StepRun>> {
        let steps = sqlx::query_as::<_, StepRun>(
            "SELECT id, run_id, step_id, step_name, step_type, status, exit_code, stdout, stderr, started_at, finished_at, attempt FROM step_runs WHERE run_id = ? ORDER BY rowid ASC"
        )
            .bind(run_id)
            .fetch_all(&self.pool)
            .await?;
        Ok(steps)
    }

    /// Updates a step run with execution results.
    pub async fn update_step_run(
        &self,
        id: &str,
        status: &str,
        exit_code: Option<i32>,
        stdout: Option<&str>,
        stderr: Option<&str>,
    ) -> Result<()> {
        let now = chrono::Utc::now().to_rfc3339();
        match status {
            "running" => {
                sqlx::query("UPDATE step_runs SET status = ?, started_at = ? WHERE id = ?")
                    .bind(status).bind(&now).bind(id)
                    .execute(&self.pool).await?;
            }
            _ => {
                sqlx::query(
                    "UPDATE step_runs SET status = ?, exit_code = ?, stdout = ?, stderr = ?, finished_at = ? WHERE id = ?"
                )
                    .bind(status).bind(exit_code).bind(stdout).bind(stderr).bind(&now).bind(id)
                    .execute(&self.pool).await?;
            }
        }
        Ok(())
    }

    /// Increments the attempt counter for a step run (for retries).
    pub async fn increment_step_attempt(&self, id: &str) -> Result<()> {
        sqlx::query("UPDATE step_runs SET attempt = attempt + 1, status = 'pending', started_at = NULL, finished_at = NULL, exit_code = NULL, stdout = NULL, stderr = NULL WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}
