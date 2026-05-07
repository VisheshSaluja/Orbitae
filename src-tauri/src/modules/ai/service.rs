use super::models::{Conversation, ConversationMessage, AiProviderConfig, AiProviderInfo, AiModelInfo};
use super::repository::AiRepository;
use anyhow::Result;
use sqlx::SqlitePool;

pub struct AiService {
    repo: AiRepository,
}

impl AiService {
    pub fn new(pool: SqlitePool) -> Self {
        Self {
            repo: AiRepository::new(pool),
        }
    }

    /// Returns the catalog of supported AI providers and their models.
    pub fn get_available_providers() -> Vec<AiProviderInfo> {
        vec![
            AiProviderInfo {
                id: "openai".to_string(),
                name: "OpenAI".to_string(),
                requires_api_key: true,
                default_base_url: None,
                models: vec![
                    AiModelInfo { id: "gpt-4o".to_string(), name: "GPT-4o".to_string(), context_window: 128000, supports_tools: true },
                    AiModelInfo { id: "gpt-4o-mini".to_string(), name: "GPT-4o Mini".to_string(), context_window: 128000, supports_tools: true },
                    AiModelInfo { id: "gpt-4.1".to_string(), name: "GPT-4.1".to_string(), context_window: 1047576, supports_tools: true },
                    AiModelInfo { id: "gpt-4.1-mini".to_string(), name: "GPT-4.1 Mini".to_string(), context_window: 1047576, supports_tools: true },
                    AiModelInfo { id: "o3-mini".to_string(), name: "o3-mini".to_string(), context_window: 200000, supports_tools: true },
                ],
            },
            AiProviderInfo {
                id: "anthropic".to_string(),
                name: "Anthropic".to_string(),
                requires_api_key: true,
                default_base_url: None,
                models: vec![
                    AiModelInfo { id: "claude-opus-4-6".to_string(), name: "Claude Opus 4.6".to_string(), context_window: 200000, supports_tools: true },
                    AiModelInfo { id: "claude-sonnet-4-6".to_string(), name: "Claude Sonnet 4.6".to_string(), context_window: 200000, supports_tools: true },
                    AiModelInfo { id: "claude-haiku-4-5-20251001".to_string(), name: "Claude Haiku 4.5".to_string(), context_window: 200000, supports_tools: true },
                ],
            },
            AiProviderInfo {
                id: "groq".to_string(),
                name: "Groq".to_string(),
                requires_api_key: true,
                default_base_url: None,
                models: vec![
                    AiModelInfo { id: "llama-3.3-70b-versatile".to_string(), name: "Llama 3.3 70B".to_string(), context_window: 131072, supports_tools: true },
                    AiModelInfo { id: "llama-3.1-8b-instant".to_string(), name: "Llama 3.1 8B".to_string(), context_window: 131072, supports_tools: true },
                    AiModelInfo { id: "mixtral-8x7b-32768".to_string(), name: "Mixtral 8x7B".to_string(), context_window: 32768, supports_tools: true },
                ],
            },
            AiProviderInfo {
                id: "ollama".to_string(),
                name: "Ollama (Local)".to_string(),
                requires_api_key: false,
                default_base_url: Some("http://127.0.0.1:11434/v1".to_string()),
                models: vec![
                    AiModelInfo { id: "llama3.2:latest".to_string(), name: "Llama 3.2 (3B)".to_string(), context_window: 131072, supports_tools: false },
                    AiModelInfo { id: "qwen2.5-coder:7b".to_string(), name: "Qwen 2.5 Coder 7B".to_string(), context_window: 32768, supports_tools: true },
                    AiModelInfo { id: "qwen2.5:7b".to_string(), name: "Qwen 2.5 7B".to_string(), context_window: 32768, supports_tools: true },
                    AiModelInfo { id: "deepseek-coder-v2:latest".to_string(), name: "DeepSeek Coder V2".to_string(), context_window: 131072, supports_tools: true },
                ],
            },
        ]
    }

    // --- Conversations ---

    pub async fn create_conversation(
        &self,
        project_id: &str,
        title: &str,
        provider: &str,
        model: &str,
    ) -> Result<Conversation> {
        self.repo.create_conversation(project_id, title, provider, model).await
    }

    pub async fn get_conversation(&self, id: &str) -> Result<Option<Conversation>> {
        self.repo.get_conversation(id).await
    }

    pub async fn get_project_conversations(&self, project_id: &str) -> Result<Vec<Conversation>> {
        self.repo.get_project_conversations(project_id).await
    }

    pub async fn update_conversation_title(&self, id: &str, title: &str) -> Result<()> {
        self.repo.update_conversation_title(id, title).await
    }

    pub async fn delete_conversation(&self, id: &str) -> Result<()> {
        self.repo.delete_conversation(id).await
    }

    // --- Messages ---

    pub async fn add_message(
        &self,
        conversation_id: &str,
        role: &str,
        content: &str,
        tool_calls: Option<&str>,
        tool_results: Option<&str>,
    ) -> Result<ConversationMessage> {
        self.repo.add_message(conversation_id, role, content, tool_calls, tool_results).await
    }

    pub async fn get_conversation_messages(&self, conversation_id: &str) -> Result<Vec<ConversationMessage>> {
        self.repo.get_conversation_messages(conversation_id).await
    }

    // --- Provider Configs ---

    pub async fn save_provider_config(
        &self,
        project_id: &str,
        provider: &str,
        model: &str,
        api_key: Option<&str>,
        base_url: Option<&str>,
        temperature: f64,
        max_tokens: i64,
        is_default: bool,
    ) -> Result<AiProviderConfig> {
        let key_reference = if let Some(key) = api_key {
            let vault = crate::modules::vault::service::VaultService::new("orbitae-app");
            let ref_id = format!("ai-{}-{}", provider, uuid::Uuid::new_v4());
            vault.store_secret(&ref_id, key)?;
            Some(ref_id)
        } else {
            None
        };

        self.repo.save_provider_config(
            project_id,
            provider,
            model,
            key_reference.as_deref(),
            base_url,
            temperature,
            max_tokens,
            is_default,
        ).await
    }

    pub async fn get_project_provider_configs(&self, project_id: &str) -> Result<Vec<AiProviderConfig>> {
        self.repo.get_project_provider_configs(project_id).await
    }

    pub async fn get_default_provider_config(&self, project_id: &str) -> Result<Option<AiProviderConfig>> {
        self.repo.get_default_provider_config(project_id).await
    }

    pub async fn delete_provider_config(&self, id: &str) -> Result<()> {
        if let Some(config) = self.repo.get_provider_config(id).await? {
            if let Some(ref key_ref) = config.key_reference {
                let vault = crate::modules::vault::service::VaultService::new("orbitae-app");
                let _ = vault.delete_secret(key_ref);
            }
        }
        self.repo.delete_provider_config(id).await
    }

    pub async fn update_provider_config(
        &self,
        id: &str,
        model: &str,
        api_key: Option<&str>,
        base_url: Option<&str>,
        temperature: f64,
        max_tokens: i64,
        is_default: bool,
    ) -> Result<AiProviderConfig> {
        let existing = self.repo.get_provider_config(id).await?
            .ok_or_else(|| anyhow::anyhow!("Config not found"))?;

        let key_reference = if let Some(key) = api_key {
            let vault = crate::modules::vault::service::VaultService::new("orbitae-app");
            // Delete old key if exists
            if let Some(ref old_ref) = existing.key_reference {
                let _ = vault.delete_secret(old_ref);
            }
            let ref_id = format!("ai-{}-{}", existing.provider, uuid::Uuid::new_v4());
            vault.store_secret(&ref_id, key)?;
            Some(ref_id)
        } else {
            existing.key_reference.clone()
        };

        self.repo.update_provider_config(
            id,
            model,
            key_reference.as_deref(),
            base_url,
            temperature,
            max_tokens,
            is_default,
        ).await
    }

    /// Retrieve the actual API key for a provider config (for frontend to pass to AI SDK).
    pub async fn get_provider_api_key(&self, config_id: &str) -> Result<Option<String>> {
        let config = self.repo.get_provider_config(config_id).await?
            .ok_or_else(|| anyhow::anyhow!("Config not found"))?;

        match config.key_reference {
            Some(ref key_ref) => {
                let vault = crate::modules::vault::service::VaultService::new("orbitae-app");
                let key = vault.get_secret(key_ref)?;
                Ok(Some(key))
            }
            None => Ok(None),
        }
    }
}
