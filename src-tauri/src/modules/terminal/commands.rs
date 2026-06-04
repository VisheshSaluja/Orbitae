use tauri::{command, AppHandle, State};
use sqlx::SqlitePool;
use super::models::TerminalSessions;
use super::service::TerminalService;
use crate::modules::projects::repository::ProjectRepository;

#[command]
pub async fn spawn_shell(
    app_handle: AppHandle,
    sessions: State<'_, TerminalSessions>,
    pool: State<'_, SqlitePool>,
    project_id: String,
    initial_command: Option<String>,
) -> Result<String, String> {
    let repo = ProjectRepository::new(pool.inner().clone());
    let service = TerminalService::new(sessions.inner().clone(), repo);
    service.spawn_shell(app_handle, project_id, initial_command)
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub fn write_to_shell(
    sessions: State<'_, TerminalSessions>,
    pool: State<'_, SqlitePool>,
    session_id: String,
    data: String
) -> Result<(), String> {
    // We don't strictly need ProjectRepo for writing, but Service constructor needs it currently.
    // We could refactor to split concerns or just create repo cheap.
    let repo = ProjectRepository::new(pool.inner().clone());
    let service = TerminalService::new(sessions.inner().clone(), repo);
    
    service.write_to_shell(&session_id, &data).map_err(|e| e.to_string())
}

#[command]
pub fn resize_shell(
    sessions: State<'_, TerminalSessions>,
    pool: State<'_, SqlitePool>,
    session_id: String,
    cols: u16,
    rows: u16
) -> Result<(), String> {
    let repo = ProjectRepository::new(pool.inner().clone());
    let service = TerminalService::new(sessions.inner().clone(), repo);
    
    service.resize_shell(&session_id, cols, rows).map_err(|e| e.to_string())
}

#[command]
pub async fn open_external_terminal(path: String) -> Result<(), String> {
    // Expand path if needed
    let expanded_path = crate::shared::utils::expand_path(&path);
    
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(&["-a", "Terminal", &expanded_path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "windows")]
    {
         std::process::Command::new("cmd")
            .args(&["/C", "start", "cmd", "/K", &format!("cd /d {}", expanded_path)])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("x-terminal-emulator")
            .arg(format!("--working-directory={}", expanded_path))
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}
