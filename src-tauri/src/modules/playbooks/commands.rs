use super::executor::PlaybookExecutor;
use super::models::{PlaybookRunWithSteps, PlaybookYaml, PlaybookYamlStep};
use super::repository::PlaybookRunRepository;
use crate::modules::projects::repository::ProjectRepository;
use sqlx::SqlitePool;
use tauri::{command, AppHandle, State};

/// Runs a playbook by ID. Returns the completed run with all step results.
#[command]
pub async fn run_playbook(
    pool: State<'_, SqlitePool>,
    app_handle: AppHandle,
    playbook_id: String,
) -> Result<PlaybookRunWithSteps, String> {
    let executor = PlaybookExecutor::new(pool.inner().clone(), app_handle);
    executor.run_playbook(&playbook_id).await.map_err(|e| e.to_string())
}

/// Gets a playbook run with all step results.
#[command]
pub async fn get_playbook_run(
    pool: State<'_, SqlitePool>,
    run_id: String,
) -> Result<PlaybookRunWithSteps, String> {
    let repo = PlaybookRunRepository::new(pool.inner().clone());
    let run = repo.get_run(&run_id).await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Run not found".to_string())?;
    let steps = repo.get_run_steps(&run_id).await
        .map_err(|e| e.to_string())?;
    Ok(PlaybookRunWithSteps { run, steps })
}

/// Gets recent playbook runs for a project.
#[command]
pub async fn get_project_playbook_runs(
    pool: State<'_, SqlitePool>,
    project_id: String,
    limit: Option<i64>,
) -> Result<Vec<super::models::PlaybookRun>, String> {
    let repo = PlaybookRunRepository::new(pool.inner().clone());
    repo.get_project_runs(&project_id, limit.unwrap_or(20)).await
        .map_err(|e| e.to_string())
}

/// Exports a playbook and its steps as a YAML string.
#[command]
pub async fn export_playbook_yaml(
    pool: State<'_, SqlitePool>,
    playbook_id: String,
) -> Result<String, String> {
    let repo = ProjectRepository::new(pool.inner().clone());

    let playbook = repo.get_project_playbooks_by_id(&playbook_id).await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Playbook not found".to_string())?;

    let steps = repo.get_playbook_steps(&playbook_id).await
        .map_err(|e| e.to_string())?;

    let yaml_doc = PlaybookYaml {
        name: playbook.name,
        description: playbook.description,
        steps: steps.into_iter().map(|s| PlaybookYamlStep {
            name: s.name,
            r#type: s.r#type,
            command: s.command,
            depends_on: s.depends_on,
            expected_output: s.expected_output,
            on_failure: s.on_failure,
            max_retries: s.max_retries,
            retry_delay_ms: s.retry_delay_ms,
        }).collect(),
    };

    serde_yaml::to_string(&yaml_doc).map_err(|e| e.to_string())
}

/// Scan a project directory for discoverable commands (package.json scripts,
/// Makefile targets, docker-compose services, etc.) and return them as
/// structured suggestions for auto-generating a runbook.
#[command]
pub async fn scan_project_commands(
    project_path: String,
) -> Result<Vec<DiscoveredCommand>, String> {
    let expanded = crate::shared::utils::expand_path(&project_path);
    let root = std::path::Path::new(&expanded);
    let mut commands: Vec<DiscoveredCommand> = Vec::new();

    // package.json scripts
    let pkg_path = root.join("package.json");
    if pkg_path.exists() {
        if let Ok(content) = std::fs::read_to_string(&pkg_path) {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(scripts) = json.get("scripts").and_then(|s| s.as_object()) {
                    for (name, cmd) in scripts {
                        commands.push(DiscoveredCommand {
                            name: name.clone(),
                            command: format!("npm run {}", name),
                            source: "package.json".to_string(),
                            raw_command: cmd.as_str().unwrap_or("").to_string(),
                        });
                    }
                }
            }
        }
    }

    // Makefile targets
    let makefile_path = root.join("Makefile");
    if makefile_path.exists() {
        if let Ok(content) = std::fs::read_to_string(&makefile_path) {
            for line in content.lines() {
                if let Some(target) = line.strip_suffix(':') {
                    let target = target.trim();
                    if !target.is_empty() && !target.starts_with('.') && !target.contains(' ') {
                        commands.push(DiscoveredCommand {
                            name: target.to_string(),
                            command: format!("make {}", target),
                            source: "Makefile".to_string(),
                            raw_command: String::new(),
                        });
                    }
                }
            }
        }
    }

    // docker-compose services
    for dc_name in &["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"] {
        let dc_path = root.join(dc_name);
        if dc_path.exists() {
            if let Ok(content) = std::fs::read_to_string(&dc_path) {
                if let Ok(yaml) = serde_yaml::from_str::<serde_json::Value>(&content) {
                    if let Some(services) = yaml.get("services").and_then(|s| s.as_object()) {
                        for svc_name in services.keys() {
                            commands.push(DiscoveredCommand {
                                name: format!("{} (up)", svc_name),
                                command: format!("docker compose up {}", svc_name),
                                source: dc_name.to_string(),
                                raw_command: String::new(),
                            });
                        }
                    }
                }
            }
            break;
        }
    }

    // Cargo.toml (Rust projects)
    let cargo_path = root.join("Cargo.toml");
    if cargo_path.exists() {
        for (name, cmd) in &[
            ("build", "cargo build"),
            ("test", "cargo test"),
            ("run", "cargo run"),
            ("check", "cargo check"),
            ("clippy", "cargo clippy"),
        ] {
            commands.push(DiscoveredCommand {
                name: name.to_string(),
                command: cmd.to_string(),
                source: "Cargo.toml".to_string(),
                raw_command: String::new(),
            });
        }
    }

    Ok(commands)
}

#[derive(serde::Serialize)]
pub struct DiscoveredCommand {
    pub name: String,
    pub command: String,
    pub source: String,
    pub raw_command: String,
}

/// Import a runbook from a `.orbitae-runbook.yml` file in the project root.
#[command]
pub async fn import_runbook_file(
    pool: State<'_, SqlitePool>,
    project_id: String,
    project_path: String,
) -> Result<String, String> {
    let expanded = crate::shared::utils::expand_path(&project_path);
    let file_path = std::path::Path::new(&expanded).join(".orbitae-runbook.yml");

    if !file_path.exists() {
        return Err("No .orbitae-runbook.yml found in the project root. Generate one first with an AI agent.".to_string());
    }

    let yaml_content = std::fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read runbook file: {}", e))?;

    let yaml_doc: PlaybookYaml = serde_yaml::from_str(&yaml_content)
        .map_err(|e| format!("Invalid YAML in .orbitae-runbook.yml: {}", e))?;

    let repo = ProjectRepository::new(pool.inner().clone());

    let playbook = repo.create_playbook(
        project_id,
        yaml_doc.name,
        yaml_doc.description,
    ).await.map_err(|e| e.to_string())?;

    for step in yaml_doc.steps {
        repo.create_playbook_step(
            playbook.id.clone(),
            step.name,
            step.r#type,
            step.command,
            step.depends_on,
            step.expected_output,
        ).await.map_err(|e| e.to_string())?;
    }

    Ok(playbook.id)
}

/// Imports a playbook from a YAML string into a project.
#[command]
pub async fn import_playbook_yaml(
    pool: State<'_, SqlitePool>,
    project_id: String,
    yaml_content: String,
) -> Result<String, String> {
    let yaml_doc: PlaybookYaml = serde_yaml::from_str(&yaml_content)
        .map_err(|e| format!("Invalid YAML: {}", e))?;

    let repo = ProjectRepository::new(pool.inner().clone());

    let playbook = repo.create_playbook(
        project_id,
        yaml_doc.name,
        yaml_doc.description,
    ).await.map_err(|e| e.to_string())?;

    for step in yaml_doc.steps {
        repo.create_playbook_step(
            playbook.id.clone(),
            step.name,
            step.r#type,
            step.command,
            step.depends_on,
            step.expected_output,
        ).await.map_err(|e| e.to_string())?;
    }

    Ok(playbook.id)
}
