# Orbitae Alpha — Test Verification Checklist

> Date: 2026-05-11
> Build: v0.1.14 (aarch64 macOS)

---

## 1. App Launch & Navigation

- [ ] App opens without crash
- [ ] Main project list loads (shows existing projects or empty state)
- [ ] Create a new project (name + path) — verify it appears in the list
- [ ] Open a project — workspace dialog opens with sidebar
- [ ] Sidebar shows 4 items: Command Center, Agent, Workspace, Settings
- [ ] Click each sidebar item — panel switches correctly
- [ ] Collapse sidebar (bottom button) — shows icon-only mode
- [ ] Expand sidebar — shows labels + descriptions again
- [ ] **Cmd+1** navigates to Command Center
- [ ] **Cmd+2** navigates to Agent
- [ ] **Cmd+3** navigates to Workspace
- [ ] **Cmd+4** navigates to Settings
- [ ] **Cmd+K** opens command palette
- [ ] Command palette: type "agent" — filters to "Go to Agent"
- [ ] Command palette: arrow keys navigate, Enter executes
- [ ] Command palette: ESC closes it
- [ ] Close project (red dot or dialog close) — returns to project list

---

## 2. Command Center Panel

- [ ] Time-based greeting displays (Good morning/afternoon/evening)
- [ ] Project name shown in greeting
- [ ] Quick action pills visible (Open in Editor, Terminal, Reveal in Finder)
- [ ] "Open in Editor" pill opens VS Code (or configured editor) at project path
- [ ] "Reveal in Finder" pill opens Finder at project path
- [ ] Launch Environment section visible
- [ ] If playbooks exist: Launch button triggers playbook execution
- [ ] If no playbooks: shows appropriate empty state
- [ ] Services section — collapsible via chevron click
- [ ] Playbooks section — collapsible via chevron click
- [ ] Quick Links section — collapsible via chevron click
- [ ] "Ask the Agent" quick action navigates to Agent panel

---

## 3. Agent Panel

- [ ] If no AI provider configured: shows "Configure AI Provider" CTA
- [ ] CTA button navigates to Settings panel
- [ ] If AI provider configured: shows provider/model badge (e.g., "openai/gpt-4o-mini")
- [ ] Conversation dropdown shows "New Conversation"
- [ ] Click dropdown — shows conversation list or "No conversations yet"
- [ ] Create new conversation — title updates in dropdown
- [ ] Type a message and send — streaming response appears with cursor animation
- [ ] Tool calls show as badges above the response (e.g., "searchKnowledge", "getGitStatus")
- [ ] Send follow-up message — conversation history maintained
- [ ] Brain icon navigates to Workspace (Knowledge tab)
- [ ] Settings icon navigates to Settings panel
- [ ] Create multiple conversations — switch between them via dropdown
- [ ] Delete a conversation — removed from list
- [ ] Conversation persists after closing and reopening project

### Agent Tool Tests (with AI provider configured)

- [ ] Ask "what processes are running?" — agent uses getActiveProcesses tool
- [ ] Ask "start a process: ls -la" — agent uses startProcess tool
- [ ] Ask "what do you know about this project?" — agent uses searchKnowledge tool
- [ ] Ask "show me the git status" — agent uses getGitStatus tool
- [ ] Ask "create a knowledge node about X" — agent uses createKnowledgeNode tool
- [ ] Verify auto-created edges: after createKnowledgeNode, check Knowledge graph for new connections

---

## 4. Workspace Panel (Knowledge + Notes)

### Knowledge Graph Tab (default)

- [ ] Knowledge tab is active by default when opening Workspace
- [ ] Only 2 tabs visible: Knowledge and Notes (no Snippets)
- [ ] Auto-ingestion runs on first visit — nodes appear for README.md, ARCHITECTURE.md, etc.
- [ ] Graph view (default): force-directed graph renders with colored nodes
- [ ] Node colors match kind: blue=architecture, green=convention, purple=decision, orange=runbook
- [ ] **Edges visible** between nodes (lines connecting them)
- [ ] Edge types: "references" (doc mentions another doc's filename) and "co-located" (same project)
- [ ] Hover a node — node and connected neighbors highlight, others dim
- [ ] Click a node — detail panel slides in from right showing title, kind, source, content
- [ ] Detail panel has delete button — deleting removes node and its edges
- [ ] Click background or X — detail panel dismisses
- [ ] Toggle to List view — shows card grid with kind badges and delete buttons
- [ ] Toggle back to Graph view — graph re-renders
- [ ] Node labels show when zoomed in (zoom >= 0.6)
- [ ] Directional arrows visible on edges
- [ ] Graph is draggable, zoomable, and responsive to container size

### Notes Tab

- [ ] Switch to Notes tab
- [ ] Create a new note — TipTap editor opens
- [ ] Type rich text (bold, italic, headings, lists)
- [ ] Note saves (auto-save or manual)
- [ ] Delete a note — removed from list
- [ ] Notes persist after closing and reopening project

---

## 5. Settings Panel

### AI Provider Tab

- [ ] Shows existing provider configs (if any) with active indicator
- [ ] "Use" button switches active provider
- [ ] Delete button removes a config
- [ ] Add new provider: grid shows OpenAI, Anthropic, Groq, Ollama
- [ ] Select provider — model dropdown populates with available models
- [ ] For providers requiring API key: key input field appears
- [ ] "Stored securely in your system keychain via Vault" message shown
- [ ] Save & Activate — config created, becomes active
- [ ] For Ollama (no key needed): can save without API key

### Keys & Secrets Tab

- [ ] Add a secret (key name + value)
- [ ] Secret value hidden by default
- [ ] Reveal button shows the value
- [ ] Delete a secret — removed from list
- [ ] Secrets stored in system keychain (not in SQLite)

### Databases Tab

- [ ] Add a database connection (name, type, connection details)
- [ ] Test Connection button — shows success/failure
- [ ] For SQLite: file path field
- [ ] For Postgres: host, port, username, password, database fields
- [ ] Delete a connection — removed from list

---

## 6. Playbook Engine

- [ ] Navigate to Command Center — playbooks section visible
- [ ] If playbooks exist: each shows name and play button
- [ ] Click play — playbook execution starts
- [ ] Step progress shows in real-time (running/completed/failed indicators)
- [ ] Health check steps poll as configured (HTTP 200, TCP port)
- [ ] Failed steps show error output
- [ ] Run history accessible for past executions
- [ ] "Launch Environment" runs the first playbook + opens all quick links

### Playbook Editor (if accessible via Command Center)

- [ ] Add steps with types: command, health_check, delay
- [ ] Set dependencies between steps (depends_on)
- [ ] Visual DAG shows step dependencies as arrows
- [ ] Export playbook as YAML — downloads .yaml file
- [ ] Import playbook from YAML — loads steps correctly
- [ ] AI-generated playbook (with configured provider) — generates YAML from project scripts

---

## 7. MCP Server

- [ ] MCP token visible in Settings or via command
- [ ] MCP client config generation works (`get_mcp_client_config`)
- [ ] MCP server auto-starts on app launch
- [ ] Test with Claude Code: add Orbitae MCP config → tools appear in Claude
- [ ] MCP tools: list_projects, get_project_context, run_command, query_database, search_knowledge

---

## 8. Security Verification

- [ ] SQL injection blocked: in database query panel, try `SELECT 1; DROP TABLE projects` — should error "Multiple statements are not allowed"
- [ ] SQL injection blocked: try `-- comment\nDROP TABLE projects` — should error (comment stripped, DROP blocked)
- [ ] SQL injection blocked: try `WITH x AS (SELECT 1) DELETE FROM projects` — should error "WITH expressions must resolve to SELECT"
- [ ] Read-only enforcement: try `INSERT INTO projects VALUES (...)` — should error "Only read-only queries are allowed"
- [ ] URL validation: open_url only allows http:// and https:// schemes
- [ ] Path traversal blocked: paths with ".." are rejected
- [ ] File name validation: note image filenames with "/" or ".." are rejected
- [ ] Process validation: empty command or non-existent working directory rejected

---

## 9. Cross-Panel Integration

- [ ] Command Center "Ask the Agent" → navigates to Agent panel
- [ ] Agent panel Brain icon → navigates to Workspace Knowledge tab
- [ ] Agent panel Settings icon → navigates to Settings panel
- [ ] If no AI configured and user tries to chat → redirected to Settings
- [ ] Knowledge nodes created by agent appear in Workspace Knowledge graph
- [ ] Playbook results auto-create/update knowledge nodes

---

## 10. Performance & Stability

- [ ] App startup under 2 seconds
- [ ] Memory usage under 60MB idle (check Activity Monitor)
- [ ] No crashes during normal usage
- [ ] No console errors in dev tools (Cmd+Option+I in dev mode)
- [ ] Switching between panels is instant (no loading delay)
- [ ] Knowledge graph with 10+ nodes renders smoothly
- [ ] Agent streaming response has no visible lag between chunks

---

## Known Limitations (Alpha)

- Not code-signed (Apple Developer Certificate pending) — may need to allow in System Settings > Privacy
- Dark theme only — no light mode toggle
- No onboarding wizard for first-time users
- Knowledge graph does not yet parse source code (only docs) — tree-sitter integration planned for Phase 2
- Whiteboard (Excalidraw) included but not prominently surfaced
- Bundle size warnings for large chunks (Excalidraw, Mermaid) — code splitting planned
