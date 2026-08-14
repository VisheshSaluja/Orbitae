use anyhow::Result;
use sqlx::SqlitePool;

/// Build a context document for an AI agent session from project data.
///
/// Assembles vault key names, environment variables, notes, runbook steps,
/// and git diff into a structured text document that gets injected as the
/// agent's initial instructions.
pub async fn build_project_context(
    pool: &SqlitePool,
    project_id: &str,
    project_path: &str,
) -> Result<String> {
    let repo = crate::modules::projects::repository::ProjectRepository::new(pool.clone());

    let project = repo.get_project(project_id).await?
        .ok_or_else(|| anyhow::anyhow!("Project not found"))?;

    let mut sections: Vec<String> = Vec::new();

    sections.push(format!(
        "# Project Context: {}\nPath: {}\n",
        project.name, project.path
    ));

    // Vault key names (never expose values)
    let keys = repo.get_project_keys(project_id).await.unwrap_or_default();
    if !keys.is_empty() {
        let key_list: Vec<String> = keys.iter().map(|k| format!("- {}", k.name)).collect();
        sections.push(format!(
            "## Available Secrets (names only)\n{}\n",
            key_list.join("\n")
        ));
    }

    // Environment variables
    let envs = repo.get_project_envs(project_id).await.unwrap_or_default();
    if !envs.is_empty() {
        let env_list: Vec<String> = envs.iter().map(|e| format!("- {}={}", e.key, e.value)).collect();
        sections.push(format!(
            "## Environment Variables\n{}\n",
            env_list.join("\n")
        ));
    }

    // Notes summaries (truncated)
    let notes = repo.get_project_notes(project_id).await.unwrap_or_default();
    if !notes.is_empty() {
        let note_summaries: Vec<String> = notes.iter().take(10).map(|n| {
            let preview: String = n.content.chars().take(200).collect();
            format!("### {}\n{}", n.title, preview)
        }).collect();
        sections.push(format!(
            "## Project Notes\n{}\n",
            note_summaries.join("\n\n")
        ));
    }

    // Knowledge graph nodes (conventions, architecture, decisions the team recorded).
    // This is the context moat: the agent reads what the project already knows
    // instead of rediscovering it.
    let nodes = sqlx::query_as::<_, (String, String, String)>(
        "SELECT title, kind, content FROM knowledge_nodes \
         WHERE project_id = ? AND status = 'active' \
         ORDER BY updated_at DESC LIMIT 30",
    )
    .bind(project_id)
    .fetch_all(pool)
    .await
    .unwrap_or_default();
    if !nodes.is_empty() {
        let items: Vec<String> = nodes
            .iter()
            .map(|(title, kind, content)| {
                let preview: String = content.chars().take(240).collect();
                format!("### [{kind}] {title}\n{preview}")
            })
            .collect();
        sections.push(format!(
            "## Project Knowledge (recorded in the knowledge graph)\n{}\n",
            items.join("\n\n")
        ));
    }

    // Runbook names
    let playbooks = repo.get_project_playbooks(project_id).await.unwrap_or_default();
    if !playbooks.is_empty() {
        let pb_list: Vec<String> = playbooks.iter().map(|p| {
            format!("- {} ({})", p.name, p.description.as_deref().unwrap_or("no description"))
        }).collect();
        sections.push(format!(
            "## Runbooks\n{}\n",
            pb_list.join("\n")
        ));
    }

    // Git diff (recent changes, truncated to avoid huge payloads)
    let git_diff = get_git_diff(project_path).unwrap_or_default();
    if !git_diff.is_empty() {
        let truncated: String = git_diff.chars().take(3000).collect();
        sections.push(format!(
            "## Recent Changes (git diff)\n```\n{}\n```\n",
            truncated
        ));
    }

    // Git status
    let git_status = get_git_status_summary(project_path).unwrap_or_default();
    if !git_status.is_empty() {
        sections.push(format!(
            "## Git Status\n```\n{}\n```\n",
            git_status
        ));
    }

    Ok(sections.join("\n"))
}

/// Get a summary of uncommitted changes via `git diff --stat`.
fn get_git_diff(project_path: &str) -> Option<String> {
    let expanded = crate::shared::utils::expand_path(project_path);
    let output = std::process::Command::new("git")
        .args(["diff", "--stat", "HEAD"])
        .current_dir(&expanded)
        .output()
        .ok()?;

    if output.status.success() {
        let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if text.is_empty() { None } else { Some(text) }
    } else {
        None
    }
}

/// Get the git status summary.
fn get_git_status_summary(project_path: &str) -> Option<String> {
    let expanded = crate::shared::utils::expand_path(project_path);
    let output = std::process::Command::new("git")
        .args(["status", "--short"])
        .current_dir(&expanded)
        .output()
        .ok()?;

    if output.status.success() {
        let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if text.is_empty() { None } else { Some(text) }
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn git_diff_returns_none_for_invalid_path() {
        assert!(get_git_diff("/nonexistent/path").is_none());
    }

    #[test]
    fn git_status_returns_none_for_invalid_path() {
        assert!(get_git_status_summary("/nonexistent/path").is_none());
    }
}
