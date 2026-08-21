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

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

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

    /// Consume the handle WITHOUT removing the checkout — the caller now owns its
    /// lifecycle (persist the path, remove later via [`remove_at`]). Used when a
    /// worktree must outlive one function (execute → review → PR).
    pub fn into_path(mut self) -> PathBuf {
        self.removed = true;
        self.path.clone()
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

// ---- persisted-lifecycle helpers (worktree outlives one function) ----------

/// Create a disposable detached worktree at the repo's current `HEAD`, pruning
/// any stale registrations first. Returns the checkout path as a string; the
/// caller owns its lifecycle (persist it, remove with [`remove_at`]).
pub fn create_isolated(repo: &str) -> Result<String> {
    prune(repo);
    let wt = Worktree::create_at(repo, "HEAD")?;
    Ok(wt.into_path().to_string_lossy().into_owned())
}

/// Remove a worktree at `path` from `repo` (registration + checkout).
pub fn remove_at(repo: &str, path: &str) {
    let _ = Command::new("git")
        .args(["worktree", "remove", "--force", path])
        .current_dir(repo)
        .output();
    let _ = std::fs::remove_dir_all(path);
}

/// Prune stale worktree registrations (checkouts removed out from under git).
pub fn prune(repo: &str) {
    let _ = Command::new("git")
        .args(["worktree", "prune"])
        .current_dir(repo)
        .output();
}

// ---- parallel-wave helpers (per-wave isolation + single-committer merge) ----

/// Snapshot the current *working* state of `cwd` as a commit SHA, so a wave's
/// sibling worktrees can each branch from exactly this state. Uses a throwaway
/// index (never touches the real one) and an internal identity for the wrapper
/// commit, so it works even in a repo with no configured `user.name/email`.
/// Returns `None` on any git failure (caller falls back to sequential).
pub fn snapshot_commit(cwd: &str) -> Option<String> {
    let idx = std::env::temp_dir().join(format!("orbitae-idx-{}", uuid::Uuid::new_v4()));
    let run = |args: &[&str]| {
        Command::new("git")
            .args(args)
            .current_dir(cwd)
            .env("GIT_INDEX_FILE", &idx)
            .env("GIT_AUTHOR_NAME", "orbitae")
            .env("GIT_AUTHOR_EMAIL", "orbitae@localhost")
            .env("GIT_COMMITTER_NAME", "orbitae")
            .env("GIT_COMMITTER_EMAIL", "orbitae@localhost")
            .output()
            .ok()
    };
    // Fresh index → stage the whole working tree → record it as a tree object.
    let _ = run(&["add", "-A"]);
    let tree = run(&["write-tree"]);
    let tree = tree.filter(|o| o.status.success());
    let commit = tree.and_then(|t| {
        let tree_sha = String::from_utf8_lossy(&t.stdout).trim().to_string();
        // Wrap the tree in a parentless commit — a valid base for `worktree add`.
        run(&["commit-tree", &tree_sha, "-m", "orbitae wave base"])
    });
    let _ = std::fs::remove_file(&idx);
    let commit = commit?;
    if !commit.status.success() {
        return None;
    }
    let sha = String::from_utf8_lossy(&commit.stdout).trim().to_string();
    (!sha.is_empty()).then_some(sha)
}

/// Stage everything in worktree `wt` and return its full diff against
/// `base_commit` as a binary-safe patch. `None` when there's no change (or git
/// errors). This is what one wave step contributes back to the shared tree.
pub fn capture_patch(wt: &str, base_commit: &str) -> Option<String> {
    let add = Command::new("git").args(["add", "-A"]).current_dir(wt).output().ok()?;
    if !add.status.success() {
        return None;
    }
    let diff = Command::new("git")
        .args(["diff", "--cached", "--binary", base_commit])
        .current_dir(wt)
        .output()
        .ok()?;
    if !diff.status.success() {
        return None;
    }
    let patch = String::from_utf8_lossy(&diff.stdout).into_owned();
    (!patch.trim().is_empty()).then_some(patch)
}

/// Apply a [`capture_patch`] patch to the working tree of `repo` (the single
/// committer merging one wave step back). Errors if it doesn't apply cleanly, so
/// the caller can fall back to a sequential re-run.
pub fn apply_patch(repo: &str, patch: &str) -> Result<()> {
    let mut child = Command::new("git")
        .args(["apply", "--binary", "--whitespace=nowarn"])
        .current_dir(repo)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| OrchestratorError::Backend(format!("git apply spawn: {e}")))?;
    child
        .stdin
        .take()
        .ok_or_else(|| OrchestratorError::Backend("git apply: no stdin".into()))?
        .write_all(patch.as_bytes())
        .map_err(|e| OrchestratorError::Backend(format!("git apply write: {e}")))?;
    let out = child
        .wait_with_output()
        .map_err(|e| OrchestratorError::Backend(format!("git apply: {e}")))?;
    if !out.status.success() {
        return Err(OrchestratorError::Backend(format!(
            "patch did not apply: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        )));
    }
    Ok(())
}

/// Remove leftover worktree checkouts from previous runs — temp dirs whose name
/// carries our prefix. Safe at startup: no session is mid-run then.
pub fn cleanup_temp_dirs() {
    if let Ok(entries) = std::fs::read_dir(std::env::temp_dir()) {
        for e in entries.flatten() {
            if e.file_name().to_string_lossy().starts_with("orbitae-wt-") && e.path().is_dir() {
                let _ = std::fs::remove_dir_all(e.path());
            }
        }
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

    /// The parallel-wave merge path: snapshot the exec tree, branch two sibling
    /// worktrees from it, make DISJOINT edits in each, capture their patches, and
    /// merge both back into the exec tree — both changes must land cleanly.
    #[test]
    #[ignore = "requires the git binary and filesystem; run with `--ignored`"]
    fn parallel_wave_merges_disjoint_changes() {
        let repo = std::env::temp_dir().join(format!("orbitae-wt-repo-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&repo).unwrap();
        let dir = repo.to_str().unwrap();
        let git = |args: &[&str]| Command::new("git").args(args).current_dir(dir).output().unwrap();
        git(&["init", "-q"]);
        git(&["config", "user.email", "t@t"]);
        git(&["config", "user.name", "t"]);
        std::fs::write(repo.join("base.txt"), "base\n").unwrap();
        git(&["add", "-A"]);
        git(&["commit", "-qm", "init"]);

        // Snapshot the exec tree → wave base commit.
        let wave_base = snapshot_commit(dir).expect("snapshot_commit");

        // Two sibling worktrees at that base; each edits a DIFFERENT file.
        let wt_a = Worktree::create_at(dir, &wave_base).unwrap();
        let wt_b = Worktree::create_at(dir, &wave_base).unwrap();
        let a = wt_a.path().to_string_lossy().into_owned();
        let b = wt_b.path().to_string_lossy().into_owned();
        std::fs::write(wt_a.path().join("a.txt"), "from A\n").unwrap();
        std::fs::write(wt_b.path().join("b.txt"), "from B\n").unwrap();

        let patch_a = capture_patch(&a, &wave_base).expect("patch A");
        let patch_b = capture_patch(&b, &wave_base).expect("patch B");
        drop(wt_a);
        drop(wt_b);

        // Single committer merges both back into the exec tree.
        apply_patch(dir, &patch_a).expect("apply A");
        apply_patch(dir, &patch_b).expect("apply B");

        assert_eq!(std::fs::read_to_string(repo.join("a.txt")).unwrap(), "from A\n");
        assert_eq!(std::fs::read_to_string(repo.join("b.txt")).unwrap(), "from B\n");
        assert_eq!(std::fs::read_to_string(repo.join("base.txt")).unwrap(), "base\n");

        std::fs::remove_dir_all(&repo).ok();
    }
}
