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

use std::io::Read;
use std::path::Path;
use std::process::Command;
use std::time::{Duration, Instant};

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

/// A deterministic check to run: a display name, a shell-free command, the
/// directory to run it in, a hard timeout, and exit codes to treat as "not
/// applicable" (e.g. pytest's 5 = no tests collected → drop the check).
struct CheckSpec {
    name: &'static str,
    program: &'static str,
    args: &'static [&'static str],
    dir: std::path::PathBuf,
    timeout_secs: u64,
    neutral_codes: &'static [i32],
}

/// Is a CLI tool available on PATH? (Avoids reporting "could not run X" as a
/// failed check when the tool simply isn't installed.)
fn tool_exists(program: &str) -> bool {
    Command::new(program).arg("--version").output().map(|o| o.status.success()).unwrap_or(false)
}

/// Run a check command with a **hard wall-clock timeout**. A timeout is a
/// FAILURE, never an implicit pass — a hung test is not a green test, and agents
/// reward-hack. Output is redirected to a temp file (no pipe-buffer deadlocks);
/// the process runs non-interactively (`CI=1`, no stdin) so watch-mode test
/// runners exit instead of hanging. `Some((passed, tail))`, or `None` when the
/// exit code is in `neutral` (the check doesn't apply).
fn run_timed(
    program: &str,
    args: &[&str],
    dir: &Path,
    timeout: Duration,
    neutral: &[i32],
) -> Option<(bool, String)> {
    let tmp = std::env::temp_dir().join(format!("orbitae-check-{}", uuid::Uuid::new_v4()));
    let out = match std::fs::File::create(&tmp) {
        Ok(f) => f,
        Err(e) => return Some((false, format!("could not create temp output: {e}"))),
    };
    let err = match out.try_clone() {
        Ok(f) => f,
        Err(e) => return Some((false, format!("io: {e}"))),
    };
    let mut child = match Command::new(program)
        .args(args)
        .current_dir(dir)
        .env("CI", "1")
        .env("NO_COLOR", "1")
        .stdin(std::process::Stdio::null())
        .stdout(out)
        .stderr(err)
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            let _ = std::fs::remove_file(&tmp);
            return Some((false, format!("could not run {program}: {e}")));
        }
    };

    let start = Instant::now();
    let timed_out = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Err(status),
            Ok(None) => {
                if start.elapsed() > timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    break Ok(());
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(_) => {
                let _ = child.kill();
                break Ok(());
            }
        }
    };

    let mut buf = String::new();
    if let Ok(mut f) = std::fs::File::open(&tmp) {
        let _ = f.read_to_string(&mut buf);
    }
    let _ = std::fs::remove_file(&tmp);
    let tail: String = buf
        .lines()
        .rev()
        .take(20)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join("\n");

    match timed_out {
        Ok(()) => Some((false, format!("timed out after {}s\n{tail}", timeout.as_secs()))),
        Err(status) => {
            if let Some(code) = status.code() {
                if neutral.contains(&code) {
                    return None;
                }
            }
            Some((status.success(), tail))
        }
    }
}

/// The new-side file paths a unified diff touches (`+++ b/<path>`).
fn changed_paths(diff: &str) -> Vec<String> {
    diff.lines()
        .filter_map(|l| l.strip_prefix("+++ b/"))
        .map(|p| p.trim().to_string())
        .collect()
}

/// Tolerant path equality — handles the plan declaring a partial path (`main.py`)
/// while the diff reports the full one (`backend/app/main.py`), and vice-versa.
fn path_matches(a: &str, b: &str) -> bool {
    let a = a.trim_start_matches("./");
    let b = b.trim_start_matches("./");
    a == b || a.ends_with(&format!("/{b}")) || b.ends_with(&format!("/{a}"))
}

/// Files the change touched that the plan never declared it would — scope drift.
/// Returns empty if the plan declared no scope at all (can't judge drift then).
fn scope_drift(changed: &[String], declared: &[String]) -> Vec<String> {
    if declared.is_empty() {
        return Vec::new();
    }
    changed
        .iter()
        .filter(|c| !declared.iter().any(|d| path_matches(c, d)))
        .cloned()
        .collect()
}

/// Sensitive paths that usually need explicit approval to change: CI/build
/// config, dependency lockfiles, secrets/env, and DB migrations. Touching these
/// is how a change can quietly alter security, dependencies, or data — so the
/// gate surfaces them. (Tests are handled separately by the tamper guard.)
fn is_protected_path(path: &str) -> bool {
    let p = path.to_lowercase();
    let file = p.rsplit('/').next().unwrap_or(&p);
    // CI / build pipeline config
    p.contains(".github/workflows/")
        || p.contains("/.circleci/")
        || file == ".gitlab-ci.yml"
        || file == "azure-pipelines.yml"
        || file == "jenkinsfile"
        // dependency lockfiles
        || file == "package-lock.json"
        || file == "yarn.lock"
        || file == "pnpm-lock.yaml"
        || file == "cargo.lock"
        || file == "poetry.lock"
        || file == "gemfile.lock"
        || file == "go.sum"
        // secrets / env
        || file.starts_with(".env")
        // database migrations
        || p.contains("/migrations/")
}

/// Heuristic: does this path look like a test file? Used by the tamper guard —
/// editing tests to force a green result is the single most common way agents
/// fake success, so a feature change that also edits tests warrants a look.
fn is_test_file(path: &str) -> bool {
    let p = path.to_lowercase();
    p.contains("/tests/")
        || p.contains("/test/")
        || p.contains("test_")
        || p.ends_with("_test.py")
        || p.ends_with("_test.go")
        || p.ends_with("_test.rs")
        || p.contains(".test.")
        || p.contains(".spec.")
        || p.ends_with("conftest.py")
}

/// Detect the fast, deterministic checks appropriate for a project. Scans the
/// repo root AND immediate subdirectories (monorepo `backend/` + `frontend/`
/// splits), but only runs a subproject's checks if the change actually touched
/// it — so unrelated pre-existing errors elsewhere can't produce false failures.
fn detect_checks(cwd: &str, changed: &[String]) -> Vec<CheckSpec> {
    let root = Path::new(cwd);
    let mut candidates: Vec<(String, std::path::PathBuf)> = vec![(String::new(), root.to_path_buf())];
    if let Ok(entries) = std::fs::read_dir(root) {
        for e in entries.flatten() {
            let p = e.path();
            if !p.is_dir() {
                continue;
            }
            let name = e.file_name().to_string_lossy().to_string();
            if name.starts_with('.')
                || matches!(name.as_str(), "node_modules" | "target" | "venv" | "dist" | "build")
            {
                continue;
            }
            candidates.push((name, p));
        }
    }

    let mut specs = Vec::new();
    for (rel, dir) in candidates {
        let touched =
            rel.is_empty() || changed.iter().any(|p| p.starts_with(&format!("{rel}/")));
        if !touched {
            continue;
        }
        if dir.join("Cargo.toml").exists() {
            specs.push(CheckSpec { name: "build", program: "cargo", args: &["check", "--quiet"], dir: dir.clone(), timeout_secs: 300, neutral_codes: &[] });
            specs.push(CheckSpec { name: "lint", program: "cargo", args: &["clippy", "--quiet"], dir: dir.clone(), timeout_secs: 300, neutral_codes: &[] });
            // Real test execution — the evidence, not the agent's word.
            specs.push(CheckSpec { name: "tests", program: "cargo", args: &["test", "--quiet"], dir: dir.clone(), timeout_secs: 300, neutral_codes: &[] });
        }
        if dir.join("package.json").exists() {
            specs.push(CheckSpec { name: "typecheck", program: "npx", args: &["tsc", "--noEmit"], dir: dir.clone(), timeout_secs: 300, neutral_codes: &[] });
        }
        let is_python = dir.join("pyproject.toml").exists()
            || dir.join("requirements.txt").exists()
            || dir.join("setup.py").exists();
        if is_python && tool_exists("python3") {
            // compileall is the cheap "does it even parse/compile" evidence.
            specs.push(CheckSpec {
                name: "compile",
                program: "python3",
                args: &["-m", "compileall", "-q", "-x", r"(\.venv|venv|node_modules|\.git|migrations)", "."],
                dir: dir.clone(),
                timeout_secs: 120,
                neutral_codes: &[],
            });
            // Run the real suite when pytest is available; exit 5 = "no tests
            // collected", which is not a failure — drop the check then.
            if tool_exists("pytest") {
                specs.push(CheckSpec { name: "tests", program: "pytest", args: &["-q", "-p", "no:cacheprovider"], dir: dir.clone(), timeout_secs: 300, neutral_codes: &[5] });
            }
        }
        // Go
        if dir.join("go.mod").exists() && tool_exists("go") {
            specs.push(CheckSpec { name: "build", program: "go", args: &["build", "./..."], dir: dir.clone(), timeout_secs: 300, neutral_codes: &[] });
            specs.push(CheckSpec { name: "lint", program: "go", args: &["vet", "./..."], dir: dir.clone(), timeout_secs: 180, neutral_codes: &[] });
            specs.push(CheckSpec { name: "tests", program: "go", args: &["test", "./..."], dir: dir.clone(), timeout_secs: 300, neutral_codes: &[] });
        }
        // Java (Maven, then Gradle) — build tools are slow, so the hard timeout matters.
        if dir.join("pom.xml").exists() && tool_exists("mvn") {
            specs.push(CheckSpec { name: "build", program: "mvn", args: &["-q", "-DskipTests", "compile"], dir: dir.clone(), timeout_secs: 420, neutral_codes: &[] });
            specs.push(CheckSpec { name: "tests", program: "mvn", args: &["-q", "test"], dir: dir.clone(), timeout_secs: 420, neutral_codes: &[] });
        } else if (dir.join("build.gradle").exists() || dir.join("build.gradle.kts").exists()) && tool_exists("gradle") {
            specs.push(CheckSpec { name: "build", program: "gradle", args: &["-q", "compileJava"], dir: dir.clone(), timeout_secs: 420, neutral_codes: &[] });
            specs.push(CheckSpec { name: "tests", program: "gradle", args: &["-q", "test"], dir: dir.clone(), timeout_secs: 420, neutral_codes: &[] });
        }
        // Ruby — lint + spec when those tools are present.
        if dir.join("Gemfile").exists() {
            if tool_exists("rubocop") {
                specs.push(CheckSpec { name: "lint", program: "rubocop", args: &["--format", "simple"], dir: dir.clone(), timeout_secs: 180, neutral_codes: &[] });
            }
            if tool_exists("rspec") {
                specs.push(CheckSpec { name: "tests", program: "rspec", args: &["--no-color"], dir: dir.clone(), timeout_secs: 300, neutral_codes: &[] });
            }
        }
    }
    specs
}

/// Run the detected deterministic checks, capturing pass/fail + output evidence.
/// Each runs under a hard timeout; a check whose exit code is "not applicable"
/// (e.g. pytest with no tests) is dropped rather than shown as a failure.
fn run_checks(cwd: &str, changed: &[String]) -> Vec<Check> {
    detect_checks(cwd, changed)
        .into_iter()
        .filter_map(|spec| {
            run_timed(
                spec.program,
                spec.args,
                &spec.dir,
                Duration::from_secs(spec.timeout_secs),
                spec.neutral_codes,
            )
            .map(|(passed, output)| Check { name: spec.name.to_string(), passed, output })
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

/// The approved change boundary the gate enforces against. `allowed` is the set
/// of paths the change may touch (drives scope-drift); `protected` extends the
/// built-in protected set (CI/lockfiles/env/migrations); `max_diff_lines` caps
/// the change size. Persisted per session and approved with the plan.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ScopePolicy {
    #[serde(default)]
    pub allowed: Vec<String>,
    #[serde(default)]
    pub protected: Vec<String>,
    #[serde(default)]
    pub max_diff_lines: Option<u32>,
}

/// A human review comment to apply: the file, a code anchor from the diff, and
/// the developer's ask. Anchors are best-effort (the agent locates them).
#[derive(Debug, Clone, Deserialize)]
pub struct ReviewComment {
    #[serde(default)]
    pub file: Option<String>,
    #[serde(default)]
    pub code: Option<String>,
    pub comment: String,
}

/// Apply a batch of human review comments via a focused agent pass — edits only
/// what the comments ask for, nothing else. A fresh agent in the project cwd
/// (like the autofix pass). Returns the agent's one-line summary.
pub fn apply_review_comments(
    backend: &dyn AgentBackend,
    config: &SessionConfig,
    comments: &[ReviewComment],
    intent: Option<&str>,
) -> Result<String> {
    let list = comments
        .iter()
        .enumerate()
        .map(|(i, c)| {
            let loc = match (&c.file, c.code.as_deref().map(str::trim).filter(|s| !s.is_empty())) {
                (Some(f), Some(code)) => format!("in {f}, at `{code}`"),
                (Some(f), _) => format!("in {f}"),
                _ => "in the change".to_string(),
            };
            format!("{}. {loc}: {}", i + 1, c.comment.trim())
        })
        .collect::<Vec<_>>()
        .join("\n");
    // Context lets the agent resolve terse comments ("this is wrong") against
    // what the change was actually for.
    let context = intent
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|i| format!("The change under review was implementing: {i}\n\n"))
        .unwrap_or_default();
    let prompt = format!(
        "{context}Apply ONLY these specific review comments to the code. Make each \
         requested change in place and nothing else — do not refactor or touch \
         anything not listed.\n\n{list}\n\nApply them now, then reply with a \
         one-line summary of what you changed."
    );
    let convo = Conversation::start(backend, config.clone())?;
    let out = convo.ask(&prompt)?;
    let _ = convo.stop();
    if out.is_error {
        return Err(super::error::OrchestratorError::Backend(format!(
            "applying comments failed: {}",
            out.stderr.trim()
        )));
    }
    Ok(out.text)
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
    scope: &ScopePolicy,
    settings: &OrchestrationSettings,
) -> Result<ValidationReport> {
    let diff = working_diff(cwd, base_tree);
    let changed = changed_paths(&diff);
    let mut checks = run_checks(cwd, &changed);
    tracing::info!(
        "[gate] checks: {}/{} passed ({})",
        checks.iter().filter(|c| c.passed).count(),
        checks.len(),
        if checks.is_empty() {
            "no deterministic checks for this project".to_string()
        } else {
            checks.iter().map(|c| format!("{}:{}", c.name, if c.passed { "ok" } else { "FAIL" })).collect::<Vec<_>>().join(", ")
        }
    );

    // The review runs when validation is on and there's an actual change to
    // judge. Cost is bounded (one pass, capped diff, the budget) — no arbitrary
    // size threshold deciding it.
    let run_review = settings.validation != ValidationMode::Off && !diff.trim().is_empty();

    let mut findings = if run_review {
        // A FRESH agent (not the author) reviews — that's what makes it honest.
        let convo = Conversation::start(backend, config.clone())?;
        let out = convo.ask(&build_review_prompt(intent, &diff))?;
        let _ = convo.stop();
        let parsed = if out.is_error { Vec::new() } else { parse_findings(&out.text) };
        tracing::info!(
            "[gate] adversarial review: {} finding(s){}",
            parsed.len(),
            if out.is_error { " (review turn errored)" } else { "" }
        );
        parsed
    } else {
        tracing::info!("[gate] adversarial review: skipped (validation off or no diff)");
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
            checks = run_checks(cwd, &changed); // re-verify after the edits
            findings.retain(|f| f.action != FindingAction::AutoFix);
        }
    }

    // Scope-drift guard: the change touched files the approved plan never
    // declared. This is the "stayed in scope" half of the product — surfacing
    // exactly what an agent quietly changed beyond what you approved.
    let drift = scope_drift(&changed, &scope.allowed);
    if !drift.is_empty() {
        findings.push(Finding {
            title: "Change touched files outside the approved plan".into(),
            detail: format!(
                "The plan scoped its work to specific files, but the change also \
                 modified: {}. Confirm these out-of-scope edits are intended — the \
                 change went beyond the approved boundary.",
                drift.join(", ")
            ),
            severity: Severity::Warning,
            action: FindingAction::Escalate,
            file: drift.first().cloned(),
            anchor: None,
        });
    }

    // Protected-path guard: the change touched sensitive files (CI config,
    // lockfiles, secrets/env, migrations, plus any the boundary marks protected)
    // that should need explicit approval.
    let protected: Vec<&String> = changed
        .iter()
        .filter(|p| is_protected_path(p) || scope.protected.iter().any(|g| path_matches(p, g)))
        .collect();
    if !protected.is_empty() {
        findings.push(Finding {
            title: "Change modified protected paths".into(),
            detail: format!(
                "The change touched sensitive files that usually need explicit \
                 approval: {}. Confirm these edits are intended — CI config, \
                 lockfiles, secrets, and migrations are how a change can quietly \
                 alter security, dependencies, or data.",
                protected.iter().map(|s| s.as_str()).collect::<Vec<_>>().join(", ")
            ),
            severity: Severity::Warning,
            action: FindingAction::Escalate,
            file: protected.first().map(|s| s.to_string()),
            anchor: None,
        });
    }

    // Max-diff cap: an oversized change is harder to review safely — flag it if
    // the boundary set a ceiling.
    if let Some(max) = scope.max_diff_lines {
        let added = diff
            .lines()
            .filter(|l| l.starts_with('+') && !l.starts_with("+++"))
            .count() as u32;
        if added > max {
            findings.push(Finding {
                title: "Change is larger than the approved limit".into(),
                detail: format!(
                    "This change adds {added} lines, over the approved cap of {max}. \
                     Large changes are harder to review safely — confirm it can't be split."
                ),
                severity: Severity::Warning,
                action: FindingAction::Escalate,
                file: None,
                anchor: None,
            });
        }
    }

    // Tamper guard: a feature change that ALSO edits test files is the classic
    // reward-hack shape (weakening tests to force green). Flag it — but don't
    // nag on pure test work (adding/strengthening tests is good).
    let touched_tests: Vec<&String> = changed.iter().filter(|p| is_test_file(p)).collect();
    let touched_nontest = changed.iter().any(|p| !is_test_file(p));
    if !touched_tests.is_empty() && touched_nontest {
        findings.push(Finding {
            title: "Change also edited test files".into(),
            detail: format!(
                "This change modified test files ({}) alongside the implementation. \
                 Confirm the tests were added or strengthened — not weakened, \
                 skipped, or deleted. Loosened tests are a way green checks become \
                 misleading.",
                touched_tests.iter().map(|s| s.as_str()).collect::<Vec<_>>().join(", ")
            ),
            severity: Severity::Warning,
            action: FindingAction::Escalate,
            file: touched_tests.first().map(|s| s.to_string()),
            anchor: None,
        });
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
    tracing::info!("[gate] verdict: {risk_level:?} — {summary} ({})", risk_reasons.join("; "));

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
    fn scope_drift_flags_undeclared_files() {
        let declared = vec!["backend/app/main.py".to_string(), "public/index.html".to_string()];
        let changed = vec![
            "backend/app/main.py".to_string(),   // declared (exact)
            "public/index.html".to_string(),      // declared
            "backend/app/routes/auth.py".to_string(), // NOT declared → drift
        ];
        let drift = scope_drift(&changed, &declared);
        assert_eq!(drift, vec!["backend/app/routes/auth.py".to_string()]);
    }

    #[test]
    fn scope_drift_matches_partial_paths_and_skips_when_unscoped() {
        // Plan declared a bare filename; diff has the full path → in scope.
        assert!(scope_drift(&["backend/app/main.py".into()], &["main.py".into()]).is_empty());
        // No declared scope → can't judge drift.
        assert!(scope_drift(&["a.rs".into(), "b.rs".into()], &[]).is_empty());
    }

    #[test]
    fn detects_protected_paths() {
        assert!(is_protected_path(".github/workflows/ci.yml"));
        assert!(is_protected_path("package-lock.json"));
        assert!(is_protected_path("frontend/pnpm-lock.yaml"));
        assert!(is_protected_path("backend/.env"));
        assert!(is_protected_path("api/db/migrations/0001_init.sql"));
        assert!(is_protected_path("Cargo.lock"));
        assert!(!is_protected_path("src/main.rs"));
        assert!(!is_protected_path("backend/app/routes/auth.py"));
    }

    #[test]
    fn detects_test_files() {
        assert!(is_test_file("src/foo_test.rs"));
        assert!(is_test_file("backend/tests/test_auth.py"));
        assert!(is_test_file("web/Login.spec.ts"));
        assert!(is_test_file("api/conftest.py"));
        assert!(!is_test_file("src/main.rs"));
        assert!(!is_test_file("backend/app/routes/auth.py"));
    }

    #[test]
    fn changed_paths_reads_new_side_files() {
        let diff = "diff --git a/backend/app/main.py b/backend/app/main.py\n\
                    --- a/backend/app/main.py\n+++ b/backend/app/main.py\n@@ -1 +1 @@\n+x\n\
                    diff --git a/public/index.html b/public/index.html\n\
                    --- /dev/null\n+++ b/public/index.html\n@@ -0,0 +1 @@\n+y\n";
        let c = changed_paths(diff);
        assert_eq!(c, vec!["backend/app/main.py", "public/index.html"]);
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
