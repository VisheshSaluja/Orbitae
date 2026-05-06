use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct KnowledgeNode {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub content: String,
    pub kind: String,
    pub source: String,
    pub status: String,
    pub tags: String,
    #[sqlx(default)]
    pub created_at: String,
    #[sqlx(default)]
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct KnowledgeEdge {
    pub id: String,
    pub from_node: String,
    pub to_node: String,
    pub relation: String,
    #[sqlx(default)]
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct KnowledgeLogEntry {
    pub id: String,
    pub project_id: String,
    pub action: String,
    pub summary: String,
    pub affected_nodes: String,
    #[sqlx(default)]
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateNodeRequest {
    pub project_id: String,
    pub title: String,
    pub content: String,
    pub kind: String,
    pub source: Option<String>,
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateNodeRequest {
    pub title: Option<String>,
    pub content: Option<String>,
    pub kind: Option<String>,
    pub status: Option<String>,
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchNodesRequest {
    pub project_id: String,
    pub query: Option<String>,
    pub kind: Option<String>,
    pub status: Option<String>,
    pub limit: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeWithEdges {
    pub node: KnowledgeNode,
    pub edges: Vec<KnowledgeEdge>,
}
