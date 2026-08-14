//! Skill registry — the pluggable, upgradable capabilities the orchestrator can
//! apply per phase.
//!
//! For now the catalog is the set of skills detected in the agent's environment
//! (GSD, ponytail). A DB-backed, user-editable registry (add/toggle/version)
//! lands with the persistence adapter; this in-memory catalog keeps the seam and
//! powers the Skills view today.

use super::models::{SkillDef, SkillPhase};

/// Built-in skills available to the orchestrator.
pub fn builtin_skills() -> Vec<SkillDef> {
    vec![
        SkillDef {
            id: "gsd".into(),
            name: "get-shit-done".into(),
            version: "1.x".into(),
            source: "~/.claude/skills/gsd-*".into(),
            phase: SkillPhase::Plan,
            backends: vec!["claude".into()],
            invocation: serde_json::json!({ "kind": "skill", "ref": "gsd-plan-phase" }),
            enabled: true,
        },
        SkillDef {
            id: "ponytail".into(),
            name: "ponytail".into(),
            version: "4.x".into(),
            source: "ponytail plugin".into(),
            phase: SkillPhase::Execute,
            backends: vec!["claude".into()],
            invocation: serde_json::json!({ "kind": "principle", "ref": "lean-execution" }),
            enabled: true,
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_has_gsd_and_ponytail() {
        let skills = builtin_skills();
        assert!(skills.iter().any(|s| s.id == "gsd" && s.phase == SkillPhase::Plan));
        assert!(skills.iter().any(|s| s.id == "ponytail"));
    }
}
