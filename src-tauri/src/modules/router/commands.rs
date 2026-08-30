use sqlx::SqlitePool;
use tauri::{command, State};

use super::classifier::RouterState;
use super::models::{
    RouteHandler, RouteResponse, DIRECT_THRESHOLD, ORCHESTRATE_THRESHOLD,
};
use crate::modules::agent_sessions::models::AgentSessionState;
use crate::modules::agent_sessions::service::AgentSessionService;
use crate::shared::validation;

/// Direct routes are short utility commands ("show me active sessions",
/// "check git status") — never multi-sentence descriptions. A long, descriptive
/// query can still score above `DIRECT_THRESHOLD` against a route purely by
/// vocabulary overlap (e.g. a pomodoro app's own "session" repeated many times
/// scored 0.49 against the `active_sessions` route and got silently executed
/// as a direct command instead of ever reaching chat). Past this many words, a
/// query is a description, not a command — it must fall through to the
/// confidence-based orchestrate/fallback path below instead.
const MAX_DIRECT_ROUTE_WORDS: usize = 15;

/// Whether a classified match should actually execute as a direct command.
/// Pulled out of `route_request` so the length guard is unit-testable without
/// standing up Tauri state.
fn is_direct_execution(confidence: f64, handler: RouteHandler, query: &str) -> bool {
    confidence >= DIRECT_THRESHOLD
        && handler == RouteHandler::Direct
        && query.split_whitespace().count() <= MAX_DIRECT_ROUTE_WORDS
}

/// Classify a user query and execute or suggest a route.
///
/// The router scores the query against all registered routes using TF-IDF
/// cosine similarity. High-confidence direct routes are executed inline
/// and return structured data. Template routes return a suggested prompt
/// for the frontend to spawn a task session. Low-confidence queries fall
/// back to full orchestration.
#[command]
pub async fn route_request(
    router: State<'_, RouterState>,
    pool: State<'_, SqlitePool>,
    session_state: State<'_, AgentSessionState>,
    project_id: String,
    project_path: String,
    query: String,
) -> Result<RouteResponse, String> {
    tracing::debug!(query = %query, project_id = %project_id, "route_request called");

    validation::validate_id(&project_id).map_err(|e| e.to_string())?;
    validation::validate_path(&project_path).map_err(|e| e.to_string())?;
    validation::validate_content(&query, "query").map_err(|e| e.to_string())?;

    let query = query.trim().to_string();
    if query.is_empty() {
        return Ok(RouteResponse::Fallback {
            query,
            top_match: None,
        });
    }

    let classification = router.classify(&query);

    let route_match = match classification {
        Some(m) => {
            tracing::debug!(route = %m.route_id, confidence = %m.confidence, "classified");
            m
        }
        None => {
            tracing::debug!("no classification match");
            return Ok(RouteResponse::Fallback {
                query,
                top_match: None,
            });
        }
    };

    let scored_as_direct = route_match.confidence >= DIRECT_THRESHOLD && route_match.handler == RouteHandler::Direct;
    if scored_as_direct && query.split_whitespace().count() > MAX_DIRECT_ROUTE_WORDS {
        tracing::debug!(
            route = %route_match.route_id,
            confidence = %route_match.confidence,
            word_count = query.split_whitespace().count(),
            "direct route matched but query is too long to be a command — falling through to orchestrate/fallback"
        );
    }

    if is_direct_execution(route_match.confidence, route_match.handler, &query) {
        let data = execute_direct(
            &route_match.route_id,
            pool.inner(),
            session_state.inner(),
            &project_id,
            &project_path,
        )
        .await?;

        tracing::debug!(route = %route_match.route_id, "direct execution complete");
        return Ok(RouteResponse::Direct {
            route_id: route_match.route_id,
            route_name: route_match.route_name,
            confidence: route_match.confidence,
            data,
        });
    }

    if route_match.confidence >= ORCHESTRATE_THRESHOLD {
        let prompt = if let Some(route) = router.get_route(&route_match.route_id) {
            match route.template_prompt {
                Some(template) => template.to_string(),
                None => query.clone(),
            }
        } else {
            query.clone()
        };

        let template_id = if route_match.handler == RouteHandler::Template {
            Some(route_match.route_id.clone())
        } else {
            None
        };

        return Ok(RouteResponse::Orchestrate {
            route_id: route_match.route_id,
            route_name: route_match.route_name,
            confidence: route_match.confidence,
            suggested_prompt: prompt,
            template_id,
        });
    }

    Ok(RouteResponse::Fallback {
        query,
        top_match: Some(route_match),
    })
}

/// Execute a direct route and return structured JSON data.
async fn execute_direct(
    route_id: &str,
    pool: &SqlitePool,
    session_state: &AgentSessionState,
    project_id: &str,
    project_path: &str,
) -> Result<serde_json::Value, String> {
    let expanded = crate::shared::utils::expand_path(project_path);
    tracing::debug!(route_id = %route_id, path = %expanded, "execute_direct");

    match route_id {
        "git_status" => {
            let dir = expanded.clone();
            let output = tokio::task::spawn_blocking(move || {
                std::process::Command::new("git")
                    .args(["status", "--short", "--branch"])
                    .current_dir(&dir)
                    .output()
            })
            .await
            .map_err(|e| format!("task join failed: {e}"))?
            .map_err(|e| format!("git failed: {e}"))?;

            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            let lines: Vec<&str> = stdout.lines().collect();

            let branch = lines
                .first()
                .and_then(|l| l.strip_prefix("## "))
                .unwrap_or("unknown")
                .to_string();

            let modified: Vec<String> = lines
                .iter()
                .skip(1)
                .filter(|l| !l.is_empty())
                .map(|l| l.to_string())
                .collect();

            Ok(serde_json::json!({
                "branch": branch,
                "modified_count": modified.len(),
                "files": modified,
            }))
        }

        "git_changes" => {
            let dir = expanded.clone();
            let dir2 = expanded.clone();

            let (stat, numstat) = tokio::try_join!(
                async {
                    tokio::task::spawn_blocking(move || {
                        std::process::Command::new("git")
                            .args(["diff", "--stat", "HEAD"])
                            .current_dir(&dir)
                            .output()
                    })
                    .await
                    .map_err(|e| format!("task join failed: {e}"))?
                    .map_err(|e| format!("git failed: {e}"))
                },
                async {
                    tokio::task::spawn_blocking(move || {
                        std::process::Command::new("git")
                            .args(["diff", "--numstat", "HEAD"])
                            .current_dir(&dir2)
                            .output()
                    })
                    .await
                    .map_err(|e| format!("task join failed: {e}"))?
                    .map_err(|e| format!("git failed: {e}"))
                }
            )?;

            let summary = String::from_utf8_lossy(&stat.stdout).trim().to_string();

            let files: Vec<serde_json::Value> = String::from_utf8_lossy(&numstat.stdout)
                .lines()
                .filter_map(|line| {
                    let parts: Vec<&str> = line.split('\t').collect();
                    if parts.len() >= 3 {
                        Some(serde_json::json!({
                            "file": parts[2],
                            "additions": parts[0].parse::<i64>().unwrap_or(0),
                            "deletions": parts[1].parse::<i64>().unwrap_or(0),
                        }))
                    } else {
                        None
                    }
                })
                .collect();

            Ok(serde_json::json!({
                "summary": summary,
                "files": files,
                "total_files": files.len(),
            }))
        }

        "listening_ports" => {
            let mut sockets = tokio::task::spawn_blocking(crate::shared::ports::listening_ports)
                .await
                .map_err(|e| format!("task join failed: {e}"))?;
            sockets.sort_by_key(|s| s.port);

            let ports: Vec<serde_json::Value> = sockets
                .iter()
                .map(|s| serde_json::json!({ "port": s.port, "process": s.process, "pid": s.pid }))
                .collect();

            Ok(serde_json::json!({
                "ports": ports,
                "count": ports.len(),
            }))
        }

        "project_context" => {
            let context = crate::modules::agent_sessions::context::build_project_context(
                pool, project_id, project_path,
            )
            .await
            .map_err(|e| format!("Failed to build context: {e}"))?;

            Ok(serde_json::json!({
                "context": context,
                "length": context.len(),
            }))
        }

        "active_sessions" => {
            let sessions = AgentSessionService::list_sessions(session_state);
            let session_data: Vec<serde_json::Value> = sessions
                .iter()
                .filter(|s| s.project_id == project_id)
                .map(|s| {
                    serde_json::json!({
                        "id": s.id,
                        "display_name": s.display_name,
                        "status": s.status,
                        "agent_type": s.agent_type,
                        "created_at": s.created_at,
                    })
                })
                .collect();

            Ok(serde_json::json!({
                "sessions": session_data,
                "count": session_data.len(),
            }))
        }

        _ => Err(format!("No direct executor for route: {route_id}")),
    }
}

#[cfg(test)]
mod direct_execution_tests {
    use super::*;

    #[test]
    fn short_high_confidence_direct_query_executes() {
        assert!(is_direct_execution(0.49, RouteHandler::Direct, "show me active sessions"));
    }

    /// Regression test: a long, descriptive build request ("create a pomodoro
    /// app... store each session the user does...") scored 0.49 against the
    /// `active_sessions` route purely from repeating "session" many times, and
    /// was silently executed as a direct command instead of ever reaching
    /// chat. A query this long can never be a short utility command.
    fn pomodoro_description() -> String {
        "create a pomodoro ap, the app needs to be minimilistic and store each \
         session the user does. No need for any kind of authentication for v1 \
         we can use local storage for saving the sessions. each session should \
         have some ability to ask for a review from the user on how the session \
         went and also log that."
            .to_string()
    }

    #[test]
    fn long_description_never_executes_as_direct_even_at_high_confidence() {
        assert!(!is_direct_execution(0.49, RouteHandler::Direct, &pomodoro_description()));
    }

    #[test]
    fn template_handler_never_executes_as_direct_regardless_of_length() {
        assert!(!is_direct_execution(0.90, RouteHandler::Template, "short query"));
    }

    #[test]
    fn low_confidence_short_query_does_not_execute_as_direct() {
        assert!(!is_direct_execution(0.10, RouteHandler::Direct, "show me active sessions"));
    }

    #[test]
    fn exactly_at_word_limit_still_executes() {
        let query = "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen";
        assert_eq!(query.split_whitespace().count(), MAX_DIRECT_ROUTE_WORDS);
        assert!(is_direct_execution(0.5, RouteHandler::Direct, query));
    }
}
