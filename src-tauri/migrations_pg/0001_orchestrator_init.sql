-- Orchestrator: plan-first, human-in-the-loop orchestration state.
--
-- Postgres schema, tenant-scoped (org_id) and project-scoped from day one so the
-- future enterprise/multitenant tier is a policy change, not a migration.
--
-- NOTE: Row-Level Security is intentionally NOT enabled here. Every table carries
-- org_id so RLS activation is a later, additive migration (enterprise phase).
-- Enabling restrictive RLS now would lock out solo/local use, which has no auth
-- session. See docs/superpowers/specs/2026-08-12-plan-first-orchestration-design.md §5.

-- Identity / tenancy -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS organizations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    plan_tier   TEXT NOT NULL DEFAULT 'free',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email       TEXT UNIQUE NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memberships (
    org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role        TEXT NOT NULL DEFAULT 'member',   -- owner|admin|member
    PRIMARY KEY (org_id, user_id)
);

-- Default local org so solo use has a tenant without auth.
INSERT INTO organizations (id, name, plan_tier)
VALUES ('00000000-0000-0000-0000-000000000001', 'Local', 'free')
ON CONFLICT (id) DO NOTHING;

-- Skill registry (UI-managed, upgradable) --------------------------------------
CREATE TABLE IF NOT EXISTS skills (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,             -- 'gsd', 'ponytail'
    version     TEXT NOT NULL,
    source      TEXT NOT NULL,             -- marketplace/plugin ref
    phase       TEXT NOT NULL,             -- plan|execute|review|any
    backends    TEXT[] NOT NULL DEFAULT '{claude}',
    invocation  JSONB NOT NULL DEFAULT '{}'::jsonb,
    enabled     BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (org_id, name)
);

-- Orchestration state ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS orchestration_sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    project_id      TEXT NOT NULL,
    task            TEXT NOT NULL,
    backend         TEXT NOT NULL DEFAULT 'claude',
    use_gsd         BOOLEAN NOT NULL DEFAULT true,
    permission_mode TEXT NOT NULL DEFAULT 'acceptEdits',
    status          TEXT NOT NULL,   -- planning|reviewing|executing|done|errored|cancelled
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_orch_sessions_project ON orchestration_sessions(org_id, project_id);

CREATE TABLE IF NOT EXISTS plans (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    session_id  UUID NOT NULL REFERENCES orchestration_sessions(id) ON DELETE CASCADE,
    version     INTEGER NOT NULL,
    goal        TEXT NOT NULL,
    summary_md  TEXT NOT NULL,
    status      TEXT NOT NULL,   -- draft|reviewing|confirmed
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (session_id, version)
);

CREATE TABLE IF NOT EXISTS plan_steps (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    plan_id       UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    ordinal       INTEGER NOT NULL,
    title         TEXT NOT NULL,
    detail_md     TEXT NOT NULL,
    model         TEXT,             -- suggested agent/model (SP2 delegation)
    files         JSONB NOT NULL DEFAULT '[]'::jsonb,
    commands      JSONB NOT NULL DEFAULT '[]'::jsonb,
    status        TEXT NOT NULL,    -- pending|approved|done|failed
    user_edited   BOOLEAN NOT NULL DEFAULT false  -- authoritative: planner won't overwrite
);
CREATE INDEX IF NOT EXISTS idx_plan_steps_plan ON plan_steps(plan_id, ordinal);

-- Q&A: answers to user questions; no plan mutation
CREATE TABLE IF NOT EXISTS plan_qa (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    session_id  UUID NOT NULL REFERENCES orchestration_sessions(id) ON DELETE CASCADE,
    step_id     UUID,
    question    TEXT NOT NULL,
    answer      TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Decision trail: bounded, human-facing, NOT auto-injected into agent context
CREATE TABLE IF NOT EXISTS decisions (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    session_id   UUID NOT NULL REFERENCES orchestration_sessions(id) ON DELETE CASCADE,
    step_id      UUID,
    summary      TEXT NOT NULL,          -- one line: what was decided
    rationale    TEXT NOT NULL,          -- why (kept short)
    tradeoffs    TEXT,                   -- what was given up
    alternatives TEXT,                   -- options not taken
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_decisions_session ON decisions(session_id, created_at);

-- Authoritative, ordered event stream (reconnect / remote foundation)
CREATE TABLE IF NOT EXISTS orchestration_events (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    session_id   UUID NOT NULL REFERENCES orchestration_sessions(id) ON DELETE CASCADE,
    seq          BIGINT NOT NULL,        -- monotonic per session
    type         TEXT NOT NULL,
    payload      JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (session_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_orch_events_session_seq ON orchestration_events(session_id, seq);
