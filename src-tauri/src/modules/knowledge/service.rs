use super::models::{KnowledgeNode, KnowledgeEdge, KnowledgeLogEntry, NodeWithEdges};
use super::repository::KnowledgeRepository;
use anyhow::Result;
use sqlx::SqlitePool;

pub struct KnowledgeService {
    repo: KnowledgeRepository,
}

impl KnowledgeService {
    pub fn new(pool: SqlitePool) -> Self {
        Self {
            repo: KnowledgeRepository::new(pool),
        }
    }

    pub async fn create_node(
        &self,
        project_id: &str,
        title: &str,
        content: &str,
        kind: &str,
        source: Option<&str>,
        tags: Option<Vec<String>>,
    ) -> Result<KnowledgeNode> {
        let source = source.unwrap_or("manual");
        let tags_json = serde_json::to_string(&tags.unwrap_or_default())?;

        let node = self.repo.create_node(project_id, title, content, kind, source, &tags_json).await?;

        self.repo.create_log_entry(
            project_id,
            "ingest",
            &format!("Created node: {}", title),
            &serde_json::to_string(&vec![&node.id])?,
        ).await?;

        tracing::info!(project_id = project_id, node_id = node.id, kind = kind, "Knowledge node created");
        Ok(node)
    }

    pub async fn get_node(&self, id: &str) -> Result<Option<KnowledgeNode>> {
        self.repo.get_node(id).await
    }

    pub async fn get_node_with_edges(&self, id: &str) -> Result<Option<NodeWithEdges>> {
        let node = self.repo.get_node(id).await?;
        match node {
            Some(n) => {
                let edges = self.repo.get_node_edges(id).await?;
                Ok(Some(NodeWithEdges { node: n, edges }))
            }
            None => Ok(None),
        }
    }

    pub async fn get_project_nodes(&self, project_id: &str) -> Result<Vec<KnowledgeNode>> {
        self.repo.get_project_nodes(project_id).await
    }

    pub async fn search_nodes(
        &self,
        project_id: &str,
        query: Option<&str>,
        kind: Option<&str>,
        status: Option<&str>,
        limit: Option<i64>,
    ) -> Result<Vec<KnowledgeNode>> {
        let limit = limit.unwrap_or(20);
        self.repo.search_nodes(project_id, query, kind, status, limit).await
    }

    pub async fn update_node(
        &self,
        id: &str,
        title: Option<&str>,
        content: Option<&str>,
        kind: Option<&str>,
        status: Option<&str>,
        tags: Option<Vec<String>>,
    ) -> Result<KnowledgeNode> {
        let tags_json = tags.map(|t| serde_json::to_string(&t).unwrap_or_default());
        let node = self.repo.update_node(
            id,
            title,
            content,
            kind,
            status,
            tags_json.as_deref(),
        ).await?;

        self.repo.create_log_entry(
            &node.project_id,
            "update",
            &format!("Updated node: {}", node.title),
            &serde_json::to_string(&vec![&node.id])?,
        ).await?;

        tracing::debug!(node_id = id, "Knowledge node updated");
        Ok(node)
    }

    pub async fn delete_node(&self, id: &str) -> Result<()> {
        let node = self.repo.get_node(id).await?;
        if let Some(n) = node {
            self.repo.delete_node(id).await?;
            let _ = self.repo.create_log_entry(
                &n.project_id,
                "delete",
                &format!("Deleted node: {}", n.title),
                &serde_json::to_string(&vec![id])?,
            ).await;
            tracing::info!(node_id = id, "Knowledge node deleted");
        }
        Ok(())
    }

    pub async fn create_edge(
        &self,
        from_node: &str,
        to_node: &str,
        relation: &str,
    ) -> Result<KnowledgeEdge> {
        self.repo.create_edge(from_node, to_node, relation).await
    }

    pub async fn get_node_edges(&self, node_id: &str) -> Result<Vec<KnowledgeEdge>> {
        self.repo.get_node_edges(node_id).await
    }

    pub async fn get_project_edges(&self, project_id: &str) -> Result<Vec<KnowledgeEdge>> {
        self.repo.get_project_edges(project_id).await
    }

    pub async fn delete_edge(&self, id: &str) -> Result<()> {
        self.repo.delete_edge(id).await
    }

    pub async fn get_project_log(&self, project_id: &str, limit: Option<i64>) -> Result<Vec<KnowledgeLogEntry>> {
        self.repo.get_project_log(project_id, limit.unwrap_or(50)).await
    }

    /// Build context for AI from the knowledge graph.
    /// Returns relevant nodes based on a query, with connected nodes via edges.
    pub async fn build_context(
        &self,
        project_id: &str,
        query: &str,
        max_nodes: i64,
    ) -> Result<Vec<KnowledgeNode>> {
        let mut relevant = self.repo.search_nodes(
            project_id,
            Some(query),
            None,
            Some("active"),
            max_nodes,
        ).await?;

        let direct_ids: Vec<String> = relevant.iter().map(|n| n.id.clone()).collect();

        // Expand: fetch connected nodes via edges
        for id in &direct_ids {
            let edges = self.repo.get_node_edges(id).await?;
            for edge in edges {
                let neighbor_id = if edge.from_node == *id { &edge.to_node } else { &edge.from_node };
                if !relevant.iter().any(|n| n.id == *neighbor_id) {
                    if let Some(neighbor) = self.repo.get_node(neighbor_id).await? {
                        if neighbor.status == "active" {
                            relevant.push(neighbor);
                        }
                    }
                }
            }
        }

        self.repo.create_log_entry(
            project_id,
            "query",
            &format!("Context query: {}", query),
            &serde_json::to_string(&relevant.iter().map(|n| &n.id).collect::<Vec<_>>())?,
        ).await?;

        Ok(relevant)
    }

    /// Auto-ingest content from a file into the knowledge graph.
    pub async fn ingest_file(
        &self,
        project_id: &str,
        file_path: &str,
        content: &str,
        kind: &str,
    ) -> Result<KnowledgeNode> {
        let title = std::path::Path::new(file_path)
            .file_name()
            .map(|f| f.to_string_lossy().to_string())
            .unwrap_or_else(|| file_path.to_string());

        self.create_node(
            project_id,
            &title,
            content,
            kind,
            Some("auto_ingest"),
            Some(vec!["auto".to_string(), kind.to_string()]),
        ).await
    }
}
