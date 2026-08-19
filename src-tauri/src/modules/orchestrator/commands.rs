//! Tauri IPC surface for the plan-first orchestrator.
//!
//! Sessions live in an in-memory registry (like the embedded/autonomous agent
//! maps). Each session has its own mutex so a long-running turn on one session
//! doesn't block operations on another. Because [`PlanSession`] operations block
//! (they wait on the agent), every command runs the work on a blocking thread.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use sqlx::SqlitePool;
use tauri::{command, AppHandle, Emitter, State};

use super::backend::{claude::ClaudeBackend, BackendEvent, SessionConfig};
use super::error::OrchestratorError;
use super::models::{Plan, SessionStatus};
use super::plan_ops::StepEdit;
use super::planner::lite::LitePlanner;
use super::session::{BeginParams, PlanSession};
use super::sqlite_store::{
    clear_worktree_path, delete_session, get_annotations, get_base_tree, get_boundary,
    get_worktree_path, list_plan_summaries, load_session, save_annotations, save_base_tree,
    save_boundary, save_execution, save_worktree_path, PlanSummary, SqliteStore,
};
use crate::modules::agent_sessions::commands::resolve_task_permission_mode;
use crate::modules::agent_sessions::events::TaskPermissionMode;
use crate::shared::validation;

/// String label persisted for a permission mode.
fn permission_label(mode: TaskPermissionMode) -> &'static str {
    match mode {
        TaskPermissionMode::AcceptEdits => "acceptEdits",
        TaskPermissionMode::Skip => "skip",
    }
}

/// Format a streamed execution event into a terminal-friendly line.
fn format_exec_event(ev: &BackendEvent) -> String {
    match ev {
        BackendEvent::SessionStarted { model } => format!("▸ executing (model: {model})"),
        BackendEvent::AssistantText(t) => t.clone(),
        BackendEvent::ToolUse { name, detail } => {
            if detail.is_empty() {
                format!("▸ {name}")
            } else {
                format!("▸ {name}  {detail}")
            }
        }
        BackendEvent::Completed { is_error, cost_usd, duration_ms, .. } => {
            let label = if *is_error { "failed" } else { "done" };
            format!(
                "━━ {label} · {:.1}s · ${:.4}",
                *duration_ms as f64 / 1000.0,
                cost_usd
            )
        }
        BackendEvent::Stderr(s) => format!("[stderr] {s}"),
        BackendEvent::Exited(_) => String::new(),
    }
}

/// In-memory registry of live orchestration sessions, each independently locked.
pub type PlanSessionMap = Arc<Mutex<HashMap<String, Arc<Mutex<PlanSession>>>>>;

/// In-memory registry of the per-project **chat conversation** — a persistent,
/// multi-turn agent conversation (remembers context) that the developer talks to
/// before deciding to create a plan.
pub type ChatMap = Arc<Mutex<HashMap<String, Arc<Mutex<super::conversation::Conversation>>>>>;

/// The reply from one chat turn. The conversational agent decides for itself when
/// the developer wants to *build* something and invokes its `create_plan` tool by
/// emitting the [`PLAN_DIRECTIVE`] marker; when it does, `plan_goal` carries the
/// distilled goal and the frontend spawns a plan card. Otherwise it's just prose.
#[derive(serde::Serialize)]
pub struct ChatReply {
    pub reply: String,
    pub plan_goal: Option<String>,
}

/// The sentinel the chat agent emits to invoke its `create_plan` tool. The app
/// owns the chat process and parses its stream, so this marker *is* the tool
/// call — no MCP round-trip for an in-process action. Chosen to never collide
/// with prose or code.
const PLAN_DIRECTIVE: &str = "%%CREATE_PLAN%%";

/// Split a chat reply into (prose-to-show, optional plan goal). If the agent
/// emitted the `create_plan` directive on a line, that line is stripped from the
/// visible prose and its goal returned.
fn split_plan_directive(text: &str) -> (String, Option<String>) {
    let mut goal: Option<String> = None;
    let kept: Vec<&str> = text
        .lines()
        .filter(|line| match line.find(PLAN_DIRECTIVE) {
            Some(idx) => {
                let g = line[idx + PLAN_DIRECTIVE.len()..].trim();
                if !g.is_empty() {
                    goal = Some(g.to_string());
                }
                false // drop the directive line from the shown reply
            }
            None => true,
        })
        .collect();
    (kept.join("\n").trim().to_string(), goal)
}

/// A snapshot of a session for the frontend.
#[derive(serde::Serialize)]
pub struct SessionView {
    pub session_id: String,
    pub status: SessionStatus,
    pub task: String,
    pub plan: Option<Plan>,
    /// Persisted execution result summary (present when reopening a finished plan).
    pub result: Option<String>,
    /// Persisted execution log (present when reopening a finished plan).
    pub log: Option<String>,
}

impl SessionView {
    fn of(s: &PlanSession) -> Self {
        SessionView {
            session_id: s.session().id.clone(),
            status: s.session().status,
            task: s.session().task.clone(),
            plan: s.plan().cloned(),
            result: None,
            log: None,
        }
    }

    fn from_loaded(loaded: super::sqlite_store::LoadedPlan) -> Self {
        SessionView {
            session_id: loaded.session.id.clone(),
            status: loaded.session.status,
            task: loaded.session.task.clone(),
            plan: loaded.plan,
            result: loaded.result,
            log: loaded.log,
        }
    }
}

/// Look up a session and run a blocking operation on it off the async runtime.
async fn run_on_session<T, F>(
    map: PlanSessionMap,
    session_id: String,
    f: F,
) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(&mut PlanSession) -> Result<T, OrchestratorError> + Send + 'static,
{
    let session = {
        let guard = map.lock().map_err(|e| format!("registry lock: {e}"))?;
        guard.get(&session_id).cloned()
    }
    .ok_or_else(|| format!("session not found: {session_id}"))?;

    tokio::task::spawn_blocking(move || {
        let mut s = session.lock().map_err(|e| format!("session lock: {e}"))?;
        f(&mut s).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("task join: {e}"))?
}

/// The directory to operate on for a session: its **isolated worktree** if one
/// exists (and is still on disk), else the project path. Ensures review, comment
/// application, and PR creation all act on the same tree the agents wrote to.
async fn effective_cwd(pool: &SqlitePool, session_id: &str, project_path: &str) -> String {
    if let Ok(Some(wt)) = get_worktree_path(pool, session_id).await {
        if std::path::Path::new(&wt).exists() {
            return wt;
        }
    }
    crate::shared::utils::expand_path(project_path)
}

/// Start a plan-first session: produce the first plan for a task.
#[command]
pub async fn orchestrator_begin(
    map: State<'_, PlanSessionMap>,
    pool: State<'_, SqlitePool>,
    project_id: String,
    project_path: String,
    task: String,
    use_gsd: bool,
    model: Option<String>,
) -> Result<SessionView, String> {
    validation::validate_id(&project_id).map_err(|e| e.to_string())?;
    validation::validate_path(&project_path).map_err(|e| e.to_string())?;
    validation::validate_content(&task, "task").map_err(|e| e.to_string())?;
    if task.trim().is_empty() {
        return Err("task cannot be empty".into());
    }
    if let Some(ref m) = model {
        if m.starts_with('-') {
            return Err("invalid model name".into());
        }
    }

    // Execution honors the project's Safe/Full permission toggle.
    let permission_mode = resolve_task_permission_mode(pool.inner(), &project_id).await;

    // The context moat: hand the agent what the project already knows (codebase
    // knowledge, notes, conventions, git) so it plans/executes without
    // re-discovering — the core token saving.
    let context = crate::modules::agent_sessions::context::build_project_context(
        pool.inner(),
        &project_id,
        &project_path,
    )
    .await
    .ok();

    let map = map.inner().clone();
    let cwd = crate::shared::utils::expand_path(&project_path);
    let pool = pool.inner().clone();
    let handle = tokio::runtime::Handle::current();

    tokio::task::spawn_blocking(move || -> Result<SessionView, String> {
        let config = SessionConfig {
            cwd,
            model,
            permission_mode,
        };
        // The GSD toggle selects the thorough vs lean planner.
        let planner: Box<dyn super::planner::Planner> = if use_gsd {
            Box::new(super::planner::gsd::GsdPlanner)
        } else {
            Box::new(LitePlanner)
        };
        let session = PlanSession::begin(
            &ClaudeBackend,
            planner,
            Arc::new(SqliteStore::new(pool, handle)),
            config,
            BeginParams {
                project_id,
                task,
                use_gsd,
                permission_mode: permission_label(permission_mode).into(),
                context,
            },
        )
        .map_err(|e| e.to_string())?;

        let view = SessionView::of(&session);
        let id = view.session_id.clone();
        map.lock()
            .map_err(|e| format!("registry lock: {e}"))?
            .insert(id, Arc::new(Mutex::new(session)));
        Ok(view)
    })
    .await
    .map_err(|e| format!("task join: {e}"))?
}

/// Execute the confirmed plan, streaming progress lines to the frontend via
/// `orchestrator-progress-{session_id}` events. Returns the final session view.
#[command]
pub async fn orchestrator_execute(
    map: State<'_, PlanSessionMap>,
    pool: State<'_, SqlitePool>,
    app_handle: AppHandle,
    session_id: String,
) -> Result<SessionView, String> {
    validation::validate_id(&session_id).map_err(|e| e.to_string())?;

    let session = {
        let guard = map
            .inner()
            .lock()
            .map_err(|e| format!("registry lock: {e}"))?;
        guard.get(&session_id).cloned()
    }
    .ok_or_else(|| format!("session not found: {session_id}"))?;

    let progress_channel = format!("orchestrator-progress-{session_id}");
    let result_channel = format!("orchestrator-result-{session_id}");

    // 1. Snapshot what we need under a brief lock.
    let (config, plan) = {
        let s = session.clone();
        tokio::task::spawn_blocking(move || -> Result<_, String> {
            let g = s.lock().map_err(|e| format!("session lock: {e}"))?;
            g.prepare_execution().map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| format!("task join: {e}"))??
    };

    // 1.5 Isolate execution in a disposable worktree so a run never dirties the
    //     developer's main working tree; snapshot its baseline so review sees
    //     only what the run produces. Best-effort — if worktree setup fails, run
    //     in the project directory (no regression).
    let project_cwd = config.cwd.clone();
    let (exec_cwd, base_tree, worktree_path) = tokio::task::spawn_blocking(move || {
        match super::worktree::create_isolated(&project_cwd) {
            Ok(wt) => {
                let base = super::validation::snapshot_tree(&wt);
                (wt.clone(), base, Some(wt))
            }
            Err(_) => {
                let base = super::validation::snapshot_tree(&project_cwd);
                (project_cwd.clone(), base, None)
            }
        }
    })
    .await
    .map_err(|e| format!("task join: {e}"))?;
    if let Some(base) = base_tree.as_deref() {
        let _ = save_base_tree(pool.inner(), &session_id, base).await;
    }
    if let Some(ref wt) = worktree_path {
        let _ = save_worktree_path(pool.inner(), &session_id, wt).await;
    }

    // Execution runs in the isolated worktree; the plan's file paths are the same
    // relative paths there.
    let config = SessionConfig { cwd: exec_cwd.clone(), ..config };
    let result_cwd = exec_cwd.clone();
    let goal = plan.goal.clone();

    // 2. Run the long execution WITHOUT holding the session lock, so reads
    //    (reopening the plan, polling) never block while it runs for minutes.
    //    Accumulate the log + per-run metrics alongside streaming it.
    let log = Arc::new(Mutex::new(Vec::<String>::new()));
    let metrics = Arc::new(Mutex::new((0.0f64, 0i64))); // (cost_usd, duration_ms)
    let handle = app_handle.clone();
    let pc = progress_channel.clone();
    let log_acc = log.clone();
    let metrics_acc = metrics.clone();
    let outcomes = tokio::task::spawn_blocking(move || -> Result<_, String> {
        super::executor::run_tiered(&ClaudeBackend, &config, &plan, |ev, step| {
            if let BackendEvent::Completed { cost_usd, duration_ms, .. } = ev {
                if let Ok(mut m) = metrics_acc.lock() {
                    m.0 += *cost_usd;
                    m.1 += *duration_ms;
                }
            }
            let line = format_exec_event(ev);
            if !line.is_empty() {
                let model = step.model.as_deref().unwrap_or("sonnet");
                let tagged = format!("[{}·{}] {}", step.ordinal + 1, model, line);
                if let Ok(mut l) = log_acc.lock() {
                    l.push(tagged.clone());
                }
                let _ = handle.emit(&pc, tagged);
            }
        })
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("task join: {e}"))??;

    // Objective stats — computed before `outcomes` is moved into finish.
    let steps = outcomes.len();
    let failed_pos = outcomes.iter().position(|o| !o.ok);

    // 3. Record outcomes under a brief lock.
    let s = session.clone();
    let view = tokio::task::spawn_blocking(move || -> Result<SessionView, String> {
        let mut g = s.lock().map_err(|e| format!("session lock: {e}"))?;
        g.finish_execution(&outcomes).map_err(|e| e.to_string())?;
        Ok(SessionView::of(&g))
    })
    .await
    .map_err(|e| format!("task join: {e}"))??;

    // 3.5 Assemble the STRUCTURED result from data we own (never the agent's
    //     narration): outcome + the git delta + objective stats. The git work
    //     runs off the async runtime.
    let (cost_usd, duration_i64) = metrics.lock().map(|m| *m).unwrap_or((0.0, 0));
    let duration_ms = duration_i64.max(0) as u64;
    let base_for_result = base_tree.clone();
    let result = tokio::task::spawn_blocking(move || super::result::ExecutionResult {
        outcome: (if steps > 0 && failed_pos.is_none() { "done" } else { "failed" }).to_string(),
        headline: goal,
        changed_files: super::result::changed_files(&result_cwd, base_for_result.as_deref()),
        stats: super::result::ExecStats {
            steps,
            failed_step: failed_pos.map(|i| i + 1),
            duration_ms,
            cost_usd,
        },
    })
    .await
    .map_err(|e| format!("task join: {e}"))?;
    let result_json = serde_json::to_string(&result).unwrap_or_default();

    // 4. Persist the log + structured result so reopening shows the outcome.
    let log_text = log.lock().map(|l| l.join("\n")).unwrap_or_default();
    let _ = save_execution(pool.inner(), &session_id, &log_text, &result_json).await;

    let _ = app_handle.emit(&result_channel, result_json);
    Ok(view)
}

/// List the installed skills the orchestrator can apply.
#[command]
pub async fn orchestrator_list_skills() -> Result<Vec<super::models::SkillDef>, String> {
    Ok(super::skills::builtin_skills())
}

/// Send a message to the project's **persistent chat conversation** and get the
/// reply. Multi-turn: the conversation remembers context, so the developer can
/// brainstorm, ask, and iterate before deciding to create a plan. Read-only —
/// the agent discusses and answers but does not modify files (that happens later
/// via an approved plan).
#[command]
pub async fn orchestrator_chat(
    chats: State<'_, ChatMap>,
    pool: State<'_, SqlitePool>,
    project_id: String,
    project_path: String,
    message: String,
) -> Result<ChatReply, String> {
    validation::validate_id(&project_id).map_err(|e| e.to_string())?;
    validation::validate_path(&project_path).map_err(|e| e.to_string())?;
    validation::validate_content(&message, "message").map_err(|e| e.to_string())?;

    // Reuse the live conversation if one exists; else create + prime it once.
    let existing = {
        let guard = chats.inner().lock().map_err(|e| format!("chat registry lock: {e}"))?;
        guard.get(&project_id).cloned()
    };
    let convo = match existing {
        Some(c) => c,
        None => {
            let permission_mode = resolve_task_permission_mode(pool.inner(), &project_id).await;
            let context = crate::modules::agent_sessions::context::build_project_context(
                pool.inner(),
                &project_id,
                &project_path,
            )
            .await
            .ok();
            let cwd = crate::shared::utils::expand_path(&project_path);
            let created = tokio::task::spawn_blocking(
                move || -> Result<Arc<Mutex<super::conversation::Conversation>>, String> {
                    let config = SessionConfig { cwd, model: Some("sonnet".to_string()), permission_mode };
                    let convo = super::conversation::Conversation::start(&ClaudeBackend, config)
                        .map_err(|e| e.to_string())?;
                    let tool_contract = format!(
                        "You have one tool: create_plan. When — and ONLY when — the developer \
                         clearly wants you to build, implement, add, change, refactor, or fix \
                         something concrete (not merely discuss, ask about, or explore it), \
                         invoke it by ending your reply with a final line in exactly this form:\n\
                         {PLAN_DIRECTIVE} <a single-line, specific goal>\n\
                         For questions, explanations, brainstorming, or exploration, do NOT emit \
                         it — just reply normally. Never modify files yourself; a plan (reviewed \
                         and approved by the developer) is how changes happen. You may run \
                         read-only commands to check facts."
                    );
                    let primer = match context.as_deref() {
                        Some(ctx) if !ctx.trim().is_empty() => format!(
                            "You are the developer's assistant for this project. Discuss ideas, \
                             brainstorm, answer questions, and help plan. {tool_contract} \
                             Here is the project context; rely on it. Reply only \"ok\".\n\n{ctx}"
                        ),
                        _ => format!(
                            "You are the developer's assistant for this project. Discuss, \
                             brainstorm, answer questions, and help plan. {tool_contract} \
                             Reply only \"ok\"."
                        ),
                    };
                    let _ = convo.ask(&primer);
                    Ok(Arc::new(Mutex::new(convo)))
                },
            )
            .await
            .map_err(|e| format!("task join: {e}"))??;
            chats
                .inner()
                .lock()
                .map_err(|e| format!("chat registry lock: {e}"))?
                .insert(project_id.clone(), created.clone());
            created
        }
    };

    tokio::task::spawn_blocking(move || -> Result<ChatReply, String> {
        let g = convo.lock().map_err(|e| format!("chat lock: {e}"))?;
        let out = g.ask(&message).map_err(|e| e.to_string())?;
        if out.is_error {
            return Err(out.stderr.trim().to_string());
        }
        let (reply, plan_goal) = split_plan_directive(&out.text);
        Ok(ChatReply { reply, plan_goal })
    })
    .await
    .map_err(|e| format!("task join: {e}"))?
}

/// Answer a developer's question about the project **conversationally** — a
/// single read-only agent turn, no plan. For informational queries so they don't
/// get the heavyweight plan-first flow.
#[command]
pub async fn orchestrator_quick_ask(
    pool: State<'_, SqlitePool>,
    project_id: String,
    project_path: String,
    question: String,
) -> Result<String, String> {
    validation::validate_id(&project_id).map_err(|e| e.to_string())?;
    validation::validate_path(&project_path).map_err(|e| e.to_string())?;
    validation::validate_content(&question, "question").map_err(|e| e.to_string())?;

    let permission_mode = resolve_task_permission_mode(pool.inner(), &project_id).await;
    let context = crate::modules::agent_sessions::context::build_project_context(
        pool.inner(),
        &project_id,
        &project_path,
    )
    .await
    .ok();
    let cwd = crate::shared::utils::expand_path(&project_path);

    tokio::task::spawn_blocking(move || -> Result<String, String> {
        let config = SessionConfig { cwd, model: Some("sonnet".to_string()), permission_mode };
        let convo = super::conversation::Conversation::start(&ClaudeBackend, config)
            .map_err(|e| e.to_string())?;
        if let Some(ctx) = context.as_deref() {
            if !ctx.trim().is_empty() {
                let _ = convo.ask(&format!(
                    "Project context — rely on it instead of re-exploring; reply only \"ok\".\n\n{ctx}"
                ));
            }
        }
        let prompt = format!(
            "Answer this question about the project concisely and directly. You may run \
             read-only commands (git, ls, cat, grep) to check facts, but do NOT modify any \
             files.\n\nQuestion: {question}"
        );
        let out = convo.ask(&prompt).map_err(|e| e.to_string())?;
        let _ = convo.stop();
        if out.is_error {
            return Err(out.stderr.trim().to_string());
        }
        Ok(out.text)
    })
    .await
    .map_err(|e| format!("task join: {e}"))?
}

/// Run the bounded validation pass (deterministic checks + gated adversarial
/// review) on a plan's changes, honoring the project's configured caps.
#[command]
pub async fn orchestrator_validate(
    pool: State<'_, SqlitePool>,
    project_id: String,
    project_path: String,
    session_id: String,
) -> Result<super::validation::ValidationReport, String> {
    validation::validate_id(&project_id).map_err(|e| e.to_string())?;
    validation::validate_id(&session_id).map_err(|e| e.to_string())?;
    validation::validate_path(&project_path).map_err(|e| e.to_string())?;

    // Load the user's configured caps for this project.
    let settings_json = crate::modules::projects::repository::ProjectRepository::new(pool.inner().clone())
        .get_project(&project_id)
        .await
        .ok()
        .flatten()
        .and_then(|p| p.settings);
    let settings = super::settings::OrchestrationSettings::from_project_settings(settings_json.as_deref());
    if settings.validation == super::settings::ValidationMode::Off {
        return Err("validation is turned off for this project".into());
    }

    // The intent is the plan's goal. The scope policy is the developer-approved
    // change boundary if one was saved, else derived from the plan's declared
    // files (union of every step's `files`).
    let plan = super::sqlite_store::load_session(pool.inner(), &session_id)
        .await
        .ok()
        .flatten()
        .and_then(|l| l.plan);
    let intent = plan
        .as_ref()
        .map(|p| p.goal.clone())
        .unwrap_or_else(|| "the recent change".to_string());
    let scope: super::validation::ScopePolicy = get_boundary(pool.inner(), &session_id)
        .await
        .ok()
        .flatten()
        .and_then(|j| serde_json::from_str(&j).ok())
        .unwrap_or_else(|| super::validation::ScopePolicy {
            allowed: plan
                .as_ref()
                .map(|p| p.steps.iter().flat_map(|s| s.files.clone()).collect())
                .unwrap_or_default(),
            ..Default::default()
        });

    // The baseline snapshot captured when execution started (if any) — lets the
    // review diff only what the run produced.
    let base_tree = get_base_tree(pool.inner(), &session_id).await.ok().flatten();

    // Review the isolated worktree the run executed in, not the main tree.
    let cwd = effective_cwd(pool.inner(), &session_id, &project_path).await;
    tokio::task::spawn_blocking(move || -> Result<super::validation::ValidationReport, String> {
        let config = SessionConfig {
            cwd: cwd.clone(),
            model: Some("sonnet".to_string()),
            permission_mode: TaskPermissionMode::AcceptEdits,
        };
        super::validation::run_validation(
            &ClaudeBackend,
            &config,
            &cwd,
            &intent,
            base_tree.as_deref(),
            &scope,
            &settings,
        )
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("task join: {e}"))?
}

/// Apply a batch of human review comments (line annotations) to the working
/// tree via a focused agent pass. The frontend re-runs validation afterward.
#[command]
pub async fn orchestrator_apply_review_comments(
    pool: State<'_, SqlitePool>,
    project_path: String,
    session_id: String,
    comments: Vec<super::validation::ReviewComment>,
    intent: Option<String>,
) -> Result<String, String> {
    validation::validate_path(&project_path).map_err(|e| e.to_string())?;
    validation::validate_id(&session_id).map_err(|e| e.to_string())?;
    if comments.is_empty() {
        return Err("no comments to apply".into());
    }

    // Apply in the same tree the run executed in (worktree if isolated).
    let cwd = effective_cwd(pool.inner(), &session_id, &project_path).await;
    tokio::task::spawn_blocking(move || -> Result<String, String> {
        let config = SessionConfig {
            cwd: cwd.clone(),
            model: Some("sonnet".to_string()),
            permission_mode: TaskPermissionMode::AcceptEdits,
        };
        super::validation::apply_review_comments(&ClaudeBackend, &config, &comments, intent.as_deref())
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("task join: {e}"))?
}

/// Commit the validated change under the developer's identity and open a PR
/// (never merges — the human is the merge gate).
#[command]
pub async fn orchestrator_create_pr(
    pool: State<'_, SqlitePool>,
    project_path: String,
    session_id: String,
    title: String,
    body: String,
) -> Result<super::pr::PrResult, String> {
    validation::validate_path(&project_path).map_err(|e| e.to_string())?;
    validation::validate_id(&session_id).map_err(|e| e.to_string())?;
    validation::validate_content(&title, "title").map_err(|e| e.to_string())?;
    if title.trim().is_empty() {
        return Err("a title is required".into());
    }

    // Commit from the isolated worktree (if any) — the branch lands in the shared
    // repo; the main working tree is never touched.
    let cwd = effective_cwd(pool.inner(), &session_id, &project_path).await;
    let result = tokio::task::spawn_blocking(move || -> Result<super::pr::PrResult, String> {
        super::pr::create_pr(&super::pr::PrRequest { cwd, title, body }).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("task join: {e}"))??;

    // The change is now on a branch — dispose the worktree and clear it.
    if result.committed {
        if let Ok(Some(wt)) = get_worktree_path(pool.inner(), &session_id).await {
            let project = crate::shared::utils::expand_path(&project_path);
            let _ = tokio::task::spawn_blocking(move || super::worktree::remove_at(&project, &wt)).await;
            let _ = clear_worktree_path(pool.inner(), &session_id).await;
        }
    }
    Ok(result)
}

/// Persist the developer's pending plan annotations so they survive reopen.
#[command]
pub async fn orchestrator_save_annotations(
    pool: State<'_, SqlitePool>,
    session_id: String,
    annotations: String,
) -> Result<(), String> {
    validation::validate_id(&session_id).map_err(|e| e.to_string())?;
    save_annotations(pool.inner(), &session_id, &annotations)
        .await
        .map_err(|e| e.to_string())
}

/// Load the developer's pending plan annotations for a session (JSON array).
#[command]
pub async fn orchestrator_get_annotations(
    pool: State<'_, SqlitePool>,
    session_id: String,
) -> Result<String, String> {
    validation::validate_id(&session_id).map_err(|e| e.to_string())?;
    get_annotations(pool.inner(), &session_id)
        .await
        .map_err(|e| e.to_string())
}

/// Persist the developer-approved change boundary (ScopePolicy JSON).
#[command]
pub async fn orchestrator_save_boundary(
    pool: State<'_, SqlitePool>,
    session_id: String,
    boundary: String,
) -> Result<(), String> {
    validation::validate_id(&session_id).map_err(|e| e.to_string())?;
    save_boundary(pool.inner(), &session_id, &boundary)
        .await
        .map_err(|e| e.to_string())
}

/// Load the approved change boundary for a session (JSON, or empty string).
#[command]
pub async fn orchestrator_get_boundary(
    pool: State<'_, SqlitePool>,
    session_id: String,
) -> Result<String, String> {
    validation::validate_id(&session_id).map_err(|e| e.to_string())?;
    Ok(get_boundary(pool.inner(), &session_id)
        .await
        .map_err(|e| e.to_string())?
        .unwrap_or_default())
}

/// List recent persisted plan sessions for a project (for the Plans list).
#[command]
pub async fn orchestrator_list_plans(
    pool: State<'_, SqlitePool>,
    project_id: String,
) -> Result<Vec<PlanSummary>, String> {
    validation::validate_id(&project_id).map_err(|e| e.to_string())?;
    list_plan_summaries(pool.inner(), &project_id, 50)
        .await
        .map_err(|e| e.to_string())
}

/// Delete a plan session (removes it from the registry and storage).
#[command]
pub async fn orchestrator_delete_plan(
    map: State<'_, PlanSessionMap>,
    pool: State<'_, SqlitePool>,
    session_id: String,
) -> Result<(), String> {
    validation::validate_id(&session_id).map_err(|e| e.to_string())?;

    // If live, stop and drop it from the registry (best effort).
    let removed = {
        let mut guard = map.inner().lock().map_err(|e| format!("registry lock: {e}"))?;
        guard.remove(&session_id)
    };
    if let Some(sess) = removed {
        let _ = tokio::task::spawn_blocking(move || {
            if let Ok(mut s) = sess.lock() {
                let _ = s.cancel();
            }
        })
        .await;
    }

    // Dispose the session's isolated worktree, if any, before deleting it.
    if let Ok(Some(wt)) = get_worktree_path(pool.inner(), &session_id).await {
        let _ = tokio::task::spawn_blocking(move || {
            // Prune from whichever repo owns it; the checkout dir is removed too.
            let _ = std::fs::remove_dir_all(&wt);
        })
        .await;
    }

    delete_session(pool.inner(), &session_id)
        .await
        .map_err(|e| e.to_string())
}

/// Reopen a plan: return the live session if still in the registry, otherwise
/// load its latest persisted state from storage (read-only view).
#[command]
pub async fn orchestrator_load_plan(
    map: State<'_, PlanSessionMap>,
    pool: State<'_, SqlitePool>,
    session_id: String,
) -> Result<SessionView, String> {
    validation::validate_id(&session_id).map_err(|e| e.to_string())?;

    // Prefer the live session (still interactive) if present.
    let live = {
        let guard = map.inner().lock().map_err(|e| format!("registry lock: {e}"))?;
        guard.get(&session_id).cloned()
    };
    if let Some(sess) = live {
        return tokio::task::spawn_blocking(move || -> Result<SessionView, String> {
            let s = sess.lock().map_err(|e| format!("session lock: {e}"))?;
            Ok(SessionView::of(&s))
        })
        .await
        .map_err(|e| format!("task join: {e}"))?;
    }

    // Otherwise reconstruct from storage.
    match load_session(pool.inner(), &session_id)
        .await
        .map_err(|e| e.to_string())?
    {
        Some(loaded) => Ok(SessionView::from_loaded(loaded)),
        None => Err(format!("plan not found: {session_id}")),
    }
}

/// Get the current snapshot of a session.
#[command]
pub async fn orchestrator_get(
    map: State<'_, PlanSessionMap>,
    session_id: String,
) -> Result<SessionView, String> {
    validation::validate_id(&session_id).map_err(|e| e.to_string())?;
    run_on_session(map.inner().clone(), session_id, |s| Ok(SessionView::of(s))).await
}

/// Edit a step's title and/or detail — authoritative (preserved on revision).
#[command]
pub async fn orchestrator_edit_step(
    map: State<'_, PlanSessionMap>,
    session_id: String,
    step_id: String,
    title: Option<String>,
    detail_md: Option<String>,
    model: Option<String>,
) -> Result<SessionView, String> {
    validation::validate_id(&session_id).map_err(|e| e.to_string())?;
    validation::validate_id(&step_id).map_err(|e| e.to_string())?;
    run_on_session(map.inner().clone(), session_id, move |s| {
        s.edit_step(
            &step_id,
            StepEdit {
                title,
                detail_md,
                // A provided model sets that tier; absent leaves it unchanged.
                model: model.map(Some),
                ..Default::default()
            },
        )?;
        Ok(SessionView::of(s))
    })
    .await
}

/// Ask a question about a step or design decision; returns the answer.
#[command]
pub async fn orchestrator_ask(
    map: State<'_, PlanSessionMap>,
    session_id: String,
    question: String,
    step_id: Option<String>,
) -> Result<String, String> {
    validation::validate_id(&session_id).map_err(|e| e.to_string())?;
    validation::validate_content(&question, "question").map_err(|e| e.to_string())?;
    run_on_session(map.inner().clone(), session_id, move |s| {
        s.ask(&question, step_id)
    })
    .await
}

/// Request a change; produces a new plan version preserving user edits.
#[command]
pub async fn orchestrator_revise(
    map: State<'_, PlanSessionMap>,
    session_id: String,
    feedback: String,
) -> Result<SessionView, String> {
    validation::validate_id(&session_id).map_err(|e| e.to_string())?;
    validation::validate_content(&feedback, "feedback").map_err(|e| e.to_string())?;
    run_on_session(map.inner().clone(), session_id, move |s| {
        s.revise(&feedback)?;
        Ok(SessionView::of(s))
    })
    .await
}

/// Approve a single step.
#[command]
pub async fn orchestrator_approve_step(
    map: State<'_, PlanSessionMap>,
    session_id: String,
    step_id: String,
) -> Result<SessionView, String> {
    validation::validate_id(&session_id).map_err(|e| e.to_string())?;
    validation::validate_id(&step_id).map_err(|e| e.to_string())?;
    run_on_session(map.inner().clone(), session_id, move |s| {
        s.approve_step(&step_id)?;
        Ok(SessionView::of(s))
    })
    .await
}

/// Approve every step.
#[command]
pub async fn orchestrator_approve_all(
    map: State<'_, PlanSessionMap>,
    session_id: String,
) -> Result<SessionView, String> {
    validation::validate_id(&session_id).map_err(|e| e.to_string())?;
    run_on_session(map.inner().clone(), session_id, |s| {
        s.approve_all()?;
        Ok(SessionView::of(s))
    })
    .await
}

/// Confirm the plan (all steps must be approved) and move to execution.
#[command]
pub async fn orchestrator_confirm(
    map: State<'_, PlanSessionMap>,
    session_id: String,
) -> Result<SessionView, String> {
    validation::validate_id(&session_id).map_err(|e| e.to_string())?;
    run_on_session(map.inner().clone(), session_id, |s| {
        s.confirm()?;
        Ok(SessionView::of(s))
    })
    .await
}

/// Cancel a session, stop the agent, and remove it from the registry.
#[command]
pub async fn orchestrator_cancel(
    map: State<'_, PlanSessionMap>,
    session_id: String,
) -> Result<(), String> {
    validation::validate_id(&session_id).map_err(|e| e.to_string())?;
    let map = map.inner().clone();
    run_on_session(map.clone(), session_id.clone(), |s| s.cancel()).await?;
    map.lock()
        .map_err(|e| format!("registry lock: {e}"))?
        .remove(&session_id);
    Ok(())
}

#[cfg(test)]
mod chat_tests {
    use super::split_plan_directive;

    #[test]
    fn plain_prose_yields_no_goal() {
        let (reply, goal) = split_plan_directive("Here's how /health works.\nIt returns ok.");
        assert_eq!(reply, "Here's how /health works.\nIt returns ok.");
        assert_eq!(goal, None);
    }

    #[test]
    fn directive_is_extracted_and_stripped() {
        let text = "Sure, I'll add readiness.\n%%CREATE_PLAN%% add a /health/ready endpoint that checks DB and Redis";
        let (reply, goal) = split_plan_directive(text);
        assert_eq!(reply, "Sure, I'll add readiness.");
        assert_eq!(goal.as_deref(), Some("add a /health/ready endpoint that checks DB and Redis"));
    }

    #[test]
    fn directive_only_reply_is_empty_prose() {
        let (reply, goal) = split_plan_directive("%%CREATE_PLAN%% wire up rate limiting");
        assert_eq!(reply, "");
        assert_eq!(goal.as_deref(), Some("wire up rate limiting"));
    }

    #[test]
    fn empty_goal_directive_is_ignored() {
        let (reply, goal) = split_plan_directive("ok\n%%CREATE_PLAN%%   ");
        assert_eq!(reply, "ok");
        assert_eq!(goal, None);
    }
}
