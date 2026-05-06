use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Conversation {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub provider: String,
    pub model: String,
    #[sqlx(default)]
    pub created_at: String,
    #[sqlx(default)]
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ConversationMessage {
    pub id: String,
    pub conversation_id: String,
    pub role: String,
    pub content: String,
    pub tool_calls: Option<String>,
    pub tool_results: Option<String>,
    #[sqlx(default)]
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct AiProviderConfig {
    pub id: String,
    pub project_id: String,
    pub provider: String,
    pub model: String,
    pub key_reference: Option<String>,
    pub base_url: Option<String>,
    pub temperature: f64,
    pub max_tokens: i64,
    pub is_default: i32,
    #[sqlx(default)]
    pub created_at: String,
    #[sqlx(default)]
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiProviderInfo {
    pub id: String,
    pub name: String,
    pub models: Vec<AiModelInfo>,
    pub requires_api_key: bool,
    pub default_base_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiModelInfo {
    pub id: String,
    pub name: String,
    pub context_window: i64,
    pub supports_tools: bool,
}
