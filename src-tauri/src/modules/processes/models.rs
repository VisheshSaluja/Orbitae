use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::io::Write;
use portable_pty::PtyPair;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Process {
    pub id: String,
    pub command: String,
    pub cwd: String,
    pub running: bool,
    pub pid: u32,
}

pub struct ProcessSession {
    pub pty_pair: PtyPair,
    pub process: Box<dyn portable_pty::Child>,
    pub running: bool,
    pub history: Arc<Mutex<String>>,
    pub command: String,
    pub cwd: String,
    pub writer: Arc<Mutex<Box<dyn Write + Send>>>,
}

// SAFETY: portable_pty types wrap OS handles (FDs on Unix, Handles on Windows) which are generally Send/Sync.
// The trait objects returned by portable-pty don't explicitly enforce Send/Sync but the underlying implementations are.
unsafe impl Send for ProcessSession {}
unsafe impl Sync for ProcessSession {}

// Global state container
pub type ProcessState = Arc<Mutex<HashMap<String, ProcessSession>>>;
