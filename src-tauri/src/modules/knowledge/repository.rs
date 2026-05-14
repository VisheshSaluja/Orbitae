use super::models::{KnowledgeNode, KnowledgeEdge, KnowledgeLogEntry};
use anyhow::Result;
use sqlx::SqlitePool;
use uuid::Uuid;

pub struct KnowledgeRepository {
    pool: SqlitePool,
}

impl KnowledgeRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub async fn create_node(
        &self,
        project_id: &str,
        title: &str,
        content: &str,
        kind: &str,
        source: &str,
        tags: &str,
    ) -> Result<KnowledgeNode> {
        let id = Uuid::new_v4().to_string();

        sqlx::query(
            "INSERT INTO knowledge_nodes (id, project_id, title, content, kind, source, status, tags, created_at, updated_at) \
             VALUES (?, ?, ?, ?, ?, ?, 'active', ?, datetime('now'), datetime('now'))"
        )
            .bind(&id)
            .bind(project_id)
            .bind(title)
            .bind(content)
            .bind(kind)
            .bind(source)
            .bind(tags)
            .execute(&self.pool)
            .await?;

        self.get_node(&id).await?.ok_or_else(|| anyhow::anyhow!("Failed to retrieve created node"))
    }

    pub async fn get_node(&self, id: &str) -> Result<Option<KnowledgeNode>> {
        let node = sqlx::query_as::<_, KnowledgeNode>(
            "SELECT id, project_id, title, content, kind, source, status, tags, created_at, updated_at \
             FROM knowledge_nodes WHERE id = ?"
        )
            .bind(id)
            .fetch_optional(&self.pool)
            .await?;
        Ok(node)
    }

    pub async fn get_project_nodes(&self, project_id: &str) -> Result<Vec<KnowledgeNode>> {
        let nodes = sqlx::query_as::<_, KnowledgeNode>(
            "SELECT id, project_id, title, content, kind, source, status, tags, created_at, updated_at \
             FROM knowledge_nodes WHERE project_id = ? AND status != 'archived' ORDER BY updated_at DESC"
        )
            .bind(project_id)
            .fetch_all(&self.pool)
            .await?;
        Ok(nodes)
    }

    pub async fn search_nodes(
        &self,
        project_id: &str,
        query: Option<&str>,
        kind: Option<&str>,
        status: Option<&str>,
        limit: i64,
    ) -> Result<Vec<KnowledgeNode>> {
        let mut sql = String::from(
            "SELECT id, project_id, title, content, kind, source, status, tags, created_at, updated_at \
             FROM knowledge_nodes WHERE project_id = ?"
        );
        let mut binds: Vec<String> = vec![project_id.to_string()];

        if let Some(q) = query {
            sql.push_str(" AND (title LIKE ? OR content LIKE ? OR tags LIKE ?)");
            let pattern = format!("%{}%", q);
            binds.push(pattern.clone());
            binds.push(pattern.clone());
            binds.push(pattern);
        }

        if let Some(k) = kind {
            sql.push_str(" AND kind = ?");
            binds.push(k.to_string());
        }

        if let Some(s) = status {
            sql.push_str(" AND status = ?");
            binds.push(s.to_string());
        }

        sql.push_str(" ORDER BY updated_at DESC LIMIT ?");
        binds.push(limit.to_string());

        let mut query_builder = sqlx::query_as::<_, KnowledgeNode>(&sql);
        for b in &binds {
            query_builder = query_builder.bind(b);
        }

        let nodes = query_builder.fetch_all(&self.pool).await?;
        Ok(nodes)
    }

    pub async fn update_node(
        &self,
        id: &str,
        title: Option<&str>,
        content: Option<&str>,
        kind: Option<&str>,
        status: Option<&str>,
        tags: Option<&str>,
    ) -> Result<KnowledgeNode> {
        let existing = self.get_node(id).await?
            .ok_or_else(|| anyhow::anyhow!("Node not found: {}", id))?;

        let new_title = title.unwrap_or(&existing.title);
        let new_content = content.unwrap_or(&existing.content);
        let new_kind = kind.unwrap_or(&existing.kind);
        let new_status = status.unwrap_or(&existing.status);
        let new_tags = tags.unwrap_or(&existing.tags);

        sqlx::query(
            "UPDATE knowledge_nodes SET title = ?, content = ?, kind = ?, status = ?, tags = ?, updated_at = datetime('now') WHERE id = ?"
        )
            .bind(new_title)
            .bind(new_content)
            .bind(new_kind)
            .bind(new_status)
            .bind(new_tags)
            .bind(id)
            .execute(&self.pool)
            .await?;

        self.get_node(id).await?.ok_or_else(|| anyhow::anyhow!("Failed to retrieve updated node"))
    }

    pub async fn delete_node(&self, id: &str) -> Result<()> {
        let mut tx = self.pool.begin().await?;

        sqlx::query("DELETE FROM knowledge_edges WHERE from_node = ? OR to_node = ?")
            .bind(id)
            .bind(id)
            .execute(&mut *tx)
            .await?;

        sqlx::query("DELETE FROM knowledge_nodes WHERE id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await?;

        tx.commit().await?;
        Ok(())
    }

    pub async fn create_edge(
        &self,
        from_node: &str,
        to_node: &str,
        relation: &str,
    ) -> Result<KnowledgeEdge> {
        let id = Uuid::new_v4().to_string();

        sqlx::query(
            "INSERT INTO knowledge_edges (id, from_node, to_node, relation, created_at) \
             VALUES (?, ?, ?, ?, datetime('now'))"
        )
            .bind(&id)
            .bind(from_node)
            .bind(to_node)
            .bind(relation)
            .execute(&self.pool)
            .await?;

        Ok(KnowledgeEdge {
            id,
            from_node: from_node.to_string(),
            to_node: to_node.to_string(),
            relation: relation.to_string(),
            created_at: String::new(),
        })
    }

    pub async fn get_node_edges(&self, node_id: &str) -> Result<Vec<KnowledgeEdge>> {
        let edges = sqlx::query_as::<_, KnowledgeEdge>(
            "SELECT id, from_node, to_node, relation, created_at \
             FROM knowledge_edges WHERE from_node = ? OR to_node = ? ORDER BY created_at DESC"
        )
            .bind(node_id)
            .bind(node_id)
            .fetch_all(&self.pool)
            .await?;
        Ok(edges)
    }

    pub async fn get_project_edges(&self, project_id: &str) -> Result<Vec<KnowledgeEdge>> {
        let edges = sqlx::query_as::<_, KnowledgeEdge>(
            "SELECT e.id, e.from_node, e.to_node, e.relation, e.created_at \
             FROM knowledge_edges e \
             INNER JOIN knowledge_nodes n ON e.from_node = n.id \
             WHERE n.project_id = ? \
             ORDER BY e.created_at DESC"
        )
            .bind(project_id)
            .fetch_all(&self.pool)
            .await?;
        Ok(edges)
    }

    /// Delete all nodes with a given source for a project, along with their edges.
    pub async fn delete_nodes_by_source(&self, project_id: &str, source: &str) -> Result<u64> {
        let mut tx = self.pool.begin().await?;

        // Delete edges connected to nodes being removed
        sqlx::query(
            "DELETE FROM knowledge_edges WHERE from_node IN \
             (SELECT id FROM knowledge_nodes WHERE project_id = ? AND source = ?) \
             OR to_node IN \
             (SELECT id FROM knowledge_nodes WHERE project_id = ? AND source = ?)"
        )
            .bind(project_id)
            .bind(source)
            .bind(project_id)
            .bind(source)
            .execute(&mut *tx)
            .await?;

        let result = sqlx::query(
            "DELETE FROM knowledge_nodes WHERE project_id = ? AND source = ?"
        )
            .bind(project_id)
            .bind(source)
            .execute(&mut *tx)
            .await?;

        tx.commit().await?;
        Ok(result.rows_affected())
    }

    /// Find a node by exact title and source for a given project.
    pub async fn find_node_by_title_and_source(
        &self,
        project_id: &str,
        title: &str,
        source: &str,
    ) -> Result<Option<KnowledgeNode>> {
        let node = sqlx::query_as::<_, KnowledgeNode>(
            "SELECT id, project_id, title, content, kind, source, status, tags, created_at, updated_at \
             FROM knowledge_nodes WHERE project_id = ? AND title = ? AND source = ? LIMIT 1"
        )
            .bind(project_id)
            .bind(title)
            .bind(source)
            .fetch_optional(&self.pool)
            .await?;
        Ok(node)
    }

    pub async fn delete_edge(&self, id: &str) -> Result<()> {
        sqlx::query("DELETE FROM knowledge_edges WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn create_log_entry(
        &self,
        project_id: &str,
        action: &str,
        summary: &str,
        affected_nodes: &str,
    ) -> Result<KnowledgeLogEntry> {
        let id = Uuid::new_v4().to_string();

        sqlx::query(
            "INSERT INTO knowledge_log (id, project_id, action, summary, affected_nodes, created_at) \
             VALUES (?, ?, ?, ?, ?, datetime('now'))"
        )
            .bind(&id)
            .bind(project_id)
            .bind(action)
            .bind(summary)
            .bind(affected_nodes)
            .execute(&self.pool)
            .await?;

        Ok(KnowledgeLogEntry {
            id,
            project_id: project_id.to_string(),
            action: action.to_string(),
            summary: summary.to_string(),
            affected_nodes: affected_nodes.to_string(),
            created_at: String::new(),
        })
    }

    pub async fn get_project_log(&self, project_id: &str, limit: i64) -> Result<Vec<KnowledgeLogEntry>> {
        let entries = sqlx::query_as::<_, KnowledgeLogEntry>(
            "SELECT id, project_id, action, summary, affected_nodes, created_at \
             FROM knowledge_log WHERE project_id = ? ORDER BY created_at DESC LIMIT ?"
        )
            .bind(project_id)
            .bind(limit)
            .fetch_all(&self.pool)
            .await?;
        Ok(entries)
    }
}
