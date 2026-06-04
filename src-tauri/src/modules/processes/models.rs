use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::io::Write;
use portable_pty::PtyPair;

/// Maximum size of the process output ring buffer (1 MB).
const MAX_HISTORY_BYTES: usize = 1_048_576;

/// A capped ring buffer for process output that evicts the oldest chunks
/// once the total size exceeds `MAX_HISTORY_BYTES`, preventing unbounded
/// memory growth from long-running processes.
#[derive(Default)]
pub struct OutputBuffer {
    chunks: VecDeque<String>,
    total_bytes: usize,
}

impl OutputBuffer {
    /// Creates an empty output buffer.
    pub fn new() -> Self {
        Self::default()
    }

    /// Appends a chunk of output, evicting the oldest chunks if the buffer
    /// would exceed the 1 MB cap.
    pub fn push(&mut self, data: &str) {
        let len = data.len();
        self.chunks.push_back(data.to_string());
        self.total_bytes += len;
        while self.total_bytes > MAX_HISTORY_BYTES {
            if let Some(removed) = self.chunks.pop_front() {
                self.total_bytes -= removed.len();
            } else {
                break;
            }
        }
    }

    /// Returns the buffered output as a single concatenated string.
    pub fn contents(&self) -> String {
        self.chunks.iter().cloned().collect()
    }
}

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
    pub history: Arc<Mutex<OutputBuffer>>,
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
