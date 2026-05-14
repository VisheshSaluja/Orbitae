use tauri::{command, State, Window};
use super::models::{Process, ProcessState};
use super::service::ProcessService;

#[command]
pub async fn start_process(
    window: Window,
    state: State<'_, ProcessState>,
    command: String,
    cwd: String
) -> Result<Process, String> {
    if command.trim().is_empty() {
        return Err("Command cannot be empty".to_string());
    }
    if cwd.trim().is_empty() {
        return Err("Working directory cannot be empty".to_string());
    }
    let cwd_path = std::path::Path::new(&cwd);
    if !cwd_path.exists() || !cwd_path.is_dir() {
        return Err(format!("Working directory does not exist: {}", cwd));
    }
    let service = ProcessService::new(state.inner().clone());
    service.start_process(window, command, cwd).map_err(|e| e.to_string())
}

#[command]
pub async fn write_to_process(
    state: State<'_, ProcessState>,
    id: String,
    data: String
) -> Result<(), String> {
    let service = ProcessService::new(state.inner().clone());
    service.write(&id, &data).map_err(|e| e.to_string())
}

#[command]
pub async fn resize_process(
    state: State<'_, ProcessState>,
    id: String,
    cols: u16,
    rows: u16
) -> Result<(), String> {
    let service = ProcessService::new(state.inner().clone());
    service.resize(&id, cols, rows).map_err(|e| e.to_string())
}

#[command]
pub async fn stop_process(
    state: State<'_, ProcessState>,
    id: String
) -> Result<(), String> {
    let service = ProcessService::new(state.inner().clone());
    service.kill(&id).map_err(|e| e.to_string())
}

#[command]
pub async fn get_process_history(
    state: State<'_, ProcessState>,
    id: String
) -> Result<String, String> {
    let service = ProcessService::new(state.inner().clone());
    service.get_history(&id).map_err(|e| e.to_string())
}

#[command]
pub async fn get_active_processes(
    state: State<'_, ProcessState>
) -> Result<Vec<Process>, String> {
    let service = ProcessService::new(state.inner().clone());
    service.list_processes().map_err(|e| e.to_string())
}
