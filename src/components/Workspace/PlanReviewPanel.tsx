import React, { useState, useEffect, useCallback, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { toast } from 'sonner';
import { listen } from '@tauri-apps/api/event';
import {
    Loader2, Check, CheckCheck, Pencil, MessageCircleQuestion,
    RotateCcw, X, Play, Lock, Send, ChevronRight, ChevronDown, Terminal, CheckCircle2,
    ShieldCheck, GitPullRequest, ExternalLink, MessageSquarePlus, Trash2, ClipboardCheck,
} from 'lucide-react';
import * as orch from '../../lib/orchestrator';
import type { SessionView, Plan, PlanStep, ValidationReport, Finding, ExecutionResult } from '../../lib/orchestrator';
import { DiffReview } from './DiffReview';
import { AnnotationOverlay } from './AnnotationOverlay';
import { ResultCard } from './ResultCard';

interface PlanReviewPanelProps {
    projectId: string;
    projectPath: string;
    /** For a NEW plan. Ignored when `reopenId` is set. */
    task?: string;
    /** To REOPEN a persisted/live plan instead of starting a new one. */
    reopenId?: string;
    useGsd?: boolean;
    model?: string | null;
    onClose: () => void;
    onConfirmed?: (session: SessionView) => void;
}

/** A developer comment pinned to a highlighted phrase in a plan step. */
interface PlanNote {
    id: string;
    stepId: string;
    stepTitle: string;
    quote: string;
    comment: string;
}

const MODEL_COLORS: Record<string, string> = {
    haiku: 'bg-sky-500/15 text-sky-400',
    sonnet: 'bg-violet-500/15 text-violet-400',
    opus: 'bg-amber-500/15 text-amber-400',
};

/** Rich markdown — real tables, lists, code (never raw pipes). */
const Markdown: React.FC<{ children: string }> = ({ children }) => (
    <div className="text-[13px] leading-relaxed text-foreground/85 space-y-2
        [&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-sm [&_h2]:font-semibold
        [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5
        [&_code]:bg-muted/50 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[12px] [&_code]:font-mono
        [&_pre]:bg-muted/40 [&_pre]:p-3 [&_pre]:rounded-lg [&_pre]:overflow-x-auto [&_pre]:text-[12px]
        [&_table]:w-full [&_table]:border-collapse [&_table]:text-[12px]
        [&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:bg-muted/40 [&_th]:text-left
        [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1
        [&_a]:text-sky-400 [&_a]:underline">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
);

const StatusDot: React.FC<{ status: PlanStep['status'] }> = ({ status }) => {
    const color = status === 'approved' ? 'bg-emerald-400'
        : status === 'done' ? 'bg-sky-400'
        : status === 'failed' ? 'bg-red-400'
        : 'bg-muted-foreground/30';
    return <span className={`w-2 h-2 rounded-full shrink-0 ${color}`} />;
};

export const PlanReviewPanel: React.FC<PlanReviewPanelProps> = ({
    projectId, projectPath, task, reopenId, useGsd = false, model = null, onClose, onConfirmed,
}) => {
    const [session, setSession] = useState<SessionView | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState<string | null>(null); // action label or null

    // Per-step interaction state
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editTitle, setEditTitle] = useState('');
    const [editDetail, setEditDetail] = useState('');
    const [askingId, setAskingId] = useState<string | null>(null);
    const [askInput, setAskInput] = useState('');
    const [answers, setAnswers] = useState<Record<string, string>>({});
    const [feedback, setFeedback] = useState('');

    // Execution
    const [execLog, setExecLog] = useState<string[]>([]);
    const [execResult, setExecResult] = useState<ExecutionResult | null>(null);
    const [legacyResult, setLegacyResult] = useState<string | null>(null); // pre-structured sessions
    const [executing, setExecuting] = useState(false);
    const [logOpen, setLogOpen] = useState(false);

    // Validation (Review & Ship)
    const [validating, setValidating] = useState(false);
    const [report, setReport] = useState<ValidationReport | null>(null);
    const [prBusy, setPrBusy] = useState(false);
    const [prResult, setPrResult] = useState<orch.PrResult | null>(null);
    const [findingQna, setFindingQna] = useState<{ title: string; answer: string } | null>(null);
    const [applyingComments, setApplyingComments] = useState(false);

    // Plan annotations: highlight text anywhere in the plan → pin a comment → batch-revise.
    const [planNotes, setPlanNotes] = useState<PlanNote[]>([]);
    const noteIdc = useRef(0);
    const bodyRef = useRef<HTMLDivElement>(null);
    const notesHydrated = useRef(false); // don't persist until we've loaded

    // The approved change boundary the gate enforces against.
    const [boundary, setBoundary] = useState<orch.ScopePolicy | null>(null);
    const [newAllowed, setNewAllowed] = useState('');
    const boundaryHydrated = useRef(false);
    const logEndRef = useRef<HTMLDivElement>(null);
    useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [execLog]);

    // The result channel/persistence now carries a structured ExecutionResult as
    // JSON. Parse it; fall back to raw text for pre-structured sessions.
    const applyResultPayload = useCallback((payload: string) => {
        try {
            const r = JSON.parse(payload);
            if (r && typeof r === 'object' && 'outcome' in r && 'stats' in r) {
                setExecResult(r as ExecutionResult);
                setLegacyResult(null);
                return;
            }
        } catch { /* not JSON — legacy narration */ }
        setLegacyResult(payload);
        setExecResult(null);
    }, []);

    // Begin a new session, or reopen an existing one, on mount.
    useEffect(() => {
        let cancelled = false;
        setBusy('planning');
        const start = reopenId
            ? orch.loadPlan(reopenId)
            : orch.begin(projectId, projectPath, task ?? '', useGsd, model);
        start
            .then((v) => { if (!cancelled) setSession(v); })
            .catch((e) => { if (!cancelled) setError(String(e)); })
            .finally(() => { if (!cancelled) setBusy(null); });
        return () => { cancelled = true; };
    }, [projectId, projectPath, task, useGsd, model, reopenId]);

    // Reopening a finished plan: show its persisted log + result.
    useEffect(() => {
        if (!reopenId || !session) return;
        if (session.log) setExecLog(session.log.split('\n'));
        if (session.result) applyResultPayload(session.result);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [reopenId, session?.session_id]);

    // If we reopened a plan that's still executing, attach to its live progress.
    useEffect(() => {
        const sid = session?.session_id;
        if (!reopenId || !sid || session?.status !== 'executing') return;
        let unlistenP: (() => void) | undefined;
        let unlistenR: (() => void) | undefined;
        setExecuting(true);
        listen<string>(`orchestrator-progress-${sid}`, (e) => {
            setExecLog((prev) => [...prev, e.payload]);
        }).then((fn) => { unlistenP = fn; });
        listen<string>(`orchestrator-result-${sid}`, (e) => {
            applyResultPayload(e.payload);
            setExecuting(false);
            orch.loadPlan(sid).then(setSession).catch(() => {});
        }).then((fn) => { unlistenR = fn; });
        return () => { unlistenP?.(); unlistenR?.(); };
    }, [reopenId, session?.session_id, session?.status]);

    const sessionId = session?.session_id;
    const plan: Plan | null = session?.plan ?? null;
    const allApproved = !!plan && plan.steps.length > 0 && plan.steps.every((s) => s.status === 'approved');

    // Hydrate pending plan annotations once the session id is known, then persist
    // on every change so they survive closing/reopening the plan.
    useEffect(() => {
        if (!sessionId) return;
        notesHydrated.current = false;
        orch.getAnnotations(sessionId)
            .then((json) => {
                try {
                    const parsed = JSON.parse(json);
                    if (Array.isArray(parsed)) setPlanNotes(parsed as PlanNote[]);
                } catch { /* ignore malformed */ }
            })
            .catch(() => {})
            .finally(() => { notesHydrated.current = true; });
    }, [sessionId]);

    useEffect(() => {
        if (!sessionId || !notesHydrated.current) return;
        orch.saveAnnotations(sessionId, JSON.stringify(planNotes)).catch(() => {});
    }, [planNotes, sessionId]);

    // Hydrate the change boundary once the plan is known: use the saved one, else
    // derive a default from the plan's declared files. Then persist on edit.
    useEffect(() => {
        if (!sessionId || !plan) return;
        boundaryHydrated.current = false;
        orch.getBoundary(sessionId)
            .then((json) => {
                let b: orch.ScopePolicy | null = null;
                if (json) { try { b = JSON.parse(json) as orch.ScopePolicy; } catch { /* ignore */ } }
                if (!b) {
                    const allowed = [...new Set(plan.steps.flatMap((s) => s.files))];
                    b = { allowed, protected: [], max_diff_lines: null };
                }
                setBoundary(b);
            })
            .catch(() => {})
            .finally(() => { boundaryHydrated.current = true; });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionId, plan?.id]);

    useEffect(() => {
        if (!sessionId || !boundaryHydrated.current || !boundary) return;
        orch.saveBoundary(sessionId, boundary).catch(() => {});
    }, [boundary, sessionId]);

    const run = useCallback(async (label: string, fn: () => Promise<SessionView>) => {
        setBusy(label);
        setError(null);
        try {
            setSession(await fn());
        } catch (e) {
            toast.error(`${label} failed: ${e}`);
        } finally {
            setBusy(null);
        }
    }, []);

    const startEdit = (step: PlanStep) => {
        setEditingId(step.id);
        setEditTitle(step.title);
        setEditDetail(step.detail_md);
    };

    const saveEdit = (stepId: string) => {
        run('Edit', () => orch.editStep(sessionId!, stepId, { title: editTitle, detailMd: editDetail }));
        setEditingId(null);
    };

    const submitAsk = async (stepId: string | null) => {
        if (!askInput.trim() || !sessionId) return;
        setBusy('Ask');
        try {
            const answer = await orch.ask(sessionId, askInput.trim(), stepId);
            setAnswers((prev) => ({ ...prev, [stepId ?? '_global']: answer }));
            setAskInput('');
            setAskingId(null);
        } catch (e) {
            toast.error(`Question failed: ${e}`);
        } finally {
            setBusy(null);
        }
    };

    const submitRevise = () => {
        if (!feedback.trim() || !sessionId) return;
        run('Revise', () => orch.revise(sessionId, feedback.trim()));
        setFeedback('');
    };

    const runExecution = useCallback(async (sid: string) => {
        setExecuting(true);
        setExecLog([]);
        setExecResult(null);
        setLegacyResult(null);
        const unlistenProgress = await listen<string>(`orchestrator-progress-${sid}`, (e) => {
            setExecLog((prev) => [...prev, e.payload]);
        });
        const unlistenResult = await listen<string>(`orchestrator-result-${sid}`, (e) => {
            applyResultPayload(e.payload);
        });
        try {
            const v = await orch.execute(sid);
            setSession(v);
            toast.success('Execution complete');
            onConfirmed?.(v);
        } catch (e) {
            toast.error(`Execution failed: ${e}`);
        } finally {
            unlistenProgress();
            unlistenResult();
            setExecuting(false);
        }
    }, [onConfirmed]);

    const doConfirm = async () => {
        if (!sessionId) return;
        setBusy('Confirm');
        try {
            const v = await orch.confirm(sessionId);
            setSession(v);
            void runExecution(sessionId);
        } catch (e) {
            toast.error(`Confirm failed: ${e}`);
        } finally {
            setBusy(null);
        }
    };

    const runValidation = async () => {
        if (!sessionId) return;
        setValidating(true);
        setReport(null);
        setPrResult(null);
        try {
            setReport(await orch.validate(projectId, projectPath, sessionId));
        } catch (e) {
            toast.error(`Validation failed: ${e}`);
        } finally {
            setValidating(false);
        }
    };

    const applyComments = async (comments: orch.ReviewComment[]) => {
        if (!projectPath) return;
        setApplyingComments(true);
        try {
            await orch.applyReviewComments(projectPath, comments, plan?.goal);
            toast.success('Comments applied — re-reviewing');
            await runValidation();
        } catch (e) {
            toast.error(`Apply failed: ${e}`);
        } finally {
            setApplyingComments(false);
        }
    };

    // A comment dropped on a highlighted phrase, resolved to its step.
    const handlePlanComment = ({ quote, target, comment }: { quote: string; target: HTMLElement | null; comment: string }) => {
        const el = target?.closest('[data-annot-step]') as HTMLElement | null;
        setPlanNotes((ns) => [...ns, {
            id: `n${noteIdc.current++}`,
            stepId: el?.getAttribute('data-annot-step') ?? '',
            stepTitle: el?.getAttribute('data-annot-title') ?? 'the plan',
            quote, comment,
        }]);
    };

    const reviseWithNotes = () => {
        if (!sessionId || planNotes.length === 0) return;
        const feedback = 'Address these specific comments on the plan. Keep everything else exactly as-is:\n' +
            planNotes.map((n) => `- On step "${n.stepTitle}", regarding "${n.quote}": ${n.comment}`).join('\n');
        run('Revise', () => orch.revise(sessionId, feedback));
        setPlanNotes([]);
    };

    const askAboutFinding = async (f: Finding) => {
        if (!sessionId) return;
        setBusy('Ask');
        setFindingQna(null);
        try {
            const q = `About the review finding "${f.title}"${f.file ? ` in ${f.file}` : ''}: ${f.detail}\n\n` +
                `Is this a real problem in the change you just made? If yes, give the smallest concrete fix. If not, explain why it's a false alarm. Be brief.`;
            const answer = await orch.ask(sessionId, q, null);
            setFindingQna({ title: f.title, answer });
        } catch (e) {
            toast.error(`Question failed: ${e}`);
        } finally {
            setBusy(null);
        }
    };

    const doCreatePr = async () => {
        if (!plan) return;
        setPrBusy(true);
        try {
            const res = await orch.createPr(projectPath, plan.goal, buildReceipt(plan, report, execResult));
            setPrResult(res);
            toast.success(res.pr_url ? 'PR opened' : res.message);
        } catch (e) {
            toast.error(`Create PR failed: ${e}`);
        } finally {
            setPrBusy(false);
        }
    };

    // Close keeps the plan — it's persisted and reopenable from the Plans list.
    const doClose = () => onClose();

    // ---- render ----
    if (busy === 'planning' && !session) {
        return (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
                <Loader2 className="w-6 h-6 animate-spin" />
                <p className="text-[13px]">
                    {reopenId
                        ? 'Loading plan…'
                        : <>Planning: <span className="text-foreground/70">{task}</span></>}
                </p>
            </div>
        );
    }

    if (error && !plan) {
        return (
            <div className="flex flex-col items-center justify-center h-full gap-3 p-6 text-center">
                <p className="text-[13px] text-red-400">Failed to plan</p>
                <p className="text-[12px] text-muted-foreground max-w-md">{error}</p>
                <button onClick={onClose} className="px-4 py-2 rounded-lg text-[12px] bg-foreground/10 hover:bg-foreground/15">Close</button>
            </div>
        );
    }

    if (!plan) return null;

    return (
        <div className="flex flex-col h-full max-w-3xl mx-auto w-full">
            <AnnotationOverlay containerRef={bodyRef} scopeAttr="data-annot-step" onSubmit={handlePlanComment} />
            {/* Header */}
            <div className="flex items-start gap-3 px-4 sm:px-6 py-4 border-b border-border/60">
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-500/15 text-violet-400 font-medium capitalize">{session?.status}</span>
                        <span className="text-[10px] text-muted-foreground/60">plan v{plan.version}</span>
                        {plan.status === 'confirmed' && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-medium">confirmed</span>
                        )}
                    </div>
                    <h2 className="text-[15px] font-semibold text-foreground leading-snug">{plan.goal}</h2>
                    <p className="text-[12px] text-muted-foreground mt-0.5 truncate">{session?.task}</p>
                </div>
                <button onClick={doClose} className="p-1.5 rounded-lg text-muted-foreground/50 hover:text-foreground hover:bg-foreground/6 shrink-0">
                    <X className="w-4 h-4" />
                </button>
            </div>

            {/* Scrollable body */}
            <div ref={bodyRef} className="flex-1 overflow-y-auto hide-scrollbar px-4 sm:px-6 py-4 space-y-4">
                {(() => {
                    // The log is process (what it's doing); once done it's demoted
                    // to a one-line, expandable header so the Result leads.
                    if (!executing && execLog.length === 0) return null;
                    const done = !executing && (execResult || legacyResult);
                    const collapsed = done && !logOpen;
                    return (
                        <div className="rounded-xl border border-zinc-800 bg-[#0c0c0e] overflow-hidden">
                            <button
                                onClick={() => done && setLogOpen((v) => !v)}
                                className={`w-full flex items-center gap-2 px-4 py-2 border-b border-zinc-800 text-left ${done ? 'hover:bg-white/[0.03]' : 'cursor-default'}`}>
                                {executing
                                    ? <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                                    : <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
                                <Terminal className="w-3.5 h-3.5 text-zinc-500" />
                                <span className="text-[12px] font-medium text-zinc-200 flex-1">
                                    {executing ? 'Executing plan…' : `Execution log · ${execLog.length} lines`}
                                </span>
                                {done && (collapsed
                                    ? <ChevronRight className="w-3.5 h-3.5 text-zinc-500" />
                                    : <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />)}
                            </button>
                            {!collapsed && (
                                <div className="px-4 py-3 max-h-72 overflow-y-auto">
                                    <pre className="text-[11px] leading-relaxed font-mono text-zinc-300 whitespace-pre-wrap break-words">
                                        {execLog.join('\n')}
                                    </pre>
                                    <div ref={logEndRef} />
                                </div>
                            )}
                        </div>
                    );
                })()}

                {execResult && <ResultCard result={execResult} />}
                {!execResult && legacyResult && (
                    <div className="rounded-xl border border-border/50 bg-card/50 overflow-hidden">
                        <div className="flex items-center gap-2 px-4 py-2 border-b border-border/40">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                            <span className="text-[12px] font-semibold text-foreground">Result</span>
                        </div>
                        <div className="px-4 py-3 opacity-80"><Markdown>{legacyResult}</Markdown></div>
                    </div>
                )}

                {/* Review & Ship — validation → PR */}
                {session?.status === 'done' && (
                    report ? (
                        <>
                            <DiffReview report={report} onRerun={runValidation} busy={validating} onAsk={askAboutFinding}
                                onApplyComments={applyComments} applying={applyingComments} />
                            {findingQna && (
                                <div className="rounded-xl border border-sky-500/25 bg-sky-500/5 p-4 space-y-1.5">
                                    <div className="flex items-center gap-2">
                                        <MessageCircleQuestion className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                                        <span className="text-[12px] font-medium text-foreground flex-1 min-w-0 truncate">{findingQna.title}</span>
                                        <button onClick={() => setFindingQna(null)} className="text-muted-foreground/50 hover:text-foreground"><X className="w-3.5 h-3.5" /></button>
                                    </div>
                                    <Markdown>{findingQna.answer}</Markdown>
                                </div>
                            )}
                            {prResult ? (
                                <PrResultCard result={prResult} />
                            ) : (
                                <div className="flex gap-2">
                                    <button
                                        onClick={doCreatePr}
                                        disabled={prBusy}
                                        className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-foreground text-background px-4 py-3 text-[13px] font-medium hover:bg-foreground/90 transition-colors disabled:opacity-50"
                                    >
                                        {prBusy
                                            ? <><Loader2 className="w-4 h-4 animate-spin" /> Opening PR…</>
                                            : <><GitPullRequest className="w-4 h-4" /> Create PR</>}
                                    </button>
                                    <button
                                        onClick={() => {
                                            navigator.clipboard.writeText(buildReceipt(plan, report, execResult))
                                                .then(() => toast.success('Evidence receipt copied'))
                                                .catch(() => toast.error('Copy failed'));
                                        }}
                                        className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-[13px] font-medium hover:border-foreground/20 transition-colors"
                                        title="Copy the reproducible evidence receipt">
                                        <ClipboardCheck className="w-4 h-4" /> Copy receipt
                                    </button>
                                </div>
                            )}
                        </>
                    ) : (
                        <button
                            onClick={runValidation}
                            disabled={validating}
                            className="w-full flex items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-[13px] font-medium hover:border-foreground/20 transition-colors disabled:opacity-50"
                        >
                            {validating
                                ? <><Loader2 className="w-4 h-4 animate-spin" /> Reviewing the change…</>
                                : <><ShieldCheck className="w-4 h-4 text-emerald-400" /> Review &amp; Ship</>}
                        </button>
                    )
                )}

                {plan.summary_md.trim() && (
                    <div data-annot-step="__summary__" data-annot-title="Plan summary"
                        className="rounded-xl border border-border/50 bg-card/50 p-4 space-y-2">
                        <Markdown>{plan.summary_md}</Markdown>
                        {planNotes.filter((n) => !plan.steps.some((s) => s.id === n.stepId)).map((n) => (
                            <div key={n.id} className="rounded-lg border border-sky-500/25 bg-sky-500/5 p-2.5 space-y-1">
                                <div className="text-[10px] text-muted-foreground/70 border-l-2 border-sky-500/40 pl-2 italic line-clamp-2">“{n.quote}”</div>
                                <div className="flex items-start gap-1.5">
                                    <MessageSquarePlus className="w-3 h-3 text-sky-400 mt-0.5 shrink-0" />
                                    <span className="text-[11px] text-foreground/85 flex-1 min-w-0">{n.comment}</span>
                                    <button onClick={() => setPlanNotes((ns) => ns.filter((x) => x.id !== n.id))}
                                        className="text-muted-foreground/50 hover:text-red-400 shrink-0"><Trash2 className="w-3 h-3" /></button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Change boundary — the approved scope the gate enforces against. */}
                {boundary && (
                    <div className="rounded-xl border border-border/60 bg-card/40 p-3 space-y-2">
                        <div className="flex items-center gap-1.5">
                            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400/80" />
                            <span className="text-[12px] font-semibold text-foreground">Change boundary</span>
                            <span className="text-[10px] text-muted-foreground/60">— files this change may touch</span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                            {boundary.allowed.length === 0 && (
                                <span className="text-[11px] text-amber-400/80">Not scoped — every changed file will read as out-of-scope. Add the files this change should touch.</span>
                            )}
                            {boundary.allowed.map((f) => (
                                <span key={f} className="inline-flex items-center gap-1 text-[11px] font-mono px-1.5 py-0.5 rounded bg-muted/50 text-foreground/70">
                                    {f}
                                    {plan.status !== 'confirmed' && (
                                        <button onClick={() => setBoundary((b) => b && ({ ...b, allowed: b.allowed.filter((x) => x !== f) }))}
                                            className="text-muted-foreground/50 hover:text-red-400"><X className="w-2.5 h-2.5" /></button>
                                    )}
                                </span>
                            ))}
                        </div>
                        {plan.status !== 'confirmed' && (
                            <div className="flex items-center gap-2">
                                <input value={newAllowed} onChange={(e) => setNewAllowed(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && newAllowed.trim()) {
                                            const v = newAllowed.trim();
                                            setBoundary((b) => b && (b.allowed.includes(v) ? b : { ...b, allowed: [...b.allowed, v] }));
                                            setNewAllowed('');
                                        }
                                    }}
                                    placeholder="add a file or glob (e.g. src/**, public/index.html)"
                                    className="flex-1 bg-muted/30 rounded px-2 py-1 text-[11px] font-mono outline-none border border-border focus:border-foreground/20" />
                                <label className="text-[10px] text-muted-foreground/60 flex items-center gap-1">
                                    max +lines
                                    <input type="number" min={0} value={boundary.max_diff_lines ?? ''}
                                        onChange={(e) => setBoundary((b) => b && ({ ...b, max_diff_lines: e.target.value ? parseInt(e.target.value, 10) : null }))}
                                        className="w-16 bg-muted/30 rounded px-1.5 py-1 text-[11px] outline-none border border-border focus:border-foreground/20" />
                                </label>
                            </div>
                        )}
                        <p className="text-[10px] text-muted-foreground/40">CI config, lockfiles, secrets, and migrations are always protected.</p>
                    </div>
                )}

                {plan.status !== 'confirmed' && plan.steps.length > 0 && (
                    <p className="text-[10px] text-muted-foreground/50 px-1 flex items-center gap-1">
                        <MessageSquarePlus className="w-3 h-3" /> Highlight any text in the plan to comment on it.
                    </p>
                )}

                {plan.steps.map((step, i) => (
                    <div key={step.id} data-annot-step={step.id} data-annot-title={step.title}
                        className="rounded-xl border border-border bg-card overflow-hidden">
                        {/* Step header */}
                        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/50">
                            <StatusDot status={step.status} />
                            <span className="text-[11px] text-muted-foreground/50 font-mono">{i + 1}</span>
                            <span className="text-[13px] font-medium text-foreground flex-1 min-w-0 truncate">{step.title}</span>
                            {step.user_edited && <Lock className="w-3 h-3 text-amber-400/70 shrink-0" aria-label="edited — preserved on revision" />}
                            {step.model && (
                                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${MODEL_COLORS[step.model] ?? 'bg-muted/50 text-muted-foreground'}`}>{step.model}</span>
                            )}
                        </div>

                        {/* Step body */}
                        <div className="px-4 py-3 space-y-3">
                            {editingId === step.id ? (
                                <div className="space-y-2">
                                    <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)}
                                        className="w-full bg-muted/30 rounded-lg px-3 py-2 text-[13px] outline-none border border-border focus:border-foreground/20" />
                                    <textarea value={editDetail} onChange={(e) => setEditDetail(e.target.value)} rows={6}
                                        className="w-full bg-muted/30 rounded-lg px-3 py-2 text-[12px] font-mono outline-none border border-border focus:border-foreground/20 resize-y" />
                                    <div className="flex gap-2">
                                        <button onClick={() => saveEdit(step.id)} className="px-3 py-1.5 rounded-lg text-[12px] bg-foreground text-background hover:bg-foreground/90">Save</button>
                                        <button onClick={() => setEditingId(null)} className="px-3 py-1.5 rounded-lg text-[12px] bg-foreground/10 hover:bg-foreground/15">Cancel</button>
                                    </div>
                                </div>
                            ) : (
                                <>
                                    <Markdown>{step.detail_md}</Markdown>
                                    {step.files.length > 0 && (
                                        <div className="flex flex-wrap gap-1.5">
                                            {step.files.map((f) => (
                                                <span key={f} className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-muted/40 text-foreground/60">{f}</span>
                                            ))}
                                        </div>
                                    )}
                                    {step.commands.length > 0 && (
                                        <div className="space-y-1">
                                            {step.commands.map((c, ci) => (
                                                <div key={ci} className="flex items-center gap-2 text-[11px] font-mono text-emerald-400/80">
                                                    <ChevronRight className="w-3 h-3 shrink-0" />{c}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    {answers[step.id] && (
                                        <div className="rounded-lg bg-sky-500/5 border border-sky-500/15 p-3">
                                            <Markdown>{answers[step.id]}</Markdown>
                                        </div>
                                    )}
                                    {askingId === step.id && (
                                        <div className="flex gap-2">
                                            <input autoFocus value={askInput} onChange={(e) => setAskInput(e.target.value)}
                                                onKeyDown={(e) => e.key === 'Enter' && submitAsk(step.id)}
                                                placeholder="Ask about this step…"
                                                className="flex-1 bg-muted/30 rounded-lg px-3 py-2 text-[12px] outline-none border border-border focus:border-foreground/20" />
                                            <button onClick={() => submitAsk(step.id)} disabled={busy === 'Ask'} className="px-2 rounded-lg bg-foreground/10 hover:bg-foreground/15">
                                                {busy === 'Ask' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                                            </button>
                                        </div>
                                    )}

                                    {/* Pinned comments on this step. */}
                                    {planNotes.filter((n) => n.stepId === step.id).map((n) => (
                                        <div key={n.id} className="rounded-lg border border-sky-500/25 bg-sky-500/5 p-2.5 space-y-1">
                                            <div className="text-[10px] text-muted-foreground/70 border-l-2 border-sky-500/40 pl-2 italic line-clamp-2">“{n.quote}”</div>
                                            <div className="flex items-start gap-1.5">
                                                <MessageSquarePlus className="w-3 h-3 text-sky-400 mt-0.5 shrink-0" />
                                                <span className="text-[11px] text-foreground/85 flex-1 min-w-0">{n.comment}</span>
                                                <button onClick={() => setPlanNotes((ns) => ns.filter((x) => x.id !== n.id))}
                                                    className="text-muted-foreground/50 hover:text-red-400 shrink-0"><Trash2 className="w-3 h-3" /></button>
                                            </div>
                                        </div>
                                    ))}

                                    {/* Step actions */}
                                    <div className="flex items-center gap-1.5 pt-1">
                                        <StepAction icon={Pencil} label="Edit" onClick={() => startEdit(step)} />
                                        <StepAction icon={MessageCircleQuestion} label="Ask" onClick={() => { setAskingId(step.id); setAskInput(''); }} />
                                        {step.status !== 'approved' ? (
                                            <StepAction icon={Check} label="Approve"
                                                onClick={() => run('Approve', () => orch.approveStep(sessionId!, step.id))}
                                                accent />
                                        ) : (
                                            <span className="flex items-center gap-1 text-[11px] text-emerald-400 px-2 py-1"><Check className="w-3 h-3" /> Approved</span>
                                        )}
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            {/* Footer: revise + confirm */}
            <div className="border-t border-border/60 px-4 sm:px-6 py-3 space-y-2">
                {planNotes.length > 0 && (
                    <button onClick={reviseWithNotes} disabled={!!busy}
                        className="w-full flex items-center justify-center gap-2 rounded-lg bg-sky-500/90 text-white px-3 py-2 text-[12px] font-medium hover:bg-sky-500 disabled:opacity-40">
                        {busy === 'Revise' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MessageSquarePlus className="w-3.5 h-3.5" />}
                        Revise with {planNotes.length} comment{planNotes.length > 1 ? 's' : ''}
                    </button>
                )}
                <div className="flex gap-2">
                    <input value={feedback} onChange={(e) => setFeedback(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && submitRevise()}
                        placeholder="Request a change to the plan…"
                        className="flex-1 bg-muted/30 rounded-lg px-3 py-2 text-[12px] outline-none border border-border focus:border-foreground/20" />
                    <button onClick={submitRevise} disabled={!feedback.trim() || !!busy}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] bg-foreground/10 hover:bg-foreground/15 disabled:opacity-40">
                        {busy === 'Revise' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />} Revise
                    </button>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={() => run('Approve all', () => orch.approveAll(sessionId!))} disabled={!!busy}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] bg-foreground/10 hover:bg-foreground/15 disabled:opacity-40">
                        {busy === 'Approve all' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCheck className="w-3.5 h-3.5" />} Approve all
                    </button>
                    <div className="flex-1" />
                    <button onClick={doConfirm} disabled={!allApproved || !!busy || plan.status === 'confirmed'}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[12px] font-medium bg-emerald-500 text-white hover:bg-emerald-500/90 disabled:opacity-40 disabled:cursor-not-allowed">
                        {busy === 'Confirm' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                        {plan.status === 'confirmed' ? 'Confirmed' : 'Confirm & Execute'}
                    </button>
                </div>
            </div>
        </div>
    );
};

/** Build a clean PR body from the goal + validation report (no AI attribution). */
/**
 * A reproducible evidence receipt for the change: what was approved, the change
 * boundary, what actually changed, which checks *actually ran*, and every open
 * finding (scope drift + test-integrity + review). Used as the PR body and the
 * in-app exportable artifact. Honest framing — evidence you can inspect, not a
 * proof of correctness.
 */
function buildReceipt(plan: Plan, report: ValidationReport | null, result: ExecutionResult | null): string {
    const L: string[] = [`# Orbitae evidence receipt`, ``];
    if (report) L.push(`**Verdict: ${report.risk_level}** — ${report.risk_reasons.join('; ')}`, ``);

    L.push(`## Intent`, ``, plan.goal, ``);

    const boundary = [...new Set(plan.steps.flatMap((s) => s.files))];
    L.push(`## Change boundary (approved scope)`, ``);
    L.push(boundary.length ? boundary.map((f) => `- \`${f}\``).join('\n') : `_Not explicitly scoped._`, ``);

    if (result && result.changed_files.length) {
        L.push(`## Changed files`, ``);
        for (const f of result.changed_files) L.push(`- \`${f.status}\` ${f.path} (+${f.adds} −${f.dels})`);
        L.push(``);
    }

    if (report) {
        L.push(`## Checks (actually run)`, ``);
        if (report.checks.length) {
            for (const c of report.checks) L.push(`- ${c.passed ? '✅' : '❌'} ${c.name}${c.passed ? '' : ` — ${(c.output || 'failed').split('\n').slice(-1)[0]}`}`);
        } else {
            L.push(`_No deterministic checks for this project._`);
        }
        L.push(``);
        if (report.auto_fixed.length) {
            L.push(`## Auto-fixed`, ``, ...report.auto_fixed.map((t) => `- ${t}`), ``);
        }
        const escalations = report.findings.filter((f) => f.action === 'escalate');
        L.push(`## Findings (${escalations.length} to review)`, ``);
        if (escalations.length) {
            for (const f of escalations) L.push(`- **[${f.severity}]** ${f.title} — ${f.detail}`);
        } else {
            L.push(`_None._`);
        }
        L.push(``);
    }

    if (result) L.push(`---`, `_${result.stats.steps} steps · ${Math.round(result.stats.duration_ms / 1000)}s · $${result.stats.cost_usd.toFixed(4)}. Reproducible evidence you can inspect — not a proof of correctness. Orbitae never merges; you're the gate._`);
    return L.join('\n');
}

const PrResultCard: React.FC<{ result: orch.PrResult }> = ({ result }) => {
    const link = result.pr_url || result.compare_url;
    return (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-2">
            <div className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
                <GitPullRequest className="w-4 h-4 text-emerald-400" /> {result.message}
            </div>
            <div className="text-[11px] text-muted-foreground font-mono">branch: {result.branch}</div>
            {link && (
                <a href={link} target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-[12px] text-sky-400 hover:underline">
                    <ExternalLink className="w-3.5 h-3.5" />
                    {result.pr_url ? 'View pull request' : 'Open a pull request'}
                </a>
            )}
        </div>
    );
};

const StepAction: React.FC<{ icon: React.ElementType; label: string; onClick: () => void; accent?: boolean }> = ({ icon: Icon, label, onClick, accent }) => (
    <button onClick={onClick}
        className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] transition-colors ${
            accent ? 'text-emerald-400 hover:bg-emerald-500/10' : 'text-muted-foreground/70 hover:text-foreground hover:bg-foreground/6'
        }`}>
        <Icon className="w-3 h-3" /> {label}
    </button>
);
