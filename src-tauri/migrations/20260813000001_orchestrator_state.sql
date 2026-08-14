-- Orchestrator state (SQLite) — durable, reopenable plan-first sessions.
--
-- This is the local persistence tier: schema mirrors the Postgres design
-- (docs/superpowers/specs/2026-08-12-plan-first-orchestration-design.md) but in
-- SQLite so solo/local use is durable today. The Postgres adapter (remote/
-- enterprise) implements the same PlanStore trait later.

CREATE TABLE IF NOT EXISTS orch_sessions (
    id              TEXT PRIMARY KEY NOT NULL,
    project_id      TEXT NOT NULL,
    task            TEXT NOT NULL,
    backend         TEXT NOT NULL DEFAULT 'claude',
    use_gsd         INTEGER NOT NULL DEFAULT 1,
    permission_mode TEXT NOT NULL DEFAULT 'acceptEdits',
    status          TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orch_sessions_project ON orch_sessions(project_id, created_at);

CREATE TABLE IF NOT EXISTS orch_plans (
    id          TEXT PRIMARY KEY NOT NULL,
    session_id  TEXT NOT NULL,
    version     INTEGER NOT NULL,
    goal        TEXT NOT NULL,
    summary_md  TEXT NOT NULL,
    status      TEXT NOT NULL,
    created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orch_plans_session ON orch_plans(session_id, version);

CREATE TABLE IF NOT EXISTS orch_plan_steps (
    id           TEXT PRIMARY KEY NOT NULL,
    plan_id      TEXT NOT NULL,
    ordinal      INTEGER NOT NULL,
    title        TEXT NOT NULL,
    detail_md    TEXT NOT NULL,
    model        TEXT,
    files        TEXT NOT NULL DEFAULT '[]',
    commands     TEXT NOT NULL DEFAULT '[]',
    status       TEXT NOT NULL,
    user_edited  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_orch_plan_steps_plan ON orch_plan_steps(plan_id, ordinal);

CREATE TABLE IF NOT EXISTS orch_plan_qa (
    id          TEXT PRIMARY KEY NOT NULL,
    session_id  TEXT NOT NULL,
    step_id     TEXT,
    question    TEXT NOT NULL,
    answer      TEXT NOT NULL,
    created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orch_plan_qa_session ON orch_plan_qa(session_id, created_at);
