use serde::{Deserialize, Serialize};
use std::process::Command;
use anyhow::{Result, anyhow};
use std::path::Path;

#[derive(Debug, Serialize, Deserialize)]
pub struct GitStatus {
    pub branch: String,
    pub modified_count: usize,
    pub ahead: usize,
    pub behind: usize,
    pub remote_url: Option<String>,
}

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

fn new_command(program: &str) -> Command {
    #[allow(unused_mut)]
    let mut cmd = Command::new(program);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

pub fn get_git_status(path: &str) -> Result<Option<GitStatus>> {
    let repo_path = Path::new(path);
    
    // Check if it's a git repo using git command (more robust than checking .git folder)
    let output = new_command("git")
        .args(&["rev-parse", "--is-inside-work-tree"])
        .current_dir(repo_path)
        .output();

    match output {
        Ok(o) if o.status.success() => {},
        _ => return Ok(None), // Not a git repo
    }

    // Get branch
    let output = new_command("git")
        .args(&["symbolic-ref", "--short", "HEAD"])
        .current_dir(repo_path)
        .output()?;
    
    let mut branch = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if branch.is_empty() {
        // Detached HEAD or fresh repo
        let output = new_command("git")
            .args(&["rev-parse", "--short", "HEAD"])
            .current_dir(repo_path)
            .output()?;
        let hash = String::from_utf8_lossy(&output.stdout).trim().to_string();
        
        if !hash.is_empty() {
            branch = hash;
        } else {
            // Unborn branch (empty repo), usually "main" or "master" default
            branch = "HEAD (unborn)".to_string();
        }
    }

    // Get modified count (porcelain is stable)
    let output = new_command("git")
        .args(&["status", "--porcelain"])
        .current_dir(repo_path)
        .output()?;
    let status_lines = String::from_utf8_lossy(&output.stdout);
    let modified_count = status_lines.lines().count();

    // Get Remote URL
    let output = new_command("git")
        .args(&["remote", "get-url", "origin"])
        .current_dir(repo_path)
        .output()?;
    let remote_url = if output.status.success() {
        Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        None
    };

    // Helper to get ahead/behind
    // git rev-list --left-right --count HEAD...@{u}
    let output = new_command("git")
        .args(&["rev-list", "--left-right", "--count", "HEAD...@{u}"])
        .current_dir(repo_path)
        .output();
    
    let (ahead, behind) = match output {
        Ok(o) if o.status.success() => {
            let s = String::from_utf8_lossy(&o.stdout);
            let parts: Vec<&str> = s.split_whitespace().collect();
            if parts.len() == 2 {
                (parts[0].parse().unwrap_or(0), parts[1].parse().unwrap_or(0))
            } else {
                (0, 0)
            }
        },
        _ => (0, 0),
    };

    Ok(Some(GitStatus {
        branch,
        modified_count,
        ahead,
        behind,
        remote_url,
    }))
}

pub fn clone_repo(url: &str, target_path: &str) -> Result<()> {
    // Clone takes a while, we might WANT a window? 
    // Usually no, as we should handle stdout/stderr in the app if long running.
    // For now, suppress it to match user request.
    let status = new_command("git")
        .args(&["clone", url, target_path])
        .status()?;

    if status.success() {
        Ok(())
    } else {
        Err(anyhow!("Git clone failed"))
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Commit {
    pub hash: String,
    pub parents: Vec<String>,
    pub author: String,
    pub date: String,
    pub message: String,
    pub refs: String,
}

pub fn get_git_history(path: &str, limit: usize) -> Result<Vec<Commit>> {
    let repo_path = Path::new(path);
    
    // Quick check if git works here
    let check = new_command("git")
        .args(&["rev-parse", "--is-inside-work-tree"])
        .current_dir(repo_path)
        .output();
        
    match check {
         Ok(o) if o.status.success() => {},
         _ => return Ok(Vec::new()),
    }

    // Format: %H|%|%P|%|%an|%|%aI|%|%s|%|%d
    let output = new_command("git")
        .args(&[
            "log",
            &format!("-n{}", limit),
            "--pretty=format:%H|%|%P|%|%an|%|%aI|%|%s|%|%d",
            "--topo-order"
        ])
        .current_dir(repo_path)
        .output()?;

    if !output.status.success() {
        return Err(anyhow!("Failed to get git log"));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let commits: Vec<Commit> = stdout.lines().filter_map(|line| {
        let parts: Vec<&str> = line.split("|%|").collect();
        if parts.len() < 5 {
            tracing::debug!("Skipping line, parts len: {}", parts.len());
            return None;
        }
        
        Some(Commit {
            hash: parts[0].to_string(),
            parents: parts[1].split_whitespace().map(|s| s.to_string()).collect(),
            author: parts[2].to_string(),
            date: parts[3].to_string(),
            message: parts[4].to_string(),
            refs: parts.get(5).unwrap_or(&"").to_string(),
        })
    }).collect();
    
    tracing::debug!("Parsed Commits Count: {}", commits.len());

    Ok(commits)
}
