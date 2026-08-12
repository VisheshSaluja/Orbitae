use anyhow::Result;
use sqlx::SqlitePool;
use super::models::{SessionEvent, SessionMetrics};

/// Repository for persisting and querying structured agent session events.
pub struct SessionEventRepository {
    pool: SqlitePool,
}

impl SessionEventRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    /// Insert a single event from the agent's JSON event stream.
    pub async fn insert(&self, session_id: &str, event_type: &str, payload: &str) -> Result<i64> {
        let result = sqlx::query(
            "INSERT INTO session_events (session_id, event_type, payload) VALUES (?, ?, ?)",
        )
        .bind(session_id)
        .bind(event_type)
        .bind(payload)
        .execute(&self.pool)
        .await?;
        Ok(result.last_insert_rowid())
    }

    /// Retrieve all events for a session, ordered chronologically.
    pub async fn list_by_session(&self, session_id: &str) -> Result<Vec<SessionEvent>> {
        let rows = sqlx::query_as::<_, SessionEventRow>(
            "SELECT id, session_id, event_type, payload, created_at \
             FROM session_events WHERE session_id = ? ORDER BY id ASC",
        )
        .bind(session_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().map(Into::into).collect())
    }

    /// Count events for a session (useful for metrics without loading payloads).
    pub async fn count_by_session(&self, session_id: &str) -> Result<i64> {
        let row: (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM session_events WHERE session_id = ?",
        )
        .bind(session_id)
        .fetch_one(&self.pool)
        .await?;
        Ok(row.0)
    }

    /// Extract metrics from the session's final `result` event.
    pub async fn get_session_metrics(&self, session_id: &str) -> Result<Option<SessionMetrics>> {
        let payload = sqlx::query_scalar::<_, String>(
            "SELECT payload FROM session_events \
             WHERE session_id = ? AND event_type = 'result' \
             ORDER BY id DESC LIMIT 1",
        )
        .bind(session_id)
        .fetch_optional(&self.pool)
        .await?;

        match payload {
            Some(raw) => {
                let json: serde_json::Value = serde_json::from_str(&raw)?;
                let usage = json.get("usage");
                Ok(Some(SessionMetrics {
                    session_id: session_id.to_string(),
                    input_tokens: usage
                        .and_then(|u| u.get("input_tokens"))
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0),
                    output_tokens: usage
                        .and_then(|u| u.get("output_tokens"))
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0),
                    cost_usd: json
                        .get("total_cost_usd")
                        .and_then(|v| v.as_f64())
                        .unwrap_or(0.0),
                    duration_ms: json
                        .get("duration_ms")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0),
                    num_turns: json
                        .get("num_turns")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0) as u32,
                    is_error: json
                        .get("is_error")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false),
                }))
            }
            None => Ok(None),
        }
    }
}

#[derive(sqlx::FromRow)]
struct SessionEventRow {
    id: i64,
    session_id: String,
    event_type: String,
    payload: String,
    created_at: String,
}

impl From<SessionEventRow> for SessionEvent {
    fn from(row: SessionEventRow) -> Self {
        Self {
            id: row.id,
            session_id: row.session_id,
            event_type: row.event_type,
            payload: row.payload,
            created_at: row.created_at,
        }
    }
}
