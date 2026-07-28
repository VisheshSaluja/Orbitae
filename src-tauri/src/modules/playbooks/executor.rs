use super::models::PlaybookRunWithSteps;
use super::repository::PlaybookRunRepository;
use crate::modules::projects::repository::ProjectRepository;
use anyhow::{Result, bail};
use sqlx::SqlitePool;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;
use serde_json::json;

pub struct PlaybookExecutor {
    pool: SqlitePool,
    app_handle: AppHandle,
}

impl PlaybookExecutor {
    pub fn new(pool: SqlitePool, app_handle: AppHandle) -> Self {
        Self { pool, app_handle }
    }

    /// Starts a playbook run: creates run/step records, then executes in waves.
    /// Steps with no `depends_on` (or all deps satisfied) run in parallel.
    pub async fn run_playbook(&self, playbook_id: &str) -> Result<PlaybookRunWithSteps> {
        let project_repo = ProjectRepository::new(self.pool.clone());
        let run_repo = PlaybookRunRepository::new(self.pool.clone());

        let steps = project_repo.get_playbook_steps(playbook_id).await?;
        if steps.is_empty() {
            bail!("Playbook has no steps");
        }

        let playbook = project_repo
            .get_project_playbooks_by_id(playbook_id)
            .await?
            .ok_or_else(|| anyhow::anyhow!("Playbook not found"))?;

        let run_id = uuid::Uuid::new_v4().to_string();
        run_repo.create_run(&run_id, playbook_id, &playbook.project_id).await?;

        let mut step_run_ids = Vec::new();
        for step in &steps {
            let step_run_id = uuid::Uuid::new_v4().to_string();
            run_repo.create_step_run(&step_run_id, &run_id, &step.id, &step.name, &step.r#type).await?;
            step_run_ids.push(step_run_id);
        }

        run_repo.update_run_status(&run_id, "running").await?;
        self.emit_run_event(&run_id, "running", None);

        let project = project_repo.get_project(&playbook.project_id).await?;
        let work_dir = project.map(|p| crate::shared::utils::expand_path(&p.path)).unwrap_or_default();

        // Build dependency graph: step_id -> list of dependency step_ids
        let mut step_index: HashMap<String, usize> = HashMap::new();
        let mut deps: HashMap<String, Vec<String>> = HashMap::new();
        for (i, step) in steps.iter().enumerate() {
            step_index.insert(step.id.clone(), i);
            let dep_ids: Vec<String> = step.depends_on.as_deref()
                .filter(|s| !s.is_empty())
                .map(|s| s.split(',').map(|d| d.trim().to_string()).collect())
                .unwrap_or_default();
            deps.insert(step.id.clone(), dep_ids);
        }

        let completed: Arc<Mutex<HashSet<String>>> = Arc::new(Mutex::new(HashSet::new()));
        let aborted: Arc<Mutex<bool>> = Arc::new(Mutex::new(false));
        let mut started: HashSet<String> = HashSet::new();
        let mut all_passed = true;

        loop {
            if *aborted.lock().await {
                for step in &steps {
                    if !started.contains(&step.id) {
                        let idx = step_index[&step.id];
                        run_repo.update_step_run(&step_run_ids[idx], "skipped", None, None, None).await?;
                        self.emit_step_event(&run_id, &step_run_ids[idx], &step.name, "skipped", None);
                    }
                }
                break;
            }

            let completed_set = completed.lock().await.clone();

            // Find steps whose dependencies are all satisfied and haven't started yet
            let mut ready: Vec<usize> = Vec::new();
            for step in &steps {
                if started.contains(&step.id) { continue; }
                let step_deps = &deps[&step.id];
                if step_deps.iter().all(|d| completed_set.contains(d)) {
                    ready.push(step_index[&step.id]);
                }
            }

            if ready.is_empty() {
                if started.len() == steps.len() { break; }
                // Remaining steps have unresolvable deps — skip them
                for step in &steps {
                    if !started.contains(&step.id) {
                        let idx = step_index[&step.id];
                        run_repo.update_step_run(&step_run_ids[idx], "skipped", None, None, None).await?;
                        self.emit_step_event(&run_id, &step_run_ids[idx], &step.name, "skipped", None);
                        all_passed = false;
                    }
                }
                break;
            }

            for &idx in &ready {
                started.insert(steps[idx].id.clone());
            }

            // Execute ready steps in parallel
            let mut join_set = tokio::task::JoinSet::new();

            for &idx in &ready {
                let step = steps[idx].clone();
                let step_run_id = step_run_ids[idx].clone();
                let run_id = run_id.clone();
                let work_dir = work_dir.clone();
                let pool = self.pool.clone();
                let app_handle = self.app_handle.clone();
                let completed = completed.clone();
                let aborted = aborted.clone();

                join_set.spawn(async move {
                    let exec = PlaybookExecutor::new(pool.clone(), app_handle);
                    let repo = PlaybookRunRepository::new(pool);

                    let max_retries = step.max_retries.max(0) as u32;
                    let retry_delay = step.retry_delay_ms.max(100) as u64;
                    let attempts = if step.on_failure == "retry" { max_retries + 1 } else { 1 };

                    repo.update_step_run(&step_run_id, "running", None, None, None).await.ok();
                    exec.emit_step_event(&run_id, &step_run_id, &step.name, "running", None);

                    let mut passed = false;

                    for attempt in 0..attempts {
                        if attempt > 0 {
                            repo.increment_step_attempt(&step_run_id).await.ok();
                            repo.update_step_run(&step_run_id, "running", None, None, None).await.ok();
                            exec.emit_step_event(&run_id, &step_run_id, &step.name, "running", None);
                            tokio::time::sleep(Duration::from_millis(retry_delay * (attempt as u64 + 1))).await;
                        }

                        match exec.execute_step(&step, &work_dir).await {
                            Ok((code, stdout, stderr)) if code == 0 => {
                                repo.update_step_run(&step_run_id, "passed", Some(code), Some(&stdout), Some(&stderr)).await.ok();
                                exec.emit_step_event(&run_id, &step_run_id, &step.name, "passed", Some(code));
                                passed = true;
                                break;
                            }
                            Ok((code, stdout, stderr)) => {
                                if attempt == attempts - 1 {
                                    repo.update_step_run(&step_run_id, "failed", Some(code), Some(&stdout), Some(&stderr)).await.ok();
                                    exec.emit_step_event(&run_id, &step_run_id, &step.name, "failed", Some(code));
                                }
                            }
                            Err(e) => {
                                if attempt == attempts - 1 {
                                    repo.update_step_run(&step_run_id, "failed", None, None, Some(&e.to_string())).await.ok();
                                    exec.emit_step_event(&run_id, &step_run_id, &step.name, "failed", None);
                                }
                            }
                        }
                    }

                    if passed {
                        completed.lock().await.insert(step.id.clone());
                    } else if step.on_failure == "skip" {
                        repo.update_step_run(&step_run_id, "skipped", None, None, None).await.ok();
                        exec.emit_step_event(&run_id, &step_run_id, &step.name, "skipped", None);
                        completed.lock().await.insert(step.id.clone());
                    } else {
                        *aborted.lock().await = true;
                    }

                    passed
                });
            }

            while let Some(result) = join_set.join_next().await {
                if !result.unwrap_or(false) {
                    all_passed = false;
                }
            }
        }

        let was_aborted = *aborted.lock().await;
        let final_status = if all_passed { "passed" } else if was_aborted { "aborted" } else { "failed" };
        run_repo.update_run_status(&run_id, final_status).await?;
        self.emit_run_event(&run_id, final_status, None);

        let step_runs = run_repo.get_run_steps(&run_id).await?;
        let final_run = run_repo.get_run(&run_id).await?.unwrap();

        let _ = (&playbook.project_id, &playbook.name, final_status);

        Ok(PlaybookRunWithSteps { run: final_run, steps: step_runs })
    }

    /// Executes a single step based on its type. Returns (exit_code, stdout, stderr).
    async fn execute_step(
        &self,
        step: &crate::modules::projects::models::PlaybookStep,
        work_dir: &str,
    ) -> Result<(i32, String, String)> {
        match step.r#type.as_str() {
            "command" | "process" => {
                let cmd = step.command.as_deref().unwrap_or("");
                if cmd.is_empty() {
                    bail!("Command step has no command");
                }
                self.run_command(cmd, work_dir).await
            }
            "health_check" => {
                let target = step.command.as_deref().unwrap_or("");
                if target.is_empty() {
                    bail!("Health check step has no target");
                }
                let mode = step.expected_output.as_deref().unwrap_or("http");
                match mode {
                    "tcp" => self.check_tcp(target).await,
                    _ => self.check_http(target).await,
                }
            }
            "delay" => {
                let ms: u64 = step.command.as_deref().unwrap_or("1000").parse().unwrap_or(1000);
                tokio::time::sleep(tokio::time::Duration::from_millis(ms)).await;
                Ok((0, format!("Waited {}ms", ms), String::new()))
            }
            other => {
                bail!("Unknown step type: {}", other);
            }
        }
    }

    /// Runs a shell command and captures output.
    async fn run_command(&self, command: &str, work_dir: &str) -> Result<(i32, String, String)> {
        let output = tokio::process::Command::new("sh")
            .args(["-c", command])
            .current_dir(work_dir)
            .output()
            .await?;

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let exit_code = output.status.code().unwrap_or(-1);

        Ok((exit_code, stdout, stderr))
    }

    /// Polls an HTTP endpoint until it returns 2xx, up to 30 seconds.
    async fn check_http(&self, url: &str) -> Result<(i32, String, String)> {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(5))
            .danger_accept_invalid_certs(true)
            .build()?;
        let deadline = tokio::time::Instant::now() + Duration::from_secs(30);

        loop {
            match client.get(url).send().await {
                Ok(resp) if resp.status().is_success() => {
                    let status = resp.status().as_u16();
                    return Ok((0, format!("HTTP {} from {}", status, url), String::new()));
                }
                Ok(resp) => {
                    if tokio::time::Instant::now() >= deadline {
                        return Ok((1, String::new(), format!("HTTP {} from {} (timeout after 30s)", resp.status().as_u16(), url)));
                    }
                }
                Err(_) => {
                    if tokio::time::Instant::now() >= deadline {
                        return Ok((1, String::new(), format!("Connection to {} failed (timeout after 30s)", url)));
                    }
                }
            }
            tokio::time::sleep(Duration::from_secs(2)).await;
        }
    }

    /// Polls a TCP host:port until a connection succeeds, up to 30 seconds.
    async fn check_tcp(&self, target: &str) -> Result<(i32, String, String)> {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(30);

        loop {
            match tokio::time::timeout(Duration::from_secs(3), tokio::net::TcpStream::connect(target)).await {
                Ok(Ok(_)) => {
                    return Ok((0, format!("TCP connection to {} succeeded", target), String::new()));
                }
                _ => {
                    if tokio::time::Instant::now() >= deadline {
                        return Ok((1, String::new(), format!("TCP connection to {} failed (timeout after 30s)", target)));
                    }
                }
            }
            tokio::time::sleep(Duration::from_secs(2)).await;
        }
    }


    /// Emits a Tauri event for run status changes.
    fn emit_run_event(&self, run_id: &str, status: &str, _detail: Option<&str>) {
        let _ = self.app_handle.emit("playbook-run-update", json!({
            "runId": run_id,
            "status": status,
        }));
    }

    /// Emits a Tauri event for step status changes.
    fn emit_step_event(&self, run_id: &str, step_run_id: &str, step_name: &str, status: &str, exit_code: Option<i32>) {
        let _ = self.app_handle.emit("playbook-step-update", json!({
            "runId": run_id,
            "stepRunId": step_run_id,
            "stepName": step_name,
            "status": status,
            "exitCode": exit_code,
        }));
    }
}
