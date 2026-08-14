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
    action: 'auto_fix' | 'escalate';
}

export interface ValidationReport {
    checks: Check[];
    findings: Finding[];
    risk_level: RiskLevel;
    risk_score: number;
    summary: string;
}

/** Run the bounded validation pass (checks + gated adversarial review). */
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
