# Orbitae — Brainstorm Log

> This document tracks every idea discussed, what we chose, what we rejected, and why.
> Entries are reverse-chronological. Newest at top.

---

## How This Document Works

Each entry follows this format:

```
### [DATE] — [Topic]
**Status:** ACCEPTED / REJECTED / DEFERRED / EXPLORING
**Context:** Why this came up
**Idea:** What was proposed
**Decision:** What we decided
**Reasoning:** Why
**Trade-offs:** What we gave up
**Related:** Links to other entries or docs
```

---

## 2026-08-21 — Voice Input via Local Whisper (Kun Chen's OpenSuperWhisper pattern)

### IDEA-023: Dictate to the chat composer via a locally-run Whisper model
**Status:** DEFERRED — tracked as the next agent-layer phase after Pass 3 (multi-provider harness)
**Context:** Kun Chen (ex-Meta L8, ships ~40 PRs/day; his tools Lavish/Treehouse/No Mistakes are the direct inspiration for Orbitae's HTML-style plan review and the parallel-wave worktree executor) uses **OpenSuperWhisper** to talk to his agent sessions instead of typing — a free, open-source, fully local dictation app. It's a thin hotkey/UI wrapper around OpenAI's Whisper `large-v3-turbo` model running entirely on-device (no cloud call, no subscription, no account).
**Idea:** Build the same capability directly into Orbitae's composer, not as a separate app the user has to run alongside it:
- A mic affordance in the chat composer — press/hold to dictate; transcribed locally, inserted straight into the input, same place typed prompts go.
- The model checkpoint (~800MB–1.6GB for `large-v3-turbo`) is too large to bundle silently in the installer. Instead: an **"Install voice" button** (in Settings/onboarding) — one click downloads and caches the model locally with a clear size disclosure and progress bar; once done, dictation is fully wired in with zero further setup. Same UX pattern Ollama/LM Studio use for large local models.
- Fully on-device inference (whisper.cpp, or an MLX/Metal-accelerated path on macOS) — no audio ever leaves the machine, consistent with the app's local-first/vault-security stance.
**Decision:** Defer implementation until after Pass 3 (multi-provider harness) is done — voice is composer/hardware-integration work, orthogonal to the provider-routing engine, and the harness is higher-leverage right now. Logged here so it isn't lost; the demo already shows a scripted preview of the UX (see `website/src/components/demo/InteractiveDemo.tsx`).
**Reasoning:** OpenSuperWhisper itself ships macOS-only; Orbitae targets macOS/Windows/Linux, so this needs its own whisper.cpp-based integration rather than shelling out to their app — can't just wrap their binary.
**Trade-offs:** A large one-time model download; needs a real design pass on where the model cache lives and how "Install voice" surfaces in Settings/onboarding — not scoped yet, just captured as the next thing to design when this phase starts.
**Related:** `docs/PRODUCT.md` — command-center vision. Pass 3 (multi-provider harness) may share plumbing with the model-download UX (both are "fetch and cache a large local artifact on demand").

---

## 2026-05-05 — Knowledge Graph System (Karpathy's LLM Wiki Pattern)

### IDEA-017: Internal Knowledge Graph with LLM-Maintained Wiki
**Status:** ACCEPTED
**Context:** Karpathy proposed a pattern called "LLM Wiki" — a persistent, compounding knowledge base that LLMs maintain through three operations: Ingest (feed information), Query (retrieve relevant context), and Lint (find stale/contradictory/incomplete entries). The insight: LLMs never get bored of bookkeeping. Instead of using external tools like Obsidian, Orbitae can maintain its own internal graph system that grows as the developer uses the app.
**Idea:** A knowledge graph built into Orbitae that compounds project understanding over time:

**Data Model:**
- `knowledge_nodes` table: id, project_id, title, content, kind, source, status (active/stale/archived), tags, created_at, updated_at
- `knowledge_edges` table: from_node, to_node, relation, created_at
- `knowledge_log` table: action (ingest/query/lint/update), summary, affected_nodes, timestamp
- Node kinds: architecture, convention, decision, runbook, dependency, debug_log, api_doc, onboarding, auto_insight
- Edge relations: depends_on, related_to, contradicts, supersedes, implements, documents

**Three Core Operations (from Karpathy's pattern):**
1. **Ingest** — Multiple sources feed the graph:
   - Manual: User creates/edits nodes directly
   - Auto-ingest from README, docs/, CONTRIBUTING.md in the repo
   - AI extracts insights from conversations ("I noticed you always restart Redis before the API — creating a runbook node")
   - Playbook results update relevant nodes
   - Git commit messages can tag knowledge nodes
2. **Query** — Search relevant nodes to build AI context:
   - When the AI agent starts a conversation, it queries the graph for relevant nodes based on the user's prompt
   - Replaces naive "dump everything" context injection with targeted, graph-aware retrieval
   - Nodes have freshness scores — stale nodes are deprioritized
   - Graph traversal: if a node is relevant, its connected nodes (via edges) may also be relevant
3. **Lint** — AI periodically audits the graph:
   - Detects stale information (node references deleted files, outdated dependencies)
   - Finds contradictions (two nodes say different things about the same topic)
   - Identifies orphan nodes (no edges, low query frequency)
   - Suggests gaps ("you have a runbook for deployment but not for rollback")
   - User approves/rejects lint suggestions

**Visualization:**
- Cytoscape.js graph view (already in dependencies) showing nodes and edges
- Color-coded by node kind, opacity by freshness
- Click-to-expand node details
- Search/filter by kind, tag, or full-text

**AI Integration:**
- Agent tools: `search_knowledge`, `create_knowledge_node`, `update_knowledge_node`, `link_nodes`
- Context builder queries the graph instead of dumping raw data
- Over time, the graph becomes the project's institutional memory

**Decision:** Adopted. Foundation in P1.2 (Agent Hub), expanded in later phases.

**Reasoning:**
1. **Token savings compound over time.** Instead of injecting raw file trees, process lists, and DB schemas into every AI conversation, the graph provides pre-digested, structured context. A 50-node graph with targeted retrieval might use 2-3K tokens vs 8-10K for raw context dumps.
2. **Knowledge compounds, not just accumulates.** Edges create relationships. The graph knows that "Redis caching convention" relates to "API rate limiter" relates to "deployment runbook." A flat notes system doesn't capture this.
3. **LLM Wiki pattern is validated.** Karpathy demonstrated this works. The key insight is that LLMs are perfect for the boring bookkeeping work (ingesting, cross-referencing, detecting staleness) that humans won't do.
4. **Unique differentiator.** No developer tool has an internal knowledge graph that AI agents maintain. This is Orbitae's moat.
5. **Enables future features.** Project Memory (IDEA-012) becomes a query over this graph. Team Knowledge Base (IDEA-006/P2.3) becomes a shared graph. Onboarding becomes "walk the graph."

**Phased Rollout:**
- P1.2: SQLite tables, CRUD API, basic query tool for agent, manual node creation UI
- P1.4: Playbook results auto-create/update nodes
- P2.3: Team-shared graph with merge/conflict resolution
- P3.1: Full auto-ingest from repo, pattern detection, scheduled lint, natural language search

**Trade-offs:**
- Adds complexity to P1.2 scope (but foundation is just SQLite tables + basic UI)
- Graph quality depends on usage — empty graphs provide no value (mitigate with auto-ingest from repo docs)
- Risk of graph rot if lint isn't run — need to make lint feel automatic, not manual
- Token cost for lint operations — schedule during idle time, not on every conversation

**Open Questions:**
1. Should lint run on a schedule, on app startup, or manually? Recommendation: on startup + weekly auto-lint.
2. How to handle graph migrations when node schema evolves?
3. Should the graph be exportable (for backup/migration)? Yes — JSON export at minimum.
4. How to bootstrap an empty graph for new projects? Auto-ingest README + detect common patterns.

**Related:** IDEA-003 (AI Agent Hub), IDEA-012 (Project Memory), IDEA-006 (Team Knowledge Base), P2.3 (Shared Knowledge Base), P3.1 (Project Memory)

---

## 2026-05-05 — Remote Development via Mobile

### IDEA-016: Mobile-to-Laptop Remote Agentic Development ("Orbitae Remote")
**Status:** EXPLORING
**Context:** Developers have ideas everywhere — commuting, in meetings, at coffee shops — but can only code at their desk. No tool bridges this gap meaningfully. Mobile IDEs are terrible. The insight: you don't need to code on your phone — you need to direct an AI agent from your phone that codes on your laptop.
**Idea:** A three-part system:

**Part 1 — Remote Prompt Ingestion:**
- Orbitae runs on the laptop as an always-on dev environment host
- Exposes a secure remote API (via tunnel like Cloudflare Tunnel, or a cloud relay service)
- iOS Shortcuts / widget / lightweight companion app lets the user send prompts from their phone
- Voice input supported (Whisper transcription or iOS dictation)
- Example: Tap shortcut → dictate "add rate limiting to the API endpoints using a token bucket algorithm" → sent to laptop

**Part 2 — AI Plan Generation & Review:**
- Orbitae's AI agent receives the prompt with full project context (codebase, running services, DB schema, notes, git history)
- Generates a structured execution plan: what files to create/modify, what commands to run, what tests to add
- Plan is rendered as an interactive document (PDF or web-based) and pushed to the user's phone
- User reviews on mobile — can:
  - Approve/reject individual steps
  - Add comments or corrections (typed or handwritten via Apple Pencil on iPad)
  - Highlight sections to flag concerns
  - Reorder steps
  - Request alternatives for specific steps
- Annotations are parsed and sent back to Orbitae

**Part 3 — Remote Execution & Status:**
- Orbitae executes the approved plan on the laptop
- Real-time status updates pushed to phone (push notifications, or live status page)
- Each step shows: pending → running → success/failed
- If a step fails, user gets notified with error context and can respond with corrections
- On completion: git commit created, diff summary sent to phone for final review
- User can approve the commit or request changes — all from mobile

**Decision:** Still exploring. This is a Phase 3+ feature but could be a massive differentiator. Need to validate technical feasibility of the annotation-parsing flow.

**Reasoning — Why this is compelling:**
1. **No one does this.** Zero competitors offer "direct your AI agent from your phone to code on your laptop."
2. **Leverages existing UX.** iOS Shortcuts, Apple Pencil markup, push notifications — no need to build a mobile IDE.
3. **The plan-review-execute loop is the right abstraction.** You don't want to write code on your phone. You want to review and approve a plan.
4. **Extends Orbitae's MCP story.** The remote API is essentially MCP-over-network. Same tools, same context, different transport.
5. **Perfect for async development.** "I had an idea on the train, by the time I got to the office, the code was written and ready for review."
6. **Marketing goldmine.** "Code from your couch" demos go viral.

**Technical Feasibility Assessment:**

| Component | Feasibility | Notes |
|-----------|-------------|-------|
| Remote API on laptop | High | Cloudflare Tunnel or Tailscale for secure access without port forwarding |
| iOS Shortcuts integration | High | HTTP POST to API endpoint — Shortcuts supports this natively |
| Voice-to-prompt | High | iOS dictation or Whisper |
| AI plan generation | High | Already building the Agent Hub (IDEA-003) |
| Plan → PDF rendering | Medium | Structured plan to PDF is straightforward; rich interactivity harder |
| Plan → Web-based review | High | Better than PDF — responsive, interactive checkboxes, comment threads |
| Apple Pencil annotation parsing | Medium-Low | OCR/handwriting recognition needed. Alternative: structured form inputs instead |
| Push notifications | High | APNs via cloud relay, or simple polling |
| Remote code execution | High | Playbook Engine already handles this (IDEA-005) |
| Git commit from results | High | Existing git module handles this |
| Security (remote access) | Medium | Need auth tokens, encrypted tunnel, session management |
| Laptop sleep/availability | Medium | Need wake-on-LAN or cloud relay that queues requests |

**Key Design Decision — PDF vs Web Review:**
- **PDF approach:** Familiar, works offline, Apple Pencil native. But parsing annotations is hard (OCR, ink recognition). Static format limits interactivity.
- **Web approach:** Interactive (checkboxes, comment fields, inline editing). Works on any device. Easier to implement. But requires network connection for review.
- **Recommendation:** Start with web-based review page (hosted on the cloud relay). Add PDF export as a secondary option. Avoid Apple Pencil OCR complexity initially — structured inputs (approve/reject/comment per step) are more reliable and faster to build.

**Implementation Phases:**
1. **MVP (Phase 1 stretch goal):** Remote API + iOS Shortcut + AI plan generation + web-based review page + execution. No annotations, just approve/reject/comment per step.
2. **V2 (Phase 2):** Push notifications, voice input, step reordering, alternative suggestions, real-time execution streaming.
3. **V3 (Phase 3):** PDF export with annotation support, iPad companion app, Apple Pencil markup parsing, collaborative review (team members review plans).

**Trade-offs:**
- Adds complexity to the architecture (cloud relay, auth, push notifications)
- Security surface increases significantly (remote access to dev environment)
- Laptop must be running and accessible (mitigate with cloud relay queue)
- Could distract from core desktop experience if prioritized too early

**Open Questions:**
1. Cloud relay vs direct tunnel? Relay is more reliable but adds a cloud dependency. Tunnel is local-first but fragile.
2. Companion app vs Shortcuts-only? App gives richer UX but requires App Store review and maintenance.
3. How to handle laptop sleep? Wake-on-LAN, always-on mode, or queue-and-execute-on-wake?
4. Pricing tier? This feels like a Pro+ or Team feature given the infrastructure needed.
5. Should the review page be a PWA that works offline and syncs?

**Related:** IDEA-001 (AI command center), IDEA-002 (MCP server), IDEA-003 (AI Agent Hub), IDEA-005 (Playbook Engine), IDEA-R004 (rejected mobile app — this is different: it's a remote control, not a mobile IDE)

---

## 2026-05-05 — Initial Product Strategy Session

### IDEA-001: Reposition as "AI-native developer command center"
**Status:** ACCEPTED
**Context:** Orbitae was originally a workspace manager with many features but no sharp positioning. Needed differentiation.
**Idea:** Shift positioning from "developer workspace" to "AI-native command center where developers and agents ship together." The core differentiator is that Orbitae gives AI agents (Claude Code, Cursor, Codex) live access to project infrastructure (terminals, databases, secrets, processes) via MCP.
**Decision:** Adopted as the primary positioning.
**Reasoning:** No other tool owns the "MCP bridge between AI agents and project infrastructure" position. The workspace features become the foundation that makes the AI story possible. This is a blue ocean — Bridgemind positions as "the workroom around IDEs" but doesn't have the infrastructure depth (real DB client, real secrets vault, real process management).
**Trade-offs:** Requires building MCP server, which is new work. Marketing must communicate the AI angle clearly without alienating non-AI users who just want a good workspace.
**Related:** IDEA-002, IDEA-003, docs/COMPETITIVE.md

---

### IDEA-002: MCP Server as primary distribution channel
**Status:** ACCEPTED
**Context:** Need a go-to-market strategy that doesn't require massive content marketing budget.
**Idea:** Expose Orbitae as an MCP server so Claude Code, Cursor, Windsurf, and other AI tools can connect to it. Every developer using an MCP-compatible AI tool becomes a potential Orbitae user. Write blog posts / tutorials showing how to "give Claude Code access to your databases and terminals."
**Decision:** Adopted. MCP server is Priority #2 in the roadmap.
**Reasoning:** MCP has 97M monthly SDK downloads. 78% of enterprise AI teams have MCP agents in production. This is the USB-C moment for AI tools. Being the best MCP server for project infrastructure is a massive distribution play.
**Trade-offs:** MCP spec is still evolving. Need to stay current with protocol changes. Also creates a dependency on MCP adoption continuing.
**Related:** IDEA-001, docs/ROADMAP.md Phase 1

---

### IDEA-003: Multi-provider AI Agent Hub (replace Ollama-only)
**Status:** ACCEPTED
**Context:** Current AI integration only works with local Ollama, which requires users to install and run a separate service. Massive friction.
**Idea:** Support OpenAI, Anthropic, Groq, and local Ollama. Users bring their own API keys. The AI agent gets live project context (file structure, running processes, DB state, secrets, notes) injected into every conversation.
**Decision:** Adopted. This is Priority #1.
**Reasoning:** The magic demo is: "Chat with an AI that can see your terminals, databases, and secrets simultaneously." No other tool does this. Requiring Ollama-only kills the demo for 90%+ of developers.
**Trade-offs:** Need to handle API key storage securely (Vault). Need to manage token costs for context injection. Need streaming UI.
**Related:** IDEA-001, docs/ROADMAP.md Phase 1

---

### IDEA-004: Open source the core
**Status:** ACCEPTED
**Context:** Dev tools live or die by community trust. No developer will store secrets in a closed-source alpha from a solo developer.
**Idea:** Open source the Free tier features (workspace, terminal, notes, git, snippets, process manager). Gate AI features, MCP, playbooks, and team features behind paid tiers via a license check.
**Decision:** Adopted for post-launch (after initial Pro revenue validates the model).
**Reasoning:** Open source builds trust, gets contributors, creates distribution via GitHub. The paid features (AI hub, MCP, team workspaces) are the value-add that justifies the subscription. Bridgemind is closed-source — being open source is a differentiator.
**Trade-offs:** Need to design the codebase for clean separation of free/paid features. Risk of someone forking and adding the paid features — mitigate by moving fast and building community.
**Related:** IDEA-001, docs/PRODUCT.md Distribution Strategy

---

### IDEA-005: Playbook Engine v2 with visual DAG editor
**Status:** ACCEPTED
**Context:** Current playbook system is a stub — can create/store playbooks but execution is barely functional. The "one click to boot my dev environment" demo is the most compelling selling point.
**Idea:** Full playbook engine with: visual DAG editor, step types (command, health check, DB query, HTTP request, delay, conditional), parallel execution, failure handling (retry/skip/abort/cleanup), shareable YAML export.
**Decision:** Adopted. Priority #3 in roadmap.
**Reasoning:** "Describe your dev environment, AI generates a playbook, one click runs it every morning" — this is the demo that sells the product. Bridges the AI agent hub with real automation.
**Trade-offs:** Significant engineering effort. Visual DAG editor is complex UI work. Need to get the execution engine rock-solid for trust.
**Related:** IDEA-003, docs/ROADMAP.md Phase 1

---

### IDEA-006: Team Workspaces with shared context
**Status:** ACCEPTED (Phase 2)
**Context:** Pro tier at $15/month is fine but Team tier at $35/user/month is where real revenue comes from. Need team-specific features.
**Idea:** Shared project templates, snippet libraries, playbook marketplace, team knowledge base (persistent docs accessible by AI agents), session sharing for handoffs, role-based access.
**Decision:** Adopted for Phase 2 (after individual product is solid).
**Reasoning:** Team features are the revenue multiplier. A 5-person team at $35/user = $175/month vs one Pro user at $15/month. The shared knowledge base is especially compelling — it reduces onboarding time and makes every team member's AI agent smarter.
**Trade-offs:** Requires a sync layer (cloud backend or peer-to-peer). Adds significant complexity. Must not compromise local-first architecture for individual users.
**Related:** IDEA-004, docs/PRODUCT.md Team Tier

---

### IDEA-007: Pricing at Free / $15 Pro / $35 Team / Custom Enterprise
**Status:** ACCEPTED
**Context:** Need a pricing model that works for individuals and scales to teams. Looked at Cursor ($20/$40), Windsurf ($15/$30), GitHub Copilot ($10/$19/$39), Bridgemind ($16/$40/$80).
**Idea:** Four tiers. Free with 2 projects and basic panels. Pro at $15/month with AI and MCP. Team at $35/user/month with collaboration. Enterprise at custom pricing.
**Decision:** Adopted as initial pricing. Will iterate based on conversion data.
**Reasoning:** $15 Pro is below Cursor ($20) and accessible for individual devs. $35 Team is competitive with Cursor Business ($40). Free tier must be genuinely useful — 2 projects with terminal + notes + git + snippets is a real workflow.
**Trade-offs:** Free tier needs to be good enough to convert but limited enough to upsell. The 2-project limit is the primary gate.
**Related:** docs/PRODUCT.md Pricing Model

---

### IDEA-008: Build-in-public GTM strategy
**Status:** ACCEPTED
**Context:** Bridgemind reached $149K ARR primarily through Matthew Miller's daily YouTube series (70K subscribers). Need a distribution engine.
**Idea:** Start a build-in-public series documenting Orbitae's journey from alpha to revenue. YouTube + X/Twitter + Discord community. Blog posts on technical topics (MCP integration, Tauri architecture, AI agent orchestration).
**Decision:** Adopted.
**Reasoning:** Free distribution. Creates accountability. Builds audience before product is ready. Every piece of content is a permanent acquisition channel.
**Trade-offs:** Time investment. Must balance building content vs building product. Recommendation: short-form (X posts, 5-minute videos) over long-form initially.
**Related:** docs/PRODUCT.md Distribution Strategy

---

### IDEA-009: Homebrew distribution + CLI companion
**Status:** ACCEPTED
**Context:** Developer tools need frictionless installation. macOS developers expect Homebrew support.
**Idea:** Publish to Homebrew as `brew install orbitae`. Also build a CLI companion (`orbitae start`, `orbitae status`) that can boot projects from the terminal without opening the GUI.
**Decision:** Adopted. Homebrew for Phase 1 launch. CLI companion for Phase 2.
**Reasoning:** `brew install` is table stakes for macOS dev tools. CLI companion meets developers where they are (terminal) and serves as another entry point to the GUI.
**Trade-offs:** Homebrew requires code signing. CLI companion is additional code to maintain. CLI should be thin — just a bridge to the running Orbitae instance.
**Related:** docs/ROADMAP.md Phase 1

---

### IDEA-010: Affiliate program (30% recurring, 12 months)
**Status:** ACCEPTED (post-launch)
**Context:** Bridgemind uses a 30% recurring affiliate program as a growth lever.
**Idea:** Same model — 30% of subscription revenue for 12 months to affiliates who refer paying users.
**Decision:** Adopted for post-launch, after payment infrastructure is in place.
**Reasoning:** Aligns incentives. Power users and content creators become salespeople. 30% of $15 = $4.50/month per referral — meaningful for micro-influencers.
**Trade-offs:** Reduces margin by 30% on referred users. Need affiliate tracking infrastructure. Risk of low-quality referrals — mitigate with minimum retention period.
**Related:** docs/PRODUCT.md Distribution Strategy

---

### IDEA-011: Environment Manager with profiles and .env sync
**Status:** ACCEPTED
**Context:** Current env var panel is a flat key-value store. Real projects have dev/staging/prod environments with different configs.
**Idea:** Environment profiles (dev, staging, prod) each with their own variables, DB connections, and service configs. One-click switching. .env file import/export. Secret interpolation (`${vault:API_KEY}`). Detect drift between Orbitae and disk.
**Decision:** Adopted for Phase 1.
**Reasoning:** This is a daily pain point. Developers manually juggle .env files across environments. Vault integration for secret interpolation is unique — no other tool does this.
**Trade-offs:** Adds complexity to the data model. Need to handle .env file format variations. Must not break existing env var functionality.
**Related:** IDEA-003, docs/ROADMAP.md Phase 1

---

### IDEA-012: Project Memory (AI-powered search over project history)
**Status:** DEFERRED to Phase 3
**Context:** Idea for long-term differentiation — Orbitae remembers every command, query, and note, making it searchable via AI.
**Idea:** Index all project activity (commands, queries, notes, git history). Let users ask "why did we add this migration?" or "what command did I run to fix the SSL issue last week?" AI synthesizes answers from project history.
**Decision:** Deferred to Phase 3. Good idea but not essential for initial launch.
**Reasoning:** Requires a local vector database or embedding system. Significant engineering effort. More valuable after users have accumulated history. Focus on core experience first.
**Trade-offs:** Delays a potential moat feature. But shipping a mediocre version would hurt more than waiting.
**Related:** docs/ROADMAP.md Phase 3

---

### IDEA-013: Session sharing and async handoff
**Status:** DEFERRED to Phase 2
**Context:** Teams waste time explaining context during handoffs — "I was debugging this, here's where I left off."
**Idea:** Snapshot workspace state (open terminals, DB queries, notes) and share via link. Teammate opens it and sees your exact context. Also support real-time read-only pair debugging.
**Decision:** Deferred to Phase 2 (team features).
**Reasoning:** Requires sync infrastructure. Great team feature but not needed for individual launch.
**Trade-offs:** Delays a compelling team selling point. But building sync infra before individual product is solid would be premature.
**Related:** IDEA-006, docs/ROADMAP.md Phase 2

---

### IDEA-014: Docker integration panel
**Status:** DEFERRED to Phase 2
**Context:** Many developers run services via Docker Compose. Would be natural to manage containers from Orbitae.
**Idea:** Docker panel showing container status, logs, start/stop controls. Parse docker-compose.yml for service definitions.
**Decision:** Deferred to Phase 2.
**Reasoning:** Useful but not essential for launch. Docker Desktop already exists. Focus on features where Orbitae is uniquely better (AI + MCP + project context).
**Trade-offs:** Some developers may not adopt Orbitae without Docker support. But trying to build everything at once delays launch.
**Related:** docs/ROADMAP.md Phase 2

---

### IDEA-015: Incident / debug mode
**Status:** DEFERRED to Phase 2
**Context:** When things break, developers open 5 tools simultaneously. Orbitae could pre-configure a debugging workspace.
**Idea:** One-click incident workspace with log tailing, DB query panel, runbook notes, timeline correlation. Auto-generates post-mortem template.
**Decision:** Deferred to Phase 2.
**Reasoning:** Compelling feature for teams but requires the activity feed and integrations to be in place first. Phase 2 dependency.
**Trade-offs:** N/A — will be built once foundations are ready.
**Related:** IDEA-006, docs/ROADMAP.md Phase 2

---

## Rejected Ideas

### IDEA-R001: Build as Electron app
**Status:** REJECTED
**Context:** Considered during initial architecture phase.
**Reasoning:** Tauri is 10x more memory-efficient, provides Rust security guarantees, and produces smaller binaries. Electron's 500MB+ RAM baseline is unacceptable for a tool that positions on native performance. Non-negotiable.

### IDEA-R002: Cloud-first architecture
**Status:** REJECTED
**Context:** Considered for easier team features.
**Reasoning:** Local-first is a core differentiator. Developers trust tools that keep data on their machine. Cloud sync can be an opt-in layer for team features — but the default must be local. Secrets especially must never leave the device.

### IDEA-R003: Build our own IDE/editor
**Status:** REJECTED
**Context:** Some workspace tools include code editors.
**Reasoning:** VS Code/Cursor/Windsurf have won the editor war. Competing here is suicide. Orbitae wraps around editors via MCP — it's complementary, not competitive. "Open in editor" button is the right integration point.

### IDEA-R004: Mobile companion app
**Status:** REJECTED (for now)
**Context:** "Check project status from your phone."
**Reasoning:** Developer workflows are desktop-first. Mobile adds complexity with minimal value. If demand emerges post-launch, reconsider. Not worth the engineering investment now.

### IDEA-R005: Browser-based version
**Status:** REJECTED
**Context:** "Run Orbitae in the browser for quick access."
**Reasoning:** The entire value proposition is native performance and local-first security. A browser version undermines both. The marketing site has an interactive demo for showcasing — that's sufficient.
