use anyhow::{Context, Result};
use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Serializes access to the on-disk vault file across the whole process.
static VAULT_LOCK: Mutex<()> = Mutex::new(());

/// Cross-platform local secret store.
///
/// TEMPORARY: secrets live in a per-service JSON file in the app data dir,
/// obfuscated at rest and written owner-only (0600 on Unix). This replaces the
/// system keychain, which triggered repeated biometric/passkey prompts on
/// startup and pulled in macOS-only crates (`security-framework`,
/// `localauthentication-rs`) that blocked Windows builds. A hardened, *opt-in*
/// keychain backend returns later.
///
/// The obfuscation here is deliberately simple — it stops casual plaintext reads
/// of the file, not a determined attacker. It is not a substitute for real
/// encryption, which the hardened backend will provide.
pub struct VaultService {
    service_name: String,
}

const OBFUSCATION_KEY: &[u8] = b"orbitae-local-vault-v1";

impl VaultService {
    pub fn new(service_name: &str) -> Self {
        Self { service_name: service_name.to_string() }
    }

    /// Path to this service's vault file (creating the parent dir as needed).
    fn path(&self) -> Result<PathBuf> {
        let mut dir = dirs::data_dir().context("could not resolve the data directory")?;
        dir.push("orbitae");
        std::fs::create_dir_all(&dir).context("could not create the vault directory")?;
        dir.push(format!("{}.vault.json", self.service_name));
        Ok(dir)
    }

    fn load(&self) -> Result<HashMap<String, String>> {
        let path = self.path()?;
        match std::fs::read_to_string(&path) {
            Ok(s) => Ok(serde_json::from_str(&s).unwrap_or_default()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(HashMap::new()),
            Err(e) => Err(e).context("could not read the vault"),
        }
    }

    fn save(&self, map: &HashMap<String, String>) -> Result<()> {
        let path = self.path()?;
        let json = serde_json::to_string(map).context("could not serialize the vault")?;
        write_owner_only(&path, json.as_bytes())
    }

    pub fn store_secret(&self, key: &str, secret: &str) -> Result<()> {
        let _guard = VAULT_LOCK.lock().map_err(|_| anyhow::anyhow!("vault lock poisoned"))?;
        let mut map = self.load()?;
        map.insert(key.to_string(), obfuscate(secret));
        self.save(&map)
    }

    pub fn get_secret(&self, key: &str) -> Result<String> {
        let _guard = VAULT_LOCK.lock().map_err(|_| anyhow::anyhow!("vault lock poisoned"))?;
        let map = self.load()?;
        let stored = map.get(key).context("secret not found")?;
        deobfuscate(stored).context("could not decode the secret")
    }

    /// Kept for interface compatibility. Biometric gating was removed along with
    /// the keychain, so this is now a plain read.
    pub fn get_secret_authenticated(&self, key: &str) -> Result<String> {
        self.get_secret(key)
    }

    pub fn delete_secret(&self, key: &str) -> Result<()> {
        let _guard = VAULT_LOCK.lock().map_err(|_| anyhow::anyhow!("vault lock poisoned"))?;
        let mut map = self.load()?;
        map.remove(key);
        self.save(&map)
    }
}

/// XOR-with-key, then hex-encode. Obfuscation only (see the struct doc).
fn obfuscate(s: &str) -> String {
    let bytes: Vec<u8> = s
        .bytes()
        .enumerate()
        .map(|(i, b)| b ^ OBFUSCATION_KEY[i % OBFUSCATION_KEY.len()])
        .collect();
    hex_encode(&bytes)
}

fn deobfuscate(hex: &str) -> Result<String> {
    let bytes = hex_decode(hex)?;
    let plain: Vec<u8> = bytes
        .iter()
        .enumerate()
        .map(|(i, b)| b ^ OBFUSCATION_KEY[i % OBFUSCATION_KEY.len()])
        .collect();
    String::from_utf8(plain).context("stored secret was not valid UTF-8")
}

fn hex_encode(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

fn hex_decode(s: &str) -> Result<Vec<u8>> {
    if s.len() % 2 != 0 {
        anyhow::bail!("odd-length hex");
    }
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).context("invalid hex digit"))
        .collect()
}

/// Write a file owner-only (0600) on Unix; a plain write elsewhere.
fn write_owner_only(path: &Path, data: &[u8]) -> Result<()> {
    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let mut f = opts.open(path).context("could not open the vault for writing")?;
    f.write_all(data).context("could not write the vault")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn obfuscation_roundtrips() {
        for secret in ["sk-ant-abc123", "", "unicode: café ☕", "a"] {
            let o = obfuscate(secret);
            if !secret.is_empty() {
                assert_ne!(o, secret, "non-empty secrets should not be stored as plaintext");
            }
            assert_eq!(deobfuscate(&o).unwrap(), secret);
        }
    }

    #[test]
    fn hex_roundtrips() {
        let bytes = [0u8, 1, 15, 16, 200, 255];
        assert_eq!(hex_decode(&hex_encode(&bytes)).unwrap(), bytes);
    }

    #[test]
    fn store_get_delete_flow() {
        // Uses a unique service so it doesn't collide with real secrets.
        let svc = VaultService::new("orbitae-test-vault-unit");
        let key = "k1";
        svc.store_secret(key, "s3cr3t").unwrap();
        assert_eq!(svc.get_secret(key).unwrap(), "s3cr3t");
        svc.delete_secret(key).unwrap();
        assert!(svc.get_secret(key).is_err());
    }
}
