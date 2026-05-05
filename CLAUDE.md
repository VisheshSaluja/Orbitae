# Orbitae — CLAUDE.md

## Product Identity

**Orbitae** is an AI-native developer command center — a native desktop app (Tauri v2 = Rust + React) where developers and their AI agents manage projects, terminals, databases, secrets, and workflows in one workspace. The product serves both individual developers and teams.

**Positioning:** "The AI-native command center where developers and their agents ship together."

**Key references:**
- Product spec: `docs/PRODUCT.md`
- Architecture: `docs/ARCHITECTURE.md`
- Brainstorm log: `docs/BRAINSTORM.md`
- Competitive analysis: `docs/COMPETITIVE.md`
- Roadmap: `docs/ROADMAP.md`

---

## Code Quality Standards

This project targets **FAANG staff-engineer caliber code**. Every file merged should be production-grade.

### General Principles

- No hardcoded values — use constants, configuration, or environment variables
- No `any` types in TypeScript — ever. Use `unknown` and narrow, or define proper interfaces
- No `println!()` in Rust — use `tracing` crate with structured logging
- No `unwrap()` in Rust production code — use `?` operator with proper error types
- No `console.log` in production TypeScript — use a logging utility or remove before commit
- Every public function in Rust must have a doc comment
- Every React component must have typed props (no inline object types for complex props)

### Architecture Patterns

**Rust Backend:**
- **Layered architecture:** Commands → Service → Repository
- Commands handle Tauri IPC, validate input, delegate to services
- Services contain business logic, never touch the database directly
- Repositories handle all database operations with parameterized queries
- Custom error types per module — never return raw `String` errors from commands
- Use `thiserror` for error definitions, `anyhow` only in application-level code

**React Frontend:**
- **Component hierarchy:** Pages → Features → Components → UI primitives
- State management via Zustand stores — one store per domain
- All Tauri IPC calls go through typed wrapper functions in `src/lib/tauri.ts`
- Use React Error Boundaries around every major panel
- Memoize expensive computations with `useMemo` and callbacks with `useCallback`
- Extract hooks for reusable logic (`useProject`, `useProcesses`, etc.)

### Security Requirements

- All SQL queries MUST use parameterized bindings — never string interpolation
- Secrets MUST be stored in the system keychain via the Vault module — never in SQLite
- Database connection passwords MUST go through the Vault, not stored in JSON
- User-provided commands MUST be validated before shell execution
- CSP MUST NOT include `unsafe-eval` — configure Tauri bundler appropriately
- All file paths MUST be validated against a project sandbox — no arbitrary filesystem access
- Input validation at every system boundary (Tauri commands, IPC, external APIs)

### Testing Requirements

- Rust: Unit tests for all service and repository methods
- Rust: Integration tests for Tauri command handlers
- TypeScript: Vitest + React Testing Library for components with business logic
- No test should depend on external state (databases, network, filesystem)
- Test names describe behavior, not implementation: `"returns_error_when_project_path_does_not_exist"`

### Naming Conventions

- **Rust:** snake_case for functions/variables, PascalCase for types/structs, SCREAMING_SNAKE for constants
- **TypeScript:** camelCase for functions/variables, PascalCase for components/types/interfaces, SCREAMING_SNAKE for constants
- **Files:** Rust: snake_case.rs. TypeScript: PascalCase.tsx for components, camelCase.ts for utilities
- **Tauri commands:** snake_case matching the Rust function name
- **Database columns:** snake_case
- **CSS classes:** Tailwind utility classes only — no custom CSS unless absolutely necessary

### Git Conventions

- Conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`
- One logical change per commit
- PR descriptions must explain WHY, not WHAT

### Dependencies

- Prefer well-maintained, minimal dependencies over large frameworks
- Every new dependency must be justified — "does this save us from writing 100+ lines of non-trivial code?"
- Pin exact versions in Cargo.toml, use lockfile for npm
- No Electron. Tauri only.

---

## Tech Stack (Do Not Change Without Discussion)

| Layer | Technology | Why |
|-------|-----------|-----|
| Desktop framework | Tauri v2 | Native performance, <50MB RAM, Rust security |
| Backend language | Rust | Memory safety, performance, type system |
| Frontend framework | React 19 | Ecosystem, component model, hiring pool |
| Build tool | Vite | Fast HMR, ESM-native |
| State management | Zustand | Minimal boilerplate, TypeScript-friendly |
| UI components | shadcn/ui + Radix | Accessible, composable, themeable |
| Styling | Tailwind CSS v4 | Utility-first, consistent, no CSS drift |
| Database (local) | SQLite via SQLx | Local-first, zero config, reliable |
| Terminal emulation | xterm.js + portable-pty | Real PTY, cross-platform |
| Rich text editor | TipTap | Extensible, Notion-like UX |
| Whiteboard | Excalidraw | Best-in-class canvas |
| Icons | Lucide React | Consistent, tree-shakeable |
| Logging (Rust) | tracing | Structured, async-friendly |
| Error handling (Rust) | thiserror + anyhow | Typed errors + ergonomic propagation |

---

## Project Structure

```
src/                          # React frontend
  components/
    layout/                   # App shell, navigation
    Workspace/                # Project workspace panels
    ui/                       # shadcn/Radix primitives
  features/                   # Feature-specific modules
  hooks/                      # Shared React hooks
  lib/                        # Utilities, Tauri IPC wrappers
  stores/                     # Zustand stores
  types/                      # TypeScript interfaces

src-tauri/                    # Rust backend
  src/
    modules/                  # Feature modules (commands/service/repo/models)
    database/                 # SQLite pool + migrations
    shared/                   # Cross-cutting utilities
  migrations/                 # SQLx migration files

docs/                         # Product & architecture documentation
website/                      # Next.js marketing site
```

---

## Common Commands

```bash
# Development
npm run tauri dev              # Start desktop app in dev mode
npm run build                  # Build frontend
npm run tauri build            # Build production desktop app

# Database
cd src-tauri && sqlx migrate run    # Run migrations
cd src-tauri && sqlx migrate add <name>  # Create new migration

# Testing
cargo test                     # Run Rust tests
npm run test                   # Run frontend tests (when configured)

# Linting
cargo clippy -- -D warnings    # Rust linting
npm run lint                   # TypeScript/React linting
```

---

## Current State (May 2026)

- Version: 0.1.14 (alpha)
- Status: Pre-revenue, revamping for production launch
- Single developer: Vishesh Saluja
- 46 commits, ~8,800 lines of code
- macOS primary, Windows/Linux via Tauri cross-compilation
- Not code-signed yet (requires Apple Developer Certificate)
