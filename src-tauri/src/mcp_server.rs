use anyhow::{Result, bail};
use rmcp::{
    ServerHandler, ServiceExt,
    handler::server::router::tool::ToolRouter,
    model::*,
    schemars, tool, tool_handler, tool_router,
    transport::stdio,
};
use serde_json::json;
use sqlx::SqlitePool;
use std::sync::Arc;

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
struct ProjectIdParam {
    /// The project ID to query
    project_id: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
struct RunCommandParam {
    /// The project ID
    project_id: String,
    /// Shell command to execute
    command: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
struct QueryDatabaseParam {
    /// The database connection ID
    connection_id: String,
    /// SQL query to execute (SELECT only)
    query: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
struct SearchKnowledgeParam {
    /// The project ID
    project_id: String,
    /// Search query
    query: String,
    /// Filter by node kind (optional)
    kind: Option<String>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
struct ReadNotesParam {
    /// The project ID
    project_id: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
struct GetSecretsParam {
    /// The project ID
    project_id: String,
}

#[derive(Clone)]
#[allow(dead_code)]
struct OrbitaeMcpServer {
    pool: Arc<SqlitePool>,
    tool_router: ToolRouter<OrbitaeMcpServer>,
}

#[tool_router]
impl OrbitaeMcpServer {
    fn new(pool: SqlitePool) -> Self {
        Self {
            pool: Arc::new(pool),
            tool_router: Self::tool_router(),
        }
    }

    #[tool(description = "Get full project context: project details, scripts, git status, environment variables, active processes, and relevant knowledge graph nodes")]
    async fn get_project_context(
        &self,
        rmcp::handler::server::wrapper::Parameters(params): rmcp::handler::server::wrapper::Parameters<ProjectIdParam>,
    ) -> Result<CallToolResult, ErrorData> {
        let repo = app_lib::modules::projects::repository::ProjectRepository::new((*self.pool).clone());

        let project = repo.get_project(&params.project_id).await
            .map_err(|e| ErrorData::internal_error(e.to_string(), None))?
            .ok_or_else(|| ErrorData::invalid_params("Project not found", None))?;

        let envs = repo.get_project_envs(&params.project_id).await
            .map_err(|e| ErrorData::internal_error(e.to_string(), None))?;

        let snippets = repo.get_project_snippets(&params.project_id).await
            .map_err(|e| ErrorData::internal_error(e.to_string(), None))?;

        let notes = repo.get_project_notes(&params.project_id).await
            .map_err(|e| ErrorData::internal_error(e.to_string(), None))?;

        let links = repo.get_project_links(&params.project_id).await
            .map_err(|e| ErrorData::internal_error(e.to_string(), None))?;

        let git_status = app_lib::modules::git::get_git_status(&project.path).ok().flatten();

        let knowledge = app_lib::modules::knowledge::repository::KnowledgeRepository::new((*self.pool).clone())
            .get_project_nodes(&params.project_id).await
            .unwrap_or_default();

        let context = json!({
            "project": {
                "id": project.id,
                "name": project.name,
                "path": project.path,
            },
            "environment_variables": envs.iter().map(|e| json!({"key": e.key, "value": e.value})).collect::<Vec<_>>(),
            "snippets": snippets.iter().map(|s| json!({"label": s.label, "command": s.command, "description": s.description})).collect::<Vec<_>>(),
            "notes": notes.iter().map(|n| json!({"title": n.title, "content": n.content.chars().take(500).collect::<String>(), "kind": n.kind})).collect::<Vec<_>>(),
            "links": links.iter().map(|l| json!({"title": l.title, "url": l.url, "kind": l.kind})).collect::<Vec<_>>(),
            "git": git_status,
            "knowledge_nodes": knowledge.iter().take(20).map(|n| json!({"title": n.title, "kind": n.kind, "content": n.content.chars().take(300).collect::<String>()})).collect::<Vec<_>>(),
        });

        Ok(CallToolResult::success(vec![Content::text(
            serde_json::to_string_pretty(&context).unwrap_or_default()
        )]))
    }

    #[tool(description = "Execute a shell command in the project directory. Returns stdout and stderr.")]
    async fn run_command(
        &self,
        rmcp::handler::server::wrapper::Parameters(params): rmcp::handler::server::wrapper::Parameters<RunCommandParam>,
    ) -> Result<CallToolResult, ErrorData> {
        let repo = app_lib::modules::projects::repository::ProjectRepository::new((*self.pool).clone());

        let project = repo.get_project(&params.project_id).await
            .map_err(|e| ErrorData::internal_error(e.to_string(), None))?
            .ok_or_else(|| ErrorData::invalid_params("Project not found", None))?;

        let expanded = app_lib::shared::utils::expand_path(&project.path);

        let output = std::process::Command::new("sh")
            .args(["-c", &params.command])
            .current_dir(&expanded)
            .output()
            .map_err(|e| ErrorData::internal_error(format!("Failed to execute command: {}", e), None))?;

        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        let exit_code = output.status.code().unwrap_or(-1);

        let result = json!({
            "exit_code": exit_code,
            "stdout": stdout,
            "stderr": stderr,
        });

        Ok(CallToolResult::success(vec![Content::text(
            serde_json::to_string_pretty(&result).unwrap_or_default()
        )]))
    }

    #[tool(description = "Execute a read-only SQL query against a project's database connection")]
    async fn query_database(
        &self,
        rmcp::handler::server::wrapper::Parameters(params): rmcp::handler::server::wrapper::Parameters<QueryDatabaseParam>,
    ) -> Result<CallToolResult, ErrorData> {
        let db_repo = app_lib::modules::databases::repository::DatabaseRepository::new((*self.pool).clone());
        let db_service = app_lib::modules::databases::service::DatabaseService::new((*self.pool).clone());

        let connection = db_repo.get_connection(&params.connection_id).await
            .map_err(|e| ErrorData::internal_error(e.to_string(), None))?
            .ok_or_else(|| ErrorData::invalid_params("Database connection not found", None))?;

        let result = db_service.execute_query(&connection.kind, &connection.details, &params.query, None).await
            .map_err(|e| ErrorData::internal_error(e.to_string(), None))?;

        Ok(CallToolResult::success(vec![Content::text(
            serde_json::to_string_pretty(&result).unwrap_or_default()
        )]))
    }

    #[tool(description = "Search the project's knowledge graph for relevant information about architecture, conventions, decisions, runbooks, etc.")]
    async fn search_knowledge(
        &self,
        rmcp::handler::server::wrapper::Parameters(params): rmcp::handler::server::wrapper::Parameters<SearchKnowledgeParam>,
    ) -> Result<CallToolResult, ErrorData> {
        let service = app_lib::modules::knowledge::service::KnowledgeService::new((*self.pool).clone());

        let nodes = if params.kind.is_some() {
            service.search_nodes(&params.project_id, Some(&params.query), params.kind.as_deref(), Some("active"), Some(10)).await
        } else {
            service.build_context(&params.project_id, &params.query, 10).await
        }.map_err(|e| ErrorData::internal_error(e.to_string(), None))?;

        let result: Vec<_> = nodes.iter().map(|n| json!({
            "id": n.id,
            "title": n.title,
            "kind": n.kind,
            "content": n.content,
            "status": n.status,
            "tags": n.tags,
        })).collect();

        Ok(CallToolResult::success(vec![Content::text(
            serde_json::to_string_pretty(&result).unwrap_or_default()
        )]))
    }

    #[tool(description = "Get all notes for a project")]
    async fn read_notes(
        &self,
        rmcp::handler::server::wrapper::Parameters(params): rmcp::handler::server::wrapper::Parameters<ReadNotesParam>,
    ) -> Result<CallToolResult, ErrorData> {
        let repo = app_lib::modules::projects::repository::ProjectRepository::new((*self.pool).clone());

        let notes = repo.get_project_notes(&params.project_id).await
            .map_err(|e| ErrorData::internal_error(e.to_string(), None))?;

        let result: Vec<_> = notes.iter().map(|n| json!({
            "id": n.id,
            "title": n.title,
            "content": n.content,
            "kind": n.kind,
            "updated_at": n.updated_at,
        })).collect();

        Ok(CallToolResult::success(vec![Content::text(
            serde_json::to_string_pretty(&result).unwrap_or_default()
        )]))
    }

    #[tool(description = "List all secret key names for a project (values are NOT returned for security)")]
    async fn get_secrets(
        &self,
        rmcp::handler::server::wrapper::Parameters(params): rmcp::handler::server::wrapper::Parameters<GetSecretsParam>,
    ) -> Result<CallToolResult, ErrorData> {
        let repo = app_lib::modules::projects::repository::ProjectRepository::new((*self.pool).clone());

        let keys = repo.get_project_keys(&params.project_id).await
            .map_err(|e| ErrorData::internal_error(e.to_string(), None))?;

        let result: Vec<_> = keys.iter().map(|k| json!({
            "id": k.id,
            "name": k.name,
            "created_at": k.created_at,
        })).collect();

        Ok(CallToolResult::success(vec![Content::text(
            serde_json::to_string_pretty(&result).unwrap_or_default()
        )]))
    }

    #[tool(description = "List all projects managed by Orbitae")]
    async fn list_projects(&self) -> Result<CallToolResult, ErrorData> {
        let repo = app_lib::modules::projects::repository::ProjectRepository::new((*self.pool).clone());

        let projects = repo.list_projects().await
            .map_err(|e| ErrorData::internal_error(e.to_string(), None))?;

        let result: Vec<_> = projects.iter().map(|p| json!({
            "id": p.id,
            "name": p.name,
            "path": p.path,
        })).collect();

        Ok(CallToolResult::success(vec![Content::text(
            serde_json::to_string_pretty(&result).unwrap_or_default()
        )]))
    }
}

#[tool_handler]
impl ServerHandler for OrbitaeMcpServer {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(
            ServerCapabilities::builder()
                .enable_tools()
                .build(),
        )
        .with_server_info(Implementation::new("orbitae-mcp", env!("CARGO_PKG_VERSION")))
        .with_instructions(
            "Orbitae MCP Server — provides access to project context, shell commands, \
             database queries, knowledge graph, notes, and secrets managed by the Orbitae \
             developer command center."
                .to_string(),
        )
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    // MCP servers MUST log to stderr — stdout is the JSON-RPC transport
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive(tracing::Level::INFO.into()),
        )
        .with_writer(std::io::stderr)
        .with_ansi(false)
        .init();

    tracing::info!("Starting Orbitae MCP server");

    // Validate auth token — the launching client must pass ORBITAE_MCP_TOKEN
    let provided_token = std::env::var("ORBITAE_MCP_TOKEN").unwrap_or_default();
    if provided_token.is_empty() {
        bail!("ORBITAE_MCP_TOKEN environment variable is required. Get it from Orbitae Settings > MCP.");
    }

    let vault = app_lib::modules::vault::service::VaultService::new("com.orbitae.app");
    let expected_token = vault.get_secret("mcp-auth-token")
        .map_err(|_| anyhow::anyhow!("MCP auth token not found in keychain. Launch Orbitae first to generate it."))?;

    if provided_token != expected_token {
        bail!("Invalid MCP auth token. Regenerate from Orbitae Settings > MCP.");
    }

    tracing::info!("Auth token validated");

    // Connect to the same database Orbitae uses
    let app_data_dir = dirs::data_dir()
        .expect("Failed to get app data dir")
        .join("com.orbitae.app");

    let pool = app_lib::database::init_pool(&app_data_dir).await?;

    // Run migrations to ensure schema is current
    sqlx::migrate!("./migrations")
        .run(&pool)
        .await?;

    tracing::info!("Database connected, starting MCP transport");

    let server = OrbitaeMcpServer::new(pool);
    let service = server.serve(stdio()).await?;
    service.waiting().await?;

    Ok(())
}
