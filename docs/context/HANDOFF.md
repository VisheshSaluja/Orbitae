# Orbitae — Session Handoff & Context Backup

This folder preserves the working context that lives *outside* the code, so it
survives a Claude account migration (personal → Teams/Enterprise) or a machine
change. **The code itself is never at risk — it's all in this repo.** What was
at risk is (a) the Claude Code conversation sessions and (b) the assistant's
memory files. Both are handled here.

---

## 1. Resuming the actual Claude Code session

A Claude Code session is a **local file**, not account state. Account migration
does not migrate sessions, but it also can't delete the local files. Resume
reads the local `.jsonl`, so it works under any account you're logged into.

**Primary build session:** `12eb007e-eeb2-446e-9ce5-198f501cf6a6`

Sessions are keyed by the **absolute project path**. As long as this repo stays
at `/Users/vishesh/Desktop/Projects/Switchboard`, the session files live at:

```
~/.claude/projects/-Users-vishesh-Desktop-Projects-Switchboard/<session-id>.jsonl
```

### To resume (same machine, after migration)
```bash
cd /Users/vishesh/Desktop/Projects/Switchboard
claude --resume 12eb007e-eeb2-446e-9ce5-198f501cf6a6   # this exact session
# or:
claude --resume        # interactive picker of all sessions for this project
claude --continue      # jump straight into the most recent one
```

### If migration (or a reinstall) wiped `~/.claude/`
Restore the backup, then resume as above:
```bash
cp -R ~/Desktop/orbitae-claude-backup/. \
      ~/.claude/projects/-Users-vishesh-Desktop-Projects-Switchboard/
```

### On a different machine / different project path
The folder name is derived from the absolute path (`/` → `-`). Recreate the
matching folder for wherever the repo lives and drop the `.jsonl` files in:
```
~/.claude/projects/-<abs-path-with-slashes-as-dashes>/<session-id>.jsonl
```

> Full off-machine safety: copy `~/Desktop/orbitae-claude-backup/` to
> iCloud/Drive/an external disk. It is **not** committed to git (it may contain
> values mentioned mid-conversation). Keep it out of the repo.

---

## 2. Assistant memory (committed, in `./memory/`)

The `docs/context/memory/` folder is a copy of the assistant's project memory
(positioning, roadmap, decisions, working preferences). These are sanitized —
safe in git — and load the strategic context back into any fresh session. Start
here if resuming the transcript isn't possible; `memory/MEMORY.md` is the index.

---

## 3. Where the build is right now (2026-08-17)

Product: **Orbitae** — AI-native dev command center (Tauri v2: Rust + React 19).
The active work is the plan-first orchestration engine → conversational command
center. Three milestones on the agent layer:

- ✅ **Pass 1 — conversation-first reframe** *(done)*
  Per-project persistent multi-turn chat (`orchestrator_chat`, `ChatMap`);
  everything is chat by default; a plan is created **only** on explicit request
  ("make a plan…") or the composer's **Plan** button (`isPlanRequest`
  classifier in `SmartCommandStrip.tsx`).
- ⬜ **Pass 2 — parallel execution agents**
  Disjoint-file plan steps run concurrently, each in its own git worktree,
  merged back. Isolation is always-on; parallelism as-needed. Builds on the
  worktree primitive (`orchestrator/worktree.rs`).
- ⬜ **Pass 3 — multi-provider harness system**
  Connect multiple providers (Claude Code / Codex CLI / Gemini CLI / Aider /
  local via OpenAI-compatible endpoints). Providers UI (onboarding + settings),
  vault-stored connections, per-step provider+model routing. Seam:
  `AgentBackend` trait. Backend = **harness** (agentic loop) + **model**.
  BYO-keys/CLIs is the ToS-compliant path (no proxying subscription creds).

Also in v1 scope: **remote per-project sandbox** (one-button containerized
hosting of a single project — Podman/containerd, NOT Docker Desktop; scoped
SSH/DB/code; QR + ephemeral creds; LAN-first; mobile/tablet web app). See
`memory/project_remote_feature.md`.

**Hard constraints (persist across sessions):**
- I never commit or push — Vishesh does. I only provide commit messages.
- Never push environment variables anywhere.
- Staff-engineer / FAANG-grade code; secure, no bugs.
- Secrets via vault; parameterized SQL only; no secrets in plans/events/receipts.

---

## 4. Key architecture already built (engine)

- **Worktree isolation** — execution runs in a disposable git worktree at HEAD;
  `effective_cwd()` routes validate/apply/PR to it; startup cleanup of leaks.
- **Base-tree snapshot** — `snapshot_tree()` captures pre-run working state so
  review diffs only what the run produced (fixes "reviewed the wrong diff").
- **Evidence-based verification** — deterministic build/lint/type + **real**
  test execution with hard-timeout=FAIL; scope-drift / protected-path /
  test-tamper / oversized-diff guards; `ScopePolicy` boundary.
- **Diff-anchored review** — findings carry `file`+`anchor`, pinned to the diff
  (`DiffReview.tsx`), with highlight-to-comment annotations.
- **Evidence receipt** — intent · boundary · changed files · checks · findings ·
  verdict → PR body + Copy button.
- **Positioning** — the moat is deterministic **enforcement** (hold
  non-compliant AI changes before the PR), not agent self-verification (which
  research shows is unreliable). Verification/token-efficiency are *wedges*; the
  build-loop command center is the North Star. Details in
  `memory/project_positioning.md`.
