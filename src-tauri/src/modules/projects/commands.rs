use tauri::{command, State};
use sqlx::SqlitePool;
use super::models::{Project, ProjectEnv, Snippet};
use super::service::ProjectService;

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
    if name.trim().is_empty() {
        return Err("Project name cannot be empty".to_string());
    }
    if path.trim().is_empty() {
        return Err("Project path cannot be empty".to_string());
    }
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
    pool: State<'_, SqlitePool>,
    key_reference: String,
) -> Result<String, String> {
    let service = ProjectService::new(pool.inner().clone());
    service.reveal_secret(&key_reference)
        .await
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
    open::that(url).map_err(|e| e.to_string())
}

// Git & FS
#[command]
pub async fn get_git_status(path: String) -> Result<Option<crate::modules::git::GitStatus>, String> {
    crate::modules::git::get_git_status(&path).map_err(|e| e.to_string())
}

#[command]
pub async fn git_clone(url: String, path: String) -> Result<(), String> {
    crate::modules::git::clone_repo(&url, &path).map_err(|e| e.to_string())
}

#[command]
pub async fn get_git_history(path: String, limit: Option<usize>) -> Result<Vec<crate::modules::git::Commit>, String> {
    crate::modules::git::get_git_history(&path, limit.unwrap_or(50)).map_err(|e| e.to_string())
}

#[command]
pub async fn open_in_editor(path: String) -> Result<(), String> {
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
