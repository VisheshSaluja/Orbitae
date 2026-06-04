use std::sync::{Arc, Mutex};
// Actually checkuse std::sync::{Arc, Mutex};
use tauri::{Window, Emitter};
use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};

use std::io::{Read, Write};
use std::thread;
use anyhow::{Result, anyhow};
use uuid::Uuid;
use super::models::{OutputBuffer, Process, ProcessSession, ProcessState};

pub struct ProcessService {
    state: ProcessState,
}

impl ProcessService {
    pub fn new(state: ProcessState) -> Self {
        Self { state }
    }

    pub fn start_process(&self, window: Window, command: String, cwd: String) -> Result<Process> {
        let pty_system = NativePtySystem::default();

        // Wrap command in shell to handle arguments and PATH resolution properly
        #[cfg(target_os = "windows")]
        let (shell, args) = ("cmd", vec!["/C", &command]);
        #[cfg(not(target_os = "windows"))]
        let (shell, args) = ("sh", vec!["-c", &command]);

        let mut cmd = CommandBuilder::new(shell);
        cmd.args(&args);
        cmd.cwd(&cwd);

        let pair = pty_system.openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })?;

        let writer = pair.master.take_writer().map_err(|e| anyhow!("Failed to get process writer: {}", e))?;

        let child = pair.slave.spawn_command(cmd)?;

        let pid = child.process_id().unwrap_or(0);

        let id = Uuid::new_v4().to_string();
        
        
        let mut reader = pair.master.try_clone_reader()?;
        let process_id = id.clone();
        let window_clone = window.clone();
        
        let history = Arc::new(Mutex::new(OutputBuffer::new()));
        let history_clone = history.clone();

        thread::spawn(move || {
            let mut buf = [0u8; 1024];
            loop {
                match reader.read(&mut buf) {
                    Ok(n) if n > 0 => {
                        let data = String::from_utf8_lossy(&buf[..n]).to_string();
                        // Append to history
                        if let Ok(mut lock) = history_clone.lock() {
                            lock.push(&data);
                        }
                        
                        // Emit event to frontend
                        let _ = window_clone.emit("process_output", serde_json::json!({
                            "id": process_id,
                            "data": data
                        }));
                    }
                    Ok(_) => break, // EOF
                    Err(_) => break, // Error
                }
            }
            let _ = window_clone.emit("process_exit", serde_json::json!({
                "id": process_id
            }));
        });

        let session = ProcessSession {
            pty_pair: pair,
            process: child,
            running: true,
            history,
            command: command.clone(),
            cwd: cwd.clone(),
            writer: Arc::new(Mutex::new(writer)),
        };

        self.state.lock().map_err(|_| anyhow!("Failed to acquire process lock"))?.insert(id.clone(), session);

        Ok(Process {
            id,
            command,
            cwd,
            running: true,
            pid,
        })
    }

    pub fn write(&self, id: &str, data: &str) -> Result<()> {
        let state = self.state.lock().map_err(|_| anyhow!("Failed to acquire process lock"))?;
        let session = state.get(id).ok_or_else(|| anyhow!("Process not found: {}", id))?;
        let mut writer = session.writer.lock().map_err(|_| anyhow!("Failed to acquire writer lock"))?;
        writer.write_all(data.as_bytes())?;
        writer.flush()?;
        Ok(())
    }


    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<()> {
        let mut state = self.state.lock().map_err(|_| anyhow!("Failed to acquire process lock"))?;
        if let Some(session) = state.get_mut(id) {
            session.pty_pair.master.resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })?;
            Ok(())
        } else {
            Err(anyhow!("Process not found"))
        }
    }

    pub fn kill(&self, id: &str) -> Result<()> {
        let mut state = self.state.lock().map_err(|_| anyhow!("Failed to acquire process lock"))?;
        if let Some(mut session) = state.remove(id) {
            session.process.kill()?;
            Ok(())
        } else {
            Err(anyhow!("Process not found"))
        }
    }

    pub fn get_history(&self, id: &str) -> Result<String> {
        let state = self.state.lock().map_err(|_| anyhow!("Failed to acquire process lock"))?;
        if let Some(session) = state.get(id) {
             let history = session.history.lock().map_err(|_| anyhow!("Failed to acquire history lock"))?;
             Ok(history.contents())
        } else {
            Err(anyhow!("Process not found"))
        }
    }

    pub fn list_processes(&self) -> Result<Vec<Process>> {
        let state = self.state.lock().map_err(|_| anyhow!("Failed to acquire process lock"))?;
        let mut processes = Vec::new();
        for (id, session) in state.iter() {
             // Check if process is still running?
             // Or rely on 'running' flag?
             // Ideally we check session.process.try_wait()? 
             
             processes.push(Process {
                 id: id.clone(),
                 command: session.command.clone(),
                 cwd: session.cwd.clone(),
                 running: session.running,
                 pid: 0, // session.process.process_id().unwrap_or(0), can't easily access
             });
        }
        Ok(processes)
    }
}
