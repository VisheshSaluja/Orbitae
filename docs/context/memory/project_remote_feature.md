---
name: project_remote_feature
description: "Remote access to the WHOLE local dev environment (codebase, DBs, terminals, agents) from any device — local-first. IN v1. Not a Codex/Claude-mobile derivative."
metadata: 
  node_type: memory
  type: project
  originSessionId: 12eb007e-eeb2-446e-9ce5-198f501cf6a6
---

**IN v1 (founder decision 2026-08-16).** NOT a Codex/Claude-mobile derivative —
those remote-control an *agent session*. This exposes the developer's **entire
local development environment** — codebase, **complex databases**, terminals, the
running setup, and the agent build-loop — to **any device**, with **compute + data
staying on the user's own machine** (local-first).

**Refined design (2026-08-16): PER-PROJECT BLACK BOX, not the whole machine.** A
button on a project **containerizes/sandboxes just THAT project + its attached
resources** (codebase, its Postgres, its scope/manifest) and hosts the box wherever
the user wants (their laptop, or an external device like a **DGX Spark**). It
generates **ephemeral credentials + a QR code**; scanning opens a **web app for that
project**; the user can **SSH into the sandbox (not the host)** and access the
project's DB + codebase, limited to that project's declared scope. Compute + data
stay on the user's own hardware (local-first). Technically ≈ a **self-hosted,
single-project Codespace on your own hardware** — nobody offers exactly this (cloud
IDEs put data in their cloud; agent-mobile apps don't give DB/terminal/codebase).
The per-project sandbox is what makes it BOTH differentiated AND responsible to
build. (Do NOT dismiss as commoditized — that only applied to "mobile agent
steering.")

**Two crux problems to solve (founder flagged):** (1) **one-button hosting** — the
hard dependency is a container runtime (Docker/Podman on Linux/DGX; macOS has no
native containers → needs Docker Desktop/OrbStack/Lima; require/detect/bundle). Also
needs a formal **project manifest** (DB conn, env, ports, runtime, boundary) the
container is built from. (2) **the web app on phone/iPad = the chat shell rendered
responsively** (conversation-first on phone; terminal/DB/code panels on iPad/laptop)
— which is WHY the chat shell must be built first.

**#1 concern = SECURITY (load-bearing, not a tagline).** The per-project black box
is what makes it defensible: a breach hits the SANDBOX, not the whole machine.
Honest caveats: a container is a good boundary, NOT a perfect one (shared kernel →
escape via privileged/host-mounts/exposed-docker-socket/kernel bug) → rules: no
`--privileged`, drop caps, user namespaces, no host mounts beyond the project, never
expose the Docker socket; microVM (Firecracker/gVisor/Kata) is the real isolation =
Phase 2. SSH = key-only, ephemeral keypair provisioned into the container, no
passwords, restricted shell, never open to the internet without auth. DB = project's
scoped role only. QR carries endpoint + short-lived REVOCABLE token (never a
long-lived secret), TLS. One-button host must pair with one-button stop/revoke.
Never claim "unhackable" — frame as "sandboxed, project-scoped, ephemeral,
end-to-end encrypted." Eventually audit.

**Phasing:** v1 = **LAN-first** (same Wi-Fi; QR→local IP; scoped token; TLS) exposing
the build-loop conversation + codebase browsing + scoped DB viewer + terminal behind
strong auth (small attack surface, no open-internet exposure). Phase 2 =
**anywhere-access** via tunnel/relay + full interactive terminal/DB write + security
audit (paid-tier hook). **Build AFTER the chat-centric shell** — the web client
mirrors the same conversation + surfaces, so the shell must exist first (else built
twice). Scope reality: it's ~a second (web) client + secure server — real work; don't
let it crowd out the core loop. See [[project_positioning]].
