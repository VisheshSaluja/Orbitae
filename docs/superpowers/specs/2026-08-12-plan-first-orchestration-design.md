# Plan-First Orchestration Loop — Design Spec

**Date:** 2026-08-12
**Status:** Draft for review
**Sub-project:** 1 of 4 (of the multi-agent orchestration engine)
**Author:** Vishesh Saluja (with Claude)

---

## 1. Problem & Goal

Today, a complex query in the Smart Command Strip spawns a one-shot
`claude --print` process that immediately starts acting. There is no plan, no
human review, no ability to steer, and no way to reconstruct the session after
the fact. It is slow, opaque, and not trustworthy enough for real work like
"build me a feature."

**Goal:** Replace the crude one-shot behavior on the *complex* path with a
**plan-first, human-in-the-loop loop**: a task produces a rich, readable,
editable plan; the developer edits / questions / iterates until they confirm;
then a single agent executes the approved plan. All state is persisted as the
source of truth in a remotely-accessible database, so a session is
reconstructible and steerable from another device — the foundation the remote
sub-project (IDEA-016) builds on.

### Non-goals (explicitly deferred)

- **Model-tiered parallel delegation** (Haiku/Sonnet/Opus subagents) → Sub-project 2.
- **Codex / Gemini backends** → Sub-project 3 (but the seam is designed in now).
- **Remote / mobile UI & Apple-Pencil annotation** → Sub-project 4 (but the data
  model, rich-doc model, and DB are built ready for it now).
- **Enterprise multitenancy activation** → later (but every table is
  tenant-scoped and RLS-ready now, so activation is policy-only, not migration).

### Relationship to the semantic router (already built)

The TF-IDF cosine-similarity router is **unchanged** and remains the cheap
front-door triage. `Direct` routes ("git status") still return instant cards
with zero LLM cost. Only the `Template` / `Fallback` (complex) branch flows into
this new orchestrator. The router decides *who needs the full treatment*; the
orchestrator *is* the full treatment.

---

## 2. Locked Decisions

| Decision | Choice |
|----------|--------|
| **MVP scope** | Thin end-to-end slice: task → plan → review/edit/question/iterate → confirm → basic **single-agent** execution. No tiering/parallelism yet. |
| **Plan representation** | **Hybrid** — structured step skeleton + rich markdown body. Stored as markdown (agent-native, portable); **rendered & edited as a rich document** (real tables, diagrams via Mermaid→SVG, WYSIWYG round-tripping to markdown). Never shown as raw `\| pipes \|`. |
| **Review model** | **Direct edits are authoritative** (user text sticks; planner won't overwrite). **Ask a question** about any step/decision → focused streamed answer. **Request a change** → planner produces a new plan version, preserving user-edited steps. Loop until **Confirm**. |
| **Review UI** | **Responsive & touch-first from day one** (phone/tablet-ready). Rich-doc model reserves a separate **annotation overlay layer** so Apple-Pencil markup in SP4 is additive, not a rewrite. |
| **Architecture** | **Approach C** — the app owns UX, schema, persistence, streaming session, and the backend seam; **skills (GSD, ponytail, …) are pluggable engines** invoked by reference. |
| **Skills** | **Data-driven Skill Registry**, UI-managed. Each skill = `{ name, version, source, phase, invocation, backends, enabled }`. Invoked by reference + version so open-source skills upgrade independently. GSD default-on for plan-mode; toggle off → lean `LitePlanner`. New skills = a registry row + adapter, no core change. |
| **Database** | **Postgres** (see §5). Bring-your-own connection string via onboarding; managed default for zero-friction solo use. Built on **standard Postgres** (RLS + `LISTEN`/`NOTIFY`) so any provider works (Supabase/Neon/RDS/self-hosted) — no vendor lock-in. |
| **Decision trail** | Agent records **influential** decisions (what, why, tradeoffs, alternatives) to a structured, bounded store. **Human-facing**; never auto-injected into agent context (avoids hallucination + token bloat); re-surfaced to the agent only on explicit "why did you…" queries. |
| **Transport** | Persistent **bidirectional** agent session (`--input-format stream-json --output-format stream-json --verbose`), not one-shot `--print`. |
| **Persistence** | Authoritative — plans, versions, steps, decisions, and the event stream live in Postgres as the source of truth. |

---

## 3. Architecture & Components

### 3.1 Backend (Rust) — new `orchestrator` module

Layered per CLAUDE.md (commands → service → repository). Lives at
`src-tauri/src/modules/orchestrator/`.

| Unit | Single responsibility | Depends on |
|------|----------------------|------------|
| **`backend::AgentBackend` (trait)** | Abstract `start_session`, `send_message`, event stream, `stop`. The multi-backend seam. | — |
| **`backend::ClaudeBackend`** | Implements the trait via `claude … --input-format stream-json --output-format stream-json --verbose`. Only unit that knows `claude` specifics. | `AgentBackend` |
| **`skills::SkillRegistry`** | Data-driven catalog of installed skills (GSD, ponytail, future). Resolves which skills apply to a phase for a backend; builds the invocation directive. | repository |
| **`planner::Planner` (trait)** | `produce_plan(task)` / `revise_plan(plan, feedback)` → `Plan`. | backend, skills |
| **`planner::GsdPlanner` / `LitePlanner`** | GSD-driven vs lean planning. Chosen by the GSD toggle / registry. | `Planner` |
| **`session::PlanSession` (service)** | Owns one lifecycle `Planning → Reviewing → Executing → Done`; holds the live backend session; coordinates planner, executor, decision recorder, repos, and event emission. | all above + repos |
| **`executor`** | Runs the approved plan through a single agent under ponytail; streams progress. | backend session |
| **`decisions::DecisionRecorder`** | Captures influential agent decisions (bounded, structured); persists for human review. Not fed back into context by default. | repository |
| **`models`** | `Plan`, `PlanStep`, `OrchestrationSession`, `Decision`, `SkillDef`, `OrchestrationEvent`, `TaskPermissionMode` (reused), error types. | — |
| **`repository`** | All SQL (parameterized, Postgres): orgs, projects, sessions, plans, steps, decisions, events, skills. | `PgPool` |
| **`commands`** | Tauri IPC surface (validate → delegate to service). | service |

### 3.2 Frontend (React)

| Unit | Single responsibility |
|------|----------------------|
| **`PlanReviewPanel`** | Responsive/touch-first. Renders the hybrid plan as a **rich document** (real tables, Mermaid diagrams); per-step **edit** (WYSIWYG, authoritative), **ask** (streamed answer), **approve**; **Confirm** / **Cancel**; live execution progress. |
| **`PlanDocEditor`** | TipTap-based block editor with markdown round-trip + Mermaid rendering; reserves an annotation-overlay layer for SP4. |
| **`DecisionTrail`** | Read-only, scannable view of the agent's influential decisions (why + tradeoffs). |
| **`SkillsPanel`** | List/toggle/add skills from the registry; shows version + source. |
| **`orchestratorStore` (Zustand)** | Active session's plan, events, decisions, status; reloads from persisted state on mount/reconnect. |
| **`lib/orchestrator.ts`** | Typed IPC wrappers + event subscriptions. |

### 3.3 Boundaries that keep this clean

- The app never parses GSD's internal `.planning/` lifecycle. `GsdPlanner` maps
  GSD's *output* into our `Plan`. Skills upgrade without breaking us.
- `AgentBackend` is the **only** place that knows the `claude` binary.
  Codex/Gemini are future trait impls; loop and UI never change.
- Skills are **referenced, not vendored** — the registry stores name+version;
  the skill's own files upgrade independently.
- Persistence is authoritative. A reconnecting client (desktop now, phone later)
  rebuilds full state from Postgres by replaying events since a sequence number.

---

## 4. Data Model (Postgres, tenant-ready)

Every data table is tenant-scoped (`org_id`) and project-scoped (`project_id`)
from day one. RLS policies are defined but permissive for solo use; enterprise
multitenancy is activated by tightening policies — **no schema migration**.

```sql
-- Identity / tenancy (dormant for solo; active for teams) -----------------
CREATE TABLE organizations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    plan_tier   TEXT NOT NULL DEFAULT 'free',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE users (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email       TEXT UNIQUE NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE memberships (
    org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role        TEXT NOT NULL DEFAULT 'member',   -- owner|admin|member
    PRIMARY KEY (org_id, user_id)
);

-- Skill registry (UI-managed, upgradable) ---------------------------------
CREATE TABLE skills (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,             -- 'gsd', 'ponytail'
    version     TEXT NOT NULL,
    source      TEXT NOT NULL,             -- marketplace/plugin ref
    phase       TEXT NOT NULL,             -- plan|execute|review|any
    backends    TEXT[] NOT NULL DEFAULT '{claude}',
    invocation  JSONB NOT NULL,            -- how to invoke (skill/command/prompt)
    enabled     BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (org_id, name)
);

-- Orchestration state -----------------------------------------------------
CREATE TABLE orchestration_sessions (
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

CREATE TABLE plans (
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

CREATE TABLE plan_steps (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    plan_id       UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    ordinal       INTEGER NOT NULL,
    title         TEXT NOT NULL,
    detail_md     TEXT NOT NULL,
    model         TEXT,             -- suggested agent/model (SP2 delegation)
    files         JSONB NOT NULL DEFAULT '[]',
    commands      JSONB NOT NULL DEFAULT '[]',
    status        TEXT NOT NULL,    -- pending|approved|done|failed
    user_edited   BOOLEAN NOT NULL DEFAULT false  -- authoritative
);

-- Q&A: answers to user questions; no plan mutation
CREATE TABLE plan_qa (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    session_id  UUID NOT NULL REFERENCES orchestration_sessions(id) ON DELETE CASCADE,
    step_id     UUID,
    question    TEXT NOT NULL,
    answer      TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Decision trail: bounded, human-facing, NOT auto-injected into context
CREATE TABLE decisions (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    session_id   UUID NOT NULL REFERENCES orchestration_sessions(id) ON DELETE CASCADE,
    step_id      UUID,
    summary      TEXT NOT NULL,          -- one line: what was decided
    rationale    TEXT NOT NULL,          -- why (bounded ~500 chars)
    tradeoffs    TEXT,                   -- what was given up (bounded)
    alternatives TEXT,                   -- options not taken (bounded)
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Authoritative, ordered event stream (reconnect / remote foundation)
CREATE TABLE orchestration_events (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    session_id   UUID NOT NULL REFERENCES orchestration_sessions(id) ON DELETE CASCADE,
    seq          BIGINT NOT NULL,        -- monotonic per session
    type         TEXT NOT NULL,
    payload      JSONB NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (session_id, seq)
);
CREATE INDEX idx_orch_events_session_seq ON orchestration_events(session_id, seq);

-- RLS: tenant isolation. Permissive default org for solo; tightened for teams.
ALTER TABLE orchestration_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON orchestration_sessions
    USING (org_id IN (SELECT org_id FROM memberships WHERE user_id = current_setting('app.user_id', true)::uuid));
-- (Analogous policies on every tenant-scoped table.)
```

The Rust `Plan` mirrors this: `Plan { id, session_id, version, goal, summary_md,
status, steps: Vec<PlanStep> }` with `PlanStep { id, ordinal, title, detail_md,
model: Option<String>, files: Vec<String>, commands: Vec<String>, status,
user_edited: bool }`.

---

## 5. Database Strategy

**Engine: Postgres.** Rationale: the product is online by nature (agents require
internet), so "offline-first local SQLite" protects a capability the product
doesn't have. Postgres gives us, with **no future engine migration**:

- **Remote (soon):** network-accessible by default; the live stream rides on
  Postgres-native **`LISTEN`/`NOTIFY`** — works on *any* Postgres.
- **Phone → laptop control:** the laptop subscribes to its sessions via
  `LISTEN`; a phone writing "confirm" notifies it. No separate tunnel/relay.
  (Execution always stays on the machine with the code; only state is shared.)
- **Enterprise (later):** tenant columns + RLS present from day one; activation
  is policy tightening, not migration.

**Bring-your-own via onboarding.** The connection string is user-supplied:
- **Quick start** — a managed default so solo devs configure nothing.
- **Bring your own** — Supabase / Neon / RDS / self-hosted; same schema & code.

Because everything is standard Postgres, moving default → own instance is a
connection-string change + data copy, not an engine swap.

**Two database planes — never conflated:**

| | **Orbitae state DB** (control plane) | **User's project DBs** (data plane) |
|---|---|---|
| Holds | Our plans, sessions, decisions, events, tenancy | The developer's *own app's* data (any engine) |
| Owner | Us (this Postgres) | The developer |
| Relationship | We store state here | We *optionally connect as a tool* (existing Database Manager) — not where our state lives |

**Migration note.** Existing SQLite modules (projects, notes, vault refs) migrate
to Postgres **incrementally**; the orchestrator is built on Postgres first. Vault
secrets stay in the system keychain — never in any DB.

---

## 6. Streaming & Bidirectional Session

`ClaudeBackend` spawns:

```
claude --input-format stream-json --output-format stream-json --verbose \
       [--permission-mode acceptEdits | --dangerously-skip-permissions] \
       [--model <m>]
```

- **App → agent:** user messages (feedback, questions, confirm) written to the
  child's stdin as stream-json message objects.
- **Agent → app:** events read from stdout (reusing existing event-parsing +
  `format_event_for_display`), persisted with `seq`, emitted to the UI, and
  `NOTIFY`'d for any remote subscriber.
- stderr is read and surfaced (existing pattern).

> **Load-bearing risk / first spike (Phase 2):** confirm `--input-format
> stream-json` supports the interactive answer-back we need (sending user turns
> mid-session) and how GSD's `AskUserQuestion` checkpoints surface in that
> stream. Validated before the rest builds on it. If the protocol differs, the
> transport detail (not the architecture) adjusts.

---

## 7. Decision Trail (point #5)

The agent records **only influential** decisions — an architectural choice, a
tradeoff, a rejected alternative — via `DecisionRecorder` into the `decisions`
table. Design constraints that keep it useful and cheap:

- **Bounded fields** (summary ~1 line, rationale/tradeoffs/alternatives capped)
  so entries stay scannable and storage stays small.
- **Human-facing by default** — rendered in `DecisionTrail`; **not** re-injected
  into the agent's context on every turn (this is the key guard against
  hallucination and input-token bloat the user called out).
- **On-demand recall** — only when the user explicitly asks "why did you do X?"
  is the relevant decision fetched and passed to the agent.
- **Triggered deliberately** — the planner/executor is prompted to log a decision
  only at genuine forks, not for routine steps.

---

## 8. Security

- **Human-in-the-loop is the primary gate.** Nothing executes until **Confirm**;
  the plan surfaces every command (`commands`) for review first.
- **RLS tenant isolation** on every table; **parameterized SQL** only.
- **Permission mode** reuses the per-project `acceptEdits` / `skip` toggle;
  `skip` (full autonomy) stays explicit opt-in.
- **Input validation** at every Tauri command boundary via `shared::validation`.
- **Secrets** stay in the system keychain — never in any DB, plan, or event.
- **Connection string** stored via the Vault (keychain), never in plaintext JSON.

---

## 9. Error Handling

- Custom `OrchestratorError` (`thiserror`); commands return typed errors.
- **Backend dies mid-plan** → session `errored`, stderr surfaced, event logged;
  retry from last plan version.
- **Malformed planner output** → schema validation + **one** repair attempt;
  else a clear error, never a half-parsed plan.
- **Event/NOTIFY write failure** → logged loudly via `tracing`; degrades to
  live-only (breaks reconstructability, so it's surfaced).
- **Cancel / app close** → best-effort SIGTERM, temp cleanup.

---

## 10. Testing

- **Rust unit:** model (de)serialization; GSD-artifact → `Plan` mapping;
  `LitePlanner` prompt building; schema validation + repair; repository CRUD
  against a test Postgres (or `sqlx::test`); monotonic `seq`; permission-mode →
  CLI args; `user_edited` preserved across revision; `DecisionRecorder` bounds.
- **Frontend (Vitest + RTL):** `PlanReviewPanel` renders a rich plan; edit marks
  a step authoritative; ask shows streamed answer; approve/confirm transitions;
  reconnect replays from persisted events; `SkillsPanel` toggles.
- Backend behind `AgentBackend` trait → mocked; no test needs the real `claude`.

---

## 11. Implementation Phases (build order)

Each phase leaves the app compiling & green.

1. **Postgres data layer** — pool + config (BYO connection via onboarding/Vault),
   migration (tenant/RLS-ready schema), `models`, `repository`, tests.
2. **Backend seam + spike** — `AgentBackend` trait + `ClaudeBackend` bidirectional
   session; **validate the stream-json input protocol first** (§6).
3. **PlanSession + LitePlanner** — end-to-end plan generation with the lean
   planner (prove the loop cheaply before GSD).
4. **IPC + UI** — Tauri commands + `orchestratorStore` + `PlanReviewPanel` +
   `PlanDocEditor` (rich, responsive) + `DecisionTrail`.
5. **Executor** — single-agent execution of the confirmed plan under ponytail,
   streamed + persisted.
6. **Skills + GSD** — `SkillRegistry` + `SkillsPanel`; `GsdPlanner` mapping; wire
   the default-on toggle.

SP2 (model-tiered delegation), SP3 (Codex/Gemini), SP4 (remote + Pencil) build on
the seams established here.

---

## 12. Open Questions / To Validate

- **Phase 2 spike:** exact interactive `stream-json` input protocol + how GSD
  checkpoints appear in it (§6).
- **Zero-config default DB:** managed-cloud default vs. bundled/embedded Postgres
  for the quick-start path (decide at Phase 1; both keep the Postgres schema).
- **GSD output shape:** the artifact `gsd-plan-phase` emits, for the `GsdPlanner`
  mapping (validated at Phase 6; Phases 1–5 don't depend on it).
