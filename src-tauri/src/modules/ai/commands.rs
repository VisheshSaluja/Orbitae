use tauri::{command, State};
use sqlx::SqlitePool;
use super::models::{Conversation, ConversationMessage, AiProviderConfig, AiProviderInfo};
use super::service::AiService;

// --- Provider Catalog ---

#[command]
pub async fn get_ai_providers() -> Result<Vec<AiProviderInfo>, String> {
    Ok(AiService::get_available_providers())
}

// --- Provider Configs ---

#[command]
pub async fn save_ai_provider_config(
    pool: State<'_, SqlitePool>,
    project_id: String,
    provider: String,
    model: String,
    api_key: Option<String>,
    base_url: Option<String>,
    temperature: Option<f64>,
    max_tokens: Option<i64>,
    is_default: Option<bool>,
) -> Result<AiProviderConfig, String> {
    let service = AiService::new(pool.inner().clone());
    service.save_provider_config(
        &project_id,
        &provider,
        &model,
        api_key.as_deref(),
        base_url.as_deref(),
        temperature.unwrap_or(0.7),
        max_tokens.unwrap_or(4096),
        is_default.unwrap_or(true),
    )
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn get_ai_provider_configs(
    pool: State<'_, SqlitePool>,
    project_id: String,
) -> Result<Vec<AiProviderConfig>, String> {
    let service = AiService::new(pool.inner().clone());
    service.get_project_provider_configs(&project_id)
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn get_default_ai_config(
    pool: State<'_, SqlitePool>,
    project_id: String,
) -> Result<Option<AiProviderConfig>, String> {
    let service = AiService::new(pool.inner().clone());
    service.get_default_provider_config(&project_id)
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn update_ai_provider_config(
    pool: State<'_, SqlitePool>,
    id: String,
    model: String,
    api_key: Option<String>,
    base_url: Option<String>,
    temperature: Option<f64>,
    max_tokens: Option<i64>,
    is_default: Option<bool>,
) -> Result<AiProviderConfig, String> {
    let service = AiService::new(pool.inner().clone());
    service.update_provider_config(
        &id,
        &model,
        api_key.as_deref(),
        base_url.as_deref(),
        temperature.unwrap_or(0.7),
        max_tokens.unwrap_or(4096),
        is_default.unwrap_or(false),
    )
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn delete_ai_provider_config(
    pool: State<'_, SqlitePool>,
    id: String,
) -> Result<(), String> {
    let service = AiService::new(pool.inner().clone());
    service.delete_provider_config(&id)
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn get_ai_api_key(
    pool: State<'_, SqlitePool>,
    config_id: String,
) -> Result<Option<String>, String> {
    let service = AiService::new(pool.inner().clone());
    service.get_provider_api_key(&config_id)
        .await
        .map_err(|e| e.to_string())
}

// --- Conversations ---

#[command]
pub async fn create_conversation(
    pool: State<'_, SqlitePool>,
    project_id: String,
    title: Option<String>,
    provider: String,
    model: String,
) -> Result<Conversation, String> {
    let service = AiService::new(pool.inner().clone());
    service.create_conversation(&project_id, &title.unwrap_or("New Conversation".to_string()), &provider, &model)
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn get_project_conversations(
    pool: State<'_, SqlitePool>,
    project_id: String,
) -> Result<Vec<Conversation>, String> {
    let service = AiService::new(pool.inner().clone());
    service.get_project_conversations(&project_id)
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn update_conversation_title(
    pool: State<'_, SqlitePool>,
    id: String,
    title: String,
) -> Result<(), String> {
    let service = AiService::new(pool.inner().clone());
    service.update_conversation_title(&id, &title)
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn delete_conversation(
    pool: State<'_, SqlitePool>,
    id: String,
) -> Result<(), String> {
    let service = AiService::new(pool.inner().clone());
    service.delete_conversation(&id)
        .await
        .map_err(|e| e.to_string())
}

// --- Messages ---

#[command]
pub async fn add_conversation_message(
    pool: State<'_, SqlitePool>,
    conversation_id: String,
    role: String,
    content: String,
    tool_calls: Option<String>,
    tool_results: Option<String>,
) -> Result<ConversationMessage, String> {
    let service = AiService::new(pool.inner().clone());
    service.add_message(&conversation_id, &role, &content, tool_calls.as_deref(), tool_results.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn get_conversation_messages(
    pool: State<'_, SqlitePool>,
    conversation_id: String,
) -> Result<Vec<ConversationMessage>, String> {
    let service = AiService::new(pool.inner().clone());
    service.get_conversation_messages(&conversation_id)
        .await
        .map_err(|e| e.to_string())
}
