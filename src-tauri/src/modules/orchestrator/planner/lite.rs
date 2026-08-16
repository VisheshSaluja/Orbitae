//! The lean, ponytail-style planner.
//!
//! Drives the conversation to emit a plan as a single JSON object, extracts and
//! validates it, and makes exactly one repair attempt on malformed output before
//! giving up. No heavyweight methodology — used when the GSD skill is toggled off
//! or for small tasks.

use super::{PlanDraft, Planner};
use crate::modules::orchestrator::conversation::Conversation;
use crate::modules::orchestrator::error::{OrchestratorError, Result};

/// Lean planner: one prompt, JSON out, one repair retry.
pub struct LitePlanner;

impl Planner for LitePlanner {
    fn produce(&self, convo: &Conversation, task: &str) -> Result<PlanDraft> {
        let out = convo.ask(&build_plan_prompt(task))?;
        if out.is_error {
            return Err(OrchestratorError::Planner(format!(
                "planner turn failed: {}",
                out.stderr.trim()
            )));
        }
        parse_or_repair(convo, &out.text)
    }

    fn revise(&self, convo: &Conversation, feedback: &str) -> Result<PlanDraft> {
        let out = convo.ask(&build_revise_prompt(feedback))?;
        if out.is_error {
            return Err(OrchestratorError::Planner(format!(
                "revision turn failed: {}",
                out.stderr.trim()
            )));
        }
        parse_or_repair(convo, &out.text)
    }
}

/// Parse the response; on failure, ask once for valid JSON and parse that.
pub(crate) fn parse_or_repair(convo: &Conversation, text: &str) -> Result<PlanDraft> {
    match parse_plan_response(text) {
        Ok(draft) => Ok(draft),
        Err(_) => {
            let repaired = convo.ask(REPAIR_PROMPT)?;
            parse_plan_response(&repaired.text)
        }
    }
}

/// The plan-schema instruction shared by the produce prompt and repairs.
pub(crate) const SCHEMA_BLOCK: &str = r#"{
  "goal": "one sentence describing the outcome",
  "summary_md": "a short markdown overview",
  "steps": [
    {
      "title": "imperative step title",
      "detail_md": "markdown body; may include GFM tables or ```mermaid diagrams",
      "model": "haiku | sonnet | opus | null",
      "files": ["path/to/file"],
      "commands": ["command to run"]
    }
  ]
}"#;

fn build_plan_prompt(task: &str) -> String {
    format!(
        "You are producing an implementation plan for a developer to review. \
         Do not write code or run any tools yet — only plan.\n\n\
         TASK:\n{task}\n\n\
         Output ONLY a JSON object (optionally in a ```json fence) with this exact shape:\n\
         {SCHEMA_BLOCK}\n\n\
         Rules:\n\
         - Match the plan's size to the task's size. A small, well-scoped task \
         is 1–3 tight steps. Do NOT add standalone \"investigate\", \"confirm\", \
         \"audit\", or \"verify\" steps for small tasks — fold any lookup the \
         work needs into the implementation step itself. Reserve multi-step, \
         investigation-heavy plans for genuinely large or risky work.\n\
         - Prefer the laziest approach that fully works; don't over-engineer.\n\
         - Do NOT add a step that tells an agent to \"run it and verify\", \
         \"confirm it works\", or self-report PASS/FAIL. An agent cannot reliably \
         verify its own work and will produce false confidence. Verification is \
         handled automatically after execution by deterministic checks \
         (build/lint/type/tests) and an independent review. If something genuinely \
         needs a HUMAN to verify (a live login/OAuth round-trip, a real \
         deployment, visual QA), fold a one-line \"human must verify: …\" note \
         into the relevant step instead of making it an agent step.\n\
         - Order steps by dependency.\n\
         - Set \"model\" per step by difficulty: haiku for mechanical work, \
         sonnet for normal, opus for hard reasoning.\n\
         - \"files\" and \"commands\" may be empty arrays.\n\
         - Output the JSON object and nothing else."
    )
}

pub(crate) fn build_revise_prompt(feedback: &str) -> String {
    format!(
        "Revise the plan based on this change request. Keep every step the user \
         did not ask to change exactly as-is.\n\n\
         CHANGE REQUEST:\n{feedback}\n\n\
         Output the full revised plan as the same JSON object, and nothing else."
    )
}

const REPAIR_PROMPT: &str =
    "That was not valid JSON matching the required schema. Re-output the plan as \
     a single valid JSON object with keys goal, summary_md, and steps — and nothing else.";

/// Extract and deserialize the plan JSON from an assistant response.
fn parse_plan_response(text: &str) -> Result<PlanDraft> {
    let json = extract_json_object(text)
        .ok_or_else(|| OrchestratorError::InvalidPlan("no JSON object found in response".into()))?;
    serde_json::from_str::<PlanDraft>(&json)
        .map_err(|e| OrchestratorError::InvalidPlan(format!("plan JSON did not match schema: {e}")))
}

/// Find the plan JSON in free text: prefer a fenced block, else the first
/// balanced `{...}` object (brace-counting that respects string literals).
pub(crate) fn extract_json_object(text: &str) -> Option<String> {
    // Prefer a ```json ... ``` (or plain ``` ... ```) fence containing an object.
    if let Some(fenced) = extract_fenced(text) {
        if let Some(obj) = first_balanced_object(&fenced) {
            return Some(obj);
        }
    }
    first_balanced_object(text)
}

fn extract_fenced(text: &str) -> Option<String> {
    let start = text.find("```")?;
    let after = &text[start + 3..];
    // Skip an optional language tag on the fence line.
    let body_start = after.find('\n').map(|n| n + 1).unwrap_or(0);
    let body = &after[body_start..];
    let end = body.find("```")?;
    Some(body[..end].to_string())
}

/// Return the first brace-balanced `{...}` substring, ignoring braces inside
/// double-quoted strings and honoring backslash escapes.
fn first_balanced_object(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let start = text.find('{')?;
    let mut depth = 0usize;
    let mut in_str = false;
    let mut escaped = false;
    for (i, &b) in bytes.iter().enumerate().skip(start) {
        let c = b as char;
        if in_str {
            if escaped {
                escaped = false;
            } else if c == '\\' {
                escaped = true;
            } else if c == '"' {
                in_str = false;
            }
            continue;
        }
        match c {
            '"' => in_str = true,
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(text[start..=i].to_string());
                }
            }
            _ => {}
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::orchestrator::backend::BackendEvent;
    use crate::modules::orchestrator::conversation::test_support::{test_config, MockBackend};
    use crate::modules::orchestrator::conversation::Conversation;

    fn valid_json() -> String {
        serde_json::json!({
            "goal": "Add auth",
            "summary_md": "Overview",
            "steps": [{
                "title": "Add model",
                "detail_md": "## Model\n- fields",
                "model": "sonnet",
                "files": ["m.rs"],
                "commands": []
            }]
        })
        .to_string()
    }

    #[test]
    fn parses_bare_json() {
        let d = parse_plan_response(&valid_json()).unwrap();
        assert_eq!(d.goal, "Add auth");
        assert_eq!(d.steps.len(), 1);
        assert_eq!(d.steps[0].model.as_deref(), Some("sonnet"));
    }

    #[test]
    fn parses_fenced_json_with_prose() {
        let text = format!("Here is the plan:\n```json\n{}\n```\nDone.", valid_json());
        let d = parse_plan_response(&text).unwrap();
        assert_eq!(d.goal, "Add auth");
    }

    #[test]
    fn ignores_braces_inside_strings() {
        let tricky = serde_json::json!({
            "goal": "use a { brace }", "summary_md": "x", "steps": []
        })
        .to_string();
        let d = parse_plan_response(&tricky).unwrap();
        assert_eq!(d.goal, "use a { brace }");
        assert!(d.steps.is_empty());
    }

    #[test]
    fn malformed_is_invalid_plan() {
        assert!(matches!(
            parse_plan_response("no json here"),
            Err(OrchestratorError::InvalidPlan(_))
        ));
    }

    fn completed() -> BackendEvent {
        BackendEvent::Completed {
            is_error: false,
            cost_usd: 0.0,
            duration_ms: 1,
            input_tokens: 1,
            output_tokens: 1,
        }
    }

    #[test]
    fn produce_returns_draft_from_conversation() {
        let backend = MockBackend {
            scripts: vec![vec![BackendEvent::AssistantText(valid_json()), completed()]],
        };
        let convo = Conversation::start(&backend, test_config()).unwrap();
        let draft = LitePlanner.produce(&convo, "add auth").unwrap();
        assert_eq!(draft.goal, "Add auth");
    }

    #[test]
    fn produce_repairs_malformed_first_response() {
        let backend = MockBackend {
            scripts: vec![
                // turn 1: garbage
                vec![BackendEvent::AssistantText("oops, thinking...".into()), completed()],
                // turn 2 (repair): valid
                vec![BackendEvent::AssistantText(valid_json()), completed()],
            ],
        };
        let convo = Conversation::start(&backend, test_config()).unwrap();
        let draft = LitePlanner.produce(&convo, "add auth").unwrap();
        assert_eq!(draft.goal, "Add auth");
    }

    /// End-to-end against the real `claude` binary: proves ClaudeBackend +
    /// Conversation + LitePlanner produce a real, schema-valid plan and can then
    /// revise it on the same session. Ignored by default (needs the binary).
    #[test]
    #[ignore = "requires the claude binary; run with `--ignored --nocapture`"]
    fn live_produce_and_revise() {
        use crate::modules::agent_sessions::events::TaskPermissionMode;
        use crate::modules::orchestrator::backend::claude::ClaudeBackend;
        use crate::modules::orchestrator::backend::SessionConfig;

        let cfg = SessionConfig {
            cwd: "/tmp".into(),
            model: Some("sonnet".into()),
            permission_mode: TaskPermissionMode::AcceptEdits,
        };
        let convo = Conversation::start(&ClaudeBackend, cfg).unwrap();

        let draft = LitePlanner
            .produce(&convo, "Add a /health endpoint to a small Express app.")
            .expect("produce should return a valid plan");
        assert!(!draft.goal.is_empty());
        assert!(!draft.steps.is_empty());
        eprintln!("PLAN goal: {}", draft.goal);
        for s in &draft.steps {
            eprintln!("  - [{}] {}", s.model.as_deref().unwrap_or("?"), s.title);
        }

        let revised = LitePlanner
            .revise(&convo, "Also add a test for the endpoint.")
            .expect("revise should return a valid plan");
        eprintln!("REVISED steps: {}", revised.steps.len());
        assert!(revised.steps.len() >= draft.steps.len());

        convo.stop().ok();
    }
}
