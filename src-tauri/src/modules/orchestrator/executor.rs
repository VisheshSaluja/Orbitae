//! Model-tiered step executor.
//!
//! Runs a confirmed plan by giving **each step its own subagent on the step's
//! assigned model** (haiku/sonnet/opus), which makes the model tiering provable
//! and visible ("step 2 → haiku").
//!
//! **Parallel waves (conservative).** Steps are scheduled into *waves* of
//! pairwise file-disjoint steps ([`schedule_waves`]); a step with no declared
//! files, or one overlapping the current wave, starts a new wave. A single-step
//! wave runs directly in the shared exec tree. A multi-step wave runs each step
//! in its **own disposable worktree** (branched from a snapshot of the current
//! exec tree), concurrently — so agents can't clobber one another — then merges
//! each step's diff back into the exec tree one at a time (single committer).
//! Because a wave's files are disjoint, the patches never overlap. If one ever
//! fails to apply (near-impossible under conservative scheduling), that step is
//! re-run sequentially in the exec tree — no data loss.
//!
//! Each step subagent gets a **focused prompt** (goal + prior outcomes + this
//! step), not the whole project context — narrow scope is cheaper, which is the
//! token moat in action.

use std::collections::HashSet;

use super::backend::{AgentBackend, BackendEvent, SessionConfig};
use super::conversation::Conversation;
use super::error::{OrchestratorError, Result};
use super::models::{Plan, PlanStep};

/// Resolve a step's suggested tier to a concrete model, defaulting to mid-tier.
fn step_model(step: &PlanStep) -> String {
    match step.model.as_deref() {
        Some(m) if !m.trim().is_empty() => m.trim().to_string(),
        _ => "sonnet".to_string(),
    }
}

/// The result of running one step's subagent.
pub struct StepOutcome {
    pub step_id: String,
    pub ok: bool,
    pub summary: String,
}

/// Group step indices into **waves** of pairwise file-disjoint steps. A step
/// with no declared files, or whose files overlap the current wave, closes the
/// wave and starts a new one (conservative: only explicitly-disjoint steps ever
/// run together). Preserves plan order, so a step never runs before one it might
/// depend on.
pub fn schedule_waves(steps: &[PlanStep]) -> Vec<Vec<usize>> {
    let mut waves: Vec<Vec<usize>> = Vec::new();
    let mut cur: Vec<usize> = Vec::new();
    let mut cur_files: HashSet<&str> = HashSet::new();

    for (i, step) in steps.iter().enumerate() {
        let files: Vec<&str> = step
            .files
            .iter()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .collect();

        // Can this step join the open wave? Only if it declares files and none
        // of them collide with a file already claimed in the wave.
        let joins = !cur.is_empty()
            && !files.is_empty()
            && files.iter().all(|f| !cur_files.contains(f));

        if joins {
            for f in &files {
                cur_files.insert(f);
            }
            cur.push(i);
        } else {
            if !cur.is_empty() {
                waves.push(std::mem::take(&mut cur));
            }
            cur_files.clear();
            cur.push(i);
            for f in &files {
                cur_files.insert(f);
            }
        }

        // A step with unknown scope (no declared files) must stand alone: close
        // its wave immediately so nothing else joins it.
        if files.is_empty() {
            waves.push(std::mem::take(&mut cur));
            cur_files.clear();
        }
    }
    if !cur.is_empty() {
        waves.push(cur);
    }
    waves
}

/// Run one step on its own model-tiered subagent in `cwd`, streaming events.
fn run_step<F: Fn(&BackendEvent, &PlanStep) + Sync>(
    backend: &dyn AgentBackend,
    base: &SessionConfig,
    cwd: &str,
    goal: &str,
    prior: &[String],
    step: &PlanStep,
    on_event: &F,
) -> Result<StepOutcome> {
    let cfg = SessionConfig {
        cwd: cwd.to_string(),
        model: Some(step_model(step)),
        ..base.clone()
    };
    let convo = Conversation::start(backend, cfg)?;
    let prompt = build_step_prompt(goal, prior, step);
    let out = convo.ask_streaming(&prompt, |ev| on_event(ev, step))?;
    let _ = convo.stop();
    Ok(StepOutcome {
        step_id: step.id.clone(),
        ok: !out.is_error,
        summary: out.text,
    })
}

/// Execute the plan wave by wave: disjoint steps run concurrently in isolated
/// worktrees, everything else runs sequentially in the shared exec tree. Stops
/// after the first wave containing a failed step. `on_event` receives every
/// backend event tagged with the step it belongs to (called from multiple
/// threads during a parallel wave, hence `Send + Sync`).
pub fn run_tiered<F: Fn(&BackendEvent, &PlanStep) + Send + Sync>(
    backend: &dyn AgentBackend,
    base: &SessionConfig,
    plan: &Plan,
    on_event: F,
) -> Result<Vec<StepOutcome>> {
    let exec_cwd = base.cwd.clone();
    let mut results: Vec<StepOutcome> = Vec::new();
    let mut prior: Vec<String> = Vec::new();

    let waves = schedule_waves(&plan.steps);
    let total_waves = waves.len();
    tracing::info!(
        "[gate] wave schedule: {total_waves} wave(s) for {} step(s)",
        plan.steps.len()
    );

    for (wave_no, wave) in waves.into_iter().enumerate() {
        let step_summary: Vec<String> = wave
            .iter()
            .map(|&i| format!("{}·{}", i + 1, step_model(&plan.steps[i])))
            .collect();
        tracing::info!(
            "[gate] wave {}/{total_waves}: {} step(s) [{}]{}",
            wave_no + 1,
            wave.len(),
            step_summary.join(", "),
            if wave.len() > 1 { " running in parallel" } else { "" }
        );

        // (step index, outcome) for this wave, filled in either path below.
        let mut wave_outcomes: Vec<(usize, StepOutcome)> = Vec::new();

        if wave.len() == 1 {
            let idx = wave[0];
            let outcome =
                run_step(backend, base, &exec_cwd, &plan.goal, &prior, &plan.steps[idx], &on_event)?;
            wave_outcomes.push((idx, outcome));
        } else {
            // Parallel wave: snapshot the exec tree, branch a worktree per step,
            // run them concurrently, then merge each disjoint diff back in order.
            let wave_base = super::worktree::snapshot_commit(&exec_cwd).ok_or_else(|| {
                OrchestratorError::Backend("failed to snapshot exec tree for a parallel wave".into())
            })?;

            let collected: Vec<(usize, Result<StepOutcome>, Option<String>)> =
                std::thread::scope(|scope| {
                    let handles: Vec<_> = wave
                        .iter()
                        .map(|&idx| {
                            let exec_cwd = &exec_cwd;
                            let wave_base = &wave_base;
                            let on_event = &on_event;
                            let prior = &prior;
                            let step = &plan.steps[idx];
                            let goal = plan.goal.as_str();
                            scope.spawn(move || {
                                let wt = match super::worktree::Worktree::create_at(exec_cwd, wave_base)
                                {
                                    Ok(w) => w,
                                    Err(e) => return (idx, Err(e), None),
                                };
                                let cwd = wt.path().to_string_lossy().into_owned();
                                let outcome =
                                    run_step(backend, base, &cwd, goal, prior, step, on_event);
                                let patch = super::worktree::capture_patch(&cwd, wave_base);
                                drop(wt); // dispose the worktree
                                (idx, outcome, patch)
                            })
                        })
                        .collect();
                    handles
                        .into_iter()
                        .map(|h| h.join().expect("wave step thread panicked"))
                        .collect()
                });

            // Merge back sequentially — single committer. Disjoint files ⇒ clean.
            for (idx, outcome, patch) in collected {
                let outcome = outcome?;
                let applied = match patch {
                    Some(p) => super::worktree::apply_patch(&exec_cwd, &p).map(|_| true),
                    None => Ok(false), // step made no changes
                };
                if let Err(e) = applied {
                    // Should not happen under conservative scheduling; re-run the
                    // step directly in the exec tree so nothing is lost.
                    tracing::warn!("[gate] wave merge failed for step {idx} ({e}); re-running sequentially");
                    let redo =
                        run_step(backend, base, &exec_cwd, &plan.goal, &prior, &plan.steps[idx], &on_event)?;
                    wave_outcomes.push((idx, redo));
                } else {
                    wave_outcomes.push((idx, outcome));
                }
            }
        }

        // Append in plan order; thread outcomes into `prior`; stop on any failure.
        wave_outcomes.sort_by_key(|(idx, _)| *idx);
        let wave_failed = wave_outcomes.iter().any(|(_, o)| !o.ok);
        let outcome_summary: Vec<String> = wave_outcomes
            .iter()
            .map(|(idx, o)| format!("step {} {}", idx + 1, if o.ok { "done" } else { "FAILED" }))
            .collect();
        tracing::info!("[gate] wave {}/{total_waves} result: {}", wave_no + 1, outcome_summary.join(" · "));
        for (idx, outcome) in wave_outcomes {
            prior.push(format!(
                "- {} ({})",
                plan.steps[idx].title,
                if outcome.ok { "done" } else { "FAILED" }
            ));
            results.push(outcome);
        }
        if wave_failed {
            tracing::warn!("[gate] stopping after wave {}/{total_waves} — a step failed", wave_no + 1);
            break;
        }
    }
    Ok(results)
}

/// Build a focused prompt for a single step's subagent.
fn build_step_prompt(goal: &str, prior: &[String], step: &PlanStep) -> String {
    let prior_block = if prior.is_empty() {
        "(this is the first step)".to_string()
    } else {
        prior.join("\n")
    };
    let files = if step.files.is_empty() {
        String::new()
    } else {
        format!("\nRelevant files: {}", step.files.join(", "))
    };
    format!(
        "You are implementing ONE step of an approved plan. Be lean — make only \
         the change this step calls for, and actually apply it.\n\n\
         Overall goal: {goal}\n\n\
         Completed so far:\n{prior_block}\n\n\
         YOUR STEP: {title}\n{detail}{files}\n\n\
         Do NOT start long-running or blocking processes (dev servers, watchers, \
         `http.server`, `npm run dev`, `tail -f`) — they never return and stall \
         the run. If this step is verification, use a quick non-blocking check \
         (build/compile/typecheck/lint) or inspect the files directly; never \
         launch a server or open a browser.\n\n\
         Do the work now. When finished, reply with ONLY a single line naming \
         what you changed (e.g. \"Added static mount in main.py\") — no preamble, \
         no \"Perfect\"/\"Let me\"/\"You're right\", no restating the plan, no \
         status claims like \"verified\" or \"tests pass\".",
        title = step.title,
        detail = step.detail_md,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::orchestrator::models::{PlanStatus, StepStatus};

    fn step(title: &str, model: Option<&str>) -> PlanStep {
        PlanStep {
            id: format!("id-{title}"),
            ordinal: 0,
            title: title.into(),
            detail_md: "detail".into(),
            model: model.map(String::from),
            files: vec![],
            commands: vec![],
            status: StepStatus::Approved,
            user_edited: false,
        }
    }

    #[test]
    fn step_model_defaults_to_sonnet() {
        assert_eq!(step_model(&step("a", None)), "sonnet");
        assert_eq!(step_model(&step("a", Some("haiku"))), "haiku");
        assert_eq!(step_model(&step("a", Some(""))), "sonnet");
    }

    #[test]
    fn step_prompt_is_focused_and_names_the_step() {
        let p = build_step_prompt("Add auth", &["- Setup (done)".into()], &step("Add login", None));
        assert!(p.contains("Add auth"));
        assert!(p.contains("Add login"));
        assert!(p.contains("Setup (done)"));
        assert!(p.to_lowercase().contains("one step"));
    }

    #[test]
    fn run_tiered_runs_each_step_and_reports_ok() {
        use crate::modules::orchestrator::backend::BackendEvent;
        use crate::modules::orchestrator::conversation::test_support::{test_config, MockBackend};

        let backend = MockBackend {
            scripts: vec![vec![
                BackendEvent::AssistantText("did it".into()),
                BackendEvent::Completed {
                    is_error: false,
                    cost_usd: 0.0,
                    duration_ms: 1,
                    input_tokens: 1,
                    output_tokens: 1,
                },
            ]],
        };
        let plan = Plan {
            id: "p".into(),
            session_id: "s".into(),
            version: 1,
            goal: "g".into(),
            summary_md: "s".into(),
            status: PlanStatus::Confirmed,
            steps: vec![step("a", Some("haiku")), step("b", Some("opus"))],
            created_at: "now".into(),
        };
        let events = std::sync::atomic::AtomicUsize::new(0);
        let outcomes = run_tiered(&backend, &test_config(), &plan, |_, _| {
            events.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        })
        .unwrap();
        assert_eq!(outcomes.len(), 2);
        assert!(outcomes.iter().all(|o| o.ok));
        assert!(events.load(std::sync::atomic::Ordering::Relaxed) > 0);
    }

    fn step_with_files(title: &str, files: &[&str]) -> PlanStep {
        PlanStep {
            files: files.iter().map(|s| s.to_string()).collect(),
            ..step(title, None)
        }
    }

    #[test]
    fn disjoint_steps_share_a_wave() {
        let steps = vec![
            step_with_files("a", &["main.py"]),
            step_with_files("b", &["page.tsx"]),
        ];
        assert_eq!(schedule_waves(&steps), vec![vec![0, 1]]);
    }

    #[test]
    fn overlapping_steps_split_into_waves() {
        let steps = vec![
            step_with_files("a", &["main.py"]),
            step_with_files("b", &["main.py"]), // collides with a
        ];
        assert_eq!(schedule_waves(&steps), vec![vec![0], vec![1]]);
    }

    #[test]
    fn no_declared_files_runs_solo() {
        let steps = vec![
            step_with_files("a", &["x.rs"]),
            step_with_files("b", &[]), // unknown scope → solo
            step_with_files("c", &["y.rs"]),
            step_with_files("d", &["z.rs"]),
        ];
        // a+? — b has no files so a is solo, b solo, then c+d disjoint.
        assert_eq!(schedule_waves(&steps), vec![vec![0], vec![1], vec![2, 3]]);
    }

    #[test]
    fn three_disjoint_then_one_overlap() {
        let steps = vec![
            step_with_files("a", &["1.ts"]),
            step_with_files("b", &["2.ts"]),
            step_with_files("c", &["3.ts"]),
            step_with_files("d", &["2.ts"]), // collides with b → new wave
        ];
        assert_eq!(schedule_waves(&steps), vec![vec![0, 1, 2], vec![3]]);
    }

    // Guard that a Plan with tiered steps is the shape run_tiered expects.
    #[test]
    fn plan_shape_smoke() {
        let plan = Plan {
            id: "p".into(),
            session_id: "s".into(),
            version: 1,
            goal: "g".into(),
            summary_md: "s".into(),
            status: PlanStatus::Confirmed,
            steps: vec![step("a", Some("haiku")), step("b", Some("opus"))],
            created_at: "now".into(),
        };
        assert_eq!(plan.steps.len(), 2);
        assert_eq!(step_model(&plan.steps[1]), "opus");
    }
}
