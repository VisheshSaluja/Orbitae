use tauri::{command, State};
use sqlx::SqlitePool;
use super::models::{KnowledgeNode, KnowledgeEdge, KnowledgeLogEntry, NodeWithEdges};
use super::service::KnowledgeService;

#[command]
pub async fn create_knowledge_node(
    pool: State<'_, SqlitePool>,
    project_id: String,
    title: String,
    content: String,
    kind: String,
    source: Option<String>,
    tags: Option<Vec<String>>,
) -> Result<KnowledgeNode, String> {
    if title.trim().is_empty() {
        return Err("Node title cannot be empty".to_string());
    }
    let service = KnowledgeService::new(pool.inner().clone());
    service.create_node(&project_id, &title, &content, &kind, source.as_deref(), tags)
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn get_knowledge_node(
    pool: State<'_, SqlitePool>,
    id: String,
) -> Result<Option<NodeWithEdges>, String> {
    let service = KnowledgeService::new(pool.inner().clone());
    service.get_node_with_edges(&id)
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn get_project_knowledge_nodes(
    pool: State<'_, SqlitePool>,
    project_id: String,
) -> Result<Vec<KnowledgeNode>, String> {
    let service = KnowledgeService::new(pool.inner().clone());
    service.get_project_nodes(&project_id)
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn search_knowledge_nodes(
    pool: State<'_, SqlitePool>,
    project_id: String,
    query: Option<String>,
    kind: Option<String>,
    status: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<KnowledgeNode>, String> {
    let service = KnowledgeService::new(pool.inner().clone());
    service.search_nodes(&project_id, query.as_deref(), kind.as_deref(), status.as_deref(), limit)
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn update_knowledge_node(
    pool: State<'_, SqlitePool>,
    id: String,
    title: Option<String>,
    content: Option<String>,
    kind: Option<String>,
    status: Option<String>,
    tags: Option<Vec<String>>,
) -> Result<KnowledgeNode, String> {
    let service = KnowledgeService::new(pool.inner().clone());
    service.update_node(&id, title.as_deref(), content.as_deref(), kind.as_deref(), status.as_deref(), tags)
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn delete_knowledge_node(
    pool: State<'_, SqlitePool>,
    id: String,
) -> Result<(), String> {
    let service = KnowledgeService::new(pool.inner().clone());
    service.delete_node(&id)
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn create_knowledge_edge(
    pool: State<'_, SqlitePool>,
    from_node: String,
    to_node: String,
    relation: String,
) -> Result<KnowledgeEdge, String> {
    if from_node == to_node {
        return Err("Cannot create edge from node to itself".to_string());
    }
    let service = KnowledgeService::new(pool.inner().clone());
    service.create_edge(&from_node, &to_node, &relation)
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn get_knowledge_edges(
    pool: State<'_, SqlitePool>,
    project_id: String,
) -> Result<Vec<KnowledgeEdge>, String> {
    let service = KnowledgeService::new(pool.inner().clone());
    service.get_project_edges(&project_id)
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn delete_knowledge_edge(
    pool: State<'_, SqlitePool>,
    id: String,
) -> Result<(), String> {
    let service = KnowledgeService::new(pool.inner().clone());
    service.delete_edge(&id)
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn get_knowledge_log(
    pool: State<'_, SqlitePool>,
    project_id: String,
    limit: Option<i64>,
) -> Result<Vec<KnowledgeLogEntry>, String> {
    let service = KnowledgeService::new(pool.inner().clone());
    service.get_project_log(&project_id, limit)
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn build_knowledge_context(
    pool: State<'_, SqlitePool>,
    project_id: String,
    query: String,
    max_nodes: Option<i64>,
) -> Result<Vec<KnowledgeNode>, String> {
    let service = KnowledgeService::new(pool.inner().clone());
    service.build_context(&project_id, &query, max_nodes.unwrap_or(10))
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn ingest_knowledge_file(
    pool: State<'_, SqlitePool>,
    project_id: String,
    file_path: String,
    content: String,
    kind: String,
) -> Result<KnowledgeNode, String> {
    let service = KnowledgeService::new(pool.inner().clone());
    service.ingest_file(&project_id, &file_path, &content, &kind)
        .await
        .map_err(|e| e.to_string())
}

/// Auto-ingest README.md and docs/ from a project path into the knowledge graph.
#[command]
pub async fn auto_ingest_project_docs(
    pool: State<'_, SqlitePool>,
    project_id: String,
    project_path: String,
) -> Result<Vec<KnowledgeNode>, String> {
    let service = KnowledgeService::new(pool.inner().clone());
    let expanded = crate::shared::utils::expand_path(&project_path);
    let base = std::path::Path::new(&expanded);
    let mut ingested = Vec::new();

    let doc_files = [
        ("README.md", "onboarding"),
        ("CONTRIBUTING.md", "convention"),
        ("ARCHITECTURE.md", "architecture"),
        ("docs/README.md", "onboarding"),
        ("docs/ARCHITECTURE.md", "architecture"),
        ("docs/CONVENTIONS.md", "convention"),
        (".env.example", "convention"),
    ];

    for (rel_path, kind) in &doc_files {
        let full_path = base.join(rel_path);
        if full_path.exists() {
            if let Ok(content) = std::fs::read_to_string(&full_path) {
                if content.len() > 10 {
                    match service.ingest_file(&project_id, rel_path, &content, kind).await {
                        Ok(node) => {
                            tracing::info!(project_id = project_id, file = rel_path, "Auto-ingested doc");
                            ingested.push(node);
                        }
                        Err(e) => {
                            tracing::warn!(file = rel_path, error = %e, "Failed to auto-ingest");
                        }
                    }
                }
            }
        }
    }

    Ok(ingested)
}
