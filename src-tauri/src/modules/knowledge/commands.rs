use tauri::{command, State};
use sqlx::SqlitePool;
use super::models::{KnowledgeNode, KnowledgeEdge, KnowledgeLogEntry, NodeWithEdges};
use super::service::KnowledgeService;
use crate::shared::error::AppError;
use crate::shared::validation::{validate_name, validate_content};

#[command]
pub async fn create_knowledge_node(
    pool: State<'_, SqlitePool>,
    project_id: String,
    title: String,
    content: String,
    kind: String,
    source: Option<String>,
    tags: Option<Vec<String>>,
) -> Result<KnowledgeNode, AppError> {
    validate_name(&title, "Node title")?;
    validate_content(&content, "Node content")?;
    let service = KnowledgeService::new(pool.inner().clone());
    service.create_node(&project_id, &title, &content, &kind, source.as_deref(), tags)
        .await
        .map_err(AppError::from)
}

#[command]
pub async fn get_knowledge_node(
    pool: State<'_, SqlitePool>,
    id: String,
) -> Result<Option<NodeWithEdges>, AppError> {
    let service = KnowledgeService::new(pool.inner().clone());
    service.get_node_with_edges(&id)
        .await
        .map_err(AppError::from)
}

#[command]
pub async fn get_project_knowledge_nodes(
    pool: State<'_, SqlitePool>,
    project_id: String,
) -> Result<Vec<KnowledgeNode>, AppError> {
    let service = KnowledgeService::new(pool.inner().clone());
    service.get_project_nodes(&project_id)
        .await
        .map_err(AppError::from)
}

#[command]
pub async fn search_knowledge_nodes(
    pool: State<'_, SqlitePool>,
    project_id: String,
    query: Option<String>,
    kind: Option<String>,
    status: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<KnowledgeNode>, AppError> {
    let service = KnowledgeService::new(pool.inner().clone());
    service.search_nodes(&project_id, query.as_deref(), kind.as_deref(), status.as_deref(), limit)
        .await
        .map_err(AppError::from)
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
) -> Result<KnowledgeNode, AppError> {
    let service = KnowledgeService::new(pool.inner().clone());
    service.update_node(&id, title.as_deref(), content.as_deref(), kind.as_deref(), status.as_deref(), tags)
        .await
        .map_err(AppError::from)
}

#[command]
pub async fn delete_knowledge_node(
    pool: State<'_, SqlitePool>,
    id: String,
) -> Result<(), AppError> {
    let service = KnowledgeService::new(pool.inner().clone());
    service.delete_node(&id)
        .await
        .map_err(AppError::from)
}

#[command]
pub async fn create_knowledge_edge(
    pool: State<'_, SqlitePool>,
    from_node: String,
    to_node: String,
    relation: String,
) -> Result<KnowledgeEdge, AppError> {
    if from_node == to_node {
        return Err(AppError::Validation("Cannot create edge from node to itself".to_string()));
    }
    let service = KnowledgeService::new(pool.inner().clone());
    service.create_edge(&from_node, &to_node, &relation)
        .await
        .map_err(AppError::from)
}

#[command]
pub async fn get_knowledge_edges(
    pool: State<'_, SqlitePool>,
    project_id: String,
) -> Result<Vec<KnowledgeEdge>, AppError> {
    let service = KnowledgeService::new(pool.inner().clone());
    service.get_project_edges(&project_id)
        .await
        .map_err(AppError::from)
}

#[command]
pub async fn delete_knowledge_edge(
    pool: State<'_, SqlitePool>,
    id: String,
) -> Result<(), AppError> {
    let service = KnowledgeService::new(pool.inner().clone());
    service.delete_edge(&id)
        .await
        .map_err(AppError::from)
}

#[command]
pub async fn get_knowledge_log(
    pool: State<'_, SqlitePool>,
    project_id: String,
    limit: Option<i64>,
) -> Result<Vec<KnowledgeLogEntry>, AppError> {
    let service = KnowledgeService::new(pool.inner().clone());
    service.get_project_log(&project_id, limit)
        .await
        .map_err(AppError::from)
}

#[command]
pub async fn build_knowledge_context(
    pool: State<'_, SqlitePool>,
    project_id: String,
    query: String,
    max_nodes: Option<i64>,
) -> Result<Vec<KnowledgeNode>, AppError> {
    let service = KnowledgeService::new(pool.inner().clone());
    service.build_context(&project_id, &query, max_nodes.unwrap_or(10))
        .await
        .map_err(AppError::from)
}

#[command]
pub async fn ingest_knowledge_file(
    pool: State<'_, SqlitePool>,
    project_id: String,
    file_path: String,
    content: String,
    kind: String,
) -> Result<KnowledgeNode, AppError> {
    let service = KnowledgeService::new(pool.inner().clone());
    service.ingest_file(&project_id, &file_path, &content, &kind)
        .await
        .map_err(AppError::from)
}

/// Auto-ingest README.md and docs/ from a project path into the knowledge graph.
#[command]
pub async fn auto_ingest_project_docs(
    pool: State<'_, SqlitePool>,
    project_id: String,
    project_path: String,
) -> Result<Vec<KnowledgeNode>, AppError> {
    let service = KnowledgeService::new(pool.inner().clone());
    let expanded = crate::shared::utils::expand_path(&project_path);
    let base = std::path::Path::new(&expanded);
    let doc_files = [
        ("README.md", "onboarding"),
        ("CONTRIBUTING.md", "convention"),
        ("ARCHITECTURE.md", "architecture"),
        ("docs/README.md", "onboarding"),
        ("docs/ARCHITECTURE.md", "architecture"),
        ("docs/CONVENTIONS.md", "convention"),
        (".env.example", "convention"),
    ];

    // Track (rel_path, content, node) for edge creation after ingestion
    let mut ingested_docs: Vec<(&str, String, KnowledgeNode)> = Vec::new();

    for (rel_path, kind) in &doc_files {
        let full_path = base.join(rel_path);
        if full_path.exists() {
            if let Ok(content) = std::fs::read_to_string(&full_path) {
                if content.len() > 10 {
                    match service.ingest_file(&project_id, rel_path, &content, kind).await {
                        Ok(node) => {
                            tracing::info!(project_id = project_id, file = rel_path, "Auto-ingested doc");
                            ingested_docs.push((rel_path, content, node));
                        }
                        Err(e) => {
                            tracing::warn!(file = rel_path, error = %e, "Failed to auto-ingest");
                        }
                    }
                }
            }
        }
    }

    // Fetch existing edges so we avoid creating duplicates
    let existing_edges = service
        .get_project_edges(&project_id)
        .await
        .unwrap_or_default();
    let edge_exists = |from_id: &str, to_id: &str, relation: &str| -> bool {
        existing_edges.iter().any(|e| {
            e.relation == relation
                && ((e.from_node == from_id && e.to_node == to_id)
                    || (e.from_node == to_id && e.to_node == from_id))
        })
    };

    // Auto-create edges between ingested docs
    for i in 0..ingested_docs.len() {
        for j in (i + 1)..ingested_docs.len() {
            let (path_i, content_i, node_i) = &ingested_docs[i];
            let (path_j, content_j, node_j) = &ingested_docs[j];

            let filename_i = std::path::Path::new(path_i)
                .file_name()
                .map(|f| f.to_string_lossy().to_string())
                .unwrap_or_default();
            let filename_j = std::path::Path::new(path_j)
                .file_name()
                .map(|f| f.to_string_lossy().to_string())
                .unwrap_or_default();

            // Check cross-references: does doc i mention doc j's filename?
            let i_refs_j = !filename_j.is_empty() && content_i.contains(&filename_j);
            let j_refs_i = !filename_i.is_empty() && content_j.contains(&filename_i);

            if i_refs_j && !edge_exists(&node_i.id, &node_j.id, "references") {
                if let Err(e) = service.create_edge(&node_i.id, &node_j.id, "references").await {
                    tracing::warn!(from = node_i.title, to = node_j.title, error = %e, "Failed to create references edge");
                }
            }
            if j_refs_i && !edge_exists(&node_j.id, &node_i.id, "references") {
                if let Err(e) = service.create_edge(&node_j.id, &node_i.id, "references").await {
                    tracing::warn!(from = node_j.title, to = node_i.title, error = %e, "Failed to create references edge");
                }
            }

            // If no reference edge was created, link as co-located
            if !i_refs_j && !j_refs_i && !edge_exists(&node_i.id, &node_j.id, "co-located") {
                if let Err(e) = service.create_edge(&node_i.id, &node_j.id, "co-located").await {
                    tracing::warn!(from = node_i.title, to = node_j.title, error = %e, "Failed to create co-located edge");
                }
            }
        }
    }

    let ingested: Vec<KnowledgeNode> = ingested_docs.into_iter().map(|(_, _, node)| node).collect();
    tracing::info!(project_id = project_id, count = ingested.len(), "Auto-ingestion complete with edges");
    Ok(ingested)
}

/// Directories to skip during codebase scanning.
const SKIP_DIRS: &[&str] = &[
    "node_modules", ".git", "target", "dist", "build", ".next",
    "__pycache__", ".venv", "venv", "env", ".idea", ".vscode", ".DS_Store",
    "site-packages", "vendor", ".gradle", "Pods", ".cache", ".tox",
    ".mypy_cache", ".pytest_cache", ".eggs", "egg-info", ".nox",
    "bower_components", ".yarn", ".pnp", "coverage", ".nyc_output",
];

/// Source file extensions eligible for ingestion.
const SOURCE_EXTENSIONS: &[&str] = &[
    "ts", "tsx", "js", "jsx", "py", "rs", "go", "java",
    "yaml", "yml", "toml", "json", "md", "sql", "sh", "css", "html",
];

/// Config file extensions that map to the "config" kind.
const CONFIG_EXTENSIONS: &[&str] = &["json", "yaml", "yml", "toml"];

/// Determine the knowledge node kind from a file extension.
fn kind_for_extension(ext: &str) -> &'static str {
    if ext == "md" {
        "documentation"
    } else if CONFIG_EXTENSIONS.contains(&ext) {
        "config"
    } else {
        "source_code"
    }
}

/// Extract import targets from file content based on language conventions.
/// Returns a list of raw import path strings (e.g., "./foo", "crate::bar").
fn extract_import_targets(content: &str, ext: &str) -> Vec<String> {
    let mut targets = Vec::new();
    for line in content.lines() {
        let trimmed = line.trim();
        match ext {
            "ts" | "tsx" | "js" | "jsx" => {
                // ES import: import ... from '...' or import ... from "..."
                if let Some(from_idx) = trimmed.find("from ") {
                    let after_from = &trimmed[from_idx + 5..];
                    let after_from = after_from.trim().trim_end_matches(';');
                    let cleaned = after_from.trim_matches(|c| c == '\'' || c == '"');
                    if !cleaned.is_empty() {
                        targets.push(cleaned.to_string());
                    }
                }
                // require('...')
                if let Some(req_idx) = trimmed.find("require(") {
                    let after_req = &trimmed[req_idx + 8..];
                    if let Some(end) = after_req.find(')') {
                        let inside = &after_req[..end];
                        let cleaned = inside.trim_matches(|c| c == '\'' || c == '"');
                        if !cleaned.is_empty() {
                            targets.push(cleaned.to_string());
                        }
                    }
                }
            }
            "rs" => {
                // use crate::foo::bar; or use super::foo;
                if trimmed.starts_with("use ") || trimmed.starts_with("pub use ") {
                    let use_part = if trimmed.starts_with("pub use ") {
                        &trimmed[8..]
                    } else {
                        &trimmed[4..]
                    };
                    let use_path = use_part.trim_end_matches(';').trim();
                    if !use_path.is_empty() {
                        targets.push(use_path.to_string());
                    }
                }
                // mod foo;
                if trimmed.starts_with("mod ") || trimmed.starts_with("pub mod ") {
                    let mod_part = if trimmed.starts_with("pub mod ") {
                        &trimmed[8..]
                    } else {
                        &trimmed[4..]
                    };
                    let mod_name = mod_part.trim_end_matches(';').trim();
                    if !mod_name.is_empty() && !mod_name.contains('{') {
                        targets.push(format!("mod::{}", mod_name));
                    }
                }
            }
            "py" => {
                // import foo or from foo import bar
                if trimmed.starts_with("import ") {
                    let module = trimmed[7..].split_whitespace().next().unwrap_or("");
                    if !module.is_empty() {
                        targets.push(module.to_string());
                    }
                } else if trimmed.starts_with("from ") {
                    let module = trimmed[5..].split_whitespace().next().unwrap_or("");
                    if !module.is_empty() {
                        targets.push(module.to_string());
                    }
                }
            }
            "go" => {
                // import "path" or within import block
                if trimmed.starts_with("import ") {
                    let import_part = trimmed[7..].trim().trim_matches('"');
                    if !import_part.is_empty() && import_part != "(" {
                        targets.push(import_part.to_string());
                    }
                } else if trimmed.starts_with('"') && trimmed.ends_with('"') {
                    let cleaned = trimmed.trim_matches('"');
                    if !cleaned.is_empty() {
                        targets.push(cleaned.to_string());
                    }
                }
            }
            _ => {}
        }
    }
    targets
}

/// Resolve an import target string to a matching node title (relative path).
/// Returns the matching title if found in the set of ingested paths.
fn resolve_import_to_node(
    import_target: &str,
    source_file: &str,
    all_titles: &std::collections::HashSet<String>,
) -> Option<String> {
    // For relative imports (./foo, ../foo), resolve relative to the source file's directory
    if import_target.starts_with('.') {
        let source_dir = std::path::Path::new(source_file)
            .parent()
            .unwrap_or(std::path::Path::new(""));

        let cleaned = import_target.trim_start_matches("./");
        let candidate_base = source_dir.join(cleaned);
        let candidate_str = candidate_base.to_string_lossy().to_string();

        // Try direct match, then with common extensions
        let extensions_to_try = &["", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx", "/index.js"];
        for ext in extensions_to_try {
            let candidate = format!("{}{}", candidate_str, ext);
            if all_titles.contains(&candidate) {
                return Some(candidate);
            }
        }
    }

    // For Rust crate/super imports, try to match path segments
    if import_target.starts_with("crate::") || import_target.starts_with("super::") || import_target.starts_with("mod::") {
        let segments: Vec<&str> = import_target.split("::").collect();
        // Try matching the last 1-2 segments against known file paths
        for title in all_titles {
            let path = std::path::Path::new(title.as_str());
            let stem = path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
            if let Some(last_segment) = segments.last() {
                if &stem == last_segment && title != source_file {
                    return Some(title.clone());
                }
            }
        }
    }

    None
}

/// Recursively scan a project directory and ingest all source files into the knowledge graph.
#[command]
pub async fn scan_project_codebase(
    pool: State<'_, SqlitePool>,
    project_id: String,
    project_path: String,
) -> Result<Vec<KnowledgeNode>, AppError> {
    let service = KnowledgeService::new(pool.inner().clone());
    let expanded = crate::shared::utils::expand_path(&project_path);
    let base = std::path::Path::new(&expanded);

    if !base.exists() || !base.is_dir() {
        return Err(AppError::Validation(format!(
            "Project path does not exist or is not a directory: {}",
            project_path
        )));
    }

    // Purge old codebase_scan nodes so we get a clean rescan with current skip list
    let purged = service.delete_nodes_by_source(&project_id, "codebase_scan").await
        .unwrap_or(0);
    if purged > 0 {
        tracing::info!(project_id = project_id, purged = purged, "Purged stale codebase_scan nodes");
    }

    // Collect all eligible files first
    let mut file_entries: Vec<(String, String, String)> = Vec::new(); // (rel_path, content, extension)
    let mut walk_stack = vec![base.to_path_buf()];

    while let Some(dir) = walk_stack.pop() {
        let read_dir = match std::fs::read_dir(&dir) {
            Ok(rd) => rd,
            Err(e) => {
                tracing::warn!(dir = %dir.display(), error = %e, "Failed to read directory");
                continue;
            }
        };

        for entry in read_dir.flatten() {
            let path = entry.path();
            let file_name = entry.file_name().to_string_lossy().to_string();

            if path.is_dir() {
                if SKIP_DIRS.contains(&file_name.as_str()) {
                    continue;
                }
                walk_stack.push(path);
                continue;
            }

            // Check file extension
            let extension = path
                .extension()
                .map(|e| e.to_string_lossy().to_lowercase())
                .unwrap_or_default();

            if !SOURCE_EXTENSIONS.contains(&extension.as_str()) {
                continue;
            }

            // Skip binary or very large files (> 1MB)
            let metadata = match entry.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };
            if metadata.len() > 1_048_576 {
                continue;
            }

            // Read file content
            let content = match std::fs::read_to_string(&path) {
                Ok(c) => c,
                Err(_) => continue, // Skip binary / unreadable files
            };

            if content.len() < 5 {
                continue; // Skip near-empty files
            }

            // Compute relative path from project root
            let rel_path = path
                .strip_prefix(base)
                .unwrap_or(&path)
                .to_string_lossy()
                .to_string();

            file_entries.push((rel_path, content, extension));
        }
    }

    tracing::info!(
        project_id = project_id,
        file_count = file_entries.len(),
        "Scanning codebase files"
    );

    // Phase 1: Ingest all files as nodes
    let mut ingested_nodes: Vec<KnowledgeNode> = Vec::new();

    for (rel_path, content, extension) in &file_entries {
        let kind = kind_for_extension(extension);
        match service
            .ingest_codebase_file(&project_id, rel_path, content, kind, extension)
            .await
        {
            Ok(node) => {
                ingested_nodes.push(node);
            }
            Err(e) => {
                tracing::warn!(file = rel_path.as_str(), error = %e, "Failed to ingest codebase file");
            }
        }
    }

    // Build a lookup from title -> node id for edge creation
    let title_to_id: std::collections::HashMap<String, String> = ingested_nodes
        .iter()
        .map(|n| (n.title.clone(), n.id.clone()))
        .collect();
    let all_titles: std::collections::HashSet<String> = title_to_id.keys().cloned().collect();

    // Fetch existing edges to avoid duplicates
    let existing_edges = service
        .get_project_edges(&project_id)
        .await
        .unwrap_or_default();
    let edge_set: std::collections::HashSet<(String, String, String)> = existing_edges
        .iter()
        .map(|e| (e.from_node.clone(), e.to_node.clone(), e.relation.clone()))
        .collect();

    let edge_exists = |from_id: &str, to_id: &str, relation: &str| -> bool {
        edge_set.contains(&(from_id.to_string(), to_id.to_string(), relation.to_string()))
            || edge_set.contains(&(to_id.to_string(), from_id.to_string(), relation.to_string()))
    };

    // Phase 2: Create import edges
    for (rel_path, content, extension) in &file_entries {
        let from_id = match title_to_id.get(rel_path.as_str()) {
            Some(id) => id.clone(),
            None => continue,
        };

        let import_targets = extract_import_targets(content, extension);
        for target in &import_targets {
            if let Some(resolved_title) = resolve_import_to_node(target, rel_path, &all_titles) {
                if let Some(to_id) = title_to_id.get(&resolved_title) {
                    if from_id != *to_id && !edge_exists(&from_id, to_id, "imports") {
                        if let Err(e) = service.create_edge(&from_id, to_id, "imports").await {
                            tracing::warn!(
                                from = rel_path.as_str(),
                                to = resolved_title.as_str(),
                                error = %e,
                                "Failed to create imports edge"
                            );
                        }
                    }
                }
            }
        }
    }

    // Phase 3: Create co-located edges (files in same directory)
    let mut dir_groups: std::collections::HashMap<String, Vec<String>> = std::collections::HashMap::new();
    for node in &ingested_nodes {
        let dir = std::path::Path::new(&node.title)
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();
        dir_groups.entry(dir).or_default().push(node.id.clone());
    }

    for (_dir, node_ids) in &dir_groups {
        // Only create co-located edges within small groups to avoid N^2 explosion
        if node_ids.len() > 20 || node_ids.len() < 2 {
            continue;
        }
        for i in 0..node_ids.len() {
            for j in (i + 1)..node_ids.len() {
                if !edge_exists(&node_ids[i], &node_ids[j], "co-located") {
                    if let Err(e) = service.create_edge(&node_ids[i], &node_ids[j], "co-located").await {
                        tracing::warn!(error = %e, "Failed to create co-located edge");
                    }
                }
            }
        }
    }

    tracing::info!(
        project_id = project_id,
        nodes = ingested_nodes.len(),
        "Codebase scan complete"
    );
    Ok(ingested_nodes)
}
