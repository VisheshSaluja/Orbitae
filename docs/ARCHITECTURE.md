# Orbitae — Architecture Document

> Last updated: 2026-05-05

## System Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Orbitae Desktop App                    │
│                                                          │
│  ┌──────────────────────┐  ┌──────────────────────────┐ │
│  │   React Frontend      │  │    Rust Backend (Tauri)   │ │
│  │                        │  │                          │ │
│  │  ┌─────────────────┐  │  │  ┌────────────────────┐  │ │
│  │  │ Workspace Panels │◄─┼──┼─►│ Module: Projects   │  │ │
│  │  │ (Terminal, DB,   │  │  │  │ Module: Terminal    │  │ │
│  │  │  Notes, Git,     │  │  │  │ Module: Processes   │  │ │
│  │  │  Vault, Agent)   │  │  │  │ Module: Databases   │  │ │
│  │  └─────────────────┘  │  │  │ Module: Vault        │  │ │
│  │                        │  │  │ Module: Git          │  │ │
│  │  ┌─────────────────┐  │  │  │ Module: SSH          │  │ │
│  │  │ Zustand Stores   │  │  │  │ Module: Agent        │  │ │
│  │  └─────────────────┘  │  │  │ Module: MCP Server   │  │ │
│  │                        │  │  │ Module: Playbooks    │  │ │
│  │  ┌─────────────────┐  │  │  └────────────────────┘  │ │
│  │  │ AI Agent Hub     │  │  │                          │ │
│  │  │ (Multi-provider) │  │  │  ┌────────────────────┐  │ │
│  │  └─────────────────┘  │  │  │ SQLite Database     │  │ │
│  └──────────────────────┘  │  │  └────────────────────┘  │ │
│                              │                          │ │
│                              │  ┌────────────────────┐  │ │
│                              │  │ System Keychain     │  │ │
│                              │  └────────────────────┘  │ │
│                              │                          │ │
│                              │  ┌────────────────────┐  │ │
│                              │  │ MCP Server          │  │ │
│                              │  │ (local socket)      │  │ │
│                              │  └──────┬─────────────┘  │ │
│                              └─────────┼────────────────┘ │
└──────────────────────────────────────┼────────────────────┘
                                        │
                    ┌───────────────────┼───────────────────┐
                    │                   │                    │
              ┌─────▼─────┐    ┌───────▼──────┐    ┌──────▼──────┐
              │ Claude Code│    │    Cursor     │    │   Windsurf  │
              │ (MCP client)│   │ (MCP client)  │    │ (MCP client)│
              └────────────┘    └──────────────┘    └─────────────┘
```

## Backend Architecture (Rust)

### Module Structure

Each backend module follows the layered pattern:

```
module/
├── commands.rs    # Tauri IPC command handlers — input validation, delegation
├── service.rs     # Business logic — orchestration, transformations
├── repository.rs  # Data access — parameterized SQL queries
└── models.rs      # Data structures — Serialize/Deserialize, domain types
```

**Rules:**
- Commands MUST NOT access the database directly
- Commands MUST validate all inputs before delegating to services
- Services MUST NOT use `sqlx::query` directly — go through repository
- Repositories MUST use parameterized queries exclusively
- Models MUST derive `Serialize` and `Deserialize` where needed
- Each module MUST define its own error type via `thiserror`

### State Management (Rust)

```rust
// Managed by Tauri's state system
SqlitePool          // Database connection pool (5 connections)
TerminalSessions    // Arc<Mutex<HashMap<String, TerminalSession>>>
ProcessState        // Arc<Mutex<HashMap<String, ProcessSession>>>
McpServerState      // MCP server handle (future)
AgentState          // Active AI conversations (future)
```

### Error Handling Pattern

```rust
// Per-module error type
#[derive(Debug, thiserror::Error)]
pub enum ProjectError {
    #[error("Project not found: {0}")]
    NotFound(String),
    #[error("Invalid project path: {0}")]
    InvalidPath(String),
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),
}

// Commands convert to Tauri-compatible errors
#[tauri::command]
async fn get_project(id: String, pool: State<'_, SqlitePool>) -> Result<Project, String> {
    let service = ProjectService::new(pool.inner());
    service.get(&id).await.map_err(|e| e.to_string())
}
```

### Database Schema

See `src-tauri/migrations/` for authoritative schema. Key tables:

| Table | Purpose | Relationships |
|-------|---------|---------------|
| projects | Core project metadata | Parent of all project_* tables |
| project_envs | Environment variables | project_id FK → projects |
| project_snippets | Command snippets | project_id FK → projects |
| project_keys | Vault key references | project_id FK → projects, key_reference → Keychain |
| project_notes | Rich text / canvas notes | project_id FK → projects |
| project_links | Quick access links | project_id FK → projects |
| project_connections | DB connection metadata | project_id FK → projects |
| project_playbooks | Automation workflows | project_id FK → projects |
| playbook_steps | Steps within playbooks | playbook_id FK → project_playbooks |

**Future tables (Phase 1):**
| Table | Purpose |
|-------|---------|
| environment_profiles | Named env configurations per project |
| agent_conversations | AI chat history per project |
| agent_messages | Individual messages in conversations |
| activity_events | Project activity timeline |

## Frontend Architecture (React)

### Component Hierarchy

```
App.tsx (project list, search, sort, create/import/clone)
└── ProjectWorkspace.tsx (tabbed panel — dialog/fullscreen)
    ├── OverviewPanel.tsx (project dashboard, health, quick actions)
    ├── LaunchpadPanel.tsx (quick links, commands, repos)
    ├── AgentPanel.tsx (AI chat with tool execution)
    ├── ScriptRunner.tsx (npm/make scripts)
    ├── GitPanel.tsx (git status, graph, history)
    ├── KeysPanel.tsx (secrets vault)
    ├── SnippetsPanel.tsx (command library)
    ├── NotesPanel.tsx (TipTap + Excalidraw)
    ├── ProcessManager.tsx (running processes + terminal)
    ├── DatabasePanel.tsx (connection management, query execution)
    ├── EnvironmentPanel.tsx (profiles, .env sync) [NEW]
    └── ActivityPanel.tsx (event timeline) [NEW]
```

### State Architecture

```
Zustand Stores:
├── useAppStore       # Projects list, active project, global UI state
├── useAgentStore     # AI conversations, provider config [NEW]
├── useProcessStore   # Running processes, terminal sessions [NEW]
└── useActivityStore  # Activity feed events [NEW]

Tauri IPC Layer:
└── src/lib/tauri.ts  # Typed invokeCommand<T>() wrapper
    ├── All commands defined as typed functions
    ├── Error handling at the boundary
    └── Mock mode for browser testing
```

### Key Design Decisions

1. **No router** — Currently modal-based. Will add TanStack Router when deep linking is needed.
2. **Zustand over Redux** — Minimal boilerplate, direct async operations. Right for this scale.
3. **shadcn/ui** — Composable, accessible, themeable. Not a dependency — components are copied in.
4. **TipTap** — Extensible editor. Supports slash commands, code highlighting, task lists.
5. **Excalidraw** — Best-in-class canvas. Embedded via React component.

## MCP Server Architecture (New)

```
MCP Server (Rust, local socket)
├── Transport: stdio or SSE (for remote clients)
├── Authentication: local-only by default, token for remote
├── Tools exposed:
│   ├── get_project_context    # Project structure, status, metadata
│   ├── list_projects          # All registered projects
│   ├── run_command            # Execute in managed terminal
│   ├── query_database         # Run SQL via managed connections
│   ├── get_secrets            # Retrieve from vault (with approval)
│   ├── read_notes             # Access project notes
│   ├── get_process_status     # Check running services
│   ├── get_git_status         # Branch, changes, history
│   ├── get_environment        # Current env profile vars
│   └── execute_playbook       # Run automation playbook
├── Resources exposed:
│   ├── project://{id}/structure   # File tree
│   ├── project://{id}/notes       # All notes
│   └── project://{id}/playbooks   # Available playbooks
└── Prompts exposed:
    ├── debug-project          # Pre-filled debug context
    └── onboard-project        # Project setup guidance
```

## Security Architecture

```
Threat Model:
├── Secrets at rest → System keychain (macOS Keychain, Windows Credential Manager)
├── Secrets in transit → Never leave the machine (local-first)
├── SQL injection → Parameterized queries only, query validation for user-facing execute
├── Command injection → Argument validation, no raw shell interpolation
├── MCP access → Local socket default, token auth for remote, per-tool approval prompts
├── File access → Project path sandboxing, no arbitrary filesystem operations
├── CSP → No unsafe-eval, no unsafe-inline, strict Tauri CSP
└── Updates → Tauri built-in updater with signature verification
```

## Data Flow Examples

### "Boot my dev environment" (AI + Playbook)

```
1. User types: "Start everything for this project"
2. AgentPanel → AI Agent Hub (OpenAI/Anthropic/Ollama)
3. AI generates playbook steps based on project context:
   - Start Docker (command step)
   - Wait for Postgres (health_check step, TCP port 5432)
   - Run migrations (command step, depends_on: postgres)
   - Start backend (command step, depends_on: migrations)
   - Wait for API (health_check step, HTTP GET localhost:8000/health)
   - Start frontend (command step, depends_on: api)
4. User reviews and approves playbook
5. Playbook Engine executes steps via Process module
6. Activity Feed logs each step's status
7. Overview Panel shows all services as "running"
```

### MCP Context Query (External AI Tool)

```
1. Claude Code sends MCP request: get_project_context
2. Orbitae MCP Server receives via local socket
3. Server aggregates:
   - Project metadata from projects table
   - Running processes from ProcessState
   - Git status from git module
   - Active DB connections from connections table
   - Recent notes from project_notes table
4. Returns structured context to Claude Code
5. Claude Code uses context for informed code generation
```
