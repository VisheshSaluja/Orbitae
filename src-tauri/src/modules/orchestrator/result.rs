//! The structured execution result — the "what changed" surface.
//!
//! Research (2026-08-16) on how the strongest agentic tools present a finished
//! task is unanimous: the DONE state is a **structured summary anchored to the
//! diff**, never the agent's free-text narration. So we assemble the result from
//! data we own — per-step outcomes, accumulated metrics, and the git delta — and
//! never render the model's stream-of-consciousness.

use std::collections::HashMap;
use std::process::Command;

use serde::Serialize;

use super::validation::snapshot_tree;

/// One changed file in the execution delta.
#[derive(Debug, Clone, Serialize)]
pub struct ChangedFile {
    /// Git status letter: `A` added, `M` modified, `D` deleted, `R` renamed.
    pub status: String,
    pub path: String,
    pub adds: u32,
    pub dels: u32,
}

/// Objective run statistics — no prose.
#[derive(Debug, Clone, Serialize)]
pub struct ExecStats {
    pub steps: usize,
    /// 1-based index of the first failed step, if any.
    pub failed_step: Option<usize>,
    pub duration_ms: u64,
    pub cost_usd: f64,
}

/// The structured result shown after execution — assembled, not narrated.
#[derive(Debug, Clone, Serialize)]
pub struct ExecutionResult {
    /// `"done"` or `"failed"`.
    pub outcome: String,
    /// A one-line headline (the plan goal) — never a paragraph.
    pub headline: String,
    pub changed_files: Vec<ChangedFile>,
    pub stats: ExecStats,
}

/// The files changed between the pre-execution snapshot and now, with +/- line
/// counts. Empty when there's no baseline (older sessions) or not a git repo.
pub fn changed_files(cwd: &str, base: Option<&str>) -> Vec<ChangedFile> {
    let base = match base {
        Some(b) => b.to_string(),
        None => return Vec::new(),
    };
    let current = match snapshot_tree(cwd) {
        Some(c) => c,
        None => return Vec::new(),
    };

    // Status letters (A/M/D/R…), keyed by path.
    let mut statuses: HashMap<String, String> = HashMap::new();
    if let Ok(o) = Command::new("git")
        .args(["diff", "--name-status", &base, &current])
        .current_dir(cwd)
        .output()
    {
        for line in String::from_utf8_lossy(&o.stdout).lines() {
            let mut parts = line.split('\t');
            if let (Some(s), Some(p)) = (parts.next(), parts.next()) {
                let path = parts.next().unwrap_or(p).to_string(); // R lines: status old new
                statuses.insert(path, s.chars().next().unwrap_or('M').to_string());
            }
        }
    }

    // +/- counts per path (numstat uses `-` for binary → treated as 0).
    let mut files = Vec::new();
    if let Ok(o) = Command::new("git")
        .args(["diff", "--numstat", &base, &current])
        .current_dir(cwd)
        .output()
    {
        for line in String::from_utf8_lossy(&o.stdout).lines() {
            let mut parts = line.split('\t');
            let adds = parts.next().unwrap_or("0");
            let dels = parts.next().unwrap_or("0");
            let path = parts.next().unwrap_or("").to_string();
            if path.is_empty() {
                continue;
            }
            files.push(ChangedFile {
                status: statuses.get(&path).cloned().unwrap_or_else(|| "M".into()),
                adds: adds.parse().unwrap_or(0),
                dels: dels.parse().unwrap_or(0),
                path,
            });
        }
    }
    files
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_base_yields_no_files() {
        assert!(changed_files("/tmp", None).is_empty());
    }
}
