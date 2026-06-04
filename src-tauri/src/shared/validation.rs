use crate::shared::error::AppError;

const MAX_NAME_LEN: usize = 256;
const MAX_CONTENT_LEN: usize = 1_000_000;
const MAX_PATH_LEN: usize = 4096;

/// Validate a name field (e.g. project name, node title) is non-empty and within length limits.
pub fn validate_name(name: &str, field: &str) -> Result<(), AppError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(AppError::Validation(format!("{field} cannot be empty")));
    }
    if trimmed.len() > MAX_NAME_LEN {
        return Err(AppError::Validation(format!(
            "{field} exceeds {MAX_NAME_LEN} characters"
        )));
    }
    Ok(())
}

/// Validate a filesystem path is non-empty, within length limits, and contains no traversal.
pub fn validate_path(path: &str) -> Result<(), AppError> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(AppError::Validation("Path cannot be empty".into()));
    }
    if trimmed.len() > MAX_PATH_LEN {
        return Err(AppError::Validation(format!(
            "Path exceeds {MAX_PATH_LEN} characters"
        )));
    }
    if trimmed.contains("..") {
        return Err(AppError::Validation(
            "Path must not contain '..'".into(),
        ));
    }
    Ok(())
}

/// Validate content size does not exceed the 1 MB limit.
pub fn validate_content(content: &str, field: &str) -> Result<(), AppError> {
    if content.len() > MAX_CONTENT_LEN {
        return Err(AppError::Validation(format!(
            "{field} exceeds 1MB limit"
        )));
    }
    Ok(())
}

/// Validate an identifier is non-empty and within length limits.
pub fn validate_id(id: &str) -> Result<(), AppError> {
    if id.trim().is_empty() {
        return Err(AppError::Validation("ID cannot be empty".into()));
    }
    if id.len() > 128 {
        return Err(AppError::Validation(
            "ID exceeds 128 characters".into(),
        ));
    }
    Ok(())
}

/// Validate a shell command is non-empty and does not contain known destructive patterns.
pub fn validate_shell_command(command: &str) -> Result<(), AppError> {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return Err(AppError::Validation("Command cannot be empty".into()));
    }
    let blocked = [
        "rm -rf /",
        "rm -rf /*",
        "mkfs.",
        "dd if=",
        "> /dev/sd",
        ":(){ :|:& };:",
    ];
    let lower = trimmed.to_lowercase();
    for pattern in blocked {
        if lower.contains(pattern) {
            return Err(AppError::Validation(format!(
                "Blocked dangerous command pattern: {pattern}"
            )));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_name_rejects_empty() {
        let result = validate_name("   ", "Test");
        assert!(result.is_err());
    }

    #[test]
    fn validate_name_rejects_too_long() {
        let long_name = "a".repeat(MAX_NAME_LEN + 1);
        let result = validate_name(&long_name, "Test");
        assert!(result.is_err());
    }

    #[test]
    fn validate_name_accepts_valid() {
        assert!(validate_name("My Project", "Test").is_ok());
    }

    #[test]
    fn validate_path_rejects_traversal() {
        let result = validate_path("/home/../etc/passwd");
        assert!(result.is_err());
    }

    #[test]
    fn validate_path_rejects_empty() {
        assert!(validate_path("").is_err());
    }

    #[test]
    fn validate_path_accepts_valid() {
        assert!(validate_path("/Users/test/projects/foo").is_ok());
    }

    #[test]
    fn validate_content_rejects_oversized() {
        let large = "x".repeat(MAX_CONTENT_LEN + 1);
        assert!(validate_content(&large, "Body").is_err());
    }

    #[test]
    fn validate_content_accepts_normal() {
        assert!(validate_content("hello world", "Body").is_ok());
    }

    #[test]
    fn validate_id_rejects_empty() {
        assert!(validate_id("  ").is_err());
    }

    #[test]
    fn validate_id_rejects_too_long() {
        let long_id = "x".repeat(129);
        assert!(validate_id(&long_id).is_err());
    }

    #[test]
    fn validate_shell_command_rejects_fork_bomb() {
        let result = validate_shell_command(":(){ :|:& };:");
        assert!(result.is_err());
    }

    #[test]
    fn validate_shell_command_rejects_rm_rf_root() {
        assert!(validate_shell_command("sudo rm -rf /").is_err());
        assert!(validate_shell_command("rm -rf /*").is_err());
    }

    #[test]
    fn validate_shell_command_accepts_normal() {
        assert!(validate_shell_command("npm run dev").is_ok());
        assert!(validate_shell_command("cargo build --release").is_ok());
    }
}
