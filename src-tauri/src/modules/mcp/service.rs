use anyhow::Result;
use uuid::Uuid;

use crate::modules::vault::service::VaultService;

const VAULT_SERVICE: &str = "com.orbitae.app";
const MCP_TOKEN_KEY: &str = "mcp-auth-token";

pub struct McpService;

impl McpService {
    /// Ensures an MCP auth token exists in the keychain, generating one if needed.
    /// Returns the token.
    pub fn ensure_token() -> Result<String> {
        let vault = VaultService::new(VAULT_SERVICE);

        match vault.get_secret(MCP_TOKEN_KEY) {
            Ok(token) => Ok(token),
            Err(_) => {
                let token = Uuid::new_v4().to_string();
                vault.store_secret(MCP_TOKEN_KEY, &token)?;
                tracing::info!("Generated new MCP auth token");
                Ok(token)
            }
        }
    }

    /// Regenerates the MCP auth token (invalidates existing client configs).
    pub fn regenerate_token() -> Result<String> {
        let vault = VaultService::new(VAULT_SERVICE);
        let token = Uuid::new_v4().to_string();
        vault.store_secret(MCP_TOKEN_KEY, &token)?;
        tracing::info!("Regenerated MCP auth token");
        Ok(token)
    }

    /// Returns the path to the orbitae-mcp binary.
    pub fn binary_path() -> Result<String> {
        let current_exe = std::env::current_exe()?;
        let bin_dir = current_exe.parent().unwrap_or(current_exe.as_path());
        let mcp_bin = bin_dir.join("orbitae-mcp");

        if mcp_bin.exists() {
            Ok(mcp_bin.to_string_lossy().to_string())
        } else {
            // During development, check the cargo target directory
            let dev_bin = bin_dir.join("orbitae-mcp");
            Ok(dev_bin.to_string_lossy().to_string())
        }
    }

    /// Generates the MCP client config JSON for Claude Code / Cursor.
    pub fn client_config() -> Result<serde_json::Value> {
        let token = Self::ensure_token()?;
        let bin_path = Self::binary_path()?;

        Ok(serde_json::json!({
            "mcpServers": {
                "orbitae": {
                    "command": bin_path,
                    "env": {
                        "ORBITAE_MCP_TOKEN": token
                    }
                }
            }
        }))
    }
}
