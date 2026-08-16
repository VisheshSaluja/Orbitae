# Diff-Anchored Review — Design

**Date:** 2026-08-15
**Status:** Approved (implement)
**Supersedes the review *surface*, not the flow, of** `2026-08-12-plan-first-orchestration-design.md`.

## Problem

The validation review renders findings as a detached list of text cards
(`ValidationView`). A finding like *"in `process_job_background`'s except block…"*
references code the user cannot see. This is the anti-pattern both research
threads independently flagged:

- **Kun's "no-mistakes"** reviews locally *before* the PR, in a TUI where the
  developer **acts on each finding** in context (auto-fix applied / judgement
  escalated). The PR is the clean *output*, not the review venue. The human is
  the merge gate reviewing **evidence it works**.
- **The AI-review tool landscape** (CodeRabbit, Greptile, Graphite, Bugbot,
  Devin…) overwhelmingly **anchors findings to diff lines**, never a standalone
  card list — for code context, no tab-switching, and in-place actionability.
  The #1 abandonment cause is **noise**, countered with a severity floor + a
  per-review cap.

The conclusion for our product type (agentic tool reviewing its agents' own
diff before a human merges): **keep review-before-PR; fix the surface.**

## Design

One review engine over the diff we already capture (base-tree snapshot →
current). Render findings **anchored inline** on that diff, evidence-first,
capped.

### Backend (`validation.rs`)

- `Finding` gains `file: Option<String>` and `anchor: Option<String>` — the
  file the finding is about and a **verbatim one-line snippet** from the diff to
  pin it to (LLM line numbers are unreliable; a snippet we can string-match is
  robust).
- `ValidationReport` gains `diff: String` — the reviewed diff, so the frontend
  can render the viewer. Capped (`DIFF_VIEW_CAP`) to bound IPC.
- Review prompt: require `file` + `anchor` per finding; **cap at
  `MAX_FINDINGS`**; explicitly ignore style nits (linters own those).
- Severity floor: warnings render collapsed/secondary; errors lead.

### Frontend (`DiffReview.tsx`, replacing `ValidationView`)

- Minimal unified-diff parser (no new dependency): files → hunks → rows with
  new-file line numbers.
- **Evidence header first:** risk pill + reasons + deterministic checks
  (build/lint/typecheck) as the primary trust signal.
- Diff rendered per file; each finding pinned after the first row in its file
  whose text contains its `anchor` (else at the file header; findings with no
  file → a general list on top).
- Per-finding: severity chip, detail, and an **Ask** action (question the agent
  about it in context). Auto-fixed findings shown as resolved.

### Flow (unchanged)

execute → review (this surface) → **Create PR (clean output)**. PR stays last.

## Fast-follows (not this change)

- Mirror findings to GitHub as native PR review comments when a remote exists.
- Worktree isolation for execution (Kun's disposable worktree; our SP2).
- Test-suite as an evidence check (guarded against hangs).
- Per-finding one-click "Fix this" dispatching a focused fix agent.
