use portable_pty::PtyPair;
use std::io::Write;
use std::sync::{Arc, Mutex};

pub struct TerminalSession {
    pub pty_pair: PtyPair,
    pub writer: Box<dyn Write + Send>,
    pub project_id: String,
}

pub type TerminalSessions = Arc<Mutex<std::collections::HashMap<String, TerminalSession>>>;
