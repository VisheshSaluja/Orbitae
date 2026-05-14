# Orbitae — Development Roadmap

> Last updated: 2026-05-11
> Status: Alpha development in progress.

---

## Phase 1 — Foundation & Pro Tier (Target: 3-4 weeks)
*Goal: A product a solo developer would pay $15/month for*

### P1.1 — Security & Code Quality Hardening
- [x] Fix SQL injection in `execute_query` — allowlist-based validation, comment stripping, multi-statement blocking
- [ ] Move DB connection passwords to Vault (out of plaintext JSON)
- [x] Harden Tauri CSP — added frame-src/object-src 'none', font-src restriction, Groq API endpoint
- [x] Validate all file paths against project sandbox — path traversal checks on open_in_editor, reveal_in_finder, save_note_image
- [x] Replace all `println!()` with `tracing` crate structured logging
- [ ] Remove all `any` types from TypeScript — define proper interfaces
- [x] Add React Error Boundaries around all workspace panels
- [x] Add input validation on all Tauri command parameters — process, URL, file, query commands
- [ ] Fix `write_to_process` disabled command (trait bounds issue)
- [x] Implement custom error types per Rust module — shared AppError with thiserror, knowledge module migrated

### P1.2 — AI Agent Hub (Priority #1)
- [x] Multi-provider LLM support: OpenAI, Anthropic, Groq, local Ollama
- [x] API key management via Vault (per-provider, securely stored)
- [x] Provider configuration UI (select model, set temperature, token limits)
- [x] Project context injection: file tree, running processes, DB connections, git status, recent notes
- [x] Streaming responses with real-time tool execution visualization
- [x] Tool definitions: startProcess, stopProcess, runQuery, searchKnowledge, getGitStatus, createKnowledgeNode, linkNodes
- [x] Conversation history persisted per project in SQLite
- [x] Agent templates: "Boot dev environment", "Debug this error", "Explain this codebase", + 3 more
- [x] **Knowledge Graph Foundation:** SQLite tables (`knowledge_nodes`, `knowledge_edges`, `knowledge_log`)
- [x] **Knowledge Graph CRUD:** Rust repository + service for node/edge creation, update, deletion
- [x] **Knowledge Graph UI:** Node list panel with kind badges, source labels, delete actions
- [x] **Knowledge Graph AI Tools:** `search_knowledge`, `create_knowledge_node`, `update_knowledge_node`, `link_nodes`
- [x] **Context Builder v2:** Graph-aware context injection — query relevant nodes instead of dumping raw data
- [x] **Auto-ingest (basic):** Auto-ingest README.md, CONTRIBUTING.md, ARCHITECTURE.md, docs/ into graph nodes
- [x] **Knowledge Graph UI:** Force-directed graph visualization (react-force-graph-2d, hover highlighting, click detail panel, graph/list toggle)

### P1.3 — MCP Server (Priority #2)
- [x] Implement MCP server protocol in Rust (rmcp v1.6, JSON-RPC over stdio)
- [x] Expose tools: `list_projects`, `get_project_context`, `run_command`, `query_database`, `get_secrets`, `read_notes`, `search_knowledge`
- [x] Authentication for MCP connections (token-based, keychain-stored, env var handshake)
- [x] Auto-start MCP server when Orbitae launches (token provisioned on startup, config generator command)
- [x] Documentation: "How to connect Claude Code / Cursor to Orbitae" (`docs/MCP.md`)
- [x] MCP client config generation command (`get_mcp_client_config`)
- [ ] Test with Claude Code, Cursor, and at least one other MCP client

### P1.4 — Playbook Engine v2 (Priority #3)
- [x] Playbook execution engine in Rust (PlaybookExecutor, PlaybookRunRepository, run/step tracking in SQLite, Tauri events)
- [x] Step types: command, health_check (HTTP/TCP), delay
- [x] Parallel execution for independent steps (wave-based via depends_on + JoinSet)
- [x] Failure handling: retry (with backoff), skip, abort
- [x] Execution status UI: real-time step progress, output viewer, run history (PlaybookRunStatus component)
- [x] Health check primitives: wait for HTTP 200 (poll 30s), wait for TCP port (poll 30s)
- [x] Visual DAG editor in React (React Flow, drag-and-drop steps, dependency arrows, properties panel)
- [x] "One-click start" button on project dashboard (Launch Environment runs first playbook + all links)
- [x] Export/import playbooks as YAML (serde_yaml, download/upload via UI)
- [x] AI-generated playbooks (uses configured AI provider to generate YAML from project scripts)
- [x] **Knowledge Graph integration:** Playbook results auto-create/update knowledge nodes (e.g., "deployment succeeded" updates runbook node)

### P1.5 — Environment Manager
- [ ] Environment profiles data model (dev, staging, prod, custom)
- [ ] Profile CRUD in Rust backend
- [ ] One-click profile switching (swaps env vars, DB connections, service configs)
- [ ] .env file import/export
- [ ] Secret interpolation syntax: `${vault:KEY_NAME}`
- [ ] Drift detection: compare Orbitae state vs .env file on disk
- [ ] Profile indicator in workspace header

### P1.6 — Activity Feed
- [ ] Event logging system in Rust (commands run, processes started/stopped, DB queries, notes edited, git operations)
- [ ] SQLite table for activity events
- [ ] Activity feed panel in React (real-time, reverse-chronological)
- [ ] Filter by event type
- [ ] Quick actions from activity items (re-run command, open note, etc.)

### P1.UI — Workspace UI Revamp
- [x] Replace 10-tab horizontal bar with grouped sidebar navigation
- [x] Navigation groups: Core, Infrastructure, Development, Content
- [x] Collapsible sidebar with icon-only mode
- [x] Active tab highlight with primary color accent border
- [x] **Agent-first simplification:** Collapse 10 tabs → 4 views (Command Center, Agent, Workspace, Settings)
- [x] **Command Center panel:** Jarvis-style minimal cockpit — greeting hero, pill quick-actions, collapsible accordion sections
- [x] **Workspace panel:** Merge Notes + Snippets + Knowledge Graph with internal tab switching
- [x] **Settings panel:** Merge Keys & Secrets + Database connections + AI provider config
- [x] Remove Git and Scripts as standalone tabs (agent handles, surfaced contextually)
- [x] Keyboard shortcuts for sidebar navigation (Cmd+1–4)

### P1.7 — Polish & Distribution
- [ ] Apple Developer Certificate + code signing
- [ ] Homebrew formula
- [ ] Auto-updater (Tauri built-in)
- [ ] Onboarding flow for new users (first project setup wizard)
- [x] Keyboard shortcuts for all major actions (Cmd+1–4 nav, Cmd+K palette)
- [x] Command palette (Cmd+K) for quick navigation — search, arrow keys, enter to execute
- [ ] Dark/light theme toggle (currently dark-only)
- [ ] Performance profiling and optimization
- [ ] Landing page update to reflect new positioning

---

## Phase 2 — Team Tier (Target: 4-6 weeks after Phase 1)
*Goal: Features that make teams pay $35/user/month*

### P2.1 — Sync Infrastructure
- [ ] Cloud sync service (API backend — likely Rust/Axum or Node)
- [ ] Account system (auth, billing, team management)
- [ ] Selective sync: only team-shared data syncs, personal stays local
- [ ] Conflict resolution for concurrent edits
- [ ] End-to-end encryption for synced secrets

### P2.2 — Team Workspaces
- [ ] Team creation and member management
- [ ] Shared project templates (project config without secrets)
- [ ] Shared snippet libraries (team-wide command bank)
- [ ] Shared playbook marketplace (browse, install, customize team playbooks)
- [ ] Role-based access: admin, member, viewer

### P2.3 — Shared Knowledge Base (powered by Knowledge Graph)
- [ ] Per-project knowledge documents (architecture, conventions, runbooks)
- [ ] Auto-indexing from repo (README, docs/, CONTRIBUTING.md)
- [ ] AI-accessible via MCP (team AI agents pull from shared knowledge)
- [ ] Edit permissions and version history
- [ ] **Team graph sync:** Merge individual knowledge graphs into shared team graph
- [ ] **Graph conflict resolution:** Handle competing node edits across team members
- [ ] **Knowledge Graph lint (team):** AI audits shared graph for staleness, contradictions, gaps

### P2.4 — Session Sharing & Handoff
- [ ] Snapshot workspace state (terminals, queries, notes, processes)
- [ ] Generate shareable link
- [ ] Teammate opens snapshot in their Orbitae
- [ ] Read-only pair debugging mode (real-time terminal view)

### P2.5 — Integrations Hub
- [ ] GitHub/GitLab: PR status, CI results, issues in sidebar
- [ ] Slack/Discord: Share snippets, trigger playbooks, notifications
- [ ] Linear/Jira: View and update issues
- [ ] Docker: Container management panel
- [ ] Cloud quick links (AWS, GCP, Vercel dashboards)

### P2.6 — CLI Companion
- [ ] `orbitae start [project]` — boot project playbook from terminal
- [ ] `orbitae status` — show running services
- [ ] `orbitae connect` — start MCP server for current directory
- [ ] Communication with running Orbitae instance via local socket

### P2.7 — Orbitae Remote (Mobile-to-Laptop Agentic Development)
*Depends on: P1.2 (Agent Hub), P1.4 (Playbook Engine), P2.1 (Cloud Sync/Relay)*
- [ ] Cloud relay service: queue prompts, relay status, serve review pages (Cloudflare Worker or Vercel API)
- [ ] Remote API on Orbitae desktop: receive prompts, return plans, accept approvals, stream execution status
- [ ] Authentication: device pairing via QR code, token-based session auth, encrypted transport
- [ ] iOS Shortcut: one-tap or voice prompt → HTTP POST to cloud relay → queued for laptop
- [ ] AI plan generation: prompt + full project context → structured multi-step plan with file diffs, commands, tests
- [ ] Web-based review page (mobile-responsive PWA):
  - [ ] Per-step approve / reject / comment
  - [ ] Step reordering via drag
  - [ ] "Suggest alternative" button per step
  - [ ] Overall approve / request changes / reject
- [ ] Plan execution: approved steps run via Playbook Engine on laptop
- [ ] Real-time status: push notifications (APNs via relay) + live status page (SSE/WebSocket)
- [ ] Completion flow: git commit created, diff summary pushed to phone, final approve/reject
- [ ] Laptop availability handling: queue-and-execute-on-wake if laptop is asleep
- [ ] PDF export of plans (secondary to web review — for offline reading / archival)
- [ ] iPad annotation support (V2): Apple Pencil markup on plan → OCR → corrections parsed

---

## Phase 3 — Intelligence Layer (Target: 6-8 weeks after Phase 2)
*Goal: Moat features no competitor has*

### P3.1 — Project Memory (powered by Knowledge Graph)
- [ ] **Full auto-ingest:** Git commits, terminal commands, DB queries, process events feed graph automatically
- [ ] **Knowledge Graph lint (scheduled):** Weekly/startup AI audit — detect stale nodes, contradictions, orphans, gaps
- [ ] Natural language search over knowledge graph: "when did we change the auth middleware?"
- [ ] Pattern detection: suggest playbook steps from repeated commands (mined from graph)
- [ ] Onboarding assistant: "how do I set up this project?" answered by walking the graph
- [ ] **Graph export/import:** JSON backup, migration between Orbitae instances

### P3.2 — AI Code Review Integration
- [ ] Context-aware review using project DB schema, conventions, running services
- [ ] Pre-push checks triggered from Orbitae
- [ ] Team-specific review criteria templates
- [ ] Security scanning for common vulnerability patterns

### P3.3 — Workflow Automation
- [ ] Trigger system: git push, process crash, schedule, webhook
- [ ] Action system: run playbook, send notification, execute command
- [ ] Rule builder UI
- [ ] Cron-style scheduling for recurring playbooks

### P3.4 — Analytics Dashboard (Team)
- [ ] Development velocity metrics (commits/day, build times)
- [ ] Environment health (service uptime, common errors)
- [ ] AI usage patterns (prompts, success rates, cost tracking)
- [ ] Team activity overview

---

## Non-Functional Requirements (All Phases)

| Requirement | Target |
|-------------|--------|
| Memory usage (idle) | < 60MB |
| App startup time | < 2 seconds |
| Playbook step execution latency | < 100ms overhead |
| MCP response time | < 200ms for context queries |
| Database query (local SQLite) | < 50ms for all operations |
| Terminal input latency | < 16ms (60fps) |
| Crash rate | < 0.1% of sessions |
| Test coverage (Rust) | > 80% for services and repositories |
| Test coverage (React) | > 60% for components with business logic |
