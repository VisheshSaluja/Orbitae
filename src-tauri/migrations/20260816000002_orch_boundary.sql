-- The approved change boundary (ScopePolicy JSON: allowed globs, extra protected
-- paths, max diff size) the gate enforces against. Approved with the plan.
ALTER TABLE orch_sessions ADD COLUMN boundary TEXT;
