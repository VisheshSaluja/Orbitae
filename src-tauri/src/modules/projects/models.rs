use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    pub ssh_key_path: Option<String>,
    pub notes: Option<String>,
    pub settings: Option<String>, // JSON string
    #[sqlx(default)]
    pub created_at: String,
    #[sqlx(default)]
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectSettings {
    pub note_labels: std::collections::HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ProjectEnv {
    pub id: String,
    pub project_id: String,
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Snippet {
    pub id: String,
    pub project_id: String,
    pub label: String,
    pub command: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ProjectKey {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub key_reference: String, // The key used in Vault
    #[sqlx(default)]
    pub created_at: String, // Sqlite stores as string/text usually
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ProjectNote {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub content: String,
    pub color: String,
    #[sqlx(default)]
    pub kind: String, // 'text' or 'canvas'
    #[sqlx(default)]
    pub created_at: String,
    #[sqlx(default)]
    pub updated_at: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectScript {
    pub name: String,
    pub command: String,
    pub source: String, // e.g. "package.json", "Makefile"
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ProjectLink {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub url: String,
    pub icon: Option<String>,
    #[sqlx(default)]
    pub kind: String, // 'url' or 'command'
    #[sqlx(default)]
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ProjectPlaybook {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub description: Option<String>,
    #[sqlx(default)]
    pub created_at: String,
    #[sqlx(default)]
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct PlaybookStep {
    pub id: String,
    pub playbook_id: String,
    pub name: String,
    pub r#type: String,
    pub command: Option<String>,
    pub depends_on: Option<String>,
    pub expected_output: Option<String>,
    #[sqlx(default)]
    pub on_failure: String,
    #[sqlx(default)]
    pub max_retries: i32,
    #[sqlx(default)]
    pub retry_delay_ms: i32,
    #[sqlx(default)]
    pub created_at: String,
    #[sqlx(default)]
    pub updated_at: String,
}
