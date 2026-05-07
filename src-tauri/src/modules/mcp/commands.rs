use super::service::McpService;

/// Gets the current MCP auth token, generating one if it doesn't exist.
#[tauri::command]
pub fn get_mcp_token() -> Result<String, String> {
    McpService::ensure_token().map_err(|e| e.to_string())
}

/// Regenerates the MCP auth token, invalidating all existing client configs.
#[tauri::command]
pub fn regenerate_mcp_token() -> Result<String, String> {
    McpService::regenerate_token().map_err(|e| e.to_string())
}

/// Returns the MCP client config JSON for Claude Code / Cursor.
#[tauri::command]
pub fn get_mcp_client_config() -> Result<serde_json::Value, String> {
    McpService::client_config().map_err(|e| e.to_string())
}

/// Returns the path to the orbitae-mcp binary.
#[tauri::command]
pub fn get_mcp_binary_path() -> Result<String, String> {
    McpService::binary_path().map_err(|e| e.to_string())
}
