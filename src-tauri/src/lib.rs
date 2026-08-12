pub mod database;
pub mod modules;
pub mod shared;

use tauri::Manager;
use std::sync::{Arc, Mutex};
use std::collections::HashMap;
use tracing_subscriber::EnvFilter;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let filter = if cfg!(debug_assertions) {
      EnvFilter::new("app_lib=debug,info")
  } else {
      EnvFilter::new("app_lib=info,warn")
  };

  tracing_subscriber::fmt()
      .with_env_filter(filter)
      .with_target(true)
      .init();

  tauri::Builder::default()
    .setup(|app| {
      app.handle().plugin(tauri_plugin_shell::init())?;
      app.handle().plugin(tauri_plugin_dialog::init())?;
      app.handle().plugin(tauri_plugin_fs::init())?;

      let app_handle = app.handle();
      let app_data_dir = app_handle.path().app_data_dir().expect("failed to get app data dir");

      // Initialize Agent Session State
      let agent_session_state: modules::agent_sessions::models::AgentSessionState = Arc::new(Mutex::new(HashMap::new()));
      app_handle.manage(agent_session_state);

      // Initialize Embedded PTY Session State
      let embedded_state: modules::agent_sessions::embedded::EmbeddedSessionMap = Arc::new(Mutex::new(HashMap::new()));
      app_handle.manage(embedded_state);

      // Initialize Autonomous (task mode) Session State
      let autonomous_state: modules::agent_sessions::events::AutonomousSessionMap = Arc::new(Mutex::new(HashMap::new()));
      app_handle.manage(autonomous_state);

      tauri::async_runtime::block_on(async {
          let pool = database::init_pool(&app_data_dir).await.expect("failed to init database");

          sqlx::migrate!("./migrations")
              .run(&pool)
              .await
              .expect("failed to run migrations");

          app_handle.manage(pool);
      });

      // Initialize Semantic Router
      let router: modules::router::classifier::RouterState =
          std::sync::Arc::new(modules::router::classifier::SemanticRouter::new());
      app_handle.manage(router);

      if let Err(e) = modules::mcp::service::McpService::ensure_token() {
          tracing::warn!("Failed to provision MCP auth token: {}", e);
      }

      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
        // Projects
        modules::projects::commands::create_project,
        modules::projects::commands::list_projects,
        modules::projects::commands::get_project,
        modules::projects::commands::set_project_env,
        modules::projects::commands::get_project_envs,
        modules::projects::commands::update_project_notes,
        modules::projects::commands::update_project,
        modules::projects::commands::delete_project,
        modules::projects::commands::add_project_key,
        modules::projects::commands::get_project_keys,
        modules::projects::commands::delete_project_key,
        modules::projects::commands::reveal_secret,
        modules::projects::commands::create_project_note,
        modules::projects::commands::update_project_note,
        modules::projects::commands::delete_project_note,
        modules::projects::commands::get_project_notes,
        modules::projects::commands::save_project_note_image,
        modules::projects::commands::update_project_settings,
        modules::projects::commands::get_git_status,
        modules::projects::commands::git_clone,
        modules::projects::commands::get_git_history,
        modules::projects::commands::open_in_editor,
        modules::projects::commands::reveal_in_finder,
        modules::projects::commands::open_url,
        // Playbooks
        modules::projects::commands::create_playbook,
        modules::projects::commands::get_project_playbooks,
        modules::projects::commands::delete_playbook,
        modules::projects::commands::create_playbook_step,
        modules::projects::commands::get_playbook_steps,
        modules::projects::commands::export_project,
        modules::projects::commands::import_project_bundle,
        // Database Manager
        modules::databases::commands::create_connection,
        modules::databases::commands::get_connections,
        modules::databases::commands::delete_connection,
        modules::databases::commands::test_connection,
        modules::databases::commands::execute_query,
        modules::databases::commands::get_tables,
        // AI Provider Config
        modules::ai::commands::get_ai_providers,
        modules::ai::commands::save_ai_provider_config,
        modules::ai::commands::get_ai_provider_configs,
        modules::ai::commands::get_default_ai_config,
        modules::ai::commands::update_ai_provider_config,
        modules::ai::commands::delete_ai_provider_config,
        modules::ai::commands::get_ai_api_key,
        modules::ai::commands::create_conversation,
        modules::ai::commands::get_project_conversations,
        modules::ai::commands::update_conversation_title,
        modules::ai::commands::delete_conversation,
        modules::ai::commands::add_conversation_message,
        modules::ai::commands::get_conversation_messages,
        // MCP
        modules::mcp::commands::get_mcp_token,
        modules::mcp::commands::regenerate_mcp_token,
        modules::mcp::commands::get_mcp_client_config,
        modules::mcp::commands::get_mcp_binary_path,
        // Playbook Engine
        modules::playbooks::commands::run_playbook,
        modules::playbooks::commands::get_playbook_run,
        modules::playbooks::commands::get_project_playbook_runs,
        modules::playbooks::commands::export_playbook_yaml,
        modules::playbooks::commands::import_playbook_yaml,
        modules::playbooks::commands::scan_project_commands,
        modules::playbooks::commands::import_runbook_file,
        // Agent Sessions
        modules::agent_sessions::commands::launch_agent_sessions,
        modules::agent_sessions::commands::list_agent_sessions,
        modules::agent_sessions::commands::stop_agent_session,
        modules::agent_sessions::commands::remove_agent_session,
        modules::agent_sessions::commands::get_project_context_preview,
        modules::agent_sessions::commands::focus_agent_terminals,
        modules::agent_sessions::commands::get_session_diff,
        modules::agent_sessions::commands::scan_listening_ports,
        // Embedded Agent Sessions
        modules::agent_sessions::commands::launch_embedded_session,
        modules::agent_sessions::commands::write_to_embedded_session,
        modules::agent_sessions::commands::resize_embedded_session,
        modules::agent_sessions::commands::get_session_events,
        modules::agent_sessions::commands::get_session_metrics,
        // Semantic Router
        modules::router::commands::route_request,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
