# Pre-PR Enforcement Gate — Design

**Date:** 2026-08-16
**Status:** Draft (for review)
**Positioning:** see `memory/project_positioning`. The moat is **deterministic
enforcement, not evidence-reporting.** Competitors report scope/test issues after
the fact; Orbitae must *hold* non-compliant changes at a gate and emit a
commit-bound receipt a CI check can re-verify.

**Claim this makes true:** *Any agent can write the patch. Orbitae proves it
stayed in scope, didn't weaken the tests, and passed the checks — before the PR.*

## The enforcement chain

approved boundary → isolate in worktree → lock protected paths → run + verify in a
fresh env → **gate (hold out-of-scope / tamper, don't just flag)** → commit-bound
receipt → **PR check fails if receipt ≠ commit.**

## Components

### 1. Explicit change boundary (approved, not inferred)
Today the plan carries loose optional per-step `files`. Upgrade to a first-class,
user-approved **boundary** on the plan:
- `allowed`: path globs the change may touch (default = union of step files).
- `protected`: paths that must NOT change without explicit approval — tests, CI
  config, lockfiles, `.env`, migrations (sensible per-ecosystem defaults, editable).
- `max_diff_lines`: optional cap.

Surfaced in the plan-review UI as an editable **Change boundary** block; approving
the plan approves the boundary. Persisted with the plan.

### 2. Worktree isolation
On execute: `git worktree add <tmp>` off HEAD; run every step subagent there; run
verification there in a **fresh process** (`CI=1`, no dev-server state). Disposable;
removed after the gate. Rationale: we **cannot** intercept an external CLI's writes
mid-flight — isolation gives a clean boundary to diff and gate before anything
touches the real working tree.

### 3. Protected-path lock
Snapshot content hashes of `protected` paths (and all test files) **before**
execution; recompute after. Any change to a protected/test path is a **lock
violation** — hard-blocked in strict mode, else an error finding requiring explicit
approval. (Backs the test-integrity claim deterministically, beyond the current
heuristic warning.)

### 4. The gate (enforcement, not reporting)
Compute the worktree diff vs the pre-exec snapshot and evaluate: scope-drift (vs
`allowed`), lock violations, deterministic checks (build/lint/type/**tests actually
run**), max-diff cap. Outcome by **mode** (per-project, extends `OrchestrationSettings`):
- **strict (no-mistakes):** any violation or failed check → **HELD** — the change
  cannot be shipped (PR creation is blocked) until the developer explicitly approves
  the specific violation or fixes it. *How "held" is realized:* Phase 1 blocks the
  PR while the change sits in the working tree for review/fix; Phase 2 (worktree)
  keeps it fully isolated so the working branch never sees a non-compliant change.
  Clean → merge to a branch + PR.
- **direct-PR:** always open the PR, but the receipt records violations and the PR
  check reflects them.
- **local-only:** never auto-PR; hold until the developer ships manually.

The existing `DiffReview` becomes the "review the held change" surface; scope-drift
and lock findings gain an explicit **"approve this exception"** action.

### 5. Commit-bound receipt + PR check
The receipt (already built) gains: **commit SHA**, the exact commands run + exit
codes + durations, the boundary, lock-hash results, and the verdict. Written into
the commit as `.orbitae/receipt.json` so it travels with the patch. A lightweight
**PR check** — a GitHub Action we ship, or an `orbitae verify` CLI — recomputes
diff-vs-boundary and re-hashes protected paths against the receipt and **FAILS if
they disagree** (receipt ≠ commit). This makes the gate tamper-evident in CI, not
just in-app.

## Flow changes
`execute` (now in worktree) → **gate (new)** → `validate`/review (in worktree, fresh
env) → on approve/clean: merge to branch + commit receipt + PR.

## Honest limits (adopt in copy)
- Enforcement is at the **gate**, not mid-flight write interception.
- Checks prove specific checks **ran and passed**, not semantic correctness or
  security. "Reproducible evidence you can inspect," not "proof it's safe."
- Provider inference still sends repo context to the configured agent's provider.

## ToS / agent-agnostic
Works over the `AgentBackend` seam; BYO API key / official SDK / the user's own
authenticated local CLI. **Never proxy a user's Claude Pro/Max subscription
credentials** (prohibited by Anthropic's terms).

## Phasing (build order)
1. **Boundary (editable/approved) + gate on the current tree + protected-path
   lock + modes.** Hold non-compliant changes on a `orbitae/held-<id>` branch so
   nothing lands on the working branch. Delivers enforcement fastest, no worktree
   yet.
2. **Worktree isolation** (fresh env, cleaner hold/merge-back).
3. **Commit-bound receipt file + `orbitae verify` CLI + GitHub Action check.**

## Open questions
- Boundary format: start with explicit paths + simple globs; richer (function/module
  boundaries, dependency restrictions) later.
- Protected-path defaults per ecosystem (tests, CI yml, lockfiles, `.env`, migrations).
- Phase-1 "held" storage: a held branch vs a stash — held branch preferred (nothing
  touches the working branch, reviewable, resumable).
