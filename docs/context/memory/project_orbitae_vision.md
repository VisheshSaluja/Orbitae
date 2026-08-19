---
name: Orbitae Product Vision & Strategy
description: Orbitae is an AI-native developer command center (Tauri/Rust/React). Repositioning from workspace manager to MCP bridge between AI agents and project infrastructure. Target $15/mo Pro, $35/user Team tier.
type: project
originSessionId: 12eb007e-eeb2-446e-9ce5-198f501cf6a6
---
Orbitae (formerly Switchboard) is being revamped from a developer workspace manager into an AI-native developer command center.

**Why:** The core insight is that AI coding agents (Claude Code, Cursor, Codex) are powerful but blind — they can't see running services, query databases, check secrets, or read project notes. Orbitae gives them eyes and hands through MCP.

**How to apply:** Every feature decision should be evaluated through the lens of: "Does this make Orbitae a better context bridge between developers, their AI agents, and their project infrastructure?" Pure workspace features are the foundation; AI + MCP integration is the differentiator.

Key priorities (in order):
1. Multi-provider AI Agent Hub (replace Ollama-only)
2. MCP Server (distribution play — every AI tool user becomes potential Orbitae user)
3. Playbook Engine v2 (one-click dev environment boot)
4. Security hardening + code quality
5. Team features (Phase 2)

Revenue model: Free (2 projects, basic panels) → Pro $15/mo (AI, MCP, playbooks) → Team $35/user/mo (shared workspaces, knowledge base)

Full docs in `docs/` directory: PRODUCT.md, ROADMAP.md, BRAINSTORM.md, COMPETITIVE.md, ARCHITECTURE.md, DECISIONS.md, MARKET.md
