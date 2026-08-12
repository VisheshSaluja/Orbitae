use super::models::AgentSession;
use anyhow::Result;
use sqlx::SqlitePool;

/// Repository for persisting agent sessions in SQLite.
pub struct AgentSessionRepository {
    pool: SqlitePool,
}

impl AgentSessionRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    /// Insert a new agent session record.
    pub async fn insert(&self, session: &AgentSession) -> Result<()> {
        sqlx::query(
            "INSERT INTO agent_sessions (id, agent_type, display_name, status, pid, project_id, instructions, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(&session.id)
        .bind(&session.agent_type)
        .bind(&session.display_name)
        .bind(&session.status)
        .bind(session.pid.map(|p| p as i64))
        .bind(&session.project_id)
        .bind(&session.instructions)
        .bind(&session.created_at)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Update session status (e.g. running -> stopped).
    pub async fn update_status(&self, id: &str, status: &str) -> Result<()> {
        let stopped_at = if status == "stopped" {
            Some(chrono::Utc::now().to_rfc3339())
        } else {
            None
        };
        sqlx::query("UPDATE agent_sessions SET status = ?, stopped_at = ? WHERE id = ?")
            .bind(status)
            .bind(stopped_at)
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    /// Fetch a single session by ID.
    pub async fn get_by_id(&self, id: &str) -> Result<Option<AgentSession>> {
        let row = sqlx::query_as::<_, AgentSessionRow>(
            "SELECT id, agent_type, display_name, status, pid, project_id, instructions, created_at FROM agent_sessions WHERE id = ?"
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.map(|r| r.into()))
    }

    /// List sessions for a project, most recent first.
    pub async fn list_by_project(&self, project_id: &str) -> Result<Vec<AgentSession>> {
        let rows = sqlx::query_as::<_, AgentSessionRow>(
            "SELECT id, agent_type, display_name, status, pid, project_id, instructions, created_at FROM agent_sessions WHERE project_id = ? ORDER BY created_at DESC"
        )
        .bind(project_id)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows.into_iter().map(|r| r.into()).collect())
    }

    /// Delete a session record.
    pub async fn delete(&self, id: &str) -> Result<()> {
        sqlx::query("DELETE FROM agent_sessions WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    /// List all sessions, most recent first.
    pub async fn list_all(&self) -> Result<Vec<AgentSession>> {
        let rows = sqlx::query_as::<_, AgentSessionRow>(
            "SELECT id, agent_type, display_name, status, pid, project_id, instructions, created_at FROM agent_sessions ORDER BY created_at DESC"
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(rows.into_iter().map(|r| r.into()).collect())
    }

}

#[derive(sqlx::FromRow)]
struct AgentSessionRow {
    id: String,
    agent_type: String,
    display_name: String,
    status: String,
    pid: Option<i64>,
    project_id: String,
    instructions: Option<String>,
    created_at: String,
}

impl From<AgentSessionRow> for AgentSession {
    fn from(row: AgentSessionRow) -> Self {
        Self {
            id: row.id,
            agent_type: row.agent_type,
            display_name: row.display_name,
            status: row.status,
            pid: row.pid.map(|p| p as u32),
            project_id: row.project_id,
            instructions: row.instructions,
            created_at: row.created_at,
        }
    }
}
