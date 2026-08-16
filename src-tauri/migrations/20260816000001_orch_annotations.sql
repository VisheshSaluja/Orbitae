-- Pending plan annotations (highlight-to-comment notes the developer is
-- composing), stored as an opaque JSON array so they survive closing/reopening
-- a plan. Consumed and cleared when the developer submits them as a revision.
ALTER TABLE orch_sessions ADD COLUMN annotations TEXT;
