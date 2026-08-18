//! Disposable git worktrees — the isolation primitive.
//!
//! A worktree is a second working checkout that shares the repository's object
//! store. Work happens inside it without touching the developer's main working
//! tree, which is the foundation for three things on the roadmap:
//! - **isolated execution** — a failed/abandoned run never dirties the main tree;
//! - **parallel agents** — disjoint-file steps run in separate worktrees, then
//!   merge, so concurrent agents can't clobber each other;
//! - **enforcement + the per-project sandbox** — hold non-compliant changes in
//!   isolation until approved.
//!
//! This module is the low-level primitive (create / path / remove). Wiring it
//! into the execute → verify → PR flow is done separately, since that reshapes
//! how the base snapshot, review, and PR interact.

use std::path::{Path, PathBuf};
use std::process::Command;

use super::error::{OrchestratorError, Result};

/// A disposable worktree. Removed explicitly via [`remove`](Worktree::remove) or
/// automatically on drop (best effort).
pub struct Worktree {
    repo: PathBuf,
    path: PathBuf,
    removed: bool,
}

impl Worktree {
    /// Create a **detached** worktree at the repo's current `HEAD`, in a fresh
    /// temp directory. Detached so it never moves the repo's branch.
    pub fn create(repo: &str) -> Result<Worktree> {
        Self::create_at(repo, "HEAD")
    }

    /// Create a detached worktree at an arbitrary commit-ish (branch, tag, SHA).
    pub fn create_at(repo: &str, at: &str) -> Result<Worktree> {
        let path = std::env::temp_dir().join(format!("orbitae-wt-{}", uuid::Uuid::new_v4()));
        let path_str = path
            .to_str()
            .ok_or_else(|| OrchestratorError::Backend("non-UTF8 temp path".into()))?;
        let out = Command::new("git")
            .args(["worktree", "add", "--detach", path_str, at])
            .current_dir(repo)
            .output()
            .map_err(|e| OrchestratorError::Backend(format!("git worktree add: {e}")))?;
        if !out.status.success() {
            return Err(OrchestratorError::Backend(format!(
                "could not create worktree: {}",
                String::from_utf8_lossy(&out.stderr).trim()
            )));
        }
        Ok(Worktree { repo: PathBuf::from(repo), path, removed: false })
    }

    /// The isolated checkout directory — use this as the agent's `cwd`.
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Remove the worktree registration and its checkout (best effort, idempotent).
    pub fn remove(&mut self) {
        if self.removed {
            return;
        }
        self.removed = true;
        if let Some(p) = self.path.to_str() {
            let _ = Command::new("git")
                .args(["worktree", "remove", "--force", p])
                .current_dir(&self.repo)
                .output();
        }
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

impl Drop for Worktree {
    fn drop(&mut self) {
        self.remove();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    /// Init a throwaway repo, create a worktree, confirm it's a real isolated
    /// checkout, then remove it. Ignored by default (needs git + filesystem).
    #[test]
    #[ignore = "requires the git binary and filesystem; run with `--ignored`"]
    fn create_isolated_checkout_and_remove() {
        let repo = std::env::temp_dir().join(format!("orbitae-wt-repo-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&repo).unwrap();
        let dir = repo.to_str().unwrap();
        let git = |args: &[&str]| Command::new("git").args(args).current_dir(dir).output().unwrap();
        git(&["init", "-q"]);
        git(&["config", "user.email", "t@t"]);
        git(&["config", "user.name", "t"]);
        std::fs::write(repo.join("a.txt"), "hi\n").unwrap();
        git(&["add", "-A"]);
        git(&["commit", "-qm", "init"]);

        let mut wt = Worktree::create(dir).expect("worktree created");
        assert!(wt.path().exists(), "worktree dir exists");
        assert!(wt.path().join("a.txt").exists(), "checkout has the committed file");
        // Writing in the worktree must NOT touch the main repo's file.
        std::fs::write(wt.path().join("b.txt"), "x\n").unwrap();
        assert!(!repo.join("b.txt").exists(), "main tree is untouched");

        let wt_path = wt.path().to_path_buf();
        wt.remove();
        assert!(!wt_path.exists(), "worktree removed");

        std::fs::remove_dir_all(&repo).ok();
    }
}
