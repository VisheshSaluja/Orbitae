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

      // Initialize Database
      let app_handle = app.handle();
      // In Tauri v2, we can get the path via app_handle.path() helper
      // Note: app_data_dir() returns a Result, need to unwrap or handle
      let app_data_dir = app_handle.path().app_data_dir().expect("failed to get app data dir");
      
      // Initialize Terminal Sessions State
      let terminal_sessions: modules::terminal::models::TerminalSessions = Arc::new(Mutex::new(HashMap::new()));
      app_handle.manage(terminal_sessions);

      // Initialize Process State
      let process_state: modules::processes::models::ProcessState = Arc::new(Mutex::new(HashMap::new()));
      app_handle.manage(process_state);

      tauri::async_runtime::block_on(async {
          let pool = database::init_pool(&app_data_dir).await.expect("failed to init database");
          
          // Run migrations
          sqlx::migrate!("./migrations")
              .run(&pool)
              .await
              .expect("failed to run migrations");

          app_handle.manage(pool);
      });

      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
        modules::ssh::commands::get_ssh_hosts,
        modules::ssh::commands::add_ssh_host,
        modules::projects::commands::create_project,
        modules::projects::commands::list_projects,
        modules::projects::commands::get_project,
        modules::projects::commands::set_project_env,
        modules::projects::commands::get_project_envs,
        modules::projects::commands::add_project_link,
        modules::projects::commands::get_project_links,
        modules::projects::commands::delete_project_link,
        modules::projects::commands::open_url,
        modules::projects::commands::update_project_notes,
        modules::projects::commands::add_snippet,
        modules::projects::commands::get_project_snippets,
        modules::projects::commands::delete_snippet,
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
        modules::projects::commands::get_project_scripts,
        modules::projects::commands::save_project_note_image,
        modules::projects::commands::update_project_settings,
        modules::projects::commands::get_git_status,
        modules::projects::commands::git_clone,
        modules::projects::commands::get_git_history,
        modules::projects::commands::open_in_editor,
        modules::projects::commands::reveal_in_finder,
        modules::terminal::commands::spawn_shell,
        modules::terminal::commands::write_to_shell,
        modules::terminal::commands::resize_shell,
        modules::terminal::commands::open_external_terminal,
        modules::projects::commands::create_playbook,
        modules::projects::commands::get_project_playbooks,
        modules::projects::commands::delete_playbook,
        modules::projects::commands::create_playbook_step,
        modules::projects::commands::get_playbook_steps,
        // Process Manager
        modules::processes::commands::start_process,
        modules::processes::commands::write_to_process,
        modules::processes::commands::resize_process,
        modules::processes::commands::stop_process,
        modules::processes::commands::get_process_history,
        modules::processes::commands::get_active_processes,
        // Database Manager
        modules::databases::commands::create_connection,
        modules::databases::commands::get_connections,
        modules::databases::commands::delete_connection,
        modules::databases::commands::test_connection,
        modules::databases::commands::execute_query,
        modules::databases::commands::get_tables,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
