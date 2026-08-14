//! Configurable orchestration limits & budget — the user-owned token ceiling.
//!
//! Parsed from the project's `settings` JSON (`orchestration` object) with
//! conservative defaults, so it's cheap and safe out of the box and every cap is
//! adjustable. The budget (`max_tokens_per_run`) is a hard circuit breaker: when
//! a run reaches it, the orchestrator stops and escalates rather than spending
//! more — the accessibility moat as an actual guarantee.

use serde::{Deserialize, Serialize};

/// Which planner a task uses by default.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlannerMode {
    Lean,
    Gsd,
}

/// When validation (the adversarial review) runs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ValidationMode {
    /// Never run validation.
    Off,
    /// The user triggers it per plan (default — visible, in control).
    Manual,
    /// Run automatically after execution.
    Auto,
}

/// Coarse risk classification.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RiskLevel {
    Low,
    Medium,
    High,
}

/// The full set of user-configurable orchestration limits.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OrchestrationSettings {
    pub planner: PlannerMode,
    pub validation: ValidationMode,
    /// Adversarial review passes per validation (bounded loop).
    pub max_review_passes: u32,
    /// Independent reviewers (voters) — more for higher confidence on risky work.
    pub max_reviewers: u32,
    /// Auto-fix → recheck cycles allowed per issue before escalating.
    pub max_autofix_cycles: u32,
    /// Run the deep (LLM) review only at/above this risk level.
    pub risk_threshold: RiskLevel,
    /// Hard token ceiling for one run; reaching it stops and escalates.
    pub max_tokens_per_run: u64,
}

impl Default for OrchestrationSettings {
    fn default() -> Self {
        Self {
            planner: PlannerMode::Lean,
            validation: ValidationMode::Manual,
            max_review_passes: 1,
            max_reviewers: 1,
            max_autofix_cycles: 2,
            risk_threshold: RiskLevel::Medium,
            max_tokens_per_run: 200_000,
        }
    }
}

impl OrchestrationSettings {
    /// Parse from a project's settings JSON string, falling back to defaults for
    /// any missing field so partial/absent config always yields a valid, safe set.
    pub fn from_project_settings(settings_json: Option<&str>) -> Self {
        let defaults = Self::default();
        let value = match settings_json.and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok())
        {
            Some(v) => v,
            None => return defaults,
        };
        let orch = match value.get("orchestration") {
            Some(o) => o,
            None => return defaults,
        };

        let u32_at = |key: &str, d: u32| -> u32 {
            orch.get(key).and_then(|v| v.as_u64()).map(|v| v as u32).unwrap_or(d)
        };

        OrchestrationSettings {
            planner: match orch.get("planner").and_then(|v| v.as_str()) {
                Some("gsd") => PlannerMode::Gsd,
                Some("lean") => PlannerMode::Lean,
                _ => defaults.planner,
            },
            validation: match orch.get("validation").and_then(|v| v.as_str()) {
                Some("off") => ValidationMode::Off,
                Some("auto") => ValidationMode::Auto,
                Some("manual") => ValidationMode::Manual,
                _ => defaults.validation,
            },
            max_review_passes: u32_at("max_review_passes", defaults.max_review_passes).max(1),
            max_reviewers: u32_at("max_reviewers", defaults.max_reviewers).clamp(1, 5),
            max_autofix_cycles: u32_at("max_autofix_cycles", defaults.max_autofix_cycles),
            risk_threshold: match orch.get("risk_threshold").and_then(|v| v.as_str()) {
                Some("low") => RiskLevel::Low,
                Some("high") => RiskLevel::High,
                Some("medium") => RiskLevel::Medium,
                _ => defaults.risk_threshold,
            },
            max_tokens_per_run: orch
                .get("max_tokens_per_run")
                .and_then(|v| v.as_u64())
                .unwrap_or(defaults.max_tokens_per_run),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_conservative() {
        let d = OrchestrationSettings::default();
        assert_eq!(d.validation, ValidationMode::Manual);
        assert_eq!(d.max_review_passes, 1);
        assert_eq!(d.max_reviewers, 1);
        assert_eq!(d.risk_threshold, RiskLevel::Medium);
    }

    #[test]
    fn missing_or_absent_config_yields_defaults() {
        assert_eq!(OrchestrationSettings::from_project_settings(None), OrchestrationSettings::default());
        assert_eq!(
            OrchestrationSettings::from_project_settings(Some("{\"note_labels\":{}}")),
            OrchestrationSettings::default()
        );
        assert_eq!(
            OrchestrationSettings::from_project_settings(Some("not json")),
            OrchestrationSettings::default()
        );
    }

    #[test]
    fn partial_config_merges_over_defaults() {
        let json = serde_json::json!({
            "orchestration": { "validation": "auto", "max_tokens_per_run": 50000, "planner": "gsd" }
        })
        .to_string();
        let s = OrchestrationSettings::from_project_settings(Some(&json));
        assert_eq!(s.validation, ValidationMode::Auto);
        assert_eq!(s.max_tokens_per_run, 50_000);
        assert_eq!(s.planner, PlannerMode::Gsd);
        // untouched fields keep defaults
        assert_eq!(s.max_review_passes, 1);
    }

    #[test]
    fn reviewers_are_clamped() {
        let json = serde_json::json!({ "orchestration": { "max_reviewers": 99 } }).to_string();
        assert_eq!(OrchestrationSettings::from_project_settings(Some(&json)).max_reviewers, 5);
    }

    #[test]
    fn risk_levels_order() {
        assert!(RiskLevel::High > RiskLevel::Medium);
        assert!(RiskLevel::Medium > RiskLevel::Low);
    }
}
