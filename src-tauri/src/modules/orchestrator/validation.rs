//! Validation & evidence — the "no-mistakes"-style trust layer.
//!
//! Two bounded layers, cheap-first:
//! 1. **Deterministic checks** (build, lint) — real tools, zero tokens, hard
//!    evidence. Catch the mechanical majority.
//! 2. **One adversarial LLM review** — a *fresh* agent (not the author) inspects
//!    the diff against the intent and is prompted to find faults. Judgment only.
//!
//! A risk score is computed from both. The whole pass is structurally bounded
//! (finite stages, `max_review_passes` capped) so it can't spiral — and the
//! caller enforces the token budget.
//!
//! v1 surfaces findings + evidence + risk for the developer to act on; applying
//! auto-fixes and opening a PR are the next increments.

use std::path::Path;
use std::process::Command;

use serde::{Deserialize, Serialize};

use super::backend::{AgentBackend, SessionConfig};
use super::conversation::Conversation;
use super::error::Result;
use super::settings::{OrchestrationSettings, RiskLevel, ValidationMode};

/// A deterministic check result (build/lint/test).
#[derive(Debug, Clone, Serialize)]
pub struct Check {
    pub name: String,
    pub passed: bool,
    /// Trimmed tail of the tool output — the evidence.
    pub output: String,
}

/// Whether a finding can be auto-fixed or needs a human decision.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FindingAction {
    AutoFix,
    Escalate,
}

/// A single review finding.
#[derive(Debug, Clone, Serialize)]
pub struct Finding {
    pub title: String,
    pub detail: String,
    pub action: FindingAction,
}

/// The validation report shown to the developer.
#[derive(Debug, Clone, Serialize)]
pub struct ValidationReport {
    pub checks: Vec<Check>,
    pub findings: Vec<Finding>,
    pub risk_level: RiskLevel,
    /// 0–100.
    pub risk_score: u32,
    pub summary: String,
}

/// A deterministic check to run: a display name and a shell-free command.
struct CheckSpec {
    name: &'static str,
    program: &'static str,
    args: &'static [&'static str],
}

/// Detect the fast, deterministic checks appropriate for a project.
fn detect_checks(cwd: &str) -> Vec<CheckSpec> {
    let root = Path::new(cwd);
    let mut specs = Vec::new();
    if root.join("Cargo.toml").exists() {
        specs.push(CheckSpec { name: "build", program: "cargo", args: &["check", "--quiet"] });
        specs.push(CheckSpec { name: "lint", program: "cargo", args: &["clippy", "--quiet"] });
    }
    if root.join("package.json").exists() {
        // Type-check is the cheapest, most valuable JS/TS signal.
        specs.push(CheckSpec { name: "typecheck", program: "npx", args: &["tsc", "--noEmit"] });
    }
    specs
}

/// Run the detected deterministic checks, capturing pass/fail + output evidence.
fn run_checks(cwd: &str) -> Vec<Check> {
    detect_checks(cwd)
        .into_iter()
        .map(|spec| {
            let out = Command::new(spec.program).args(spec.args).current_dir(cwd).output();
            match out {
                Ok(o) => {
                    let mut text = String::from_utf8_lossy(&o.stderr).to_string();
                    if text.trim().is_empty() {
                        text = String::from_utf8_lossy(&o.stdout).to_string();
                    }
                    // Keep only the tail — evidence, not a firehose.
                    let tail: String = text.lines().rev().take(20).collect::<Vec<_>>()
                        .into_iter().rev().collect::<Vec<_>>().join("\n");
                    Check { name: spec.name.to_string(), passed: o.status.success(), output: tail }
                }
                Err(e) => Check {
                    name: spec.name.to_string(),
                    passed: false,
                    output: format!("could not run {}: {e}", spec.program),
                },
            }
        })
        .collect()
}

/// The working-tree diff produced by execution (what we're reviewing).
fn working_diff(cwd: &str) -> String {
    let out = Command::new("git").args(["diff", "HEAD"]).current_dir(cwd).output();
    out.map(|o| String::from_utf8_lossy(&o.stdout).to_string()).unwrap_or_default()
}

/// Build the adversarial review prompt: attack the change, don't rubber-stamp it.
fn build_review_prompt(intent: &str, diff: &str) -> String {
    // Cap the diff so a huge change can't blow the budget in one prompt.
    let diff: String = diff.chars().take(24_000).collect();
    format!(
        "You are an adversarial code reviewer. You did NOT write this change — your \
         job is to find what's wrong with it, not to approve it. Assume it is \
         flawed until proven otherwise.\n\n\
         INTENT (what the change was supposed to do):\n{intent}\n\n\
         DIFF:\n```diff\n{diff}\n```\n\n\
         Find real problems: bugs, missed edge cases, mismatches with the intent, \
         security issues. Ignore style nits already caught by linters. Output ONLY \
         a JSON object:\n\
         {{\"findings\":[{{\"title\":\"short\",\"detail\":\"why it's a problem\",\"action\":\"auto_fix\"|\"escalate\"}}]}}\n\
         Use \"escalate\" for anything touching intent or product behavior; \
         \"auto_fix\" only for mechanical, unambiguous fixes. If you genuinely find \
         nothing wrong, return {{\"findings\":[]}}."
    )
}

#[derive(Deserialize)]
struct FindingsWire {
    findings: Vec<FindingWire>,
}
#[derive(Deserialize)]
struct FindingWire {
    title: String,
    detail: String,
    action: FindingAction,
}

/// Parse the reviewer's findings JSON (tolerant of surrounding prose/fences).
fn parse_findings(text: &str) -> Vec<Finding> {
    let json = match super::planner::lite::extract_json_object(text) {
        Some(j) => j,
        None => return Vec::new(),
    };
    serde_json::from_str::<FindingsWire>(&json)
        .map(|w| {
            w.findings
                .into_iter()
                .map(|f| Finding { title: f.title, detail: f.detail, action: f.action })
                .collect()
        })
        .unwrap_or_default()
}

/// Compute a 0–100 risk score and level from checks, findings, and diff size.
fn compute_risk(checks: &[Check], findings: &[Finding], diff_lines: usize) -> (RiskLevel, u32) {
    let failed = checks.iter().filter(|c| !c.passed).count() as u32;
    let escalations = findings.iter().filter(|f| f.action == FindingAction::Escalate).count() as u32;
    let autofixes = findings.iter().filter(|f| f.action == FindingAction::AutoFix).count() as u32;

    let size_score = if diff_lines > 400 { 25 } else if diff_lines > 100 { 12 } else { 0 };
    let score = (failed * 35 + escalations * 20 + autofixes * 5 + size_score).min(100);

    // A failed deterministic check is never "low".
    let level = if score >= 60 || failed > 0 {
        RiskLevel::High
    } else if score >= 25 {
        RiskLevel::Medium
    } else {
        RiskLevel::Low
    };
    (level, score)
}

/// Run the bounded validation pass and return a report.
///
/// Cheap-first: deterministic checks always run; the (LLM) adversarial review
/// runs only when validation is enabled AND the preliminary risk (from the
/// checks + diff size) meets the user's `risk_threshold`. That gate is the token
/// saving — a clean, small change never pays for an LLM pass.
pub fn run_validation(
    backend: &dyn AgentBackend,
    config: &SessionConfig,
    cwd: &str,
    intent: &str,
    settings: &OrchestrationSettings,
) -> Result<ValidationReport> {
    let checks = run_checks(cwd);
    let diff = working_diff(cwd);
    let diff_lines = diff.lines().count();

    // Preliminary risk from deterministic signals only, to decide whether the
    // expensive review is worth running.
    let (prelim_level, _) = compute_risk(&checks, &[], diff_lines);
    let run_review = settings.validation != ValidationMode::Off
        && prelim_level >= settings.risk_threshold
        && !diff.trim().is_empty();

    let findings = if run_review {
        // A FRESH agent (not the author) reviews — that's what makes it honest.
        let convo = Conversation::start(backend, config.clone())?;
        let out = convo.ask(&build_review_prompt(intent, &diff))?;
        let _ = convo.stop();
        if out.is_error { Vec::new() } else { parse_findings(&out.text) }
    } else {
        Vec::new()
    };

    let (risk_level, risk_score) = compute_risk(&checks, &findings, diff_lines);
    let failed: Vec<&str> = checks.iter().filter(|c| !c.passed).map(|c| c.name.as_str()).collect();
    let summary = format!(
        "{} check(s), {} passed{}; {} finding(s), {} to review. Risk: {:?}.",
        checks.len(),
        checks.iter().filter(|c| c.passed).count(),
        if failed.is_empty() { String::new() } else { format!(" (failed: {})", failed.join(", ")) },
        findings.len(),
        findings.iter().filter(|f| f.action == FindingAction::Escalate).count(),
        risk_level,
    );

    Ok(ValidationReport { checks, findings, risk_level, risk_score, summary })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn f(action: FindingAction) -> Finding {
        Finding { title: "t".into(), detail: "d".into(), action }
    }
    fn passed(name: &str) -> Check {
        Check { name: name.into(), passed: true, output: String::new() }
    }
    fn failed(name: &str) -> Check {
        Check { name: name.into(), passed: false, output: "boom".into() }
    }

    #[test]
    fn review_prompt_is_adversarial() {
        let p = build_review_prompt("add auth", "diff here");
        assert!(p.to_lowercase().contains("adversarial"));
        assert!(p.to_lowercase().contains("did not write"));
        assert!(p.contains("add auth"));
    }

    #[test]
    fn parses_findings_json() {
        let text = "Here you go:\n```json\n{\"findings\":[\
            {\"title\":\"npe\",\"detail\":\"x can be null\",\"action\":\"escalate\"},\
            {\"title\":\"fmt\",\"detail\":\"spacing\",\"action\":\"auto_fix\"}]}\n```";
        let fs = parse_findings(text);
        assert_eq!(fs.len(), 2);
        assert_eq!(fs[0].action, FindingAction::Escalate);
        assert_eq!(fs[1].action, FindingAction::AutoFix);
    }

    #[test]
    fn empty_or_garbage_findings_are_none() {
        assert!(parse_findings("no json").is_empty());
        assert!(parse_findings("{\"findings\":[]}").is_empty());
    }

    #[test]
    fn failed_check_is_high_risk() {
        let (level, score) = compute_risk(&[failed("build")], &[], 10);
        assert_eq!(level, RiskLevel::High);
        assert!(score >= 35);
    }

    #[test]
    fn clean_small_change_is_low_risk() {
        let (level, _) = compute_risk(&[passed("build"), passed("lint")], &[], 8);
        assert_eq!(level, RiskLevel::Low);
    }

    #[test]
    fn escalations_raise_risk() {
        let (level, _) = compute_risk(&[passed("build")], &[f(FindingAction::Escalate), f(FindingAction::Escalate)], 20);
        assert!(level >= RiskLevel::Medium);
    }
}
