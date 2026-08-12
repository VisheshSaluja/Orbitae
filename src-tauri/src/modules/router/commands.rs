use sqlx::SqlitePool;
use tauri::{command, State};

use super::classifier::RouterState;
use super::models::{
    RouteHandler, RouteResponse, DIRECT_THRESHOLD, ORCHESTRATE_THRESHOLD,
};
use crate::modules::agent_sessions::models::AgentSessionState;
use crate::modules::agent_sessions::service::AgentSessionService;
use crate::shared::validation;

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

    if route_match.confidence >= DIRECT_THRESHOLD && route_match.handler == RouteHandler::Direct {
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
            let output = tokio::task::spawn_blocking(|| {
                std::process::Command::new("lsof")
                    .args(["-i", "-P", "-n", "-sTCP:LISTEN"])
                    .output()
            })
            .await
            .map_err(|e| format!("task join failed: {e}"))?
            .map_err(|e| format!("lsof failed: {e}"))?;

            let stdout = String::from_utf8_lossy(&output.stdout);
            let mut ports: Vec<serde_json::Value> = Vec::new();
            let mut seen = std::collections::HashSet::new();

            for line in stdout.lines().skip(1) {
                let cols: Vec<&str> = line.split_whitespace().collect();
                if cols.len() < 9 {
                    continue;
                }

                let port: u16 = match cols.last().and_then(|c| c.rsplit(':').next()).and_then(|p| p.parse().ok()) {
                    Some(p) => p,
                    None => continue,
                };

                if !seen.insert(port) {
                    continue;
                }

                let process = cols[0].to_string();
                let pid: u32 = cols[1].parse().unwrap_or(0);

                ports.push(serde_json::json!({
                    "port": port,
                    "process": process,
                    "pid": pid,
                }));
            }

            ports.sort_by_key(|p| p["port"].as_u64().unwrap_or(0));

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
