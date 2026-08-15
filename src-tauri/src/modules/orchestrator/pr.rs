//! PR creation — turn a validated change into a reviewable PR.
//!
//! Commits under the **developer's own git identity** (git's configured
//! user.name/email — never an AI attribution), on a fresh branch, then opens a
//! PR. It **never merges**: the human is always the merge gate.
//!
//! Degrades gracefully: GitHub via the `gh` CLI → a push + compare URL for other
//! hosts → a local branch if there's no remote at all.

use std::process::Command;

use serde::Serialize;

use super::error::{OrchestratorError, Result};

/// What to ship.
pub struct PrRequest {
    pub cwd: String,
    /// The plan goal — used for the branch name and PR title.
    pub title: String,
    /// The PR body (description + risk + evidence), already formatted.
    pub body: String,
}

/// The outcome of a PR attempt.
#[derive(Debug, Serialize)]
pub struct PrResult {
    pub branch: String,
    pub committed: bool,
    pub pushed: bool,
    /// The PR URL, when created via `gh`.
    pub pr_url: Option<String>,
    /// A "open a PR" compare URL, when we pushed but couldn't create the PR directly.
    pub compare_url: Option<String>,
    /// Human-facing status for the UI.
    pub message: String,
}

/// Commit the working-tree change on a new branch and open a PR (never merge).
pub fn create_pr(req: &PrRequest) -> Result<PrResult> {
    let cwd = req.cwd.as_str();

    if !has_changes(cwd) {
        return Err(OrchestratorError::Validation(
            "there are no changes to ship".into(),
        ));
    }

    let branch = branch_name(&req.title);
    git(cwd, &["checkout", "-b", &branch])
        .map_err(|e| OrchestratorError::Backend(format!("could not create branch: {e}")))?;

    git(cwd, &["add", "-A"]).map_err(OrchestratorError::Backend)?;
    // Commits use the repo's configured identity — the developer's, not an agent's.
    git(cwd, &["commit", "-m", &commit_subject(&req.title)])
        .map_err(|e| OrchestratorError::Backend(format!("commit failed (is git user configured?): {e}")))?;

    let has_remote = git_output(cwd, &["remote"])
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);
    if !has_remote {
        return Ok(PrResult {
            branch: branch.clone(),
            committed: true,
            pushed: false,
            pr_url: None,
            compare_url: None,
            message: format!("Committed to local branch '{branch}'. No git remote configured — push it yourself to open a PR."),
        });
    }

    let pushed = git(cwd, &["push", "-u", "origin", &branch]).is_ok();
    if !pushed {
        return Ok(PrResult {
            branch: branch.clone(),
            committed: true,
            pushed: false,
            pr_url: None,
            compare_url: None,
            message: format!("Committed to '{branch}' but the push failed — check your remote/auth."),
        });
    }

    // Prefer opening the PR directly via GitHub's CLI.
    if gh_available() {
        if let Ok(url) = gh_create_pr(cwd, &req.title, &req.body) {
            return Ok(PrResult {
                branch,
                committed: true,
                pushed: true,
                pr_url: Some(url),
                compare_url: None,
                message: "PR opened — review and merge when you're ready.".into(),
            });
        }
    }

    // Fallback: pushed, but open the PR via the host's compare page.
    let compare_url = compare_url(cwd, &branch);
    Ok(PrResult {
        branch: branch.clone(),
        committed: true,
        pushed: true,
        pr_url: None,
        compare_url: compare_url.clone(),
        message: match compare_url {
            Some(_) => format!("Pushed '{branch}'. Open the PR from the link."),
            None => format!("Pushed '{branch}'. Open a PR on your host from that branch."),
        },
    })
}

fn has_changes(cwd: &str) -> bool {
    git_output(cwd, &["status", "--porcelain"])
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false)
}

/// A safe, readable branch name from the goal: `orbitae/<slug>-<short-id>`.
fn branch_name(title: &str) -> String {
    let slug: String = title
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    let slug: String = slug.chars().take(40).collect();
    let short = uuid::Uuid::new_v4().to_string()[..8].to_string();
    let slug = slug.trim_matches('-');
    if slug.is_empty() {
        format!("orbitae/change-{short}")
    } else {
        format!("orbitae/{slug}-{short}")
    }
}

/// A clean commit subject — the goal, capped, no AI attribution.
fn commit_subject(title: &str) -> String {
    let one_line = title.lines().next().unwrap_or(title).trim();
    one_line.chars().take(72).collect()
}

fn git(cwd: &str, args: &[&str]) -> std::result::Result<(), String> {
    let out = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .map_err(|e| format!("git failed: {e}"))?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

fn git_output(cwd: &str, args: &[&str]) -> Option<String> {
    let out = Command::new("git").args(args).current_dir(cwd).output().ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).to_string())
}

fn gh_available() -> bool {
    Command::new("gh")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// `gh pr create` prints the PR URL on success; return it.
fn gh_create_pr(cwd: &str, title: &str, body: &str) -> std::result::Result<String, String> {
    let out = Command::new("gh")
        .args(["pr", "create", "--title", title, "--body", body])
        .current_dir(cwd)
        .output()
        .map_err(|e| format!("gh failed: {e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    let stdout = String::from_utf8_lossy(&out.stdout);
    stdout
        .lines()
        .rev()
        .find(|l| l.starts_with("http"))
        .map(|s| s.trim().to_string())
        .ok_or_else(|| "gh did not return a PR URL".into())
}

/// Build a "create PR" compare URL from the origin remote (GitHub/GitLab).
fn compare_url(cwd: &str, branch: &str) -> Option<String> {
    let remote = git_output(cwd, &["remote", "get-url", "origin"])?;
    let remote = remote.trim();
    // Normalize git@host:owner/repo(.git) and https://host/owner/repo(.git).
    let stripped = remote
        .strip_prefix("git@")
        .map(|s| s.replacen(':', "/", 1))
        .or_else(|| remote.strip_prefix("https://").map(|s| s.to_string()))
        .or_else(|| remote.strip_prefix("http://").map(|s| s.to_string()))?;
    let stripped = stripped.strip_suffix(".git").unwrap_or(&stripped).to_string();
    // stripped is now host/owner/repo
    let base = format!("https://{stripped}");
    if stripped.contains("github.com") {
        Some(format!("{base}/compare/{branch}?expand=1"))
    } else if stripped.contains("gitlab") {
        Some(format!("{base}/-/merge_requests/new?merge_request%5Bsource_branch%5D={branch}"))
    } else {
        Some(base)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn branch_name_is_slugged_and_prefixed() {
        let b = branch_name("Add a /health endpoint & test!");
        assert!(b.starts_with("orbitae/add-a-health-endpoint-test-"));
        assert!(!b.contains(' '));
        assert_eq!(b.matches('/').count(), 1, "only the orbitae/ separator");
    }

    #[test]
    fn empty_title_still_yields_a_branch() {
        assert!(branch_name("!!!").starts_with("orbitae/change-"));
    }

    #[test]
    fn commit_subject_is_one_capped_line() {
        let s = commit_subject("A very long title\nsecond line");
        assert!(!s.contains('\n'));
        assert!(s.len() <= 72);
        assert_eq!(commit_subject("A very long title\nsecond line"), "A very long title");
    }
}
