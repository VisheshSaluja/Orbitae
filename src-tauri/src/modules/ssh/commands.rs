use tauri::command;
use super::models::SshHostModel;
use super::service::SshService;

#[command]
pub fn get_ssh_hosts() -> Result<Vec<SshHostModel>, String> {
    let service = SshService::new().map_err(|e| e.to_string())?;
    service.list_hosts().map_err(|e| e.to_string())
}

#[command]
pub fn add_ssh_host(host: SshHostModel) -> Result<(), String> {
    let service = SshService::new().map_err(|e| e.to_string())?;
    service.add_host(host).map_err(|e| e.to_string())
}
