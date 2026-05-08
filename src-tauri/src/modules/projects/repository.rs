use super::models::{Project, ProjectEnv, Snippet, ProjectKey, ProjectNote, ProjectLink, ProjectPlaybook, PlaybookStep};
use anyhow::Result;
use sqlx::SqlitePool;
use uuid::Uuid;

pub struct ProjectRepository {
    pool: SqlitePool,
}

impl ProjectRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub async fn create_project(&self, name: String, path: String, ssh_key_path: Option<String>) -> Result<Project> {
        let id = Uuid::new_v4().to_string();
        
        sqlx::query("INSERT INTO projects (id, name, path, ssh_key_path, notes, settings, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))")
            .bind(&id)
            .bind(&name)
            .bind(&path)
            .bind(&ssh_key_path)
            .bind(Option::<String>::None)
            .bind(Option::<String>::None)
            .execute(&self.pool)
            .await?;

        self.get_project(&id).await?.ok_or_else(|| anyhow::anyhow!("Failed to retrieve created project"))
    }

    pub async fn get_project(&self, id: &str) -> Result<Option<Project>> {
        let project = sqlx::query_as::<_, Project>("SELECT id, name, path, ssh_key_path, notes, settings, created_at, updated_at FROM projects WHERE id = ?")
            .bind(id)
            .fetch_optional(&self.pool)
            .await?;
        Ok(project)
    }

    pub async fn list_projects(&self) -> Result<Vec<Project>> {
        let projects = sqlx::query_as::<_, Project>("SELECT id, name, path, ssh_key_path, notes, settings, created_at, updated_at FROM projects ORDER BY created_at DESC")
            .fetch_all(&self.pool)
            .await?;
        Ok(projects)
    }

    pub async fn update_notes(&self, id: &str, notes: String) -> Result<()> {
        sqlx::query("UPDATE projects SET notes = ? WHERE id = ?")
            .bind(notes)
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn update_settings(&self, id: &str, settings: String) -> Result<()> {
        sqlx::query("UPDATE projects SET settings = ? WHERE id = ?")
            .bind(settings)
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn set_env_var(&self, project_id: &str, key: String, value: String) -> Result<()> {
        let id = Uuid::new_v4().to_string();
        
        let mut tx = self.pool.begin().await?;
        
        sqlx::query("DELETE FROM project_envs WHERE project_id = ? AND key = ?")
            .bind(project_id)
            .bind(&key)
            .execute(&mut *tx)
            .await?;

        sqlx::query("INSERT INTO project_envs (id, project_id, key, value) VALUES (?, ?, ?, ?)")
            .bind(&id)
            .bind(project_id)
            .bind(&key)
            .bind(&value)
            .execute(&mut *tx)
            .await?;

        tx.commit().await?;
        Ok(())
    }

    pub async fn get_project_envs(&self, project_id: &str) -> Result<Vec<ProjectEnv>> {
        let envs = sqlx::query_as::<_, ProjectEnv>("SELECT id, project_id, key, value FROM project_envs WHERE project_id = ?")
            .bind(project_id)
            .fetch_all(&self.pool)
            .await?;
        Ok(envs)
    }

    pub async fn add_snippet(&self, project_id: String, label: String, command: String, description: Option<String>) -> Result<Snippet> {
        let id = Uuid::new_v4().to_string();

        sqlx::query("INSERT INTO project_snippets (id, project_id, label, command, description) VALUES (?, ?, ?, ?, ?)")
            .bind(&id)
            .bind(&project_id)
            .bind(&label)
            .bind(&command)
            .bind(&description)
            .execute(&self.pool)
            .await?;

        Ok(Snippet {
            id,
            project_id,
            label,
            command,
            description,
        })
    }

    pub async fn get_project_snippets(&self, project_id: &str) -> Result<Vec<Snippet>> {
        let snippets = sqlx::query_as::<_, Snippet>("SELECT id, project_id, label, command, description FROM project_snippets WHERE project_id = ?")
            .bind(project_id)
            .fetch_all(&self.pool)
            .await?;
        Ok(snippets)
    }

    pub async fn delete_snippet(&self, id: &str) -> Result<()> {
        sqlx::query("DELETE FROM project_snippets WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
    pub async fn update_project(&self, id: &str, name: String, path: String, key_path: Option<String>) -> Result<()> {
        sqlx::query("UPDATE projects SET name = ?, path = ?, ssh_key_path = ? WHERE id = ?")
            .bind(name)
            .bind(path)
            .bind(key_path)
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn delete_project(&self, id: &str) -> Result<()> {
        let mut tx = self.pool.begin().await?;

        // Manual cleanup if no CASCADE (better safe)
        sqlx::query("DELETE FROM project_envs WHERE project_id = ?").bind(id).execute(&mut *tx).await?;
        sqlx::query("DELETE FROM project_snippets WHERE project_id = ?").bind(id).execute(&mut *tx).await?;
        sqlx::query("DELETE FROM project_notes WHERE project_id = ?").bind(id).execute(&mut *tx).await?; 
        sqlx::query("DELETE FROM project_links WHERE project_id = ?").bind(id).execute(&mut *tx).await?; 
        sqlx::query("DELETE FROM project_playbooks WHERE project_id = ?").bind(id).execute(&mut *tx).await?;
        sqlx::query("DELETE FROM knowledge_log WHERE project_id = ?").bind(id).execute(&mut *tx).await?;
        sqlx::query("DELETE FROM knowledge_edges WHERE from_node IN (SELECT id FROM knowledge_nodes WHERE project_id = ?)").bind(id).execute(&mut *tx).await?;
        sqlx::query("DELETE FROM knowledge_nodes WHERE project_id = ?").bind(id).execute(&mut *tx).await?;
        sqlx::query("DELETE FROM conversation_messages WHERE conversation_id IN (SELECT id FROM conversations WHERE project_id = ?)").bind(id).execute(&mut *tx).await?;
        sqlx::query("DELETE FROM conversations WHERE project_id = ?").bind(id).execute(&mut *tx).await?;
        sqlx::query("DELETE FROM ai_provider_configs WHERE project_id = ?").bind(id).execute(&mut *tx).await?;
        sqlx::query("DELETE FROM projects WHERE id = ?").bind(id).execute(&mut *tx).await?;

        tx.commit().await?;
        Ok(())
    }
    pub async fn add_key(&self, project_id: String, name: String, key_reference: String) -> Result<ProjectKey> {
        let id = Uuid::new_v4().to_string();

        sqlx::query("INSERT INTO project_keys (id, project_id, name, key_reference) VALUES (?, ?, ?, ?)")
            .bind(&id)
            .bind(&project_id)
            .bind(&name)
            .bind(&key_reference)
            .execute(&self.pool)
            .await?;

        // created_at is default current_timestamp
        Ok(ProjectKey {
            id,
            project_id,
            name,
            key_reference,
            created_at: String::new(), // Placeholder, typically we'd fetch or use time crate, but UI might not strictly need exact time immediately
        })
    }

    pub async fn get_project_keys(&self, project_id: &str) -> Result<Vec<ProjectKey>> {
        let keys = sqlx::query_as::<_, ProjectKey>("SELECT id, project_id, name, key_reference, created_at FROM project_keys WHERE project_id = ?")
            .bind(project_id)
            .fetch_all(&self.pool)
            .await?;
        Ok(keys)
    }

    pub async fn delete_key(&self, id: &str) -> Result<()> {
        sqlx::query("DELETE FROM project_keys WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn create_note(&self, project_id: String, title: String, content: String, color: String, kind: String) -> Result<ProjectNote> {
        let id = Uuid::new_v4().to_string();

        sqlx::query("INSERT INTO project_notes (id, project_id, title, content, color, kind) VALUES (?, ?, ?, ?, ?, ?)")
            .bind(&id)
            .bind(&project_id)
            .bind(&title)
            .bind(&content)
            .bind(&color)
            .bind(&kind)
            .execute(&self.pool)
            .await?;

        Ok(ProjectNote {
            id,
            project_id,
            title,
            content,
            color,
            kind,
            created_at: String::new(), 
            updated_at: String::new(),
        })
    }

    pub async fn get_project_notes(&self, project_id: &str) -> Result<Vec<ProjectNote>> {
        let notes = sqlx::query_as::<_, ProjectNote>("SELECT id, project_id, title, content, color, kind, created_at, updated_at FROM project_notes WHERE project_id = ? ORDER BY updated_at DESC")
            .bind(project_id)
            .fetch_all(&self.pool)
            .await?;
        Ok(notes)
    }

    pub async fn update_note(&self, id: &str, title: String, content: String, color: String, kind: String) -> Result<()> {
        sqlx::query("UPDATE project_notes SET title = ?, content = ?, color = ?, kind = ? WHERE id = ?")
            .bind(title)
            .bind(content)
            .bind(color)
            .bind(kind)
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn delete_note(&self, id: &str) -> Result<()> {
        sqlx::query("DELETE FROM project_notes WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    // Links
    pub async fn create_link(&self, project_id: String, title: String, url: String, icon: Option<String>, kind: String, working_directory: Option<String>) -> Result<ProjectLink> {
        let id = Uuid::new_v4().to_string();

        sqlx::query("INSERT INTO project_links (id, project_id, title, url, icon, kind, working_directory) VALUES (?, ?, ?, ?, ?, ?, ?)")
            .bind(&id)
            .bind(&project_id)
            .bind(&title)
            .bind(&url)
            .bind(&icon)
            .bind(&kind)
            .bind(&working_directory)
            .execute(&self.pool)
            .await?;

        Ok(ProjectLink {
            id,
            project_id,
            title,
            url,
            icon,
            kind,
            created_at: String::new(),
        })
    }

    pub async fn get_project_links(&self, project_id: &str) -> Result<Vec<ProjectLink>> {
        let links = sqlx::query_as::<_, ProjectLink>("SELECT id, project_id, title, url, icon, kind, working_directory, created_at FROM project_links WHERE project_id = ? ORDER BY created_at ASC")
            .bind(project_id)
            .fetch_all(&self.pool)
            .await?;
        Ok(links)
    }

    pub async fn delete_link(&self, id: &str) -> Result<()> {
        sqlx::query("DELETE FROM project_links WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    // Playbooks
    pub async fn create_playbook(&self, project_id: String, name: String, description: Option<String>) -> Result<ProjectPlaybook> {
        let id = Uuid::new_v4().to_string();

        sqlx::query("INSERT INTO project_playbooks (id, project_id, name, description) VALUES (?, ?, ?, ?)")
            .bind(&id)
            .bind(&project_id)
            .bind(&name)
            .bind(&description)
            .execute(&self.pool)
            .await?;

        Ok(ProjectPlaybook {
            id,
            project_id,
            name,
            description,
            created_at: String::new(),
            updated_at: String::new(),
        })
    }

    /// Gets a single playbook by ID.
    pub async fn get_project_playbooks_by_id(&self, id: &str) -> Result<Option<ProjectPlaybook>> {
        let playbook = sqlx::query_as::<_, ProjectPlaybook>(
            "SELECT id, project_id, name, description, created_at, updated_at FROM project_playbooks WHERE id = ?"
        )
            .bind(id)
            .fetch_optional(&self.pool)
            .await?;
        Ok(playbook)
    }

    pub async fn get_project_playbooks(&self, project_id: &str) -> Result<Vec<ProjectPlaybook>> {
        let playbooks = sqlx::query_as::<_, ProjectPlaybook>("SELECT id, project_id, name, description, created_at, updated_at FROM project_playbooks WHERE project_id = ? ORDER BY created_at DESC")
            .bind(project_id)
            .fetch_all(&self.pool)
            .await?;
        Ok(playbooks)
    }

    pub async fn delete_playbook(&self, id: &str) -> Result<()> {
        sqlx::query("DELETE FROM project_playbooks WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn create_playbook_step(
        &self, playbook_id: String, name: String, r#type: String, command: Option<String>, depends_on: Option<String>, expected_output: Option<String>
    ) -> Result<PlaybookStep> {
        let id = Uuid::new_v4().to_string();

        sqlx::query("INSERT INTO playbook_steps (id, playbook_id, name, type, command, depends_on, expected_output) VALUES (?, ?, ?, ?, ?, ?, ?)")
            .bind(&id)
            .bind(&playbook_id)
            .bind(&name)
            .bind(&r#type)
            .bind(&command)
            .bind(&depends_on)
            .bind(&expected_output)
            .execute(&self.pool)
            .await?;

        Ok(PlaybookStep {
            id,
            playbook_id,
            name,
            r#type,
            command,
            depends_on,
            expected_output,
            on_failure: "abort".to_string(),
            max_retries: 0,
            retry_delay_ms: 1000,
            created_at: String::new(),
            updated_at: String::new(),
        })
    }

    pub async fn get_playbook_steps(&self, playbook_id: &str) -> Result<Vec<PlaybookStep>> {
        let steps = sqlx::query_as::<_, PlaybookStep>("SELECT id, playbook_id, name, type, command, depends_on, expected_output, on_failure, max_retries, retry_delay_ms, created_at, updated_at FROM playbook_steps WHERE playbook_id = ? ORDER BY created_at ASC")
            .bind(playbook_id)
            .fetch_all(&self.pool)
            .await?;
        Ok(steps)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    #[tokio::test]
    async fn test_project_crud() -> Result<()> {
        let pool = SqlitePoolOptions::new()
            .connect("sqlite::memory:")
            .await?;
            
        // Run migrations
        // sqlx::migrate! path is relative to Cargo.toml usually.
        sqlx::migrate!("./migrations")
            .run(&pool)
            .await?;

        let repo = ProjectRepository::new(pool);

        // Create
        let proj = repo.create_project("Test Project".into(), "/tmp/test".into(), None).await?;
        assert_eq!(proj.name, "Test Project");

        // Get
        let found = repo.get_project(&proj.id).await?;
        assert!(found.is_some());
        assert_eq!(found.unwrap().id, proj.id);

        Ok(())
    }
}
