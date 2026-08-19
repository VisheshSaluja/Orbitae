---
name: project_positioning
description: "Orbitae's core strategy — reposition from \"agent command center\" to the independent, agent-agnostic verification/evidence layer (the \"trust receipt\")"
metadata: 
  node_type: memory
  type: project
  originSessionId: 12eb007e-eeb2-446e-9ce5-198f501cf6a6
---

**NORTH STAR (re-anchored 2026-08-16 after founder pushback):** the original
vision holds — **an integrated, plan-first, token-efficient environment for
building WITH agents (Kun's 8-tool workflow as one accessible app), with
verification built in.** Do NOT let market analyses narrow this into a me-too
"CI verification gate for teams." Verification + token-efficiency are the sharp
**WEDGES** that get users in the door; the efficient trustworthy build-loop is the
**destination**. They're one machine: confident agent-building REQUIRES trust
(Kun is fast *because* of his no-mistakes gate), and token predictability is a
real, unclaimed pain (Cursor/Claude billing-shock backlash).

Caution: successive GPT analyses keep optimizing for "defensible B2B SaaS" and
dropped **token efficiency** and **streamlined building** entirely — use them for
market facts, not to override the founder's conviction. Build the **solo-developer
build-loop** (plan-first + token budget + model tiering + verification gate) into a
coherent v1 = the vision scoped to one buyer. Teams/CLI/enterprise come AFTER it
proves out.

**Market facts still valid (from the analyses):** plan-mode + orchestration are
table stakes (Cursor/Claude Code/Codex/Factory/Augment Intent); pure enforcement
is crowded (Mault/Neurcode/Agentplane/etc.); so neither *alone* is the moat — the
combination (efficient build-loop + native verification + token predictability) is.

**Wedge positioning line (one entry point, not the whole product):** *Any agent can
write the patch. Orbitae proves it stayed in scope, didn't weaken the tests, and
actually passed the checks — before the PR.*

**The defensible chain (the category to own):** approved intent → authorized
scope → actual diff → **independently-executed** evidence → gate. The artifact is
an immutable, exportable **"trust receipt."** This converged from THREE
independent analyses (our two research threads + the user's ChatGPT market study).

**THE MOAT IS ENFORCEMENT, NOT EVIDENCE (refined 2026-08-16, 2nd ChatGPT pass).**
"Evidence" is already claimed by early competitors (Agentplane, Critique, AI Code
Guard, Legit VibeGuard — a forming, fragmented category; do NOT claim "nobody owns
this"). Defensible = **deterministic enforcement**: approve an explicit change
boundary → isolate the task in a **worktree** → **lock** protected tests/config →
out-of-scope or tamper changes are **held/blocked before the PR, not merely
reported** → **receipt bound to the exact commit + commands + config + outputs** →
**the PR check fails if receipt≠commit**. (Enforcement is at the GATE — we can't
intercept an external CLI's writes mid-flight; the worktree holds out-of-scope
changes until approved.)

**Build order (the wedge):**
1. ✅ Scope-drift detection (done)
2. **Commit-bound evidence receipt** ("trust receipt") — the enforceable artifact
3. **Explicit change boundary** — machine-readable, user-approved (allowed/forbidden
   files, protected test/config paths, max diff size), replacing loose NL `files`
4. **Enforcement gate + test/config lock** — hard-block PR on drift/tamper unless
   explicitly approved (Kun's no-mistakes/direct-PR/local-only modes); snapshot+hash
   protected tests → hard-block on change
5. **Worktree isolation** — run isolated; verification in a fresh env; boundary
   enforced at merge-back
6. Agent-agnostic proof; then headless CLI + GitHub required check + evidence badge

**CORRECTION:** worktree isolation + hard-blocking gates + frozen/locked tests are
BACK ON the critical path — as **enforcement** primitives (not speed). Only the
**parallel-agent fleet** stays deprioritized (that's the commoditized part). Go
Remote stays deprioritized — see [[project_remote_feature]]. Keep the Tauri desktop
app; ADD a CLI/CI layer.

**Honesty wording (adopt, don't overclaim):** NOT "proves safe / machine-proven /
faking success / ship on proof / keychain-free / your code stays on your machine /
reproducible receipt / isolated environment". USE "commit-bound, replayable
evidence receipt / isolated checkout / safer to review and ship / ship with
receipts / no credential custody". Tagline: **"The pre-PR integrity gate for
AI-written code."** In the UI, separate **mechanical gate (deterministic)** from
**model review (probabilistic)** from **human decision**. Publish a **capability
matrix**: universal guarantee = non-compliant work can't pass the PR gate;
write-time interception is adapter-dependent (Claude Code hooks can, arbitrary
CLIs can't).

**REFINED MOAT (3rd ChatGPT pass, 2026-08-16): enforcement alone is NOT the moat —
it's already crowded** (Mault, Neurcode, AgentSteer, Latchpoint, Agentplane,
Critique, VibeGuard) and the primitives (allowlists, hashing, GitHub required
checks, Sigstore attestations) are commodity. The durable moat is **"approval-to-
enforcement accuracy" — the policy compiler**: turn an approved plan into a
PRECISE, LOW-NOISE, enforceable boundary teams trust as a required check (low
false-block rate is the #1 retention/kill signal). **The paying TEAM product is the
CLI + GitHub required check, NOT the desktop app** (desktop = solo/demo/authoring).

**NEXT BUILD (the thin slice):** `orbitae verify` (deterministic mechanical gate +
commit-bound receipt, reuse the existing validation engine headless, exit non-zero
on violations) → GitHub Action bound to head SHA → required check. **Claude Code
first.** Then boundary-precision work. Pause remote, multi-agent fleet, other-agent
adapters, enterprise until ~10 paying design-partner teams. ICP: 3–15 devs, heavy
Claude Code, 5+ agent PRs/week, real tests + GitHub Actions. Founding program ~$99/mo
(don't give away free); standard ~$249–399/mo; ~40 teams ≈ $10k MRR.

**Market:** teams-first (3–20 devs, agencies, small SaaS) then serious solo devs.
Pricing ~ Free / $19 solo / $35–39 per-dev team / $99 founding-team. CodeRabbit
(~$1.5B val, review category) is the comp. **Auth model: BYO API keys / official
SDK / shell out to the user's own authenticated local CLI — NEVER proxy a user's
Claude Pro/Max subscription credentials (ToS).** Marketing hook: "the agent
reported 47 passing tests; Orbitae found it disabled 12 and blocks the PR."
See [[project_business_goal]], [[feedback_research_first]], [[project_review_architecture]].
