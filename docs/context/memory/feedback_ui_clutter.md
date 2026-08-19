---
name: UI Navigation Clutter
description: User flagged the 10-tab horizontal bar as too cluttered — needs redesign with grouping or sidebar
type: feedback
originSessionId: 12eb007e-eeb2-446e-9ce5-198f501cf6a6
---
The project workspace has 10 horizontal tabs (Overview, Launchpad, Agent, Scripts, Git, Keys, Snippets, Notes, Processes, Databases) which is too many for a single tab bar. The UI feels cluttered.

**Why:** Visual overload, hard to scan, doesn't scale as more features are added (Knowledge Graph panel, Environment Manager, Activity Feed are all coming).

**How to apply:** When building the UI revamp, consolidate navigation. Options:
- Sidebar with icon-only collapsed mode (like VS Code activity bar)
- Group tabs into categories: Core (Overview, Agent), Infra (Processes, Database, Keys), Dev (Git, Scripts, Launchpad), Content (Notes, Snippets, Knowledge)
- Consider a command palette (Cmd+K) as primary navigation with the sidebar as secondary
