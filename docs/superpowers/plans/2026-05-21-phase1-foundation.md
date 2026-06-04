# Phase 1: Fix the Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all security vulnerabilities, replace the Dialog workspace with a full-screen view, add a Terminal tab, and harden the backend — making Orbitae trustworthy enough to charge money for.

**Architecture:** The workspace moves from a Radix Dialog overlay to a full-screen React component switched via state in App.tsx. Database passwords move to the OS keychain via the existing VaultService. Process output gets a ring buffer to prevent memory leaks. All console.log calls are removed or replaced with the existing logger utility.

**Tech Stack:** Tauri v2, Rust (sqlx, keyring, localauthentication-rs), React 19, TypeScript, Zustand, xterm.js, portable-pty

---

## File Map

### Files to Modify
| File | Responsibility | Tasks |
|------|---------------|-------|
| `src/App.tsx` | Project list + workspace routing | 3 |
| `src/components/Workspace/ProjectWorkspace.tsx` | Workspace shell (Dialog → full-screen) | 3 |
| `src-tauri/src/modules/databases/service.rs` | DB connection + query execution | 1 |
| `src-tauri/src/modules/databases/commands.rs` | DB Tauri command handlers | 1 |
| `src-tauri/src/modules/processes/service.rs` | Process management + PTY | 5, 6 |
| `src-tauri/src/modules/processes/models.rs` | Process data structures | 5 |
| `src-tauri/src/modules/projects/commands.rs` | Project command validation | 7 |
| `src-tauri/src/modules/databases/commands.rs` | DB command validation | 7 |
| `src-tauri/src/modules/knowledge/commands.rs` | Knowledge command validation | 7 |
| `src/components/Workspace/KeysPanel.tsx` | Secrets UI (remove sensitive logs) | 2 |
| `src/components/Workspace/TerminalPanel.tsx` | Terminal (remove debug logs) | 2 |
| `src/components/Workspace/DatabasePanel.tsx` | DB UI (remove console.error) | 2 |
| `src/stores/useAppStore.ts` | Global store (remove console.error) | 2 |
| 60+ other .ts/.tsx files | Remove remaining console.* calls | 2 |

### Files to Create
| File | Responsibility | Tasks |
|------|---------------|-------|
| `src/components/Workspace/TerminalTab.tsx` | Dedicated terminal tab with split panes | 4 |

---

## Task 1: Move Database Passwords to Vault

**Context:** Database connection passwords currently fall back to `config["password"]` read from a JSON blob stored in plaintext SQLite. The frontend `DatabasePanel.tsx` may include passwords in the `details` JSON when creating connections. Passwords must ONLY live in the OS keychain via `VaultService`.

**Files:**
- Modify: `src-tauri/src/modules/databases/service.rs` (lines 52-112, 114-206, 208-308)
- Modify: `src-tauri/src/modules/databases/commands.rs` (lines 1-81)
- Modify: `src/components/Workspace/DatabasePanel.tsx` (connection create/test/query flows)

- [ ] **Step 1: Add vault-backed password storage to DatabaseService**

In `src-tauri/src/modules/databases/service.rs`, add a helper to store/retrieve passwords from the vault, keyed by connection ID:

```rust
use crate::modules::vault::service::VaultService;

impl DatabaseService {
    fn vault() -> VaultService {
        VaultService::new("orbitae-db-passwords")
    }

    pub fn store_password(connection_id: &str, password: &str) -> anyhow::Result<()> {
        Self::vault().store_secret(connection_id, password)
    }

    pub fn get_password(connection_id: &str) -> Option<String> {
        Self::vault().get_secret(connection_id).ok()
    }

    pub fn delete_password(connection_id: &str) {
        let _ = Self::vault().delete_secret(connection_id);
    }
}
```

- [ ] **Step 2: Update commands to accept password separately and store in vault**

In `src-tauri/src/modules/databases/commands.rs`, update `create_connection` to accept an optional password and store it in the vault (not in the details JSON):

```rust
#[command]
pub async fn create_connection(
    pool: State<'_, SqlitePool>,
    project_id: String,
    name: String,
    kind: String,
    details: String,
    password: Option<String>,
) -> Result<ProjectConnection, String> {
    // Strip any password from the details JSON before storing
    let clean_details = {
        let mut parsed: serde_json::Value = serde_json::from_str(&details)
            .map_err(|e| format!("Invalid connection details JSON: {e}"))?;
        if let Some(obj) = parsed.as_object_mut() {
            obj.remove("password");
        }
        serde_json::to_string(&parsed).map_err(|e| e.to_string())?
    };

    let service = DatabaseService::new(pool.inner().clone());
    let conn = service.create_connection(&project_id, &name, &kind, &clean_details)
        .await
        .map_err(|e| e.to_string())?;

    // Store password in vault if provided
    if let Some(pw) = password {
        if !pw.is_empty() {
            DatabaseService::store_password(&conn.id, &pw)
                .map_err(|e| format!("Failed to store password in vault: {e}"))?;
        }
    }

    Ok(conn)
}
```

- [ ] **Step 3: Update test_connection and execute_query to read password from vault**

In `commands.rs`, update `test_connection` and `execute_query` to try vault first, then fall back to the runtime `password` parameter:

```rust
#[command]
pub async fn test_connection(
    pool: State<'_, SqlitePool>,
    kind: String,
    details: String,
    password: Option<String>,
) -> Result<bool, String> {
    let service = DatabaseService::new(pool.inner().clone());
    // Try vault password first, then runtime parameter
    let resolved_password = password.or_else(|| {
        let parsed: serde_json::Value = serde_json::from_str(&details).ok()?;
        let conn_id = parsed.get("connection_id")?.as_str()?;
        DatabaseService::get_password(conn_id)
    });
    service.test_connection(&kind, &details, resolved_password.as_deref())
        .await
        .map_err(|e| e.to_string())
}
```

- [ ] **Step 4: Update DatabaseService to never read password from details JSON**

In `service.rs`, remove the `config["password"]` fallback in `test_connection()`, `execute_query()`, and `get_tables()`. Replace with the explicit password parameter only:

Remove these lines (pattern appears in all three methods):
```rust
// REMOVE: let password = password.unwrap_or_else(|| config["password"].as_str().unwrap_or("").to_string());
// REPLACE WITH: let password = password.unwrap_or("");
```

- [ ] **Step 5: Update delete_connection to clean up vault**

In `commands.rs`, update `delete_connection` to also delete the vault entry:

```rust
#[command]
pub async fn delete_connection(
    pool: State<'_, SqlitePool>,
    id: String,
) -> Result<(), String> {
    let service = DatabaseService::new(pool.inner().clone());
    DatabaseService::delete_password(&id);
    service.delete_connection(&id)
        .await
        .map_err(|e| e.to_string())
}
```

- [ ] **Step 6: Update DatabasePanel.tsx to send password separately**

In the frontend, ensure the password is sent as a separate parameter, never included in the `details` JSON.

- [ ] **Step 7: Verify — `grep -rn "password" src-tauri/src/modules/databases/` should show no plaintext storage**

---

## Task 2: Remove All console.log / console.error from Production Code

**Context:** 67 instances of console.log/error/warn across the TypeScript codebase. Some log sensitive data (secret reveals, terminal keystrokes). The existing `src/lib/logger.ts` wrapper should be used for error logging, or errors should be handled with toast notifications.

**Files:**
- Modify: All 20+ .ts/.tsx files listed in the exploration report
- Key files: `KeysPanel.tsx` (sensitive data), `TerminalPanel.tsx` (high-volume), `App.tsx`, `useAppStore.ts`

- [ ] **Step 1: Remove CRITICAL sensitive/high-volume logs first**

`src/components/Workspace/KeysPanel.tsx` lines 80, 82 — remove secret reveal logs:
```typescript
// DELETE: console.log("Requesting secret for:", keyReference);
// DELETE: console.log("Secret received");
```

`src/components/Workspace/TerminalPanel.tsx` line 60 — remove keystroke logging:
```typescript
// DELETE: console.log('TERM DATA', JSON.stringify(data));
```

`src/App.tsx` line 80 — remove project flow log:
```typescript
// DELETE: console.log(`Starting project flow: ${mode}`);
```

- [ ] **Step 2: Replace all remaining console.error with logger.error or remove**

For catch blocks that already show toast notifications, just remove the console.error. For catch blocks with no user-facing feedback, add a toast or use the logger:

```typescript
// Pattern: replace
} catch (e) {
    console.error(e);
    toast.error("Failed to load keys");
}
// With:
} catch {
    toast.error("Failed to load keys");
}
```

- [ ] **Step 3: Batch-remove all remaining instances**

Run through every file in the exploration report. The rule: if there's already a toast.error or the error is non-critical, delete the console call. If there's no user feedback, add a toast or use logger.

- [ ] **Step 4: Verify — `grep -rn "console\.\(log\|error\|warn\)" src/ --include="*.ts" --include="*.tsx"` returns 0 results**

Exception: `src/lib/logger.ts` itself may use console internally — that's acceptable as the centralized logging utility.

---

## Task 3: Replace Dialog Workspace with Full-Screen View

**Context:** `ProjectWorkspace` renders inside a Radix `<Dialog>` with `max-w-7xl h-[90vh]`. This makes it feel like a popup, wastes screen space, and causes sizing issues (knowledge graph can't fill the space). Replace with a full-screen component that takes over the window.

**Files:**
- Modify: `src/App.tsx` (lines 170-260 — conditional rendering)
- Modify: `src/components/Workspace/ProjectWorkspace.tsx` (lines 132-260 — Dialog removal)
- Modify: `src/components/layout/AppLayout.tsx` (may need to be bypassed when workspace is open)

- [ ] **Step 1: Update App.tsx to conditionally render either project list OR workspace**

Replace the current pattern where ProjectWorkspace overlays on top of the project list. Instead, swap between them:

```tsx
// In App.tsx return():
return (
    <>
        {activeTerminalProject ? (
            <ProjectWorkspace 
                project={projects.find(p => p.id === activeTerminalProject)!}
                onClose={() => {
                    setActiveTerminalProject(null);
                    fetchProjects(); // refresh in case anything changed
                }} 
            />
        ) : (
            <AppLayout onNewProject={handleNewProject}>
                {/* ... existing project grid ... */}
            </AppLayout>
        )}
        
        {/* Import Dialog */}
        <Dialog open={isImportOpen} onOpenChange={setIsImportOpen}>
            {/* ... keep as-is ... */}
        </Dialog>

        {/* Clone Dialog */}
        <Dialog open={isCloneOpen} onOpenChange={setIsCloneOpen}>
            {/* ... keep as-is ... */}
        </Dialog>
        <Toaster />
    </>
);
```

- [ ] **Step 2: Rewrite ProjectWorkspace to be a full-screen component (no Dialog)**

Remove the Radix Dialog wrapper entirely. The component becomes a full-screen flex layout:

```tsx
export const ProjectWorkspace: React.FC<ProjectWorkspaceProps> = ({ project, onClose }) => {
    // ... keep all existing state and logic ...

    return (
        <div className="flex flex-col h-screen bg-background">
            {/* Title bar */}
            <header className="h-11 shrink-0 border-b border-border/40 bg-background flex items-center justify-between px-4 select-none">
                <div className="flex items-center gap-3">
                    <button
                        onClick={onClose}
                        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                        <ChevronLeft className="w-3.5 h-3.5" />
                        Projects
                    </button>
                    <span className="text-border/60">/</span>
                    <span className="text-sm font-medium flex items-center gap-2 text-foreground/90">
                        <FolderOpen className="w-4 h-4 text-primary" />
                        {project.name}
                    </span>
                </div>
                <div className="flex items-center gap-2">
                    <kbd className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border/40">
                        {navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}K
                    </kbd>
                </div>
            </header>

            <div className="flex-1 overflow-hidden flex flex-row">
                {/* Sidebar — keep existing sidebar code */}
                <nav className={`${sidebarCollapsed ? 'w-14' : 'w-52'} shrink-0 border-r border-border/30 bg-muted/5 flex flex-col transition-all duration-200`}>
                    {/* ... existing sidebar nav items ... */}
                </nav>

                {/* Panel */}
                <div className="flex-1 overflow-hidden bg-background relative">
                    <ErrorBoundary key={activeTab}>
                        {panelContent}
                    </ErrorBoundary>
                </div>
            </div>

            {/* Command palette — keep existing, but render inline (no createPortal needed) */}
            {paletteOpen && (
                <div className="fixed inset-0 z-[9999] flex items-start justify-center pt-[20vh]">
                    {/* ... existing palette code ... */}
                </div>
            )}
        </div>
    );
};
```

- [ ] **Step 3: Remove Dialog imports from ProjectWorkspace**

Remove unused imports: `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`. Add `ChevronLeft` to the lucide imports.

- [ ] **Step 4: Verify — open a project, workspace fills entire window. Back button returns to project list.**

---

## Task 4: Add Terminal Tab to Workspace Navigation

**Context:** The workspace has 4 tabs (Command Center, Agent, Workspace, Settings). A developer command center needs an accessible terminal. Add a 5th tab "Terminal" using the existing `TerminalPanel` component, with support for 1-4 split panes.

**Files:**
- Create: `src/components/Workspace/TerminalTab.tsx`
- Modify: `src/components/Workspace/ProjectWorkspace.tsx` (add to NAV_ITEMS + panelContent)

- [ ] **Step 1: Create TerminalTab component**

Create `src/components/Workspace/TerminalTab.tsx`:

```tsx
import React, { useState, useCallback } from 'react';
import { TerminalPanel } from './TerminalPanel';
import { Plus, X, Columns2, Square } from 'lucide-react';

interface TerminalTabProps {
    projectId: string;
    projectPath: string;
}

interface TerminalInstance {
    id: string;
    label: string;
}

export const TerminalTab: React.FC<TerminalTabProps> = ({ projectId, projectPath }) => {
    const [terminals, setTerminals] = useState<TerminalInstance[]>([
        { id: crypto.randomUUID(), label: 'Terminal 1' },
    ]);
    const [activeTerminalId, setActiveTerminalId] = useState(terminals[0].id);
    const [splitMode, setSplitMode] = useState<'single' | 'split'> ('single');

    const addTerminal = useCallback(() => {
        if (terminals.length >= 4) return;
        const newTerm: TerminalInstance = {
            id: crypto.randomUUID(),
            label: `Terminal ${terminals.length + 1}`,
        };
        setTerminals(prev => [...prev, newTerm]);
        setActiveTerminalId(newTerm.id);
    }, [terminals.length]);

    const removeTerminal = useCallback((id: string) => {
        setTerminals(prev => {
            const next = prev.filter(t => t.id !== id);
            if (next.length === 0) {
                const fresh = { id: crypto.randomUUID(), label: 'Terminal 1' };
                setActiveTerminalId(fresh.id);
                return [fresh];
            }
            if (activeTerminalId === id) {
                setActiveTerminalId(next[0].id);
            }
            return next;
        });
    }, [activeTerminalId]);

    const visibleTerminals = splitMode === 'split' ? terminals : terminals.filter(t => t.id === activeTerminalId);

    return (
        <div className="h-full flex flex-col bg-background">
            {/* Terminal tab bar */}
            <div className="shrink-0 flex items-center justify-between border-b border-border/40 bg-muted/5 px-2">
                <div className="flex items-center gap-0.5 overflow-x-auto py-1">
                    {terminals.map(term => (
                        <button
                            key={term.id}
                            onClick={() => setActiveTerminalId(term.id)}
                            className={`group flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                                activeTerminalId === term.id
                                    ? 'bg-background text-foreground shadow-sm'
                                    : 'text-muted-foreground hover:text-foreground'
                            }`}
                        >
                            {term.label}
                            {terminals.length > 1 && (
                                <X
                                    className="w-3 h-3 opacity-0 group-hover:opacity-100 hover:text-destructive transition-opacity"
                                    onClick={(e) => { e.stopPropagation(); removeTerminal(term.id); }}
                                />
                            )}
                        </button>
                    ))}
                    {terminals.length < 4 && (
                        <button
                            onClick={addTerminal}
                            className="p-1.5 rounded-md text-muted-foreground/50 hover:text-foreground hover:bg-muted/50 transition-colors"
                            title="New terminal"
                        >
                            <Plus className="w-3.5 h-3.5" />
                        </button>
                    )}
                </div>
                <div className="flex items-center gap-1 pr-1">
                    <button
                        onClick={() => setSplitMode(splitMode === 'single' ? 'split' : 'single')}
                        className={`p-1.5 rounded-md text-muted-foreground hover:text-foreground transition-colors ${splitMode === 'split' ? 'bg-muted text-foreground' : ''}`}
                        title={splitMode === 'single' ? 'Split view' : 'Single view'}
                    >
                        {splitMode === 'single' ? <Columns2 className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
                    </button>
                </div>
            </div>

            {/* Terminal panes */}
            <div className={`flex-1 min-h-0 ${splitMode === 'split' ? 'grid grid-cols-2 gap-px bg-border/40' : 'flex'}`}>
                {visibleTerminals.map(term => (
                    <div key={term.id} className="min-h-0 min-w-0 bg-background">
                        <TerminalPanel
                            projectId={projectId}
                        />
                    </div>
                ))}
            </div>
        </div>
    );
};
```

- [ ] **Step 2: Add Terminal to NAV_ITEMS and panelContent in ProjectWorkspace**

In `ProjectWorkspace.tsx`, add to imports:
```tsx
import { TerminalTab } from './TerminalTab';
import { Terminal } from 'lucide-react'; // add to existing lucide import
```

Update NAV_ITEMS:
```tsx
const NAV_ITEMS: NavItem[] = [
    { id: 'command-center', label: 'Command Center', icon: Rocket, description: 'Project cockpit' },
    { id: 'agent', label: 'Agent', icon: Bot, description: 'AI assistant' },
    { id: 'terminal', label: 'Terminal', icon: Terminal, description: 'Shell access' },
    { id: 'workspace', label: 'Workspace', icon: ScrollText, description: 'Notes & knowledge' },
    { id: 'settings', label: 'Settings', icon: Settings, description: 'Configuration' },
];
```

Update `panelContent` useMemo — add the terminal case:
```tsx
case 'terminal':
    return <TerminalTab projectId={project.id} projectPath={project.path} />;
```

- [ ] **Step 3: Add Cmd+T shortcut for new terminal tab**

In the keydown handler, add:
```tsx
if ((e.metaKey || e.ctrlKey) && e.key === 't') {
    e.preventDefault();
    setActiveTab('terminal');
}
```

Update Cmd+1-5 mapping to account for the new tab.

- [ ] **Step 4: Verify — Terminal tab visible, can open shell, type commands, see output. Split view works.**

---

## Task 5: Fix Process Output Memory Leak

**Context:** `ProcessSession.history` is `Arc<Mutex<String>>` that grows unboundedly as process output accumulates. A long-running dev server can consume gigabytes of memory.

**Files:**
- Modify: `src-tauri/src/modules/processes/models.rs` (line 20)
- Modify: `src-tauri/src/modules/processes/service.rs` (lines 54-66, 139-147)

- [ ] **Step 1: Add a RingBuffer to models.rs**

Replace the unbounded String with a capped ring buffer:

```rust
use std::collections::VecDeque;

const MAX_HISTORY_BYTES: usize = 1_048_576; // 1MB cap

pub struct OutputBuffer {
    chunks: VecDeque<String>,
    total_bytes: usize,
}

impl OutputBuffer {
    pub fn new() -> Self {
        Self { chunks: VecDeque::new(), total_bytes: 0 }
    }

    pub fn push(&mut self, data: &str) {
        let len = data.len();
        self.chunks.push_back(data.to_string());
        self.total_bytes += len;
        while self.total_bytes > MAX_HISTORY_BYTES {
            if let Some(removed) = self.chunks.pop_front() {
                self.total_bytes -= removed.len();
            } else {
                break;
            }
        }
    }

    pub fn to_string(&self) -> String {
        self.chunks.iter().cloned().collect()
    }
}
```

- [ ] **Step 2: Update ProcessSession to use OutputBuffer**

```rust
pub struct ProcessSession {
    pub pty_pair: PtyPair,
    pub process: Box<dyn portable_pty::Child>,
    pub running: bool,
    pub history: Arc<Mutex<OutputBuffer>>, // was: Arc<Mutex<String>>
    pub command: String,
    pub cwd: String,
    pub writer: Arc<Mutex<Box<dyn Write + Send>>>,
}
```

- [ ] **Step 3: Update service.rs push and read operations**

In `start_process()` output reader thread:
```rust
// Replace: lock.push_str(&data);
// With: lock.push(&data);
```

In `get_history()`:
```rust
// Replace: Ok(lock.clone())
// With: Ok(lock.to_string())
```

- [ ] **Step 4: Verify — start a process, let it run for a while, memory stays bounded.**

---

## Task 6: Fix write_to_process

**Context:** The `write_to_process` command exists in both commands.rs and service.rs. Need to verify it compiles and works, then test from the UI.

**Files:**
- Verify: `src-tauri/src/modules/processes/commands.rs` (lines 26-34)
- Verify: `src-tauri/src/modules/processes/service.rs` (lines 104-111)
- Modify: `src/components/Workspace/ProjectTerminal.tsx` (if write_to_process calls fail)

- [ ] **Step 1: Verify backend compiles with write_to_process**

Run `cargo check` and check if `write_to_process` has any compilation errors. The function signature should be:
```rust
#[command]
pub async fn write_to_process(state: State<'_, ProcessState>, id: String, data: String) -> Result<(), String> {
    let service = ProcessService::new(state.inner().clone());
    service.write(&id, &data).map_err(|e| e.to_string())
}
```

- [ ] **Step 2: If trait bounds issue exists, fix by adding Send + Sync bounds**

The typical fix for portable-pty trait bounds:
```rust
// In service.rs write() method:
pub fn write(&self, id: &str, data: &str) -> anyhow::Result<()> {
    let state = self.state.lock().map_err(|e| anyhow::anyhow!("Lock poisoned: {e}"))?;
    let session = state.get(id).ok_or_else(|| anyhow::anyhow!("Process not found: {id}"))?;
    let mut writer = session.writer.lock().map_err(|e| anyhow::anyhow!("Writer lock: {e}"))?;
    writer.write_all(data.as_bytes())?;
    writer.flush()?;
    Ok(())
}
```

- [ ] **Step 3: Test from frontend — open a terminal process, type into it.**

---

## Task 7: Input Validation Audit

**Context:** Several Tauri commands accept user input without validation. Add length limits, character validation, and sanitization at every system boundary.

**Files:**
- Modify: `src-tauri/src/modules/projects/commands.rs`
- Modify: `src-tauri/src/modules/databases/commands.rs`
- Modify: `src-tauri/src/modules/knowledge/commands.rs`
- Modify: `src-tauri/src/modules/processes/commands.rs`

- [ ] **Step 1: Create a shared validation module**

Create validation helpers in `src-tauri/src/shared/`:

```rust
// In src-tauri/src/shared/validation.rs
use crate::shared::error::AppError;

const MAX_NAME_LEN: usize = 256;
const MAX_CONTENT_LEN: usize = 1_000_000; // 1MB
const MAX_PATH_LEN: usize = 4096;
const MAX_QUERY_LEN: usize = 100_000;

pub fn validate_name(name: &str, field: &str) -> Result<(), AppError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(AppError::Validation(format!("{field} cannot be empty")));
    }
    if trimmed.len() > MAX_NAME_LEN {
        return Err(AppError::Validation(format!("{field} exceeds {MAX_NAME_LEN} characters")));
    }
    Ok(())
}

pub fn validate_path(path: &str) -> Result<(), AppError> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(AppError::Validation("Path cannot be empty".into()));
    }
    if trimmed.len() > MAX_PATH_LEN {
        return Err(AppError::Validation(format!("Path exceeds {MAX_PATH_LEN} characters")));
    }
    // Block path traversal
    if trimmed.contains("..") {
        return Err(AppError::Validation("Path must not contain '..'".into()));
    }
    Ok(())
}

pub fn validate_content(content: &str, field: &str) -> Result<(), AppError> {
    if content.len() > MAX_CONTENT_LEN {
        return Err(AppError::Validation(format!("{field} exceeds 1MB limit")));
    }
    Ok(())
}

pub fn validate_id(id: &str) -> Result<(), AppError> {
    if id.trim().is_empty() {
        return Err(AppError::Validation("ID cannot be empty".into()));
    }
    if id.len() > 128 {
        return Err(AppError::Validation("ID exceeds 128 characters".into()));
    }
    Ok(())
}

pub fn validate_shell_command(command: &str) -> Result<(), AppError> {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return Err(AppError::Validation("Command cannot be empty".into()));
    }
    // Block obvious dangerous patterns
    let blocked = ["rm -rf /", "rm -rf /*", "mkfs.", "dd if=", "> /dev/sd", ":(){ :|:& };:"];
    let lower = trimmed.to_lowercase();
    for pattern in blocked {
        if lower.contains(pattern) {
            return Err(AppError::Validation(format!("Blocked dangerous command pattern: {pattern}")));
        }
    }
    Ok(())
}
```

- [ ] **Step 2: Register the module in shared/mod.rs**

```rust
pub mod validation;
```

- [ ] **Step 3: Add validation to project commands**

In `projects/commands.rs`:
```rust
use crate::shared::validation::{validate_name, validate_path};

// In create_project:
validate_name(&name, "Project name").map_err(|e| e.to_string())?;
validate_path(&path).map_err(|e| e.to_string())?;
```

- [ ] **Step 4: Add validation to database commands**

In `databases/commands.rs`:
```rust
use crate::shared::validation::{validate_name, validate_id};

// In create_connection:
validate_name(&name, "Connection name").map_err(|e| e.to_string())?;
```

- [ ] **Step 5: Add validation to knowledge commands**

In `knowledge/commands.rs`:
```rust
use crate::shared::validation::{validate_name, validate_content};

// In create_knowledge_node:
validate_name(&title, "Node title").map_err(|e| e.to_string())?;
validate_content(&content, "Node content").map_err(|e| e.to_string())?;
```

- [ ] **Step 6: Add validation to process commands**

In `processes/commands.rs`:
```rust
use crate::shared::validation::{validate_shell_command, validate_path};

// In start_process:
validate_shell_command(&command).map_err(|e| e.to_string())?;
validate_path(&cwd).map_err(|e| e.to_string())?;
```

- [ ] **Step 7: Verify — `cargo clippy -- -D warnings` passes clean**

---

## Task 8: Verify MCP Server End-to-End

**Context:** The MCP server binary exists and has 7 tools implemented. Token auth uses the vault. Need to verify it actually works with Claude Code.

**Files:**
- Verify: `src-tauri/src/mcp_server.rs`
- Verify: `src-tauri/src/modules/mcp/service.rs`

- [ ] **Step 1: Build the MCP binary**

```bash
cd src-tauri && cargo build --release --bin orbitae-mcp
```

Verify: binary exists at `src-tauri/target/release/orbitae-mcp`

- [ ] **Step 2: Get the auth token**

Open Orbitae, go to a project's Settings, find the MCP section. Copy the token. Or get it from keychain:
```bash
security find-generic-password -s "com.orbitae.app" -a "mcp-auth-token" -w
```

- [ ] **Step 3: Test MCP server manually**

```bash
ORBITAE_MCP_TOKEN=<token> ./src-tauri/target/release/orbitae-mcp
```

Should start without error and accept JSON-RPC on stdio.

- [ ] **Step 4: Generate Claude Code config and test**

Get config from the app (Settings > MCP), add to Claude Code's config, verify tools appear.

- [ ] **Step 5: Document any issues found and fix**

---

## Phase 1 Complete — Verification

After all 8 tasks:

- [ ] `grep -rn "console\.\(log\|error\|warn\)" src/ --include="*.ts" --include="*.tsx"` — 0 results (except logger.ts)
- [ ] `grep -rn "config\[.password.\]" src-tauri/src/` — 0 results
- [ ] `cargo clippy -- -D warnings` — passes
- [ ] `npx tsc -b --noEmit` — passes
- [ ] `npm run tauri build` — produces Orbitae.app + DMG
- [ ] Open app, import project, full-screen workspace, all 5 tabs work
- [ ] Terminal tab: open shell, type commands, split view
- [ ] Agent: configure provider, chat, tools work
- [ ] Knowledge graph: visible edges, fills space
- [ ] Secrets: biometric prompt on reveal
- [ ] DB: password stored in vault, not SQLite
- [ ] MCP: Claude Code connects and queries
