# Orbitae v0.2 — UI Revamp & Production Hardening Checklist

**Goal:** Ship a secure, polished, monetization-ready product.  
**Standard:** Staff-engineer level. Zero security gaps. Production-grade code.  
**Baseline commit:** `9c9d5eb` (2026-05-21)

---

## Phase 1: Fix the Foundation
> Priority: CRITICAL — nothing else matters until these are done.  
> Estimated: Week 1-2

### Security & Data Integrity
- [ ] **1.1** Move DB connection passwords to Vault (keychain) — currently stored as plaintext JSON in SQLite. This is the #1 security vulnerability.
- [ ] **1.2** Audit all Tauri commands for input validation — every command handler must validate and sanitize inputs before processing. No raw string interpolation in SQL or shell commands.
- [ ] **1.3** Remove all `console.log` / `console.error` from production TypeScript — replace with logger utility or remove entirely. No leaking internal state to devtools.

### Core UX Overhaul
- [ ] **1.4** Replace Dialog-based workspace with full-screen view — when a project is opened, the project grid disappears and the workspace fills the entire window. Back button (or Cmd+W) returns to project list. No more `max-w-7xl h-[90vh]` modal overlay.
- [ ] **1.5** Add persistent Terminal tab to workspace navigation — 5 tabs: Command Center, Agent, Terminal, Workspace, Settings. Terminal panel with xterm.js, supports 1-4 split panes.
- [ ] **1.6** Fix `write_to_process` — solve the trait bounds issue so users can type into managed terminal processes from the UI.

### Critical Backend Fixes
- [ ] **1.7** Get MCP server working end-to-end — verify `orbitae-mcp` binary works with Claude Code and Cursor. Test: create token, generate config, connect from Claude Code, query a database through MCP.
- [ ] **1.8** Fix process output memory leak — `Arc<Mutex<String>>` grows unboundedly. Add a ring buffer or cap at 1MB with truncation.

### Phase 1 — Testing Checklist
- [ ] Open app fresh — no crashes, no console errors in devtools
- [ ] Create project via Import — name auto-populates from folder
- [ ] Open project — workspace fills full window, not a dialog
- [ ] Navigate all 5 tabs — each loads without error
- [ ] Terminal tab — open terminal, type commands, see output
- [ ] Command Center — start a process, see output, type into it
- [ ] Agent — configure AI provider, send a message, get response
- [ ] Workspace — knowledge graph loads, nodes + edges visible
- [ ] Settings > Keys — add a secret, reveal it (biometric prompt appears), delete it
- [ ] Settings > Databases — add a connection (password stored in vault, NOT in SQLite)
- [ ] MCP — generate config, connect from Claude Code, run a query
- [ ] Cmd+K — command palette opens, search works, actions execute

### Phase 1 — Security Review
- [ ] Run `grep -rn "console\.\(log\|error\|warn\)" src/ --include="*.ts" --include="*.tsx"` — must return 0 results
- [ ] Run `grep -rn "password\|secret\|api_key" src-tauri/src/ --include="*.rs"` — verify no plaintext storage
- [ ] Verify all SQL queries use parameterized bindings (no string interpolation)
- [ ] Verify all Tauri commands validate inputs (non-empty strings, valid IDs, path sandboxing)
- [ ] Verify CSP in `tauri.conf.json` does not include `unsafe-eval`
- [ ] Verify secrets are ONLY stored via VaultService (keychain), never in SQLite
- [ ] Run `cargo clippy -- -D warnings` — must pass clean
- [ ] Run `npx tsc -b --noEmit` — must pass clean
- [ ] Production build succeeds: `npm run tauri build`

---

## Phase 2: Upgrade the Agent Experience
> Priority: HIGH — this is what makes people pay.  
> Estimated: Week 2-3

### Agent Intelligence
- [ ] **2.1** Agent thread timeline — show tool calls as a visual timeline with status dots (pending/running/done/error), tool name, elapsed time, collapsible output. Vertical thread line with accent-colored dots and pulsing animation during execution.
- [ ] **2.2** Self-learning loop — after each agent conversation ends, run a background LLM call: "Review this conversation. Should any insights, decisions, or conventions be saved to the knowledge graph?" Auto-create nodes with `source="ai_review"`.
- [ ] **2.3** Progressive tool disclosure — when tool count > 10, only load core tools (start/stop process, search knowledge, git status) into system prompt. Add a `tool_search` bridge tool for on-demand discovery.
- [ ] **2.4** Model auto-setup — on first launch of Agent panel, detect Ollama running locally. If found, auto-configure as AI provider. If not, show a guided "Add API Key" flow with provider selection.

### Agent Security
- [ ] **2.5** Sanitize all tool outputs before displaying in UI — prevent XSS via tool results containing HTML/script tags.
- [ ] **2.6** Rate-limit agent tool execution — max 20 tool calls per conversation turn, 60s timeout per tool. Prevent runaway loops.
- [ ] **2.7** Validate shell commands before execution — block dangerous patterns (`rm -rf /`, `sudo`, pipe to `curl | sh`, etc.) with an allowlist/blocklist approach.

### Phase 2 — Testing Checklist
- [ ] Send a message to agent — tool calls show as visual timeline (not plain text)
- [ ] Tool call timeline shows: tool name, status dot, elapsed time, collapsible output
- [ ] After conversation, check knowledge graph — new "ai_review" nodes created automatically
- [ ] Agent with 15+ tools — only core tools loaded, `tool_search` available
- [ ] First-time Agent panel — detects Ollama or guides API key setup
- [ ] Agent tool call with HTML in output — no XSS, content escaped properly
- [ ] Agent conversation with 20+ tool calls — stops after limit, shows warning
- [ ] Agent asked to run `rm -rf /` — blocked with clear message

### Phase 2 — Security Review
- [ ] Verify tool outputs are escaped before DOM insertion (no `dangerouslySetInnerHTML` on raw tool results)
- [ ] Verify shell command validation blocks `rm -rf`, `sudo`, `curl | sh`, `eval`, backtick injection
- [ ] Verify AI-generated knowledge nodes are sanitized (no prompt injection into future system prompts)
- [ ] Verify agent API keys are read from vault at runtime, never cached in memory longer than the request
- [ ] Verify background self-learning LLM call uses the same security context (no privilege escalation)
- [ ] Run `cargo clippy -- -D warnings` — must pass clean
- [ ] Run `npx tsc -b --noEmit` — must pass clean
- [ ] Production build succeeds

---

## Phase 3: Layout & Polish
> Priority: MEDIUM — what makes people stay and tell their friends.  
> Estimated: Week 3-4

### Layout Improvements
- [ ] **3.1** Split-pane support — allow dragging panel edges to create side-by-side views (e.g., Terminal + Agent). Start with 2-panel horizontal split using a drag handle.
- [ ] **3.2** Redesign Command Center — replace scrollable accordions with a clean dashboard: status cards at top (git branch, running processes count, active playbook), action sections as cards below.
- [ ] **3.3** Onboarding tour — on first project open, highlight 5 areas in sequence: Command Center, Agent, Terminal, Workspace, Settings. Spotlight + tooltip pattern. Dismissable, never shows again.

### Polish & Personalization
- [ ] **3.4** Theme system — add 4-5 built-in themes: Midnight (deep blue), Terminal (green-on-black), Warm (amber accents), Ocean (cyan/teal), Rose (pink accents). Add compact/comfortable density toggle.
- [ ] **3.5** Command palette expansion — add 20+ actions: search knowledge graph, search notes, start/stop processes, open recent conversations, switch theme, toggle density, toggle sidebar.
- [ ] **3.6** Keyboard shortcuts — Cmd+T (new terminal), Cmd+J (toggle terminal panel), Cmd+Shift+A (focus agent), Cmd+Shift+P (focus processes). Display shortcut hints in command palette.

### Quality of Life
- [ ] **3.7** Restore snippets in UI — re-add snippets panel (was lost during 10-tab to 4-tab simplification). Put in Command Center or as a Workspace sub-tab.
- [ ] **3.8** Git panel upgrade — add commit, diff preview, and branch switching. Currently only shows branch name + modified count.
- [ ] **3.9** Blind model comparison — send same prompt to 2-3 configured models, show results side-by-side. Low effort, high demo value.

### Phase 3 — Testing Checklist
- [ ] Drag panel edge — split view appears, both panels functional
- [ ] Command Center — clean card layout, no scrolling for basic info
- [ ] First project open — onboarding tour triggers, can be dismissed
- [ ] Dismiss tour — never appears again on subsequent opens
- [ ] Theme picker — all 6+ themes render correctly in both modes
- [ ] Density toggle — compact makes everything tighter, comfortable is default
- [ ] Command palette — 20+ actions searchable and executable
- [ ] All keyboard shortcuts — each one works, no conflicts
- [ ] Snippets — visible and usable from the UI
- [ ] Git panel — can view diff, switch branches, make commits
- [ ] Model comparison — sends to 2 models, shows side-by-side

### Phase 3 — Security Review
- [ ] Verify git operations are sandboxed to project directory (no arbitrary path traversal)
- [ ] Verify theme/density preferences stored safely (localStorage only, no server-side)
- [ ] Verify onboarding state stored locally (no network calls)
- [ ] Verify split-pane doesn't leak state between panels
- [ ] Run `cargo clippy -- -D warnings` — must pass clean
- [ ] Run `npx tsc -b --noEmit` — must pass clean
- [ ] Production build succeeds

---

## Phase 4: Monetization & Distribution
> Priority: HIGH — start making money.  
> Estimated: Week 4-5

### Distribution
- [ ] **4.1** Code-sign the app — Apple Developer Certificate, notarize for macOS distribution.
- [ ] **4.2** Auto-updater — integrate `tauri-plugin-updater` for seamless in-app updates.
- [ ] **4.3** Homebrew formula — `brew install --cask orbitae` for easy installation.
- [ ] **4.4** Landing page — clean product page with 60-second demo video, feature highlights, download button.

### Monetization
- [ ] **4.5** Pricing gate — Free tier: 1 project, local AI only, no MCP. Pro ($12/month): unlimited projects, MCP server, cloud AI providers, playbook engine, knowledge graph export.
- [ ] **4.6** License key validation — secure server-side verification. Keys stored in vault, checked at startup.
- [ ] **4.7** Usage analytics (opt-in only) — anonymous feature usage for product decisions. PostHog or similar. Must be explicitly opt-in with clear disclosure.

### Launch
- [ ] **4.8** Product Hunt launch — prepared assets, description, maker comment.
- [ ] **4.9** First demo video — 60-second walkthrough: import project, launch env with playbook, chat with agent, knowledge graph auto-builds.
- [ ] **4.10** Submit to: r/selfhosted, r/LocalLLaMA, r/programming, Hacker News.

### Phase 4 — Testing Checklist
- [ ] App opens without macOS Gatekeeper warning (code-signed)
- [ ] Auto-updater detects new version, downloads, installs
- [ ] `brew install --cask orbitae` works from scratch
- [ ] Free tier — only 1 project creatable, MCP disabled
- [ ] Pro tier — license key activates all features
- [ ] Invalid license key — clear error, graceful fallback to free tier
- [ ] Analytics — toggle off sends zero network requests (verify in Network tab)
- [ ] Fresh install on clean macOS — full flow works end-to-end

### Phase 4 — Security Review
- [ ] Verify license keys are validated server-side (not just client check)
- [ ] Verify license keys stored in vault (keychain), not in plaintext
- [ ] Verify analytics sends ZERO data when opted out (network inspection)
- [ ] Verify analytics never includes: file paths, project names, code content, secrets, API keys
- [ ] Verify auto-updater validates binary signatures before installing
- [ ] Verify Homebrew formula hash matches published binary
- [ ] Full penetration test: try to bypass license check, extract secrets, inject commands
- [ ] Run `cargo clippy -- -D warnings` — must pass clean
- [ ] Run `npx tsc -b --noEmit` — must pass clean
- [ ] Final production build succeeds

---

## Version Tracking

| Version | Phase | Date | Notes |
|---------|-------|------|-------|
| 0.1.14 | Pre-revamp | 2026-05-21 | Current baseline |
| 0.2.0 | Phase 1 complete | — | Foundation fixes |
| 0.3.0 | Phase 2 complete | — | Agent upgrade |
| 0.4.0 | Phase 3 complete | — | Polish & layout |
| 1.0.0 | Phase 4 complete | — | Public launch |
