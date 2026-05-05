use super::models::SshHostModel;
use anyhow::{Context, Result};
use ssh2_config::{ParseRule, SshConfig};
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;

pub struct SshService {
    config_path: PathBuf,
}

impl SshService {
    pub fn new() -> anyhow::Result<Self> {
        let home = dirs::home_dir().ok_or_else(|| anyhow::anyhow!("Could not find home directory"))?;
        let config_path = home.join(".ssh").join("config");
        Ok(Self { config_path })
    }

    pub fn with_path(path: PathBuf) -> Self {
        Self { config_path: path }
    }

    pub fn list_hosts(&self) -> Result<Vec<SshHostModel>> {
        if !self.config_path.exists() {
            return Ok(vec![]);
        }



        
        // Parse the config to use for querying details
        // Note: We need to re-open or clone for the parser since we will scan manually first?
        // Actually, let's load logic:
        // 1. Parse full config for querying (SshConfig)
        // 2. Read lines to find Host definitions.
        
        // Let's re-open for parsing content
        let mut reader_for_parse = BufReader::new(File::open(&self.config_path)?);
        // Assuming ParseRule strict or default. If ParseRule::default() doesn't exist, try ParseRule::STRICT.
        // Docs commonly suggest ParseRule::STRICT or similar.
        // If unknown, we can try to rely on defaults or standard.
        // Based on search "ParseRule::STRICT" exists.
        let config = SshConfig::default().parse(&mut reader_for_parse, ParseRule::STRICT)?;
        
        // Now scan for "Host " lines to get keys
        let reader_for_scan = BufReader::new(File::open(&self.config_path)?);
        let mut hosts = Vec::new();
        let mut seen_hosts = std::collections::HashSet::new();

        for line in reader_for_scan.lines() {
            let line = line?;
            let trimmed = line.trim();
            if trimmed.starts_with("Host ") {
                let parts: Vec<&str> = trimmed.split_whitespace().collect();
                // parts[0] is "Host"
                for alias in &parts[1..] {
                    if *alias == "*" { continue; } // Skip wildcard
                    if seen_hosts.contains(&alias.to_string()) { continue; } // Dedup
                    
                    seen_hosts.insert(alias.to_string());
                    
                    // Query details
                    let params = config.query(alias);
                    
                    let model = SshHostModel {
                        host: alias.to_string(),
                        hostname: params.host_name.unwrap_or_default(),
                        user: params.user,
                        port: params.port,
                        // Fix: identity_file is Option<Vec<PathBuf>>, access inner vec then first item
                        identity_file: params.identity_file.as_ref()
                            .and_then(|files| files.first())
                            .map(|p| p.to_string_lossy().to_string()),
                    };
                    hosts.push(model);
                }
            }
        }

        Ok(hosts)
    }

    pub fn add_host(&self, host: SshHostModel) -> Result<()> {
        // 1. Backup
        if self.config_path.exists() {
            let backup_path = self.config_path.with_extension("bak");
            fs::copy(&self.config_path, &backup_path).context("Failed to create SSH config backup")?;
        }

        // 2. Append
        let mut file = fs::OpenOptions::new()
            .write(true)
            .append(true)
            .create(true)
            .open(&self.config_path)
            .context("Failed to open SSH config for appending")?;

        writeln!(file, "\nHost {}", host.host)?;
        writeln!(file, "    HostName {}", host.hostname)?;
        if let Some(user) = &host.user {
            writeln!(file, "    User {}", user)?;
        }
        if let Some(port) = host.port {
            writeln!(file, "    Port {}", port)?;
        }
        if let Some(identity_file) = &host.identity_file {
            writeln!(file, "    IdentityFile {}", identity_file)?;
        }
        
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn test_list_and_add_host() -> Result<()> {
        let temp_dir = std::env::temp_dir();
        let config_path = temp_dir.join("test_ssh_config");
        
        // Setup initial config
        {
            let mut file = File::create(&config_path)?;
            writeln!(file, "Host test-server")?;
            writeln!(file, "    HostName 192.168.1.1")?;
            writeln!(file, "    User admin")?;
            writeln!(file, "    Port 2222")?;
        }

        let service = SshService::with_path(config_path.clone());

        // Test List
        let hosts = service.list_hosts()?;
        assert!(!hosts.is_empty());
        let host = hosts.iter().find(|h| h.host == "test-server").expect("Host not found");
        assert_eq!(host.hostname, "192.168.1.1");
        assert_eq!(host.user.as_deref(), Some("admin"));
        assert_eq!(host.port, Some(2222));

        // Test Add
        let new_host = SshHostModel {
            host: "new-server".to_string(),
            hostname: "10.0.0.1".to_string(),
            user: Some("dev".to_string()),
            port: None,
            identity_file: Some("/path/to/key.pem".to_string()),
        };
        service.add_host(new_host.clone())?;

        // Verify content and parse again
        let hosts_after = service.list_hosts()?;
        assert!(hosts_after.iter().any(|h| h.host == "new-server"));

        Ok(())
    }
}
