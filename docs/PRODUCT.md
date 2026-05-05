# Orbitae — Product Specification

> Last updated: 2026-05-05

## Vision

Orbitae is the AI-native command center for software developers. It replaces the daily juggle of 6+ disconnected tools (terminal, DB client, secrets manager, notes, git UI, process monitor) with a single native workspace — and adds an AI orchestration layer that no individual tool provides.

The core insight: **AI coding agents (Claude Code, Cursor, Codex) are powerful but blind.** They can't see your running services, query your database, check your secrets, or read your project notes. Orbitae gives them eyes and hands through MCP, making every AI tool smarter by connecting it to live project infrastructure.

## Target Users

### Primary: Individual Developers (Pro tier, $15/month)
- Full-stack developers running 2-5 services per project
- Developers using AI coding tools (Claude Code, Cursor, Windsurf)
- Privacy-conscious developers who prefer local-first tools
- Developers tired of context-switching between Terminal + TablePlus + 1Password + Notion + GitKraken

### Secondary: Small Teams (Team tier, $35/user/month)
- Engineering teams of 2-20 people
- Teams with complex local development environments
- Teams where onboarding takes days because of environment setup
- Teams using multiple AI coding tools and wanting shared context

### Tertiary: Enterprise (Custom pricing, future)
- Engineering orgs 20-200+ developers
- Companies needing audit logs, SSO, self-hosting
- Organizations standardizing AI-assisted development workflows

## Pricing Model

| Tier | Price | Users | Key Gates |
|------|-------|-------|-----------|
| **Free** | $0 | Solo devs exploring | 2 projects, basic panels (terminal, notes, git, snippets), no AI, no MCP |
| **Pro** | $15/month | Solo devs shipping | Unlimited projects, AI agent hub (BYOK), MCP server, playbooks, all panels, priority support |
| **Team** | $35/user/month | Small teams | Everything Pro + shared workspaces, team knowledge base, session sharing, integrations, admin controls |
| **Enterprise** | Custom | Large orgs | Everything Team + SSO/SAML, audit logs, self-hosted option, SLA, dedicated support |

### Revenue Targets
- Month 3 post-launch: 200 Pro users = $3,000/month ($36K ARR)
- Month 6: 500 Pro + 20 teams of 5 = $11,000/month ($132K ARR)
- Month 12: 1,500 Pro + 80 teams of 5 = $36,500/month ($438K ARR)

## Feature Set

### Tier: Free

| Feature | Description | Status |
|---------|-------------|--------|
| Project Management | Create, import, clone projects. Search, sort, organize. | Exists — needs polish |
| Terminal | Integrated xterm.js terminal with PTY backend per project | Exists — works well |
| Notes | Rich text (TipTap) + canvas (Excalidraw) notes per project | Exists — works well |
| Git Panel | Branch info, commit history, git graph visualization | Exists — needs polish |
| Snippets | Save and organize frequently used commands | Exists — works |
| Process Monitor | View running background processes | Exists — needs improvement |

### Tier: Pro ($15/month)

| Feature | Description | Status |
|---------|-------------|--------|
| AI Agent Hub | Multi-provider LLM chat with live project context injection | Partial — Ollama only, needs overhaul |
| MCP Server | Expose Orbitae as MCP server for external AI tools | Not started |
| Playbook Engine v2 | Visual DAG-based automation with health checks, parallel exec | Partial — basic version exists |
| Secrets Vault | OS keychain storage with biometric auth | Exists — works |
| Database Client | Connect to Postgres/MySQL/SQLite, browse tables, run queries | Exists — needs security fixes |
| Environment Manager | Profiles (dev/staging/prod), .env sync, secret interpolation | Not started |
| Launchpad | Quick-access links, commands, repo shortcuts | Exists — works |
| Script Runner | Run npm/Makefile scripts with process tracking | Exists — works |
| Activity Feed | Real-time project activity timeline | Not started |

### Tier: Team ($35/user/month)

| Feature | Description | Status |
|---------|-------------|--------|
| Team Workspaces | Shared project templates, snippets, playbooks | Not started |
| Shared Knowledge Base | Persistent project context accessible by AI agents and teammates | Not started |
| Session Sharing | Snapshot and share workspace state for handoffs | Not started |
| Incident Mode | Pre-configured debug workspace with log aggregation | Not started |
| Integrations | GitHub, Slack, Linear, Docker, cloud providers | Not started |
| Team Analytics | Development velocity, AI usage, environment health | Not started |

### Tier: Enterprise

| Feature | Description | Status |
|---------|-------------|--------|
| SSO/SAML | Enterprise identity provider integration | Not started |
| Audit Logs | Full activity audit trail | Not started |
| Self-Hosted | On-premise deployment option | Not started |
| Custom Integrations | API for custom tool integrations | Not started |

## Competitive Positioning

Orbitae is **not** an IDE (vs Cursor), **not** a terminal (vs Warp), **not** a DB client (vs TablePlus). It's the workspace that wraps around all of them — and the MCP bridge that makes AI agents aware of your live project infrastructure.

See `docs/COMPETITIVE.md` for detailed competitive analysis.

## Distribution Strategy

1. **Open source core** — Free tier features are open source. Builds trust, gets contributors, creates distribution.
2. **MCP-first adoption** — "Give Claude Code access to your databases and terminals" — viral among AI-tool users.
3. **Homebrew install** — `brew install orbitae` for zero-friction onboarding.
4. **Content marketing** — Build-in-public series, technical blog posts, demo videos.
5. **Community** — Discord for users, GitHub for contributors.
6. **Affiliate program** — 30% recurring commission for 12 months.

## Success Metrics

| Metric | Target (Month 6) | Target (Month 12) |
|--------|-------------------|---------------------|
| Downloads | 5,000+ | 25,000+ |
| Weekly Active Users | 500+ | 2,500+ |
| Pro subscribers | 500 | 1,500 |
| Team accounts | 20 | 80 |
| MCP connections/week | 1,000+ | 10,000+ |
| GitHub stars | 1,000+ | 5,000+ |
| Discord members | 500+ | 3,000+ |
| NPS score | 40+ | 50+ |
