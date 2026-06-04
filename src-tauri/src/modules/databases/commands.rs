use tauri::{command, State};
use sqlx::SqlitePool;
use super::service::DatabaseService;
use super::models::ProjectConnection;

/// Strips the "password" key from a JSON details string so it is never persisted in SQLite.
fn strip_password_from_details(details: &str) -> Result<String, String> {
    let mut parsed: serde_json::Value = serde_json::from_str(details)
        .map_err(|e| format!("Invalid details JSON: {}", e))?;

    if let Some(obj) = parsed.as_object_mut() {
        obj.remove("password");
    }

    serde_json::to_string(&parsed)
        .map_err(|e| format!("Failed to re-serialize details: {}", e))
}

/// Resolves the effective password for a connection by checking the vault first,
/// then falling back to an explicitly provided password parameter.
fn resolve_password(connection_id: Option<&str>, explicit_password: Option<&str>) -> Option<String> {
    // Try vault first using connection_id
    if let Some(conn_id) = connection_id {
        if let Some(vault_pass) = DatabaseService::get_password(conn_id) {
            return Some(vault_pass);
        }
    }
    // Fall back to explicitly provided password
    explicit_password.map(|s| s.to_string())
}

#[command]
pub async fn create_connection(
    pool: State<'_, SqlitePool>,
    project_id: String,
    name: String,
    kind: String,
    details: String,
    password: Option<String>,
) -> Result<ProjectConnection, String> {
    // Strip password from details JSON so it is never stored in SQLite
    let sanitized_details = strip_password_from_details(&details)?;

    let service = DatabaseService::new(pool.inner().clone());
    let conn = service.create_connection(project_id, name, kind, sanitized_details)
        .await
        .map_err(|e| e.to_string())?;

    // Store the password in the OS keychain if provided
    if let Some(ref pass) = password {
        if !pass.is_empty() {
            DatabaseService::store_password(&conn.id, pass)
                .map_err(|e| format!("Connection saved but failed to store password in vault: {}", e))?;
        }
    }

    Ok(conn)
}

#[command]
pub async fn get_connections(
    pool: State<'_, SqlitePool>,
    project_id: String
) -> Result<Vec<ProjectConnection>, String> {
    let service = DatabaseService::new(pool.inner().clone());
    service.get_connections(&project_id)
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn delete_connection(
    pool: State<'_, SqlitePool>,
    id: String
) -> Result<(), String> {
    // Delete the password from the vault before removing the connection record
    DatabaseService::delete_password(&id);

    let service = DatabaseService::new(pool.inner().clone());
    service.delete_connection(&id)
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn test_connection(
    pool: State<'_, SqlitePool>,
    kind: String,
    details: String,
    password: Option<String>,
    connection_id: Option<String>,
) -> Result<bool, String> {
    let resolved = resolve_password(connection_id.as_deref(), password.as_deref());
    let service = DatabaseService::new(pool.inner().clone());
    service.test_connection(&kind, &details, resolved.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn execute_query(
    pool: State<'_, SqlitePool>,
    kind: String,
    details: String,
    query: String,
    password: Option<String>,
    connection_id: Option<String>,
) -> Result<super::models::QueryResult, String> {
    let resolved = resolve_password(connection_id.as_deref(), password.as_deref());
    let service = DatabaseService::new(pool.inner().clone());
    service.execute_query(&kind, &details, &query, resolved.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn get_tables(
    pool: State<'_, SqlitePool>,
    kind: String,
    details: String,
    password: Option<String>,
    connection_id: Option<String>,
) -> Result<Vec<super::models::TableInfo>, String> {
    let resolved = resolve_password(connection_id.as_deref(), password.as_deref());
    let service = DatabaseService::new(pool.inner().clone());
    service.get_tables(&kind, &details, resolved.as_deref())
        .await
        .map_err(|e| e.to_string())
}
