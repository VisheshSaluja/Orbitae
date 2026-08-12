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
**plan-first, human-in-the-loop loop**: a task produces a readable, editable
plan; the developer edits/questions/iterates until they confirm; then a single
agent executes the approved plan. All state is persisted as the source of
truth, so the session is reconstructible — the foundation the later remote/mobile
sub-project (IDEA-016) builds on.

### Non-goals (explicitly deferred)

- **Model-tiered parallel delegation** (Haiku/Sonnet/Opus subagents) → Sub-project 2.
- **Codex / Gemini backends** → Sub-project 3 (but the seam is designed in now).
- **Remote / mobile transport** → Sub-project 4.

### Relationship to the semantic router (already built)

The TF-IDF cosine-similarity router is **unchanged** and remains the cheap
front-door triage. `Direct` routes ("git status") still return instant cards
with zero LLM cost. Only the `Template` / `Fallback` (complex) branch flows
into this new orchestrator. The router decides *who needs the full treatment*;
the orchestrator *is* the full treatment.

---

## 2. Locked Decisions

| Decision | Choice |
|----------|--------|
| **MVP scope** | Thin end-to-end slice: task → plan → review/edit/question/iterate → confirm → basic **single-agent** execution. No tiering/parallelism yet. |
| **Plan representation** | **Hybrid** — structured step skeleton + rich markdown body per step. |
| **Review model** | **Direct edits are authoritative** (user text sticks, planner won't overwrite). **Ask a question** about any step/decision → focused streamed answer. **Request a change** → planner produces a new plan version, preserving user-edited steps. Loop until **Confirm**. |
| **Architecture** | **Approach C** — the app owns the UX, schema, persistence, streaming session, and backend seam; **GSD is the default planning engine** (its output mapped into our schema); **ponytail** governs execution leanness. |
| **GSD toggle** | Per-task toggle. Default **on** in plan-mode (complex tasks); toggle **off** → lean `LitePlanner` for small tasks (fewer tokens, no heavyweight lifecycle). |
| **Transport** | Persistent **bidirectional** Claude session (`--input-format stream-json --output-format stream-json --verbose`), not one-shot `--print`. |
| **Persistence** | Authoritative — plans, versions, steps, and the event stream live in SQLite as the source of truth, not a side-log. |

---

## 3. Architecture & Components

### 3.1 Backend (Rust) — new `orchestrator` module

Layered per CLAUDE.md (commands → service → repository). Lives at
`src-tauri/src/modules/orchestrator/`.

| Unit | Single responsibility | Depends on |
|------|----------------------|------------|
| **`backend::AgentBackend` (trait)** | Abstract `start_session`, `send_message`, event stream, `stop`. The multi-backend seam. | — |
| **`backend::ClaudeBackend`** | Implements the trait via `claude … --input-format stream-json --output-format stream-json --verbose`. Only unit that knows `claude` specifics. | `AgentBackend` |
| **`planner::Planner` (trait)** | `produce_plan(task)` and `revise_plan(plan, feedback)` → `Plan`. | backend session |
| **`planner::GsdPlanner`** | Drives `gsd-plan-phase`; maps GSD's output artifact → our `Plan` schema. | `Planner`, backend |
| **`planner::LitePlanner`** | Lean ponytail-style prompt with a **forced JSON schema** → `Plan`. | `Planner`, backend |
| **`session::PlanSession` (service)** | Owns one lifecycle `Planning → Reviewing → Executing → Done`; holds the live backend session; coordinates planner, executor, repos, and event emission. | all above + repos |
| **`executor`** | Runs the approved plan through a single agent under ponytail; streams progress. | backend session |
| **`models`** | `Plan`, `PlanStep`, `OrchestrationSession`, `PlanEvent`, `TaskPermissionMode` (reused), error types (`thiserror`). | — |
| **`repository`** | All SQL (parameterized): sessions, plans, plan_steps, events, qa. | `SqlitePool` |
| **`commands`** | Tauri IPC surface (validate → delegate to service). | service |

### 3.2 Frontend (React)

| Unit | Single responsibility |
|------|----------------------|
| **`PlanReviewPanel`** | Render the hybrid plan readably; per-step **edit** (authoritative), **ask** (streamed answer), **approve**; the **GSD toggle**; **Confirm** / **Cancel**; live execution progress. |
| **`orchestratorStore` (Zustand)** | Hold the active session's plan, events, and status; reload from persisted state on mount/reconnect. |
| **`lib/orchestrator.ts`** | Typed IPC wrappers + event subscriptions for the orchestrator commands. |

### 3.3 Boundaries that keep this clean

- The app never parses GSD's internal `.planning/` lifecycle. `GsdPlanner` maps
  GSD's *output* into our `Plan`. GSD can evolve without breaking us.
- `AgentBackend` is the **only** place that knows about the `claude` binary.
  Codex/Gemini are future trait impls; the loop and UI never change.
- Persistence is authoritative, not a side-log. A reconnecting client (desktop
  now, phone later) rebuilds full state from the DB by replaying events since a
  sequence number.

---

## 4. Data Model (new migration)

```sql
-- One orchestration lifecycle per complex task.
CREATE TABLE orchestration_sessions (
    id             TEXT PRIMARY KEY,
    project_id     TEXT NOT NULL,
    task           TEXT NOT NULL,
    backend        TEXT NOT NULL DEFAULT 'claude',  -- future: codex, gemini
    use_gsd        INTEGER NOT NULL DEFAULT 1,       -- the GSD toggle
    permission_mode TEXT NOT NULL DEFAULT 'acceptEdits',
    status         TEXT NOT NULL,   -- planning|reviewing|executing|done|errored|cancelled
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
);

-- Plan versions (a new version per accepted revision request).
CREATE TABLE plans (
    id          TEXT PRIMARY KEY,
    session_id  TEXT NOT NULL REFERENCES orchestration_sessions(id) ON DELETE CASCADE,
    version     INTEGER NOT NULL,
    goal        TEXT NOT NULL,
    summary_md  TEXT NOT NULL,
    status      TEXT NOT NULL,   -- draft|reviewing|confirmed
    created_at  TEXT NOT NULL
);

CREATE TABLE plan_steps (
    id           TEXT PRIMARY KEY,
    plan_id      TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    ordinal      INTEGER NOT NULL,
    title        TEXT NOT NULL,
    detail_md    TEXT NOT NULL,
    model        TEXT,             -- suggested agent/model (used in SP2 delegation)
    files_json   TEXT NOT NULL DEFAULT '[]',
    commands_json TEXT NOT NULL DEFAULT '[]',
    status       TEXT NOT NULL,    -- pending|approved|done|failed
    user_edited  INTEGER NOT NULL DEFAULT 0   -- authoritative: planner won't overwrite
);

-- Q&A attached to a session (optionally a step). No plan mutation.
CREATE TABLE plan_qa (
    id          TEXT PRIMARY KEY,
    session_id  TEXT NOT NULL REFERENCES orchestration_sessions(id) ON DELETE CASCADE,
    step_id     TEXT,
    question    TEXT NOT NULL,
    answer      TEXT NOT NULL,
    created_at  TEXT NOT NULL
);

-- Authoritative, ordered event stream (foundation for reconnect / remote).
CREATE TABLE orchestration_events (
    id          TEXT PRIMARY KEY,
    session_id  TEXT NOT NULL REFERENCES orchestration_sessions(id) ON DELETE CASCADE,
    seq         INTEGER NOT NULL,       -- monotonic per session
    type        TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at  TEXT NOT NULL
);
CREATE INDEX idx_orch_events_session_seq ON orchestration_events(session_id, seq);
```

The Rust `Plan` mirrors this: `Plan { id, session_id, version, goal, summary_md,
status, steps: Vec<PlanStep> }` with `PlanStep { id, ordinal, title, detail_md,
model: Option<String>, files: Vec<String>, commands: Vec<String>, status,
user_edited: bool }`.

---

## 5. Data Flow — the plan / review / iterate loop

```
1. Smart Command Strip: complex query
   → create orchestration_session (status=planning, use_gsd from toggle)
   → start ClaudeBackend bidirectional session
   → run planner (GSD or Lite)

2. Planner emits Plan v1
   → validate against schema (repair once if malformed)
   → persist plan + steps (status=reviewing)
   → emit orchestration_event(seq++, "plan_ready")

3. Frontend renders Plan in PlanReviewPanel. User can:
   • EDIT step      → PATCH step (title/detail/model/files/commands),
                      set user_edited=1 (authoritative). Persisted. No model call.
   • ASK question   → send message to backend session; stream answer;
                      store in plan_qa. No plan mutation.
   • REQUEST change → send message to backend; planner returns revised plan;
                      new plan version (v+1) preserving user_edited steps;
                      persist + emit "plan_revised".
   • APPROVE step / APPROVE all.

4. CONFIRM (all steps approved)
   → plan.status=confirmed, session.status=executing
   → executor runs the approved plan via the same session under ponytail,
     honoring permission_mode (Safe/Full toggle already built)
   → stream + persist progress events; steps → done/failed
   → session.status=done

5. CANCEL at any point → session.status=cancelled, backend stopped, temp cleaned.
```

Every backend event and user action is written to `orchestration_events` with a
monotonic `seq` **before** being emitted to the UI. On mount/reconnect the store
loads the session + latest plan and replays events since its last `seq` — this
is what makes the stream consistent and is the hook the remote sub-project reuses.

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
- **Agent → app:** events read from stdout (reusing the existing event-parsing
  and `format_event_for_display` work), persisted with `seq`, emitted to the UI.
- stderr is read and surfaced (existing pattern).

> **Load-bearing risk / first spike (Phase 2):** confirm that
> `--input-format stream-json` supports the interactive answer-back protocol we
> need (sending user turns mid-session) and how GSD's own `AskUserQuestion`
> checkpoints surface in that stream. If the interactive protocol differs from
> assumptions, the transport detail (not the overall architecture) adjusts. This
> is validated in Phase 2 before the rest is built on it.

---

## 7. Security

Consistent with the project's "secure, not hackable" bar:

- **Human-in-the-loop is the primary security gate.** No command or edit in the
  plan executes until the user hits **Confirm**. The plan surfaces every command
  (`commands_json`) for review first.
- **Permission mode** reuses the existing per-project `acceptEdits` / `skip`
  setting and Safe/Full toggle. `skip` (full autonomy) remains explicit opt-in.
- **Input validation** at every Tauri command boundary (task, session_id, step
  fields, feedback) via the existing `shared::validation` module.
- **Context/temp files** written with `0600` (existing `write_restricted_file`).
- **No secrets in plan artifacts** — vault values never enter plans or events;
  only key *names* (as today in `build_project_context`).
- **Parameterized SQL** only, per repository conventions.

---

## 8. Error Handling

- Custom error type `OrchestratorError` (`thiserror`); commands return typed
  string errors, never raw `String` from deep layers.
- **Backend process dies mid-plan** → session `status=errored`, stderr surfaced,
  event `"session_error"` persisted; user can retry from the last plan version.
- **Malformed planner output** → schema validation + **one** repair attempt
  (ask the agent to re-emit valid JSON); if it still fails, surface a clear error
  rather than a half-parsed plan.
- **Event write failure** → logged via `tracing`; the session degrades to
  live-only rather than crashing (but this is logged loudly, since it breaks
  reconstructability).
- **Cancel / app close** → best-effort SIGTERM to the child, temp cleanup.

---

## 9. Testing

- **Rust unit:** `Plan`/`PlanStep` (de)serialization; GSD-artifact → `Plan`
  mapping; `LitePlanner` prompt building; schema validation + repair path;
  repository CRUD (sessions, plans, steps, events) against an in-memory SQLite;
  monotonic `seq` ordering; permission-mode → CLI args; `user_edited` preserved
  across a revision.
- **Frontend (Vitest + RTL):** `PlanReviewPanel` renders a hybrid plan; edit
  marks a step authoritative; ask posts a question and shows the streamed answer;
  approve/confirm transitions; reconnect replays from persisted events.
- No test depends on network or the real `claude` binary — backend is behind the
  `AgentBackend` trait and mocked.

---

## 10. Implementation Phases (build order)

Each phase is independently verifiable and leaves the app compiling & green.

1. **Persistence & models** — migration + `models` + `repository` + tests.
2. **Backend seam + spike** — `AgentBackend` trait + `ClaudeBackend` bidirectional
   session; **validate the stream-json input protocol first** (§6 risk).
3. **PlanSession + LitePlanner** — end-to-end plan generation with the lean
   planner (prove the loop cheaply before GSD).
4. **IPC + UI** — Tauri commands + `orchestratorStore` + `PlanReviewPanel`
   (render, edit, ask, approve, confirm).
5. **Executor** — single-agent execution of the confirmed plan under ponytail,
   streamed + persisted.
6. **GSD planner + toggle** — `GsdPlanner` mapping + wire the default-on toggle.

Sub-projects 2 (model-tiered delegation), 3 (Codex/Gemini), and 4 (remote) build
on the seams established here.

---

## 11. Open Questions / To Validate

- **Phase 2 spike:** exact interactive `stream-json` input protocol and how GSD
  checkpoints appear in it (§6).
- **GSD output shape:** the precise artifact `gsd-plan-phase` produces, to write
  the `GsdPlanner` mapping (validated in Phase 6; Phases 1–5 don't depend on it).
