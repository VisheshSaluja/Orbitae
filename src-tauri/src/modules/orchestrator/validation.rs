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

/// Per-finding severity — assigned by the reviewer (contextual judgment), not a
/// hardcoded weight. Mirrors no-mistakes' error/warning taxonomy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Severity {
    /// A real defect — breakage, a bug, a security hole, or an intent mismatch.
    Error,
    /// A concern worth a look, but not clearly wrong.
    Warning,
}

impl Default for Severity {
    fn default() -> Self {
        // Absent/unclear severity is treated as the safer, higher one.
        Severity::Error
    }
}

/// A single review finding.
#[derive(Debug, Clone, Serialize)]
pub struct Finding {
    pub title: String,
    pub detail: String,
    pub severity: Severity,
    pub action: FindingAction,
    /// The file this finding is about — so the UI can pin it to the diff.
    pub file: Option<String>,
    /// A verbatim one-line snippet from the diff to anchor the finding to. We
    /// string-match this against the rendered diff rather than trusting an LLM
    /// line number (which is unreliable).
    pub anchor: Option<String>,
}

/// The validation report shown to the developer.
#[derive(Debug, Clone, Serialize)]
pub struct ValidationReport {
    pub checks: Vec<Check>,
    /// Findings the developer must judge (escalations). Auto-fixed ones are
    /// removed from here and listed in `auto_fixed` instead.
    pub findings: Vec<Finding>,
    /// Titles of the mechanical findings that were applied automatically.
    pub auto_fixed: Vec<String>,
    pub risk_level: RiskLevel,
    /// The objective conditions that determined the risk level — so it's
    /// explainable, not a mystery number.
    pub risk_reasons: Vec<String>,
    pub summary: String,
    /// The reviewed diff, so the UI can render findings anchored to the code.
    /// Capped to bound IPC size.
    pub diff: String,
}

/// Cap the diff shipped to the UI viewer. Generous enough for real reviews,
/// bounded so a huge change can't bloat the IPC payload.
const DIFF_VIEW_CAP: usize = 120_000;

/// Cap the number of findings the reviewer may return. The dominant failure
/// mode of AI review is noise burying the critical few — so we cap, and the
/// prompt tells the reviewer to prioritize.
const MAX_FINDINGS: usize = 12;

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

/// Snapshot the entire working tree (tracked + untracked, honoring `.gitignore`)
/// as a git tree object, WITHOUT touching the real index or working tree. Done
/// via a throwaway index file so the developer's staging area is untouched.
///
/// Captured at execution start, it lets validation diff the baseline against the
/// post-execution tree — so the review sees exactly what the run produced, with
/// newly-created files included and pre-existing uncommitted work excluded.
/// Returns `None` when this isn't a usable git repo.
pub fn snapshot_tree(cwd: &str) -> Option<String> {
    let idx = std::env::temp_dir().join(format!("orbitae-idx-{}", uuid::Uuid::new_v4()));
    let git = |args: &[&str]| {
        Command::new("git")
            .args(args)
            .current_dir(cwd)
            .env("GIT_INDEX_FILE", &idx)
            .output()
            .ok()
    };
    // Fresh empty index → `add -A` stages the whole working tree → `write-tree`
    // records it as a tree object (blobs are written to the object DB too).
    let added = git(&["add", "-A"]);
    let tree = git(&["write-tree"]);
    let _ = std::fs::remove_file(&idx);
    let (added, tree) = (added?, tree?);
    if !added.status.success() || !tree.status.success() {
        return None;
    }
    let sha = String::from_utf8_lossy(&tree.stdout).trim().to_string();
    (!sha.is_empty()).then_some(sha)
}

/// The diff execution produced — what we review. With a `base` tree captured at
/// execution start, diff that baseline against the current working tree; this
/// includes newly-created files and excludes pre-existing uncommitted work.
/// Without a baseline (older sessions, non-git repos), fall back to `git diff
/// HEAD` — tracked changes only, the pre-snapshot behavior.
fn working_diff(cwd: &str, base: Option<&str>) -> String {
    if let Some(base) = base {
        if let Some(current) = snapshot_tree(cwd) {
            let out = Command::new("git")
                .args(["diff", base, &current])
                .current_dir(cwd)
                .output();
            return out.map(|o| String::from_utf8_lossy(&o.stdout).to_string()).unwrap_or_default();
        }
    }
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
         security issues. IGNORE style nits, formatting, and naming — linters own \
         those; reporting them just buries the important findings. Report at most \
         {MAX_FINDINGS} findings, ranked most-severe first; if there are more \
         trivial issues, drop them.\n\n\
         Output ONLY a JSON object:\n\
         {{\"findings\":[{{\"title\":\"short\",\"detail\":\"why it's a problem\",\
         \"severity\":\"error\"|\"warning\",\"action\":\"auto_fix\"|\"escalate\",\
         \"file\":\"path/from/the/diff\",\"anchor\":\"a verbatim line copied from the diff\"}}]}}\n\
         - severity \"error\": a real defect — breakage, a bug, a security hole, or \
         a mismatch with the intent. severity \"warning\": a concern worth a look \
         but not clearly wrong.\n\
         - action \"escalate\" for anything touching intent or product behavior; \
         \"auto_fix\" only for mechanical, unambiguous fixes.\n\
         - \"file\" is the path the finding is about (from a diff header). \"anchor\" \
         is ONE line copied EXACTLY from the diff at the problem site, so it can be \
         located — omit it only if the finding isn't about a specific line.\n\
         If you genuinely find nothing wrong, return {{\"findings\":[]}}."
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
    #[serde(default)]
    severity: Severity,
    action: FindingAction,
    #[serde(default)]
    file: Option<String>,
    #[serde(default)]
    anchor: Option<String>,
}

/// Normalize an optional string field: trim and drop empties.
fn clean(s: Option<String>) -> Option<String> {
    s.map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
}

/// Parse the reviewer's findings JSON (tolerant of surrounding prose/fences).
/// Truncates to `MAX_FINDINGS` as a hard backstop against a noisy reviewer.
fn parse_findings(text: &str) -> Vec<Finding> {
    let json = match super::planner::lite::extract_json_object(text) {
        Some(j) => j,
        None => return Vec::new(),
    };
    serde_json::from_str::<FindingsWire>(&json)
        .map(|w| {
            w.findings
                .into_iter()
                .take(MAX_FINDINGS)
                .map(|f| Finding {
                    title: f.title,
                    detail: f.detail,
                    severity: f.severity,
                    action: f.action,
                    file: clean(f.file),
                    anchor: clean(f.anchor),
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Apply the mechanical (auto-fix) findings via a focused agent pass. Only the
/// listed fixes — nothing escalated, nothing else.
fn apply_autofixes(
    backend: &dyn AgentBackend,
    config: &SessionConfig,
    findings: &[&Finding],
) -> Result<()> {
    let list = findings
        .iter()
        .enumerate()
        .map(|(i, f)| format!("{}. {} — {}", i + 1, f.title, f.detail))
        .collect::<Vec<_>>()
        .join("\n");
    let prompt = format!(
        "Apply ONLY these specific mechanical fixes to the code. Make no other \
         changes, and do not touch anything not listed here.\n\n{list}\n\n\
         Apply them now, then reply with a one-line confirmation."
    );
    let convo = Conversation::start(backend, config.clone())?;
    let _ = convo.ask(&prompt)?;
    let _ = convo.stop();
    Ok(())
}

/// Assess risk **categorically** from objective conditions, returning the level
/// and the concrete reasons for it. No weighted numbers: each tier maps to a
/// verifiable fact, so the assessment is explainable and defensible.
///
/// - **High** — a deterministic check failed, or a blocking (`error`) escalation
///   exists. Both are objectively "must look."
/// - **Medium** — there's at least one escalation (a human decision to make).
/// - **Low** — checks pass and nothing was escalated.
fn assess_risk(checks: &[Check], findings: &[Finding]) -> (RiskLevel, Vec<String>) {
    let failed: Vec<&str> = checks.iter().filter(|c| !c.passed).map(|c| c.name.as_str()).collect();
    let blocking = findings
        .iter()
        .filter(|f| f.action == FindingAction::Escalate && f.severity == Severity::Error)
        .count();
    let escalations = findings.iter().filter(|f| f.action == FindingAction::Escalate).count();

    let mut reasons = Vec::new();
    if !failed.is_empty() {
        reasons.push(format!("check(s) failed: {}", failed.join(", ")));
    }
    if blocking > 0 {
        reasons.push(format!("{blocking} blocking finding(s)"));
    }

    let level = if !failed.is_empty() || blocking > 0 {
        RiskLevel::High
    } else if escalations > 0 {
        reasons.push(format!("{escalations} finding(s) to review"));
        RiskLevel::Medium
    } else {
        reasons.push("all checks passed, nothing flagged".to_string());
        RiskLevel::Low
    };
    (level, reasons)
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
    base_tree: Option<&str>,
    settings: &OrchestrationSettings,
) -> Result<ValidationReport> {
    let mut checks = run_checks(cwd);
    let diff = working_diff(cwd, base_tree);

    // The review runs when validation is on and there's an actual change to
    // judge. Cost is bounded (one pass, capped diff, the budget) — no arbitrary
    // size threshold deciding it.
    let run_review = settings.validation != ValidationMode::Off && !diff.trim().is_empty();

    let mut findings = if run_review {
        // A FRESH agent (not the author) reviews — that's what makes it honest.
        let convo = Conversation::start(backend, config.clone())?;
        let out = convo.ask(&build_review_prompt(intent, &diff))?;
        let _ = convo.stop();
        if out.is_error { Vec::new() } else { parse_findings(&out.text) }
    } else {
        Vec::new()
    };

    // Auto-fix the *mechanical* findings only — never anything escalated. Bounded
    // by the user's cap; re-runs the deterministic checks afterward to confirm
    // the fixes didn't break the build.
    let mut auto_fixed: Vec<String> = Vec::new();
    let fixable_titles: Vec<String> = findings
        .iter()
        .filter(|f| f.action == FindingAction::AutoFix)
        .map(|f| f.title.clone())
        .collect();
    if settings.max_autofix_cycles > 0 && !fixable_titles.is_empty() {
        let fixable: Vec<&Finding> =
            findings.iter().filter(|f| f.action == FindingAction::AutoFix).collect();
        let applied = apply_autofixes(backend, config, &fixable);
        drop(fixable);
        if applied.is_ok() {
            auto_fixed = fixable_titles;
            checks = run_checks(cwd); // re-verify after the edits
            findings.retain(|f| f.action != FindingAction::AutoFix);
        }
    }

    let (risk_level, risk_reasons) = assess_risk(&checks, &findings);
    let passed = checks.iter().filter(|c| c.passed).count();
    let summary = format!(
        "{}/{} checks passed; {} auto-fixed; {} to review.",
        passed,
        checks.len(),
        auto_fixed.len(),
        findings.iter().filter(|f| f.action == FindingAction::Escalate).count(),
    );

    // Ship the diff to the UI viewer so findings render anchored to the code.
    let diff_view: String = diff.chars().take(DIFF_VIEW_CAP).collect();

    Ok(ValidationReport {
        checks,
        findings,
        auto_fixed,
        risk_level,
        risk_reasons,
        summary,
        diff: diff_view,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn f(severity: Severity, action: FindingAction) -> Finding {
        Finding {
            title: "t".into(),
            detail: "d".into(),
            severity,
            action,
            file: None,
            anchor: None,
        }
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
    fn parses_findings_with_severity_and_anchor() {
        let text = "Here you go:\n```json\n{\"findings\":[\
            {\"title\":\"npe\",\"detail\":\"x can be null\",\"severity\":\"error\",\"action\":\"escalate\",\"file\":\"src/a.rs\",\"anchor\":\"let x = get();\"},\
            {\"title\":\"fmt\",\"detail\":\"spacing\",\"severity\":\"warning\",\"action\":\"auto_fix\"}]}\n```";
        let fs = parse_findings(text);
        assert_eq!(fs.len(), 2);
        assert_eq!(fs[0].severity, Severity::Error);
        assert_eq!(fs[0].action, FindingAction::Escalate);
        assert_eq!(fs[0].file.as_deref(), Some("src/a.rs"));
        assert_eq!(fs[0].anchor.as_deref(), Some("let x = get();"));
        assert_eq!(fs[1].severity, Severity::Warning);
        assert_eq!(fs[1].action, FindingAction::AutoFix);
        assert_eq!(fs[1].file, None); // absent → None, not empty string
    }

    #[test]
    fn findings_are_capped() {
        let items: Vec<String> = (0..(MAX_FINDINGS + 5))
            .map(|i| format!("{{\"title\":\"t{i}\",\"detail\":\"d\",\"action\":\"escalate\"}}"))
            .collect();
        let text = format!("{{\"findings\":[{}]}}", items.join(","));
        assert_eq!(parse_findings(&text).len(), MAX_FINDINGS);
    }

    #[test]
    fn missing_severity_defaults_to_error() {
        let fs = parse_findings("{\"findings\":[{\"title\":\"x\",\"detail\":\"y\",\"action\":\"escalate\"}]}");
        assert_eq!(fs[0].severity, Severity::Error);
    }

    #[test]
    fn empty_or_garbage_findings_are_none() {
        assert!(parse_findings("no json").is_empty());
        assert!(parse_findings("{\"findings\":[]}").is_empty());
    }

    #[test]
    fn failed_check_is_high_with_reason() {
        let (level, reasons) = assess_risk(&[failed("build")], &[]);
        assert_eq!(level, RiskLevel::High);
        assert!(reasons.iter().any(|r| r.contains("build")));
    }

    #[test]
    fn blocking_escalation_is_high() {
        let (level, _) = assess_risk(&[passed("build")], &[f(Severity::Error, FindingAction::Escalate)]);
        assert_eq!(level, RiskLevel::High);
    }

    #[test]
    fn warning_escalation_is_medium() {
        let (level, _) = assess_risk(&[passed("build")], &[f(Severity::Warning, FindingAction::Escalate)]);
        assert_eq!(level, RiskLevel::Medium);
    }

    #[test]
    fn clean_change_is_low_with_reason() {
        let (level, reasons) = assess_risk(&[passed("build"), passed("lint")], &[]);
        assert_eq!(level, RiskLevel::Low);
        assert!(reasons.iter().any(|r| r.contains("nothing flagged")));
    }

    /// The core diff fix: a snapshot taken before a change, diffed against the
    /// post-change tree, must (a) include a NEW untracked file and (b) exclude
    /// a pre-existing uncommitted edit. Uses real git + a temp dir — ignored by
    /// default (needs the binary + filesystem).
    #[test]
    #[ignore = "requires the git binary and filesystem; run with `--ignored`"]
    fn snapshot_diff_captures_only_the_run() {
        use std::fs;
        use std::process::Command;

        let dir = std::env::temp_dir().join(format!("orbitae-snap-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let cwd = dir.to_str().unwrap();
        let git = |args: &[&str]| Command::new("git").args(args).current_dir(cwd).output().unwrap();
        git(&["init", "-q"]);
        git(&["config", "user.email", "t@t"]);
        git(&["config", "user.name", "t"]);
        fs::write(dir.join("committed.txt"), "v1\n").unwrap();
        git(&["add", "-A"]);
        git(&["commit", "-qm", "init"]);

        // Pre-existing uncommitted WIP that the "run" did NOT touch.
        fs::write(dir.join("committed.txt"), "v1-wip\n").unwrap();

        // Baseline captured at execution start (includes the WIP).
        let base = snapshot_tree(cwd).expect("baseline snapshot");

        // The "run" creates a brand-new, never-added file.
        fs::write(dir.join("new.html"), "<h1>hi</h1>\n").unwrap();

        let diff = working_diff(cwd, Some(&base));
        assert!(diff.contains("new.html"), "new file must appear: {diff}");
        assert!(!diff.contains("committed.txt"), "untouched WIP must NOT appear: {diff}");

        fs::remove_dir_all(&dir).ok();
    }
}
