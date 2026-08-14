-- Persist the execution log and result summary on the orchestration session so
-- reopening a finished plan shows what actually happened (not a blank view).

ALTER TABLE orch_sessions ADD COLUMN result TEXT;
ALTER TABLE orch_sessions ADD COLUMN log TEXT;
