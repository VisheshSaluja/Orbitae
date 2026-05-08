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
