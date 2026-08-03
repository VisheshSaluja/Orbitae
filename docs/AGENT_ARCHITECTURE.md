# Orbitae — Agent Architecture & Intelligence Roadmap

> Last updated: 2026-07-29
> Status: Planning. Derived from architecture discussions, competitive analysis (T3 Code, Superset, Pi, Devon), and interview-prep deep dive on applied AI agent engineering.

---

## Context

Orbitae currently launches AI agents by shelling out to Terminal.app via AppleScript. This works but gives us zero visibility into what agents are doing — no token tracking, no model routing, no cross-agent coordination. This document defines the path from "terminal launcher" to "intelligent agent operating system."

### Key Inspirations

| Source | What we took |
|--------|-------------|
| **T3 Code** | Embed the agent, own the message stream, render our own UI. Don't shell out to a CLI. |
| **Superset** | What NOT to do — spawning CLIs in tabs is a full-stack challenge with no AI value. |
| **Pi** | Minimal agentic loop (~2000 LOC) that performs nearly as well as Claude Code. Same loop pattern applied to both coding agents and our supervisor. |
| **Devon** | End-to-end agent UX — timeline view, file edits, terminal output, PR creation all in one interface. |
| **Temporal** | Durable execution pattern — persist state at each step, replay/resume on crash. |
| **Model Router concept** | Route tasks to the cheapest model that can handle them. Save tokens, save money. |
| **Applied AI interviews** | The 5 pillars every agent system must address: architecture, crash recovery, context management, evals, observability. |

---

## Current State (What Exists)

- Agent session launching via AppleScript → Terminal.app (up to 6 agents, window tiling)
- SQLite persistence for session metadata (id, status, pid, created_at)
- In-memory state with SQLite hydration fallback for crash recovery
- Context injection into agent instructions (vault keys, notes, git diff)
- Agent types: Claude Code, Codex CLI, custom terminal
- Stop/remove sessions with terminal window management
- Runbook system (manual + file scanner + AI generation with auto-import)
- Port scanning (lsof-based, project vs system ports)
- Knowledge graph for semantic project context
- MCP server for external AI tool integration

### Current Limitations

- **Zero visibility** — once an agent launches, Orbitae can't see what it's doing
- **No model routing** — all agents use whatever model the CLI defaults to
- **No cost tracking** — no idea how many tokens each session burns
- **No cross-agent coordination** — 6 agents running blind, potential conflicts
- **AppleScript fragility** — macOS-only, breaks on edge cases, no programmatic control
- **No crash recovery** — app restart loses all running session context
- **No evals** — no way to know if agents are improving or which model works best

---

## Priority 1 — Embedded Agent Architecture

> **The foundation. Everything else depends on this.**

### What

Replace AppleScript → Terminal.app with spawning `claude` as a child process. Capture the structured JSON event stream. Render in Orbitae's own UI. Log everything to SQLite.

### How

```
Orbitae Rust backend
  │
  ├─ portable-pty (already in stack) spawns:
  │   claude --output-format stream-json --model claude-sonnet-5 "task"
  │
  ├─ stdout → JSON event stream:
  │   {"type": "message", "role": "assistant", "content": "..."}
  │   {"type": "tool_use", "name": "read_file", "input": {"path": "..."}}
  │   {"type": "tool_result", "content": "..."}
  │   {"type": "token_usage", "input": 1523, "output": 847}
  │
  ├─ Events flow to:
  │   → Frontend (renders in xterm.js or custom message UI)
  │   → SQLite (session_events table for durability)
  │   → Supervisor agent (monitoring feed)
  │
  └─ stdin ← User input from Orbitae UI
```

### Key Decisions

- **No API keys required.** Uses the user's existing `claude` CLI authentication (`~/.claude/` auth tokens). Works with Claude Max, Pro, or any subscription.
- **Model routing via `--model` flag.** The CLI accepts `--model claude-haiku-4-5`, `--model claude-sonnet-5`, `--model claude-opus-4-8`, etc. User's subscription covers all models.
- **Keep AppleScript as fallback.** Power users who prefer native Terminal.app can opt in. Default switches to embedded.
- **portable-pty already in Cargo.toml.** No new dependencies needed for process spawning.

### New SQLite Table

```sql
CREATE TABLE session_events (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES agent_sessions(id),
    event_type TEXT NOT NULL,  -- 'message', 'tool_use', 'tool_result', 'token_usage', 'error'
    payload TEXT NOT NULL,     -- JSON blob of the event
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (session_id) REFERENCES agent_sessions(id) ON DELETE CASCADE
);

CREATE INDEX idx_session_events_session ON session_events(session_id);
```

### Effort: 2-3 weeks

---

## Priority 2 — Supervisor Agent (Pi-Loop Orchestrator)

> **Smart task decomposition + model routing + live fleet management.**

### What

A lightweight Pi-style agentic loop running on Haiku that manages the fleet of coding agents. User describes one task → supervisor decomposes into subtasks → assigns model tier + file scope per agent → launches agents → monitors progress → adapts in real-time.

### The Pi Loop Applied to Orchestration

Pi's architecture is a minimal tool-use loop:

```
while true:
    response = LLM(system_prompt + tools + conversation_history)
    if response.is_text → show to user, wait for input
    if response.is_tool_call → execute tool, append result, continue
```

The supervisor uses this identical loop, but with fleet management tools instead of coding tools:

| Supervisor Tool | Purpose |
|----------------|---------|
| `analyze_project` | Read project structure, package.json, Cargo.toml, etc. |
| `decompose_task` | Break user's task into independent subtasks |
| `launch_agent` | Start a coding agent with specific model + scope + instructions |
| `get_agent_status` | Check what each agent is doing (from event stream) |
| `get_file_changes` | What has this agent produced (git diff per agent) |
| `get_token_usage` | How many tokens has this agent burned |
| `change_agent_model` | Swap an agent's model mid-session (kill + relaunch) |
| `stop_agent` | Kill an underperforming or finished agent |
| `inject_context` | Send a hint or status update to a running agent |
| `get_past_sessions` | Query historical session outcomes for routing decisions |

### Model Routing Logic

The supervisor assigns models based on task complexity:

| Complexity | Model | Example Tasks |
|-----------|-------|---------------|
| Trivial | Haiku | Config changes, typos, simple renames, env updates |
| Moderate | Sonnet | Component creation, test writing, single-file refactors |
| Complex | Opus | Cross-file features, debugging, architecture changes |
| Research | Fable | Novel design, research-heavy, maximum quality needed |

### Agent Count Intelligence

User says "do X with 5 agents" → Supervisor responds:

```
This task breaks into 3 independent subtasks:
  1. Rust auth module (Opus) — complex, cross-file
  2. React login UI (Sonnet) — moderate, single directory
  3. Update config + env (Haiku) — trivial

Recommended: 3 agents. 2 slots unused.
Options:
  a) Launch 3 (save tokens)
  b) Assign the other 2 to: [suggested tasks]
  c) Launch all 5 with finer splits
```

### Monitoring Loop

While agents run, supervisor polls every 30 seconds:

- **Stuck detection:** No file changes for 5+ minutes → escalate model or inject hint
- **Budget enforcement:** Token burn exceeds threshold → warn user or kill agent
- **Early finish:** Agent done → reassign to help others or shut down
- **Conflict detection:** Two agents touching the same file → alert user

### Effort: 2 weeks (depends on Priority 1)

---

## Priority 3 — Observability & Cost Tracking

> **Know what every agent is doing and how much it costs.**

### What

Real-time dashboard showing per-agent and per-project metrics. Parsed from the JSON event stream (Priority 1).

### Metrics Tracked

| Metric | Source | Granularity |
|--------|--------|-------------|
| Tokens consumed (input/output) | `token_usage` events | Per-agent, per-session |
| Model used | Launch config | Per-agent |
| Estimated cost | Token count x model pricing | Per-agent, per-project |
| Files read/written | `tool_use` events (read_file, write_file) | Per-agent |
| Commands executed | `tool_use` events (bash) | Per-agent |
| Duration | Session start/end timestamps | Per-session |
| Agent status | Event stream + heartbeat | Real-time |
| Success/failure | User feedback + error events | Per-session |

### Alerts

- Agent idle > 5 minutes (no tool calls, no messages)
- Token burn rate exceeds budget threshold
- Agent erroring repeatedly (3+ consecutive errors)
- Agent trying to modify files outside its scope

### New SQLite Table

```sql
CREATE TABLE session_metrics (
    session_id TEXT PRIMARY KEY REFERENCES agent_sessions(id),
    model TEXT NOT NULL,
    tokens_input INTEGER DEFAULT 0,
    tokens_output INTEGER DEFAULT 0,
    files_read INTEGER DEFAULT 0,
    files_written INTEGER DEFAULT 0,
    commands_run INTEGER DEFAULT 0,
    estimated_cost_cents INTEGER DEFAULT 0,
    outcome TEXT,  -- 'accepted', 'reverted', 'partial', null
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### Effort: 1 week (depends on Priority 1)

---

## Priority 4 — Session Durability & Crash Recovery

> **Temporal-style durability without Temporal infrastructure.**

### What

Persist every agent action to SQLite as it happens. On app crash, detect orphaned `claude` processes, reconnect or show the user exactly where each agent stopped. Enable conversation replay/resume.

### How

- **Event logging:** Every JSON event from the agent stream → `session_events` table (from Priority 1). This IS the checkpoint log.
- **Process detection on restart:** Scan for `claude` processes whose CLI args match our session IDs. If found, reconnect to their stdout stream.
- **Conversation replay:** Re-read events from SQLite → reconstruct conversation state → resume or present to user.
- **Runbook durability:** Playbook execution already has step-level tracking. Extend with: resume from last completed step on crash.

### The Temporal Pattern (Without Temporal)

```
Normal code:           Durable code (our approach):

agent.readFile(A)      event = agent.readFile(A)
                       db.log(event)              ← checkpoint

agent.writeFile(B)     event = agent.writeFile(B)
                       db.log(event)              ← checkpoint

// crash here          // crash here
// lost everything     // restart: replay from last checkpoint
```

We don't need Temporal's infrastructure because:
- We're a desktop app, not a distributed system
- SQLite is our durable store (WAL mode, crash-safe)
- The JSON event stream is already granular enough to serve as checkpoints
- `claude` CLI has its own conversation persistence in `~/.claude/` which we can reference

### Effort: 1 week (depends on Priority 1)

---

## Priority 5 — Scoped Instructions & Cross-Agent Coordination

> **Agents know their boundaries and what others are doing.**

### What

Each agent gets explicit file/directory boundaries. Supervisor shares progress summaries across agents. Conflict detection prevents two agents from editing the same file.

### Scope Injection

Each agent's instructions include:

```
YOUR SCOPE: Only modify files in src/modules/auth/ and src/components/Auth/
DO NOT touch files outside this scope.
If you need changes elsewhere, write them to .orbitae-handoff.md with:
  - What file needs changing
  - What the change should be
  - Why you need it
```

### Cross-Agent Context Sharing

Supervisor periodically:

1. Reads each agent's git diff (`get_file_changes` tool)
2. Summarizes: "Agent 1 has added an AuthService in src/modules/auth/service.rs with methods login() and verify_token()"
3. Injects this summary into Agent 2's conversation: "FYI: Agent 1 has created an AuthService you can import from..."

### Conflict Prevention

- Supervisor maintains a file-lock registry (in-memory HashMap)
- When an agent's `tool_use` targets a file, check if another agent owns it
- If conflict: notify supervisor → supervisor decides (wait, reassign, or merge)

### Effort: 1 week (depends on Priority 2)

---

## Priority 6 — Context Engineering

> **Give each agent the RIGHT context, not ALL context.**

### What

Task-aware context selection. Instead of dumping entire vault + notes + git status into every agent, analyze the task and inject only relevant context. Cross-session memory via knowledge graph.

### Strategies

| Strategy | When | How |
|----------|------|-----|
| **Selective injection** | Always | Task mentions "database" → inject DB schema, connection info. Task mentions "auth" → inject auth-related files. |
| **Knowledge graph query** | When graph has relevant nodes | Semantic search: "what do we know about authentication in this project?" → relevant nodes injected |
| **Cross-session memory** | Repeat tasks | "Last time we deployed, the migration failed because X" → injected as warning |
| **Compaction** | Long sessions (700k+ tokens) | Summarize older conversation turns, keep recent ones verbatim |
| **Context budget** | Always | Allocate token budget: 20% context, 80% working space. Don't stuff the window. |

### Already Built

- Knowledge graph with auto-ingest (README, CONTRIBUTING, ARCHITECTURE, docs/)
- Context builder v2 (graph-aware injection)
- MCP tools for knowledge search

### Still Needed

- Task-aware context selection (analyze task → query relevant graph nodes)
- Cross-session memory ("remember what happened last time")
- Token budget enforcement for context injection
- Context quality scoring (is this context actually helpful for this task?)

### Effort: 2 weeks (partially built via knowledge graph)

---

## Priority 7 — Evals & Agent Quality Tracking

> **Know if your agents are getting better or worse.**

### What

Track which model + agent type + context strategy produces the best outcomes for each kind of task on each codebase. Feed historical data back into the model router.

### Data Collection

After each session:
- Automatic: tokens consumed, duration, files changed, errors hit, model used
- User feedback: accept / revert / partial (quick thumbs up/down in UI)
- Correlation: task type (bug fix, feature, refactor) × model × outcome

### Feedback Loop

```
Session data → session_outcomes table
  ↓
Historical analysis: "On this Rust codebase, Sonnet fails 40% of auth tasks but Opus succeeds 90%"
  ↓
Supervisor's get_past_sessions tool reads this
  ↓
Next time: auth task on Rust → automatically routes to Opus
```

### New SQLite Table

```sql
CREATE TABLE session_outcomes (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES agent_sessions(id),
    task_description TEXT,
    task_type TEXT,        -- 'bug_fix', 'feature', 'refactor', 'test', 'config'
    model TEXT NOT NULL,
    tokens_total INTEGER,
    duration_seconds INTEGER,
    files_changed INTEGER,
    outcome TEXT NOT NULL,  -- 'accepted', 'reverted', 'partial', 'abandoned'
    user_rating INTEGER,   -- 1-5, optional
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_outcomes_model ON session_outcomes(model, task_type, outcome);
```

### Effort: 2 weeks (depends on Priority 3)

---

## Priority 8 — CI/CD & Git Integration

> **Agent goes from code change to merged PR without human intervention.**

### What

Agent creates a branch, makes changes, creates a PR via `gh` CLI, monitors CI checks, auto-fixes failing tests, requests review. Ties into GitHub/Linear issue tracker.

### Flow

```
User: "Fix issue #42"
  → Supervisor reads issue from GitHub (gh issue view 42)
  → Creates branch: fix/issue-42
  → Assigns coding agent with issue context
  → Agent fixes, commits
  → Agent runs tests locally
  → If tests fail: agent reads errors, fixes, re-runs
  → Creates PR (gh pr create)
  → Monitors CI (gh pr checks)
  → If CI fails: agent reads CI logs, fixes, pushes
  → Notifies user: "PR ready for review"
```

### Effort: 2 weeks (depends on Priority 1)

---

## Architecture Evolution Path

```
Phase A (Current):
  Orbitae → AppleScript → Terminal.app → claude CLI
  Visibility: none | Control: none | Model routing: none

Phase B (Priority 1):
  Orbitae → portable-pty → claude --output-format stream-json
  Visibility: full | Control: partial | Model routing: via --model flag

Phase C (Priority 2+):
  Orbitae → Supervisor (Haiku) → fleet of claude processes
  Visibility: full | Control: full | Model routing: supervisor-driven

Phase D (Future — optional):
  Orbitae → Claude API direct (own agentic loop, no CLI dependency)
  Visibility: full | Control: total | Model routing: API-level
  Note: Phase D is optional. Phase C with CLI is sufficient for most use cases
  and avoids requiring API keys. Only needed if CLI limitations block features.
```

---

## Interview-Ready Knowledge Map

These are the 5 pillars from the applied AI interview discussion. Building Orbitae covers all of them:

| Pillar | Interview Question | How Orbitae Addresses It |
|--------|-------------------|--------------------------|
| **Architecture** | "What services do you need? How do sandboxes scale?" | Desktop app — no sandboxes needed. Agents run locally via PTY. Scaling = CPU cores. Supervisor manages fleet. |
| **Durability** | "What if the server crashes mid-task?" | SQLite event log (Temporal pattern). Every agent action checkpointed. On restart: detect orphaned processes, replay from last checkpoint. |
| **Context** | "How do you manage context at 700k+ tokens?" | Selective injection via knowledge graph. Task-aware context selection. Compaction/summarization for long sessions. Cross-agent context sharing. |
| **Evals** | "How do you know your agent is improving?" | session_outcomes table. Track model × task_type × outcome. Historical data feeds model router. A/B test model releases. |
| **Observability** | "What metrics do you watch?" | Token usage, cost, duration, files changed, error rate, stuck detection, budget enforcement. All from JSON event stream. |

---

## Timeline Estimate

| Priority | Feature | Depends On | Effort | Running Total |
|----------|---------|-----------|--------|---------------|
| 1 | Embedded agent architecture | Nothing | 2-3 weeks | 2-3 weeks |
| 2 | Supervisor agent (Pi-loop) | P1 | 2 weeks | 4-5 weeks |
| 3 | Observability & cost tracking | P1 | 1 week | 5-6 weeks |
| 4 | Crash recovery & durability | P1 | 1 week | 6-7 weeks |
| 5 | Scoped instructions + coordination | P2 | 1 week | 7-8 weeks |
| 6 | Context engineering | Knowledge graph (exists) | 2 weeks | 9-10 weeks |
| 7 | Evals & quality tracking | P3 | 2 weeks | 11-12 weeks |
| 8 | CI/CD & git integration | P1 | 2 weeks | 13-14 weeks |

P1-P4 are the core — get them done and Orbitae is a genuinely differentiated product. P5-P8 are the moat — they compound over time as more data flows through the system.
