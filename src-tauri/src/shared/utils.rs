/// Cross-platform path for a session's temporary context file.
///
/// Uses the OS temp dir (`/tmp` on Unix, `%TEMP%` on Windows) so it works
/// everywhere rather than assuming `/tmp`.
pub fn ctx_file_path(session_id: &str) -> std::path::PathBuf {
    std::env::temp_dir().join(format!("orbitae-ctx-{session_id}.md"))
}

/// The context file path as a `String`, for APIs that take a path string.
pub fn ctx_file_path_str(session_id: &str) -> String {
    ctx_file_path(session_id).to_string_lossy().to_string()
}

/// Terminate a process by PID, cross-platform (`kill` on Unix, `taskkill` on
/// Windows). Best-effort — errors are ignored, as the process may already be
/// gone.
pub fn kill_process(pid: u32) {
    #[cfg(unix)]
    {
        let _ = std::process::Command::new("kill")
            .args(["-15", &pid.to_string()])
            .status();
    }
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .status();
    }
}

pub fn expand_path(path: &str) -> String {
    if path.starts_with("~") {
        if let Some(home_dir) = dirs::home_dir() {
            if path == "~" {
                return home_dir.to_string_lossy().to_string();
            }
            if path.starts_with("~/") || path.starts_with("~\\") {
                let mut p = home_dir;
                p.push(&path[2..]);
                return p.to_string_lossy().to_string();
            }
        }
    }
    path.to_string()
}
