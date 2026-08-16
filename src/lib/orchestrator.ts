import { invokeCommand } from './tauri';

export type SessionStatus =
    | 'planning'
    | 'reviewing'
    | 'executing'
    | 'done'
    | 'errored'
    | 'cancelled';

export type PlanStatus = 'draft' | 'reviewing' | 'confirmed';

export type StepStatus = 'pending' | 'approved' | 'done' | 'failed';

export interface PlanStep {
    id: string;
    ordinal: number;
    title: string;
    detail_md: string;
    model: string | null;
    files: string[];
    commands: string[];
    status: StepStatus;
    user_edited: boolean;
}

export interface Plan {
    id: string;
    session_id: string;
    version: number;
    goal: string;
    summary_md: string;
    status: PlanStatus;
    steps: PlanStep[];
    created_at: string;
}

export interface SessionView {
    session_id: string;
    status: SessionStatus;
    task: string;
    plan: Plan | null;
    /** Persisted execution result summary (when reopening a finished plan). */
    result?: string | null;
    /** Persisted execution log (when reopening a finished plan). */
    log?: string | null;
}

export interface PlanSummary {
    session_id: string;
    task: string;
    goal: string | null;
    status: SessionStatus;
    version: number | null;
    step_count: number;
    updated_at: string;
}

/** Recent persisted plan sessions for a project. */
export function listPlans(projectId: string): Promise<PlanSummary[]> {
    return invokeCommand<PlanSummary[]>('orchestrator_list_plans', { projectId });
}

/** Reopen a plan — live session if active, else its persisted state. */
export function loadPlan(sessionId: string): Promise<SessionView> {
    return invokeCommand<SessionView>('orchestrator_load_plan', { sessionId });
}

/** Delete a plan session from the registry and storage. */
export function deletePlan(sessionId: string): Promise<void> {
    return invokeCommand<void>('orchestrator_delete_plan', { sessionId });
}

export type RiskLevel = 'low' | 'medium' | 'high';

export interface Check {
    name: string;
    passed: boolean;
    output: string;
}

export interface Finding {
    title: string;
    detail: string;
    severity: 'error' | 'warning';
    action: 'auto_fix' | 'escalate';
    /** File the finding is about — used to pin it to the diff. */
    file: string | null;
    /** Verbatim one-line snippet from the diff to anchor the finding to. */
    anchor: string | null;
}

export interface ValidationReport {
    checks: Check[];
    findings: Finding[];
    /** Titles of mechanical findings that were auto-fixed. */
    auto_fixed: string[];
    risk_level: RiskLevel;
    /** The objective reasons the risk level was assigned (explainable, not a number). */
    risk_reasons: string[];
    summary: string;
    /** The reviewed diff, for rendering findings anchored to the code. */
    diff: string;
}

/** Run the bounded validation pass (checks + gated adversarial review + auto-fix). */
export function validate(
    projectId: string,
    projectPath: string,
    sessionId: string,
): Promise<ValidationReport> {
    return invokeCommand<ValidationReport>('orchestrator_validate', {
        projectId,
        projectPath,
        sessionId,
    });
}

/** One changed file in the execution delta. */
export interface ChangedFile {
    /** Git status letter: A/M/D/R. */
    status: string;
    path: string;
    adds: number;
    dels: number;
}

export interface ExecStats {
    steps: number;
    /** 1-based index of the first failed step, if any. */
    failed_step: number | null;
    duration_ms: number;
    cost_usd: number;
}

/** The structured execution result — assembled from data, never agent narration. */
export interface ExecutionResult {
    outcome: 'done' | 'failed';
    headline: string;
    changed_files: ChangedFile[];
    stats: ExecStats;
}

/** A human review comment to apply to the diff (a line annotation). */
export interface ReviewComment {
    file: string | null;
    /** A code snippet from the diff line the comment is anchored to. */
    code: string | null;
    comment: string;
}

/** Apply a batch of human review comments to the working tree via an agent.
 *  `intent` (the plan goal) gives the agent context for terse comments. */
export function applyReviewComments(projectPath: string, comments: ReviewComment[], intent?: string): Promise<string> {
    return invokeCommand<string>('orchestrator_apply_review_comments', { projectPath, comments, intent: intent ?? null });
}

/** Persist pending plan annotations (opaque JSON) so they survive reopen. */
export function saveAnnotations(sessionId: string, annotations: string): Promise<void> {
    return invokeCommand<void>('orchestrator_save_annotations', { sessionId, annotations });
}

/** Load pending plan annotations for a session (JSON array; "[]" when none). */
export function getAnnotations(sessionId: string): Promise<string> {
    return invokeCommand<string>('orchestrator_get_annotations', { sessionId });
}

export interface PrResult {
    branch: string;
    committed: boolean;
    pushed: boolean;
    pr_url: string | null;
    compare_url: string | null;
    message: string;
}

/** Commit the change under the user's identity and open a PR (never merges). */
export function createPr(projectPath: string, title: string, body: string): Promise<PrResult> {
    return invokeCommand<PrResult>('orchestrator_create_pr', { projectPath, title, body });
}

/** Start a plan-first session and produce the first plan for a task. */
export function begin(
    projectId: string,
    projectPath: string,
    task: string,
    useGsd: boolean,
    model?: string | null,
): Promise<SessionView> {
    return invokeCommand<SessionView>('orchestrator_begin', {
        projectId,
        projectPath,
        task,
        useGsd,
        model: model ?? null,
    });
}

export function get(sessionId: string): Promise<SessionView> {
    return invokeCommand<SessionView>('orchestrator_get', { sessionId });
}

export function editStep(
    sessionId: string,
    stepId: string,
    changes: { title?: string; detailMd?: string },
): Promise<SessionView> {
    return invokeCommand<SessionView>('orchestrator_edit_step', {
        sessionId,
        stepId,
        title: changes.title ?? null,
        detailMd: changes.detailMd ?? null,
    });
}

export function ask(
    sessionId: string,
    question: string,
    stepId?: string | null,
): Promise<string> {
    return invokeCommand<string>('orchestrator_ask', {
        sessionId,
        question,
        stepId: stepId ?? null,
    });
}

export function revise(sessionId: string, feedback: string): Promise<SessionView> {
    return invokeCommand<SessionView>('orchestrator_revise', { sessionId, feedback });
}

export function approveStep(sessionId: string, stepId: string): Promise<SessionView> {
    return invokeCommand<SessionView>('orchestrator_approve_step', { sessionId, stepId });
}

export function approveAll(sessionId: string): Promise<SessionView> {
    return invokeCommand<SessionView>('orchestrator_approve_all', { sessionId });
}

export function confirm(sessionId: string): Promise<SessionView> {
    return invokeCommand<SessionView>('orchestrator_confirm', { sessionId });
}

/** Execute the confirmed plan. Progress streams via `orchestrator-progress-{id}` events. */
export function execute(sessionId: string): Promise<SessionView> {
    return invokeCommand<SessionView>('orchestrator_execute', { sessionId });
}

export function cancel(sessionId: string): Promise<void> {
    return invokeCommand<void>('orchestrator_cancel', { sessionId });
}
