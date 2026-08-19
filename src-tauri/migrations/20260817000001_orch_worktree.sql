-- Path to the disposable git worktree a run executes in, so the main working
-- tree is never touched. Review and PR creation operate on this worktree;
-- cleared once the change is committed to a PR branch or the session is removed.
ALTER TABLE orch_sessions ADD COLUMN worktree_path TEXT;
