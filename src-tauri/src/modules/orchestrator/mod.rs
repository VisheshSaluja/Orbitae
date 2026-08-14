//! Plan-first, human-in-the-loop orchestration engine.
//!
//! Turns a complex task into a reviewable, editable plan; iterates with the
//! developer until they confirm; then executes the approved plan. State is
//! persisted in Postgres as the source of truth so sessions are reconstructible
//! and (later) remotely steerable.
//!
//! See `docs/superpowers/specs/2026-08-12-plan-first-orchestration-design.md`.
//!
//! Build phases (see spec §11): [1] data layer (this) → [2] backend seam +
//! stream spike → [3] PlanSession + LitePlanner → [4] IPC + UI → [5] executor →
//! [6] skills + GSD.

pub mod backend;
pub mod commands;
pub mod conversation;
pub mod error;
pub mod models;
pub mod plan_ops;
pub mod planner;
pub mod session;
pub mod skills;
pub mod store;
