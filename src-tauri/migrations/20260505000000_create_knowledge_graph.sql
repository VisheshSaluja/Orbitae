-- Knowledge Graph: nodes, edges, and activity log
CREATE TABLE IF NOT EXISTS knowledge_nodes (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL DEFAULT 'note',
    source TEXT NOT NULL DEFAULT 'manual',
    status TEXT NOT NULL DEFAULT 'active',
    tags TEXT NOT NULL DEFAULT '[]',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_knowledge_nodes_project ON knowledge_nodes(project_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_nodes_kind ON knowledge_nodes(kind);
CREATE INDEX IF NOT EXISTS idx_knowledge_nodes_status ON knowledge_nodes(status);

CREATE TABLE IF NOT EXISTS knowledge_edges (
    id TEXT PRIMARY KEY NOT NULL,
    from_node TEXT NOT NULL,
    to_node TEXT NOT NULL,
    relation TEXT NOT NULL DEFAULT 'related_to',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (from_node) REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
    FOREIGN KEY (to_node) REFERENCES knowledge_nodes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_knowledge_edges_from ON knowledge_edges(from_node);
CREATE INDEX IF NOT EXISTS idx_knowledge_edges_to ON knowledge_edges(to_node);

CREATE TABLE IF NOT EXISTS knowledge_log (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL,
    action TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    affected_nodes TEXT NOT NULL DEFAULT '[]',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_knowledge_log_project ON knowledge_log(project_id);
