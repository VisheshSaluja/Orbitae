use tauri::{command, State};
use sqlx::SqlitePool;
use serde::{Deserialize, Serialize};
use super::models::{Project, ProjectEnv, Snippet};
use super::service::ProjectService;
use crate::shared::validation::{validate_name, validate_path};

// Note: In Tauri, we usually inject the Pool state.
// We need to decide if we inject the Service or the Pool and create Service on fly.
// Since Service is lightweight (holds repo which holds pool), creating on fly is fine.

#[command]
pub async fn create_project(
    pool: State<'_, SqlitePool>,
    name: String,
    path: String,
    ssh_key_path: Option<String>,
) -> Result<Project, String> {
    validate_name(&name, "Project name").map_err(|e| e.to_string())?;
    validate_path(&path).map_err(|e| e.to_string())?;
    let service = ProjectService::new(pool.inner().clone());
    service.create_project(name, path, ssh_key_path)
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn list_projects(pool: State<'_, SqlitePool>) -> Result<Vec<Project>, String> {
    let service = ProjectService::new(pool.inner().clone());
    service.list_projects()
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn get_project(pool: State<'_, SqlitePool>, id: String) -> Result<Option<Project>, String> {
    let service = ProjectService::new(pool.inner().clone());
    service.get_project(&id)
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn set_project_env(
    pool: State<'_, SqlitePool>,
    project_id: String,
    key: String,
    value: String
) -> Result<(), String> {
    let service = ProjectService::new(pool.inner().clone());
    service.set_env_var(&project_id, key, value)
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn get_project_envs(
    pool: State<'_, SqlitePool>,
    project_id: String
) -> Result<Vec<ProjectEnv>, String> {
    let service = ProjectService::new(pool.inner().clone());
    let result = service.get_project_with_envs(&project_id)
        .await
        .map_err(|e| e.to_string())?;
    
    match result {
        Some((_, envs)) => Ok(envs),
        None => Err("Project not found".to_string()),
    }
}

#[command]
pub async fn update_project_notes(
    pool: State<'_, SqlitePool>,
    project_id: String,
    notes: String
) -> Result<(), String> {
    let service = ProjectService::new(pool.inner().clone());
    service.update_project_notes(&project_id, notes)
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn add_snippet(
    pool: State<'_, SqlitePool>,
    project_id: String,
    label: String,
    command: String,
    description: Option<String>
) -> Result<Snippet, String> {
    let service = ProjectService::new(pool.inner().clone());
    service.add_snippet(project_id, label, command, description)
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn get_project_snippets(
    pool: State<'_, SqlitePool>,
    project_id: String
) -> Result<Vec<Snippet>, String> {
    let service = ProjectService::new(pool.inner().clone());
    service.get_project_snippets(&project_id)
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn delete_snippet(
    pool: State<'_, SqlitePool>,
    id: String
) -> Result<(), String> {
    let service = ProjectService::new(pool.inner().clone());
    service.delete_snippet(&id)
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn update_project(
    pool: State<'_, SqlitePool>,
    id: String,
    name: String,
    path: String,
    ssh_key_path: Option<String>
) -> Result<(), String> {
    validate_name(&name, "Project name").map_err(|e| e.to_string())?;
    validate_path(&path).map_err(|e| e.to_string())?;
    let service = ProjectService::new(pool.inner().clone());
    service.update_project(&id, name, path, ssh_key_path)
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn delete_project(pool: State<'_, SqlitePool>, id: String) -> Result<(), String> {
    let service = ProjectService::new(pool.inner().clone());
    service.delete_project(&id)
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn add_project_key(
    pool: State<'_, SqlitePool>,
    project_id: String,
    name: String,
    secret: String,
) -> Result<crate::modules::projects::models::ProjectKey, String> {
    let service = ProjectService::new(pool.inner().clone());
    service.create_key(project_id, name, secret)
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn get_project_keys(
    pool: State<'_, SqlitePool>,
    project_id: String,
) -> Result<Vec<crate::modules::projects::models::ProjectKey>, String> {
    let service = ProjectService::new(pool.inner().clone());
    service.get_project_keys(&project_id)
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn delete_project_key(
    pool: State<'_, SqlitePool>,
    id: String,
    key_reference: String,
) -> Result<(), String> {
    let service = ProjectService::new(pool.inner().clone());
    service.delete_key(&id, &key_reference)
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn reveal_secret(
    _pool: State<'_, SqlitePool>,
    key_reference: String,
) -> Result<String, String> {
    let key_ref = key_reference.clone();
    tokio::task::spawn_blocking(move || {
        let vault = crate::modules::vault::service::VaultService::new("orbitae-app");
        vault.get_secret_authenticated(&key_ref)
    })
    .await
    .map_err(|e| format!("Authentication thread failed: {e}"))?
    .map_err(|e| e.to_string())
}

// Notes
#[command]
pub async fn create_project_note(
    pool: State<'_, SqlitePool>,
    project_id: String,
    title: String,
    content: String,
    color: String,
    kind: String,
) -> Result<crate::modules::projects::models::ProjectNote, String> {
    let service = ProjectService::new(pool.inner().clone());
    service.create_note(project_id, title, content, color, kind)
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn update_project_note(
    pool: State<'_, SqlitePool>,
    id: String,
    title: String,
    content: String,
    color: String,
    kind: String,
) -> Result<(), String> {
    let service = ProjectService::new(pool.inner().clone());
    service.update_note(&id, title, content, color, kind)
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn delete_project_note(
    pool: State<'_, SqlitePool>,
    id: String,
) -> Result<(), String> {
    let service = ProjectService::new(pool.inner().clone());
    service.delete_note(&id)
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn get_project_notes(
    pool: State<'_, SqlitePool>,
    project_id: String,
) -> Result<Vec<crate::modules::projects::models::ProjectNote>, String> {
    let service = ProjectService::new(pool.inner().clone());
    service.get_project_notes(&project_id)
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn get_project_scripts(
    pool: State<'_, SqlitePool>,
    path: String,
) -> Result<Vec<crate::modules::projects::models::ProjectScript>, String> {
    let service = ProjectService::new(pool.inner().clone());
    service.get_project_scripts(&path)
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn update_project_settings(
    pool: State<'_, SqlitePool>,
    id: String,
    settings: String,
) -> Result<(), String> {
    let service = ProjectService::new(pool.inner().clone());
    service.update_project_settings(&id, settings)
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn save_project_note_image(
    pool: State<'_, SqlitePool>,
    project_id: String,
    file_name: String,
    file_data: String,
) -> Result<String, String> {
    if file_name.contains('/') || file_name.contains('\\') || file_name.contains("..") {
        return Err("Invalid file name — path separators are not allowed".to_string());
    }
    let service = ProjectService::new(pool.inner().clone());
    service.save_note_image(&project_id, file_name, file_data)
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn add_project_link(
    pool: State<'_, SqlitePool>,
    project_id: String,
    title: String,
    url: String,
    icon: Option<String>,
    kind: String,
    working_directory: Option<String>
) -> Result<crate::modules::projects::models::ProjectLink, String> {
    let service = ProjectService::new(pool.inner().clone());
    service.create_link(project_id, title, url, icon, kind, working_directory)
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn get_project_links(
    pool: State<'_, SqlitePool>,
    project_id: String
) -> Result<Vec<crate::modules::projects::models::ProjectLink>, String> {
    let service = ProjectService::new(pool.inner().clone());
    service.get_project_links(&project_id)
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn delete_project_link(
    pool: State<'_, SqlitePool>,
    id: String
) -> Result<(), String> {
    let service = ProjectService::new(pool.inner().clone());
    service.delete_link(&id)
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn open_url(url: String) -> Result<(), String> {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("Only http:// and https:// URLs are allowed".to_string());
    }
    open::that(url).map_err(|e| e.to_string())
}

// Git & FS — inlined after module consolidation

#[derive(serde::Serialize, Clone)]
pub struct GitStatus {
    pub branch: String,
    pub modified_count: usize,
    pub ahead: usize,
    pub behind: usize,
    pub remote_url: Option<String>,
}

#[derive(serde::Serialize, Clone)]
pub struct Commit {
    pub hash: String,
    pub parents: Vec<String>,
    pub author: String,
    pub date: String,
    pub message: String,
    pub refs: String,
}

#[command]
pub async fn get_git_status(path: String) -> Result<Option<GitStatus>, String> {
    let expanded = crate::shared::utils::expand_path(&path);
    let output = std::process::Command::new("git")
        .args(["status", "--porcelain=v2", "--branch"])
        .current_dir(&expanded)
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Ok(None);
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let mut branch = String::new();
    let mut modified_count = 0usize;
    let mut ahead = 0usize;
    let mut behind = 0usize;
    for line in text.lines() {
        if let Some(b) = line.strip_prefix("# branch.head ") { branch = b.to_string(); }
        if let Some(ab) = line.strip_prefix("# branch.ab ") {
            for part in ab.split_whitespace() {
                if let Some(a) = part.strip_prefix('+') { ahead = a.parse().unwrap_or(0); }
                if let Some(b) = part.strip_prefix('-') { behind = b.parse().unwrap_or(0); }
            }
        }
        if line.starts_with('1') || line.starts_with('2') || line.starts_with('?') {
            modified_count += 1;
        }
    }
    let remote = std::process::Command::new("git")
        .args(["remote", "get-url", "origin"])
        .current_dir(&expanded)
        .output()
        .ok()
        .and_then(|o| if o.status.success() { Some(String::from_utf8_lossy(&o.stdout).trim().to_string()) } else { None });
    Ok(Some(GitStatus { branch, modified_count, ahead, behind, remote_url: remote }))
}

#[command]
pub async fn git_clone(url: String, path: String) -> Result<(), String> {
    let output = std::process::Command::new("git")
        .args(["clone", &url, &path])
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(())
}

#[command]
pub async fn get_git_history(path: String, limit: Option<usize>) -> Result<Vec<Commit>, String> {
    let expanded = crate::shared::utils::expand_path(&path);
    let limit_str = format!("-{}", limit.unwrap_or(50));
    let output = std::process::Command::new("git")
        .args(["log", &limit_str, "--format=%H%x00%P%x00%an%x00%aI%x00%s%x00%D"])
        .current_dir(&expanded)
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Ok(vec![]);
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let commits: Vec<Commit> = text.lines().filter(|l| !l.is_empty()).map(|line| {
        let parts: Vec<&str> = line.splitn(6, '\0').collect();
        Commit {
            hash: parts.first().unwrap_or(&"").to_string(),
            parents: parts.get(1).unwrap_or(&"").split_whitespace().map(String::from).collect(),
            author: parts.get(2).unwrap_or(&"").to_string(),
            date: parts.get(3).unwrap_or(&"").to_string(),
            message: parts.get(4).unwrap_or(&"").to_string(),
            refs: parts.get(5).unwrap_or(&"").to_string(),
        }
    }).collect();
    Ok(commits)
}

#[command]
pub async fn open_in_editor(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Err(format!("Path does not exist: {}", path));
    }
    if path.contains("..") {
        return Err("Path traversal is not allowed".to_string());
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("code")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(&["/C", "code", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "linux")]
    {
        // Try VS Code, fallback to xdg-open if needed or just fail
        std::process::Command::new("code")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    
    Ok(())
}

#[command]
pub async fn reveal_in_finder(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Err(format!("Path does not exist: {}", path));
    }
    if path.contains("..") {
        return Err("Path traversal is not allowed".to_string());
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "windows")]
    {
        // explorer /select,path
        // Note: canonicalize might be needed for Windows paths to safe-guard
        std::process::Command::new("explorer")
            .args(&["/select,", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "linux")]
    {
        // xdg-open typically opens the directory, not select
        // dbus-send or specific file managers support selection, but xdg-open path is safe fallback
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[command]
pub async fn open_external_terminal(path: String) -> Result<(), String> {
    let expanded = crate::shared::utils::expand_path(&path);
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-a", "Terminal", &expanded])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "cmd", "/K", &format!("cd /d \"{}\"", expanded)])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("x-terminal-emulator")
            .arg(format!("--working-directory={}", expanded))
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

// Playbook Commands
#[command]
pub async fn create_playbook(
    pool: State<'_, SqlitePool>,
    project_id: String,
    name: String,
    description: Option<String>
) -> Result<crate::modules::projects::models::ProjectPlaybook, String> {
    let service = ProjectService::new(pool.inner().clone());
    service.create_playbook(project_id, name, description)
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn get_project_playbooks(
    pool: State<'_, SqlitePool>,
    project_id: String
) -> Result<Vec<crate::modules::projects::models::ProjectPlaybook>, String> {
    let service = ProjectService::new(pool.inner().clone());
    service.get_project_playbooks(&project_id)
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn delete_playbook(
    pool: State<'_, SqlitePool>,
    id: String
) -> Result<(), String> {
    let service = ProjectService::new(pool.inner().clone());
    service.delete_playbook(&id)
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn create_playbook_step(
    pool: State<'_, SqlitePool>,
    playbook_id: String,
    name: String,
    r#type: String,
    command: Option<String>,
    depends_on: Option<String>,
    expected_output: Option<String>
) -> Result<crate::modules::projects::models::PlaybookStep, String> {
    let service = ProjectService::new(pool.inner().clone());
    service.create_playbook_step(playbook_id, name, r#type, command, depends_on, expected_output)
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn get_playbook_steps(
    pool: State<'_, SqlitePool>,
    playbook_id: String
) -> Result<Vec<crate::modules::projects::models::PlaybookStep>, String> {
    let service = ProjectService::new(pool.inner().clone());
    service.get_playbook_steps(&playbook_id)
        .await
        .map_err(|e| e.to_string())
}

// .orbitae export/import

/// Portable project package — no secrets, only metadata.
#[derive(Debug, Serialize, Deserialize)]
pub struct OrbitaeExport {
    pub version: u32,
    pub project_name: String,
    pub settings: Option<String>,
    pub env_vars: Vec<EnvEntry>,
    pub vault_key_names: Vec<String>,
    pub notes: Vec<NoteEntry>,
    pub playbooks: Vec<PlaybookEntry>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct EnvEntry {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NoteEntry {
    pub title: String,
    pub content: String,
    pub color: String,
    pub kind: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PlaybookEntry {
    pub name: String,
    pub description: Option<String>,
    pub steps: Vec<PlaybookStepEntry>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PlaybookStepEntry {
    pub name: String,
    pub r#type: String,
    pub command: Option<String>,
    pub depends_on: Option<String>,
    pub expected_output: Option<String>,
    pub on_failure: String,
    pub max_retries: i32,
    pub retry_delay_ms: i32,
}

/// Export a project's metadata as a `.orbitae` JSON file.
///
/// Includes env vars, notes, playbooks, and vault key names (not values).
/// Writes to `<project_path>/.orbitae`.
#[command]
pub async fn export_project(
    pool: State<'_, SqlitePool>,
    project_id: String,
) -> Result<String, String> {
    let service = ProjectService::new(pool.inner().clone());
    let repo = crate::modules::projects::repository::ProjectRepository::new(pool.inner().clone());

    let project = repo.get_project(&project_id).await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Project not found".to_string())?;

    let envs = repo.get_project_envs(&project_id).await.unwrap_or_default();
    let keys = repo.get_project_keys(&project_id).await.unwrap_or_default();
    let notes = repo.get_project_notes(&project_id).await.unwrap_or_default();
    let playbooks = repo.get_project_playbooks(&project_id).await.unwrap_or_default();

    let mut playbook_entries = Vec::new();
    for pb in &playbooks {
        let steps = service.get_playbook_steps(&pb.id).await.unwrap_or_default();
        playbook_entries.push(PlaybookEntry {
            name: pb.name.clone(),
            description: pb.description.clone(),
            steps: steps.iter().map(|s| PlaybookStepEntry {
                name: s.name.clone(),
                r#type: s.r#type.clone(),
                command: s.command.clone(),
                depends_on: s.depends_on.clone(),
                expected_output: s.expected_output.clone(),
                on_failure: s.on_failure.clone(),
                max_retries: s.max_retries,
                retry_delay_ms: s.retry_delay_ms,
            }).collect(),
        });
    }

    let export = OrbitaeExport {
        version: 1,
        project_name: project.name.clone(),
        settings: project.settings.clone(),
        env_vars: envs.iter().map(|e| EnvEntry { key: e.key.clone(), value: e.value.clone() }).collect(),
        vault_key_names: keys.iter().map(|k| k.name.clone()).collect(),
        notes: notes.iter().map(|n| NoteEntry {
            title: n.title.clone(),
            content: n.content.clone(),
            color: n.color.clone(),
            kind: n.kind.clone(),
        }).collect(),
        playbooks: playbook_entries,
    };

    let json = serde_json::to_string_pretty(&export)
        .map_err(|e| format!("Serialization failed: {}", e))?;

    let expanded = crate::shared::utils::expand_path(&project.path);
    let export_path = std::path::Path::new(&expanded).join(".orbitae");
    std::fs::write(&export_path, &json)
        .map_err(|e| format!("Failed to write .orbitae: {}", e))?;

    Ok(export_path.to_string_lossy().to_string())
}

/// Import a `.orbitae` file into a project.
///
/// Merges env vars, notes, and playbooks. Vault key names are listed but
/// values must be set manually (secrets are never exported).
#[command]
pub async fn import_project_bundle(
    pool: State<'_, SqlitePool>,
    project_id: String,
    file_path: String,
) -> Result<OrbitaeImportResult, String> {
    if file_path.contains("..") {
        return Err("Path traversal is not allowed".to_string());
    }

    let content = std::fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read file: {}", e))?;

    let export: OrbitaeExport = serde_json::from_str(&content)
        .map_err(|e| format!("Invalid .orbitae format: {}", e))?;

    if export.version != 1 {
        return Err(format!("Unsupported .orbitae version: {}", export.version));
    }

    let service = ProjectService::new(pool.inner().clone());
    let repo = crate::modules::projects::repository::ProjectRepository::new(pool.inner().clone());

    let mut imported_envs = 0u32;
    let mut imported_notes = 0u32;
    let mut imported_playbooks = 0u32;

    // Import env vars (upsert)
    for env in &export.env_vars {
        if let Err(e) = repo.set_env_var(&project_id, env.key.clone(), env.value.clone()).await {
            tracing::warn!("Failed to import env var {}: {}", env.key, e);
        } else {
            imported_envs += 1;
        }
    }

    // Import notes
    for note in &export.notes {
        if let Err(e) = repo.create_note(
            project_id.clone(), note.title.clone(), note.content.clone(),
            note.color.clone(), note.kind.clone()
        ).await {
            tracing::warn!("Failed to import note {}: {}", note.title, e);
        } else {
            imported_notes += 1;
        }
    }

    // Import playbooks with steps
    for pb in &export.playbooks {
        match service.create_playbook(project_id.clone(), pb.name.clone(), pb.description.clone()).await {
            Ok(created) => {
                for step in &pb.steps {
                    let _ = service.create_playbook_step(
                        created.id.clone(), step.name.clone(), step.r#type.clone(),
                        step.command.clone(), step.depends_on.clone(), step.expected_output.clone()
                    ).await;
                }
                imported_playbooks += 1;
            }
            Err(e) => tracing::warn!("Failed to import playbook {}: {}", pb.name, e),
        }
    }

    // Import settings if present and project has none
    if let Some(ref settings) = export.settings {
        let project = repo.get_project(&project_id).await.ok().flatten();
        if project.map(|p| p.settings.is_none()).unwrap_or(false) {
            let _ = repo.update_settings(&project_id, settings.clone()).await;
        }
    }

    Ok(OrbitaeImportResult {
        imported_envs,
        imported_notes,
        imported_playbooks,
        vault_keys_needed: export.vault_key_names,
    })
}

#[derive(Debug, Serialize)]
pub struct OrbitaeImportResult {
    pub imported_envs: u32,
    pub imported_notes: u32,
    pub imported_playbooks: u32,
    pub vault_keys_needed: Vec<String>,
}
