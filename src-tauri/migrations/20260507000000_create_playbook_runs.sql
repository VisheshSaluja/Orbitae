CREATE TABLE IF NOT EXISTS playbook_runs (
    id TEXT PRIMARY KEY NOT NULL,
    playbook_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',  -- pending, running, passed, failed, aborted
    started_at DATETIME,
    finished_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (playbook_id) REFERENCES project_playbooks(id) ON DELETE CASCADE,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS step_runs (
    id TEXT PRIMARY KEY NOT NULL,
    run_id TEXT NOT NULL,
    step_id TEXT NOT NULL,
    step_name TEXT NOT NULL,
    step_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',  -- pending, running, passed, failed, skipped
    exit_code INTEGER,
    stdout TEXT,
    stderr TEXT,
    started_at DATETIME,
    finished_at DATETIME,
    attempt INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (run_id) REFERENCES playbook_runs(id) ON DELETE CASCADE,
    FOREIGN KEY (step_id) REFERENCES playbook_steps(id) ON DELETE CASCADE
);

CREATE INDEX idx_playbook_runs_project ON playbook_runs(project_id);
CREATE INDEX idx_playbook_runs_status ON playbook_runs(status);
CREATE INDEX idx_step_runs_run ON step_runs(run_id);
