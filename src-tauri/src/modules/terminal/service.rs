use super::models::{TerminalSession, TerminalSessions};
use crate::modules::projects::repository::ProjectRepository;
use anyhow::{Context, Result};
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::{Read, Write};
use std::thread;
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

pub struct TerminalService {
    sessions: TerminalSessions,
    project_repo: ProjectRepository,
}

impl TerminalService {
    pub fn new(sessions: TerminalSessions, repo: ProjectRepository) -> Self {
        Self {
            sessions,
            project_repo: repo,
        }
    }



    pub async fn spawn_shell(&self, app_handle: AppHandle, project_id: String, initial_command: Option<String>) -> Result<String> {
        let project = self.project_repo.get_project(&project_id).await
            .context("Failed to fetch project")?
            .context("Project not found")?;

        let envs = self.project_repo.get_project_envs(&project_id).await?;

        // Initialize PTY system
        let pty_system = native_pty_system();
        let pair = pty_system.openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })?;

        // Configure Command
        // Default to shell env var or /bin/zsh or cmd.exe
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
        tracing::debug!("Using shell: {}", shell);
        
        let mut cmd = CommandBuilder::new(shell);
        cmd.args(["-l"]);
        cmd.env("TERM", "xterm-256color");
        
        // Cwd
        // Expand ~ if present
        let expanded_path = crate::shared::utils::expand_path(&project.path);
        tracing::debug!("Spawning shell in path: {}", expanded_path);

        let path_obj = std::path::Path::new(&expanded_path);
        if !path_obj.exists() {
             tracing::debug!("Path missing, auto-creating: {}", expanded_path);
             if let Err(e) = std::fs::create_dir_all(&path_obj) {
                tracing::error!("Failed to create path: {}", e);
                return Err(anyhow::anyhow!("Failed to create project path: {}", e));
             }
        }

        cmd.cwd(expanded_path);

        // Env Vars
        for env in envs {
            cmd.env(env.key, env.value);
        }

        tracing::debug!("Spawning command: {:?}", cmd);
        let _child = pair.slave.spawn_command(cmd)?;

        // If we have an initial command (like ssh), write it immediately
        if let Some(cmd_str) = initial_command {
            let mut writer = pair.master.take_writer()?;
            let cmd_with_newline = format!("{}\r", cmd_str); // Add return
            writer.write_all(cmd_with_newline.as_bytes())?;
        }
        
        // Generate Session ID
        let session_id = Uuid::new_v4().to_string();

        // Start Reader Thread
        let mut reader = pair.master.try_clone_reader()?;
        let app_handle_clone = app_handle.clone();
        let session_id_clone = session_id.clone();

        thread::spawn(move || {
            let mut buffer = [0u8; 1024];
            loop {
                match reader.read(&mut buffer) {
                    Ok(n) if n > 0 => {
                        let data = String::from_utf8_lossy(&buffer[..n]).to_string();
                        let _ = app_handle_clone.emit("terminal_data", Payload {
                            session_id: session_id_clone.clone(),
                            data,
                        });
                    }
                    Ok(_) => {
                         tracing::debug!("PTY Reader EOF for session {}", session_id_clone);
                         break;
                    }
                    Err(e) => {
                         tracing::debug!("PTY Reader Error for session {}: {}", session_id_clone, e);
                         break;
                    }
                }
            }
            // Cleanup or emit exit event
        });

        // Store Session
        let session = TerminalSession {
            pty_pair: pair,
            project_id: project_id.clone(),
        };

        self.sessions.lock().map_err(|_| anyhow::anyhow!("Failed to acquire session lock"))?.insert(session_id.clone(), session);

        Ok(session_id)
    }

    pub fn write_to_shell(&self, session_id: &str, data: &str) -> Result<()> {
        tracing::debug!("Writing {} bytes to session {}", data.len(), session_id);
        let mut sessions = self.sessions.lock().map_err(|_| anyhow::anyhow!("Failed to acquire session lock"))?;
        if let Some(session) = sessions.get_mut(session_id) {
            let mut writer = session.pty_pair.master.take_writer()?;
            writer.write_all(data.as_bytes())?;
        } else {
             tracing::error!("Session {} not found", session_id);
        }
        Ok(())
    }

    pub fn resize_shell(&self, session_id: &str, cols: u16, rows: u16) -> Result<()> {
        let mut sessions = self.sessions.lock().map_err(|_| anyhow::anyhow!("Failed to acquire session lock"))?;
        if let Some(session) = sessions.get_mut(session_id) {
            session.pty_pair.master.resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })?;
        }
        Ok(())
    }
}

#[derive(Clone, serde::Serialize)]
struct Payload {
    session_id: String,
    data: String,
}
