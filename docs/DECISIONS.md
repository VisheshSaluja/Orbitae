# Orbitae — Decision Log

> Tracks architectural and product decisions with full context.
> For brainstormed ideas (accepted, rejected, deferred), see `BRAINSTORM.md`.
> This document covers implementation-level decisions made during development.

---

## How to Use This Document

When a non-obvious technical decision is made during development, log it here:

```
### DEC-XXX: [Short title]
**Date:** YYYY-MM-DD
**Status:** DECIDED / REVISITING / SUPERSEDED by DEC-YYY
**Context:** What problem we faced
**Decision:** What we chose
**Alternatives considered:** What else we looked at
**Consequences:** What this means going forward
```

---

## Decisions

### DEC-001: Tauri v2 over Electron
**Date:** 2024-12 (project inception)
**Status:** DECIDED
**Context:** Needed a desktop framework for a developer tool that manages terminals, databases, and secrets.
**Decision:** Tauri v2 with Rust backend.
**Alternatives considered:**
- Electron: Mature ecosystem but 500MB+ RAM baseline. Unacceptable for a tool positioning on native performance.
- Flutter Desktop: Dart backend limits access to system-level features (PTY, keychain).
- Native Swift/Kotlin: Platform-specific. Can't ship cross-platform from one codebase.
**Consequences:** Rust backend provides memory safety and performance. Smaller binary size (~15MB vs 150MB+ Electron). Trade-off: smaller Tauri ecosystem means more from-scratch work.

### DEC-002: SQLite over Postgres/cloud database
**Date:** 2024-12
**Status:** DECIDED
**Context:** Need persistent storage for project metadata, notes, settings.
**Decision:** SQLite via SQLx with compile-time checked queries.
**Alternatives considered:**
- Postgres: Overkill for local-first desktop app. Requires users to run a DB server.
- Embedded RocksDB/LMDB: No SQL interface. Would need custom query layer.
- JSON files: No relational queries, no ACID guarantees.
**Consequences:** Zero-config for users. Single file database. SQLx provides async support and compile-time query validation. Trade-off: no built-in sync — need custom sync layer for team features.

### DEC-003: Zustand over Redux/MobX
**Date:** 2024-12
**Status:** DECIDED
**Context:** Need state management for React frontend with async Tauri IPC calls.
**Decision:** Zustand.
**Alternatives considered:**
- Redux Toolkit: Too much boilerplate for this scale. Actions, reducers, slices for a desktop app with <20 state fields is over-engineering.
- MobX: Class-based observables feel dated in a hooks-first React 19 codebase.
- React Context: Causes unnecessary re-renders. Not suitable for frequently updating state.
**Consequences:** Minimal boilerplate. Direct async operations. Excellent TypeScript support. Easy to split into multiple stores as the app grows.

### DEC-004: Multi-provider AI with BYOK model
**Date:** 2026-05-05
**Status:** DECIDED
**Context:** Original implementation only supported local Ollama (requires separate install, huge friction). Need to support cloud providers.
**Decision:** Support OpenAI, Anthropic, Groq, and local Ollama. Users bring their own API keys, stored securely in Vault.
**Alternatives considered:**
- Proxy through our own API: Adds cloud dependency, costs, and latency. Violates local-first principle for individual users.
- Ollama only: Requires 4GB+ download and running a separate service. Kills onboarding.
- Ship a small local model: Model quality too low for useful orchestration.
**Consequences:** Users pay their own API costs (transparent). No cloud dependency for AI features. Need UI for provider/model selection. Need secure API key storage in Vault.

### DEC-005: MCP server via local socket (default)
**Date:** 2026-05-05
**Status:** DECIDED
**Context:** Need to expose Orbitae's capabilities to external AI tools (Claude Code, Cursor, etc.) via MCP.
**Decision:** Default to local Unix socket for MCP connections. Optional token-based auth for remote connections (team use case).
**Alternatives considered:**
- HTTP server: More compatible but exposes a network port. Security risk for a tool managing secrets.
- stdio only: Works for single-process clients but can't support multiple simultaneous connections.
**Consequences:** Zero-config for local use. Claude Code and Cursor can connect without network exposure. Remote connections (for team features) require explicit opt-in and token auth.

### DEC-006: Custom error types per module (thiserror)
**Date:** 2026-05-05
**Status:** DECIDED
**Context:** Current codebase returns `String` errors from Tauri commands. Loses error context and makes frontend error handling impossible.
**Decision:** Define `thiserror` error enum per module. Commands convert to `String` at the Tauri boundary only.
**Alternatives considered:**
- Single global error type: Gets bloated. Each module has different failure modes.
- anyhow everywhere: Good for applications but loses type information. Can't match on error variants.
- Result<T, serde_json::Value>: Structured but over-complex for IPC.
**Consequences:** Frontend can potentially parse error types for specific handling. Better logging with structured error chains. Each module owns its error surface.
