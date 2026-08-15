//! Cross-platform listening-TCP-port scanning.
//!
//! `lsof` on Unix, `netstat` on Windows — so the ports feature works on every
//! platform rather than assuming macOS/Linux tooling.

use std::collections::HashSet;

/// A listening TCP socket and its owning process.
pub struct ListeningSocket {
    pub port: u16,
    pub pid: u32,
    pub process: String,
}

/// All listening TCP ports on this machine (deduped by port).
pub fn listening_ports() -> Vec<ListeningSocket> {
    #[cfg(unix)]
    {
        scan_unix()
    }
    #[cfg(windows)]
    {
        scan_windows()
    }
    #[cfg(not(any(unix, windows)))]
    {
        Vec::new()
    }
}

/// Best-effort working directory of a process. Unix only (via `lsof`); returns
/// `None` on other platforms, where obtaining a process cwd needs privileged APIs.
pub fn process_cwd(pid: u32) -> Option<String> {
    #[cfg(unix)]
    {
        let output = std::process::Command::new("lsof")
            .args(["-p", &pid.to_string(), "-d", "cwd", "-Fn"])
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }
        let stdout = String::from_utf8_lossy(&output.stdout);
        stdout
            .lines()
            .find_map(|line| line.strip_prefix('n').map(|p| p.to_string()))
    }
    #[cfg(not(unix))]
    {
        let _ = pid;
        None
    }
}

#[cfg(unix)]
fn scan_unix() -> Vec<ListeningSocket> {
    let output = match std::process::Command::new("lsof")
        .args(["-i", "-P", "-n", "-sTCP:LISTEN"])
        .output()
    {
        Ok(o) if o.status.success() => o,
        _ => return Vec::new(),
    };
    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for line in stdout.lines().skip(1) {
        let cols: Vec<&str> = line.split_whitespace().collect();
        if cols.len() < 9 {
            continue;
        }
        let port: u16 = match cols[cols.len() - 1].rsplit(':').next().and_then(|p| p.parse().ok()) {
            Some(p) => p,
            None => continue,
        };
        if !seen.insert(port) {
            continue;
        }
        let pid: u32 = match cols[1].parse() {
            Ok(p) => p,
            Err(_) => continue,
        };
        out.push(ListeningSocket { port, pid, process: cols[0].to_string() });
    }
    out
}

#[cfg(windows)]
fn scan_windows() -> Vec<ListeningSocket> {
    // `netstat -ano -p TCP` rows: "TCP  0.0.0.0:PORT  0.0.0.0:0  LISTENING  PID"
    let output = match std::process::Command::new("netstat")
        .args(["-ano", "-p", "TCP"])
        .output()
    {
        Ok(o) if o.status.success() => o,
        _ => return Vec::new(),
    };
    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for line in stdout.lines() {
        let cols: Vec<&str> = line.split_whitespace().collect();
        if cols.len() < 5 || cols[0] != "TCP" || cols[3] != "LISTENING" {
            continue;
        }
        let port: u16 = match cols[1].rsplit(':').next().and_then(|p| p.parse().ok()) {
            Some(p) => p,
            None => continue,
        };
        if !seen.insert(port) {
            continue;
        }
        let pid: u32 = match cols[4].parse() {
            Ok(p) => p,
            Err(_) => continue,
        };
        out.push(ListeningSocket { port, pid, process: format!("pid {pid}") });
    }
    out
}
