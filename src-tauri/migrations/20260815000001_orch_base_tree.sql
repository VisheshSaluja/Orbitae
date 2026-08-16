-- Snapshot of the working-tree state captured at execution start, as a git tree
-- SHA. Validation diffs this baseline against the post-execution tree so the
-- review sees ONLY what the run produced (new files included, pre-existing
-- uncommitted work excluded).
ALTER TABLE orch_sessions ADD COLUMN base_tree TEXT;
