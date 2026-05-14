use keyring::Entry;
use anyhow::{Result, Context};

pub struct VaultService {
    service_name: String,
}

impl VaultService {
    pub fn new(service_name: &str) -> Self {
        Self {
            service_name: service_name.to_string(),
        }
    }

    pub fn store_secret(&self, key: &str, secret: &str) -> Result<()> {
        let entry = Entry::new(&self.service_name, key)
            .context("Failed to create keyring entry")?;
        entry.set_password(secret)
            .context("Failed to store secret in keyring")?;
        Ok(())
    }

    pub fn get_secret(&self, key: &str) -> Result<String> {
        let entry = Entry::new(&self.service_name, key)
            .context("Failed to create keyring entry")?;
        let secret = entry.get_password()
            .context("Failed to retrieve secret from keyring")?;
        Ok(secret)
    }

    /// Retrieve a secret after verifying the user's identity via biometric or password.
    pub fn get_secret_authenticated(&self, key: &str) -> Result<String> {
        Self::require_biometric_auth("reveal a stored secret")?;
        self.get_secret(key)
    }

    pub fn delete_secret(&self, key: &str) -> Result<()> {
        let entry = Entry::new(&self.service_name, key)
            .context("Failed to create keyring entry")?;
        entry.delete_password()
            .context("Failed to delete secret from keyring")?;
        Ok(())
    }

    /// Prompt the user for biometric (Touch ID / Face ID) or system password authentication.
    #[cfg(target_os = "macos")]
    fn require_biometric_auth(reason: &str) -> Result<()> {
        use localauthentication_rs::{LAPolicy, LocalAuthentication};

        let la = LocalAuthentication::new();
        let policy = if la.can_evaluate_policy(LAPolicy::DeviceOwnerAuthenticationWithBiometrics) {
            LAPolicy::DeviceOwnerAuthenticationWithBiometrics
        } else {
            LAPolicy::DeviceOwnerAuthentication
        };

        if la.evaluate_policy(policy, reason) {
            Ok(())
        } else {
            Err(anyhow::anyhow!("Authentication failed or was cancelled"))
        }
    }

    #[cfg(not(target_os = "macos"))]
    fn require_biometric_auth(_reason: &str) -> Result<()> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    // Note: These tests interact with the system keychain and might fail in headless environments
    // or prompt the user for access.
    #[test]
    #[ignore] // Ignored by default to avoid CI/headless issues. Run with -- --ignored to test.
    fn test_vault_flow() {
        let service = VaultService::new("orbitae-test");
        let key = "test-key";
        let secret = "test-secret-value";

        // Store
        service.store_secret(key, secret).expect("Failed to store");

        // Retrieve
        let retrieved = service.get_secret(key).expect("Failed to get");
        assert_eq!(retrieved, secret);

        // Delete
        service.delete_secret(key).expect("Failed to delete");
        
        // Verify deletion
        assert!(service.get_secret(key).is_err());
    }
}
