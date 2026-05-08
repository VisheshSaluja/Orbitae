ALTER TABLE playbook_steps ADD COLUMN on_failure TEXT NOT NULL DEFAULT 'abort';
-- on_failure values: 'abort' (stop playbook), 'skip' (mark skipped, continue), 'retry' (retry N times)

ALTER TABLE playbook_steps ADD COLUMN max_retries INTEGER NOT NULL DEFAULT 0;
-- only used when on_failure = 'retry'

ALTER TABLE playbook_steps ADD COLUMN retry_delay_ms INTEGER NOT NULL DEFAULT 1000;
-- backoff delay between retries
