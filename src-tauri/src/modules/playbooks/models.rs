use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct PlaybookRun {
    pub id: String,
    pub playbook_id: String,
    pub project_id: String,
    pub status: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    #[sqlx(default)]
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct StepRun {
    pub id: String,
    pub run_id: String,
    pub step_id: String,
    pub step_name: String,
    pub step_type: String,
    pub status: String,
    pub exit_code: Option<i32>,
    pub stdout: Option<String>,
    pub stderr: Option<String>,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub attempt: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaybookRunWithSteps {
    pub run: PlaybookRun,
    pub steps: Vec<StepRun>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaybookYamlStep {
    pub name: String,
    pub r#type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub depends_on: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expected_output: Option<String>,
    #[serde(default = "default_on_failure")]
    pub on_failure: String,
    #[serde(default)]
    pub max_retries: i32,
    #[serde(default = "default_retry_delay")]
    pub retry_delay_ms: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaybookYaml {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub steps: Vec<PlaybookYamlStep>,
}

fn default_on_failure() -> String { "abort".to_string() }
fn default_retry_delay() -> i32 { 1000 }
