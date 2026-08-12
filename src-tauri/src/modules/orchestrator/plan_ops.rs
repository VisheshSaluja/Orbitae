//! Pure plan operations — no I/O, no agent, fully unit-testable.
//!
//! These functions turn the agent's [`PlanDraft`] into a persistable [`Plan`],
//! merge a revision while preserving the developer's authoritative edits, apply
//! a step edit, and decide when a plan may be confirmed. The `PlanSession`
//! service composes them with the conversation and repository; keeping them pure
//! means the tricky bits (edit preservation, confirm gating) are tested in
//! isolation.

use std::collections::HashMap;

use super::models::{Plan, PlanStatus, PlanStep, StepStatus};
use super::planner::{PlanDraft, StepDraft};

/// Generate a fresh identifier for a plan/step.
fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

/// Build a fresh (pending, not-edited) step from a draft step at a position.
fn step_from_draft(d: &StepDraft, ordinal: i32) -> PlanStep {
    PlanStep {
        id: new_id(),
        ordinal,
        title: d.title.clone(),
        detail_md: d.detail_md.clone(),
        model: d.model.clone(),
        files: d.files.clone(),
        commands: d.commands.clone(),
        status: StepStatus::Pending,
        user_edited: false,
    }
}

/// Convert a first-draft plan into a persistable `Plan` (version 1+).
pub fn draft_to_plan(draft: &PlanDraft, session_id: &str, version: i32) -> Plan {
    Plan {
        id: new_id(),
        session_id: session_id.to_string(),
        version,
        goal: draft.goal.clone(),
        summary_md: draft.summary_md.clone(),
        status: PlanStatus::Reviewing,
        steps: draft
            .steps
            .iter()
            .enumerate()
            .map(|(i, s)| step_from_draft(s, i as i32))
            .collect(),
        created_at: now(),
    }
}

/// Merge a revision into a new plan version, **preserving the developer's
/// authoritative (user-edited) steps verbatim**.
///
/// Ordering and non-edited steps come from `new_draft`; any step the user edited
/// in `prev` is carried forward with its exact content, status, and
/// `user_edited` flag, re-numbered to its new position.
///
/// ponytail: locked steps are matched to the new draft by title — the cheap,
/// deterministic key. Ceiling: if the model renames a locked step's title in the
/// revision, the match is lost and it falls through as a regular step. Upgrade
/// to a stable per-step token passed through the planner prompt if that bites.
pub fn merge_revision(prev: &Plan, new_draft: &PlanDraft, version: i32) -> Plan {
    let locked: HashMap<&str, &PlanStep> = prev
        .steps
        .iter()
        .filter(|s| s.user_edited)
        .map(|s| (s.title.as_str(), s))
        .collect();

    let steps = new_draft
        .steps
        .iter()
        .enumerate()
        .map(|(i, ds)| match locked.get(ds.title.as_str()) {
            Some(kept) => {
                let mut step = (*kept).clone();
                step.ordinal = i as i32;
                step
            }
            None => step_from_draft(ds, i as i32),
        })
        .collect();

    Plan {
        id: new_id(),
        session_id: prev.session_id.clone(),
        version,
        goal: new_draft.goal.clone(),
        summary_md: new_draft.summary_md.clone(),
        status: PlanStatus::Reviewing,
        steps,
        created_at: now(),
    }
}

/// A partial edit to a step. `None` fields are left unchanged; `Some` replaces.
/// `model` is doubly-optional so the user can explicitly clear the suggestion.
#[derive(Debug, Default, Clone)]
pub struct StepEdit {
    pub title: Option<String>,
    pub detail_md: Option<String>,
    pub model: Option<Option<String>>,
    pub files: Option<Vec<String>>,
    pub commands: Option<Vec<String>>,
}

/// Apply a user edit and mark the step authoritative so revisions preserve it.
pub fn apply_step_edit(step: &mut PlanStep, edit: StepEdit) {
    if let Some(t) = edit.title {
        step.title = t;
    }
    if let Some(d) = edit.detail_md {
        step.detail_md = d;
    }
    if let Some(m) = edit.model {
        step.model = m;
    }
    if let Some(f) = edit.files {
        step.files = f;
    }
    if let Some(c) = edit.commands {
        step.commands = c;
    }
    step.user_edited = true;
}

/// A plan may be confirmed only when it has steps and every step is approved.
pub fn can_confirm(plan: &Plan) -> bool {
    !plan.steps.is_empty() && plan.steps.iter().all(|s| s.status == StepStatus::Approved)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn draft(steps: &[(&str, &str)]) -> PlanDraft {
        PlanDraft {
            goal: "Goal".into(),
            summary_md: "Summary".into(),
            steps: steps
                .iter()
                .map(|(title, detail)| StepDraft {
                    title: (*title).into(),
                    detail_md: (*detail).into(),
                    model: Some("sonnet".into()),
                    files: vec![],
                    commands: vec![],
                })
                .collect(),
        }
    }

    #[test]
    fn draft_to_plan_assigns_ordinals_and_pending() {
        let plan = draft_to_plan(&draft(&[("A", "da"), ("B", "db")]), "sess", 1);
        assert_eq!(plan.version, 1);
        assert_eq!(plan.status, PlanStatus::Reviewing);
        assert_eq!(plan.steps.len(), 2);
        assert_eq!(plan.steps[0].ordinal, 0);
        assert_eq!(plan.steps[1].ordinal, 1);
        assert!(plan.steps.iter().all(|s| s.status == StepStatus::Pending));
        assert!(plan.steps.iter().all(|s| !s.user_edited));
    }

    #[test]
    fn merge_preserves_user_edited_step_verbatim() {
        let mut prev = draft_to_plan(&draft(&[("Add route", "orig"), ("Verify", "v")]), "s", 1);
        // User edits step 0 and approves it.
        apply_step_edit(
            &mut prev.steps[0],
            StepEdit {
                detail_md: Some("MY EDITED DETAIL".into()),
                ..Default::default()
            },
        );
        prev.steps[0].status = StepStatus::Approved;

        // Revision reorders and rewrites, but keeps the same title for the edited step.
        let new_draft = draft(&[("Verify", "v2"), ("Add route", "MODEL REWROTE THIS"), ("Add test", "t")]);
        let merged = merge_revision(&prev, &new_draft, 2);

        assert_eq!(merged.version, 2);
        let edited = merged.steps.iter().find(|s| s.title == "Add route").unwrap();
        // Verbatim content, flag, and status survive the revision.
        assert_eq!(edited.detail_md, "MY EDITED DETAIL");
        assert!(edited.user_edited);
        assert_eq!(edited.status, StepStatus::Approved);
        // Re-numbered to its new position (index 1 in the new draft).
        assert_eq!(edited.ordinal, 1);
        // Non-locked steps come fresh from the draft.
        let test_step = merged.steps.iter().find(|s| s.title == "Add test").unwrap();
        assert!(!test_step.user_edited);
        assert_eq!(test_step.status, StepStatus::Pending);
    }

    #[test]
    fn merge_drops_locked_step_if_title_removed() {
        let mut prev = draft_to_plan(&draft(&[("Locked", "x")]), "s", 1);
        apply_step_edit(&mut prev.steps[0], StepEdit { detail_md: Some("edited".into()), ..Default::default() });
        // New draft no longer contains "Locked".
        let merged = merge_revision(&prev, &draft(&[("Other", "y")]), 2);
        assert!(merged.steps.iter().all(|s| s.title != "Locked"));
        assert_eq!(merged.steps.len(), 1);
    }

    #[test]
    fn apply_step_edit_marks_authoritative() {
        let mut plan = draft_to_plan(&draft(&[("A", "da")]), "s", 1);
        assert!(!plan.steps[0].user_edited);
        apply_step_edit(
            &mut plan.steps[0],
            StepEdit {
                title: Some("A2".into()),
                model: Some(None), // explicitly clear the model suggestion
                ..Default::default()
            },
        );
        assert_eq!(plan.steps[0].title, "A2");
        assert_eq!(plan.steps[0].model, None);
        assert!(plan.steps[0].user_edited);
        // Untouched fields are preserved.
        assert_eq!(plan.steps[0].detail_md, "da");
    }

    #[test]
    fn confirm_gating() {
        let mut plan = draft_to_plan(&draft(&[("A", "da"), ("B", "db")]), "s", 1);
        assert!(!can_confirm(&plan)); // pending
        plan.steps[0].status = StepStatus::Approved;
        assert!(!can_confirm(&plan)); // one still pending
        plan.steps[1].status = StepStatus::Approved;
        assert!(can_confirm(&plan)); // all approved
    }

    #[test]
    fn empty_plan_cannot_confirm() {
        let plan = draft_to_plan(
            &PlanDraft { goal: "g".into(), summary_md: "s".into(), steps: vec![] },
            "s",
            1,
        );
        assert!(!can_confirm(&plan));
    }
}
