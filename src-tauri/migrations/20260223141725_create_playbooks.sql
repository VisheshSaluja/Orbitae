CREATE TABLE IF NOT EXISTS project_playbooks (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS playbook_steps (
    id TEXT PRIMARY KEY NOT NULL,
    playbook_id TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,          -- 'process', 'delay', 'database_query', etc.
    command TEXT,                -- The actual command or process name to run
    depends_on TEXT,             -- ID of another step it waits for
    expected_output TEXT,        -- Regex or string to wait for
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (playbook_id) REFERENCES project_playbooks(id) ON DELETE CASCADE
);
