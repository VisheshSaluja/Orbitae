---
name: project_review_architecture
description: "Orchestrator review flow verdict — review-before-PR is correct; surface must be a diff-anchored in-app viewer, not a card list"
metadata: 
  node_type: memory
  type: project
  originSessionId: 12eb007e-eeb2-446e-9ce5-198f501cf6a6
---

The orchestrator's validation/review step: **review happens locally, before the
PR — that architecture is correct, keep it.** Verified by research (2026-08-15):

- Kun's "no-mistakes" reviews locally in a disposable worktree *before* the PR;
  the PR is the clean *output*, not the review venue. Findings acted on in a TUI
  (auto-fix applied / judgement escalated). Human = merge gate reviewing
  **evidence it works**, not line-by-line diffs.
- Industry (CodeRabbit/Greptile/Graphite/Bugbot) mostly posts to the GitHub PR,
  BUT explicitly carves out our case: an agentic tool reviewing its *own agents'*
  diff before a human merges belongs on the **review-then-PR** side (Amp/Cursor
  cloud agents). So do NOT move review onto the GitHub PR.

**Why:** the real defect was never the flow — it was the surface. Findings were a
detached list of text cards referencing code you couldn't see.

**How to apply:** review findings must be **anchored to the diff** (implemented in
`DiffReview.tsx` + `validation.rs` findings carry `file`/`anchor`, report carries
`diff`). Lead with **evidence** (checks). Cap findings + kill nitpicks (noise is
the #1 abandonment cause). PR stays the last, clean step (`pr.rs`, never merges).

Fast-follows (not yet built): mirror findings to GitHub PR comments when a remote
exists; worktree isolation for execution (SP2); test-suite as an evidence check
(guard against hangs); per-finding one-click "Fix this". See
[[project_orbitae_vision]]. Spec: `docs/superpowers/specs/2026-08-15-diff-anchored-review-design.md`.
