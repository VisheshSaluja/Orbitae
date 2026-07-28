use tauri::{command, State};
use sqlx::SqlitePool;
use super::models::{AgentSession, AgentSessionState, LaunchRequest};
use super::repository::AgentSessionRepository;
use super::service::AgentSessionService;
use crate::modules::ai::repository::AiRepository;
use crate::modules::vault::service::VaultService;

/// Maximum number of agent sessions that can be launched in a single request.
const MAX_LAUNCH_COUNT: u32 = 6;

/// Launch one or more AI agent sessions in external native terminal windows.
///
/// Resolves the API key from the vault based on the agent type and project's
/// AI provider configuration, then spawns terminal windows and tiles them.
/// Optionally injects project context (vault keys, notes, git diff) as instructions.
#[command]
pub async fn launch_agent_sessions(
    state: State<'_, AgentSessionState>,
    pool: State<'_, SqlitePool>,
    agent_type: String,
    count: u32,
    project_id: String,
    project_path: String,
    instructions: Option<String>,
    inject_context: Option<bool>,
) -> Result<Vec<AgentSession>, String> {
    if count == 0 || count > MAX_LAUNCH_COUNT {
        return Err(format!(
            "Session count must be between 1 and {}, got {}",
            MAX_LAUNCH_COUNT, count
        ));
    }

    // Build context if requested
    let final_instructions = if inject_context.unwrap_or(false) {
        let context = super::context::build_project_context(
            pool.inner(), &project_id, &project_path
        ).await.map_err(|e| format!("Failed to build context: {}", e))?;

        match instructions {
            Some(instr) => Some(format!("{}\n\n---\n\n{}", context, instr)),
            None => Some(context),
        }
    } else {
        instructions
    };

    let api_key = resolve_api_key(pool.inner(), &project_id, &agent_type)
        .await
        .map_err(|e| format!("Failed to resolve API key: {}", e))?;

    let request = LaunchRequest {
        agent_type,
        count,
        project_id,
        project_path,
        instructions: final_instructions,
    };

    let sessions = AgentSessionService::launch_sessions(&request, api_key.as_deref())
        .map_err(|e| format!("Failed to launch sessions: {}", e))?;

    AgentSessionService::tile_windows(request.count)
        .map_err(|e| format!("Failed to tile windows: {}", e))?;

    // Persist to SQLite and in-memory state
    let repo = AgentSessionRepository::new(pool.inner().clone());
    {
        let mut session_map = state.lock().map_err(|e| format!("State lock error: {}", e))?;
        for session in &sessions {
            session_map.insert(session.id.clone(), session.clone());
            let s = session.clone();
            let repo_ref = AgentSessionRepository::new(pool.inner().clone());
            tokio::spawn(async move {
                if let Err(e) = repo_ref.insert(&s).await {
                    tracing::warn!("Failed to persist agent session: {}", e);
                }
            });
        }
    }

    // Suppress unused variable warning for repo used only for spawned tasks above
    drop(repo);

    Ok(sessions)
}

/// List all tracked agent sessions (both running and stopped).
///
/// Returns from SQLite for persistence across restarts, with in-memory state
/// as the source of truth for currently running sessions.
#[command]
pub async fn list_agent_sessions(
    state: State<'_, AgentSessionState>,
    pool: State<'_, SqlitePool>,
) -> Result<Vec<AgentSession>, String> {
    let in_memory = AgentSessionService::list_sessions(state.inner());

    if !in_memory.is_empty() {
        return Ok(in_memory);
    }

    // Fall back to SQLite for sessions from previous app runs
    let repo = AgentSessionRepository::new(pool.inner().clone());
    repo.list_all().await.map_err(|e| format!("Failed to list sessions: {}", e))
}

/// Stop a running agent session by its ID.
#[command]
pub async fn stop_agent_session(
    state: State<'_, AgentSessionState>,
    pool: State<'_, SqlitePool>,
    session_id: String,
) -> Result<(), String> {
    AgentSessionService::stop_session(state.inner(), &session_id)
        .map_err(|e| format!("Failed to stop session: {}", e))?;

    // Update SQLite
    let repo = AgentSessionRepository::new(pool.inner().clone());
    repo.update_status(&session_id, "stopped").await
        .map_err(|e| format!("Failed to update session status: {}", e))?;

    Ok(())
}

/// Build and return the project context document without launching a session.
///
/// Useful for previewing what context will be injected into agent sessions.
#[command]
pub async fn get_project_context_preview(
    pool: State<'_, SqlitePool>,
    project_id: String,
    project_path: String,
) -> Result<String, String> {
    super::context::build_project_context(pool.inner(), &project_id, &project_path)
        .await
        .map_err(|e| format!("Failed to build context: {}", e))
}

/// Bring Terminal.app to the foreground so the user can see running agents.
#[command]
pub async fn focus_agent_terminals() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("osascript")
            .arg("-e")
            .arg(r#"tell application "Terminal" to activate"#)
            .spawn()
            .map_err(|e| format!("Failed to focus Terminal: {}", e))?;
    }
    Ok(())
}

/// Get a summary of file changes in the project (git diff --stat + file list).
#[command]
pub async fn get_session_diff(
    project_path: String,
) -> Result<SessionDiff, String> {
    let expanded = crate::shared::utils::expand_path(&project_path);

    let stat_output = std::process::Command::new("git")
        .args(["diff", "--stat", "HEAD"])
        .current_dir(&expanded)
        .output()
        .map_err(|e| format!("git diff failed: {}", e))?;

    let stat = if stat_output.status.success() {
        String::from_utf8_lossy(&stat_output.stdout).trim().to_string()
    } else {
        String::new()
    };

    let files_output = std::process::Command::new("git")
        .args(["diff", "--name-only", "HEAD"])
        .current_dir(&expanded)
        .output()
        .map_err(|e| format!("git diff failed: {}", e))?;

    let changed_files: Vec<String> = if files_output.status.success() {
        String::from_utf8_lossy(&files_output.stdout)
            .lines()
            .filter(|l| !l.is_empty())
            .map(|l| l.to_string())
            .collect()
    } else {
        Vec::new()
    };

    let numstat_output = std::process::Command::new("git")
        .args(["diff", "--numstat", "HEAD"])
        .current_dir(&expanded)
        .output()
        .map_err(|e| format!("git diff failed: {}", e))?;

    let file_stats: Vec<FileDiffStat> = if numstat_output.status.success() {
        String::from_utf8_lossy(&numstat_output.stdout)
            .lines()
            .filter_map(|line| {
                let parts: Vec<&str> = line.split('\t').collect();
                if parts.len() >= 3 {
                    Some(FileDiffStat {
                        file: parts[2].to_string(),
                        additions: parts[0].parse().unwrap_or(0),
                        deletions: parts[1].parse().unwrap_or(0),
                    })
                } else {
                    None
                }
            })
            .collect()
    } else {
        Vec::new()
    };

    Ok(SessionDiff {
        stat_summary: stat,
        changed_files,
        file_stats,
    })
}

#[derive(serde::Serialize)]
pub struct SessionDiff {
    pub stat_summary: String,
    pub changed_files: Vec<String>,
    pub file_stats: Vec<FileDiffStat>,
}

#[derive(serde::Serialize)]
pub struct FileDiffStat {
    pub file: String,
    pub additions: u32,
    pub deletions: u32,
}

/// Resolve the API key for a given agent type.
async fn resolve_api_key(
    pool: &SqlitePool,
    project_id: &str,
    agent_type: &str,
) -> Result<Option<String>, anyhow::Error> {
    let target_provider = match agent_type {
        "claude" => "anthropic",
        "codex" => "openai",
        _ => return Ok(None),
    };

    let repo = AiRepository::new(pool.clone());
    let configs = repo.get_project_provider_configs(project_id).await?;

    let config = match configs.iter().find(|c| c.provider == target_provider) {
        Some(c) => c,
        None => return Ok(None),
    };

    match &config.key_reference {
        Some(key_ref) => {
            let vault = VaultService::new("orbitae-app");
            let key = vault.get_secret(key_ref)?;
            Ok(Some(key))
        }
        None => Ok(None),
    }
}
