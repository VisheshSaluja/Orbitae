use super::models::{Conversation, ConversationMessage, AiProviderConfig};
use anyhow::Result;
use sqlx::SqlitePool;
use uuid::Uuid;

pub struct AiRepository {
    pool: SqlitePool,
}

impl AiRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    // --- Conversations ---

    pub async fn create_conversation(
        &self,
        project_id: &str,
        title: &str,
        provider: &str,
        model: &str,
    ) -> Result<Conversation> {
        let id = Uuid::new_v4().to_string();

        sqlx::query(
            "INSERT INTO conversations (id, project_id, title, provider, model, created_at, updated_at) \
             VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))"
        )
            .bind(&id)
            .bind(project_id)
            .bind(title)
            .bind(provider)
            .bind(model)
            .execute(&self.pool)
            .await?;

        self.get_conversation(&id).await?.ok_or_else(|| anyhow::anyhow!("Failed to create conversation"))
    }

    pub async fn get_conversation(&self, id: &str) -> Result<Option<Conversation>> {
        let conv = sqlx::query_as::<_, Conversation>(
            "SELECT id, project_id, title, provider, model, created_at, updated_at \
             FROM conversations WHERE id = ?"
        )
            .bind(id)
            .fetch_optional(&self.pool)
            .await?;
        Ok(conv)
    }

    pub async fn get_project_conversations(&self, project_id: &str) -> Result<Vec<Conversation>> {
        let convs = sqlx::query_as::<_, Conversation>(
            "SELECT id, project_id, title, provider, model, created_at, updated_at \
             FROM conversations WHERE project_id = ? ORDER BY updated_at DESC"
        )
            .bind(project_id)
            .fetch_all(&self.pool)
            .await?;
        Ok(convs)
    }

    pub async fn update_conversation_title(&self, id: &str, title: &str) -> Result<()> {
        sqlx::query("UPDATE conversations SET title = ?, updated_at = datetime('now') WHERE id = ?")
            .bind(title)
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn delete_conversation(&self, id: &str) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        sqlx::query("DELETE FROM conversation_messages WHERE conversation_id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await?;
        sqlx::query("DELETE FROM conversations WHERE id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        Ok(())
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
        let id = Uuid::new_v4().to_string();

        sqlx::query(
            "INSERT INTO conversation_messages (id, conversation_id, role, content, tool_calls, tool_results, created_at) \
             VALUES (?, ?, ?, ?, ?, ?, datetime('now'))"
        )
            .bind(&id)
            .bind(conversation_id)
            .bind(role)
            .bind(content)
            .bind(tool_calls)
            .bind(tool_results)
            .execute(&self.pool)
            .await?;

        // Touch conversation updated_at
        sqlx::query("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?")
            .bind(conversation_id)
            .execute(&self.pool)
            .await?;

        Ok(ConversationMessage {
            id,
            conversation_id: conversation_id.to_string(),
            role: role.to_string(),
            content: content.to_string(),
            tool_calls: tool_calls.map(|s| s.to_string()),
            tool_results: tool_results.map(|s| s.to_string()),
            created_at: String::new(),
        })
    }

    pub async fn get_conversation_messages(&self, conversation_id: &str) -> Result<Vec<ConversationMessage>> {
        let msgs = sqlx::query_as::<_, ConversationMessage>(
            "SELECT id, conversation_id, role, content, tool_calls, tool_results, created_at \
             FROM conversation_messages WHERE conversation_id = ? ORDER BY created_at ASC"
        )
            .bind(conversation_id)
            .fetch_all(&self.pool)
            .await?;
        Ok(msgs)
    }

    // --- Provider Configs ---

    pub async fn save_provider_config(
        &self,
        project_id: &str,
        provider: &str,
        model: &str,
        key_reference: Option<&str>,
        base_url: Option<&str>,
        temperature: f64,
        max_tokens: i64,
        is_default: bool,
    ) -> Result<AiProviderConfig> {
        let id = Uuid::new_v4().to_string();

        if is_default {
            sqlx::query("UPDATE ai_provider_configs SET is_default = 0 WHERE project_id = ?")
                .bind(project_id)
                .execute(&self.pool)
                .await?;
        }

        sqlx::query(
            "INSERT INTO ai_provider_configs (id, project_id, provider, model, key_reference, base_url, temperature, max_tokens, is_default, created_at, updated_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))"
        )
            .bind(&id)
            .bind(project_id)
            .bind(provider)
            .bind(model)
            .bind(key_reference)
            .bind(base_url)
            .bind(temperature)
            .bind(max_tokens)
            .bind(if is_default { 1 } else { 0 })
            .execute(&self.pool)
            .await?;

        self.get_provider_config(&id).await?.ok_or_else(|| anyhow::anyhow!("Failed to create config"))
    }

    pub async fn get_provider_config(&self, id: &str) -> Result<Option<AiProviderConfig>> {
        let config = sqlx::query_as::<_, AiProviderConfig>(
            "SELECT id, project_id, provider, model, key_reference, base_url, temperature, max_tokens, is_default, created_at, updated_at \
             FROM ai_provider_configs WHERE id = ?"
        )
            .bind(id)
            .fetch_optional(&self.pool)
            .await?;
        Ok(config)
    }

    pub async fn get_project_provider_configs(&self, project_id: &str) -> Result<Vec<AiProviderConfig>> {
        let configs = sqlx::query_as::<_, AiProviderConfig>(
            "SELECT id, project_id, provider, model, key_reference, base_url, temperature, max_tokens, is_default, created_at, updated_at \
             FROM ai_provider_configs WHERE project_id = ? ORDER BY is_default DESC, created_at DESC"
        )
            .bind(project_id)
            .fetch_all(&self.pool)
            .await?;
        Ok(configs)
    }

    pub async fn get_default_provider_config(&self, project_id: &str) -> Result<Option<AiProviderConfig>> {
        let config = sqlx::query_as::<_, AiProviderConfig>(
            "SELECT id, project_id, provider, model, key_reference, base_url, temperature, max_tokens, is_default, created_at, updated_at \
             FROM ai_provider_configs WHERE project_id = ? AND is_default = 1"
        )
            .bind(project_id)
            .fetch_optional(&self.pool)
            .await?;
        Ok(config)
    }

    pub async fn delete_provider_config(&self, id: &str) -> Result<()> {
        sqlx::query("DELETE FROM ai_provider_configs WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn update_provider_config(
        &self,
        id: &str,
        model: &str,
        key_reference: Option<&str>,
        base_url: Option<&str>,
        temperature: f64,
        max_tokens: i64,
        is_default: bool,
    ) -> Result<AiProviderConfig> {
        if is_default {
            let config = self.get_provider_config(id).await?
                .ok_or_else(|| anyhow::anyhow!("Config not found"))?;
            sqlx::query("UPDATE ai_provider_configs SET is_default = 0 WHERE project_id = ?")
                .bind(&config.project_id)
                .execute(&self.pool)
                .await?;
        }

        sqlx::query(
            "UPDATE ai_provider_configs SET model = ?, key_reference = ?, base_url = ?, temperature = ?, max_tokens = ?, is_default = ?, updated_at = datetime('now') WHERE id = ?"
        )
            .bind(model)
            .bind(key_reference)
            .bind(base_url)
            .bind(temperature)
            .bind(max_tokens)
            .bind(if is_default { 1 } else { 0 })
            .bind(id)
            .execute(&self.pool)
            .await?;

        self.get_provider_config(id).await?.ok_or_else(|| anyhow::anyhow!("Failed to retrieve updated config"))
    }
}
