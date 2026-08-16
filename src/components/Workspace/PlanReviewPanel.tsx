import React, { useState, useEffect, useCallback, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { toast } from 'sonner';
import { listen } from '@tauri-apps/api/event';
import {
    Loader2, Check, CheckCheck, Pencil, MessageCircleQuestion,
    RotateCcw, X, Play, Lock, Send, ChevronRight, Terminal, CheckCircle2,
    ShieldCheck, GitPullRequest, ExternalLink, MessageSquarePlus, Trash2,
} from 'lucide-react';
import * as orch from '../../lib/orchestrator';
import type { SessionView, Plan, PlanStep, ValidationReport, Finding } from '../../lib/orchestrator';
import { DiffReview } from './DiffReview';
import { AnnotationOverlay } from './AnnotationOverlay';

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
    const [execResult, setExecResult] = useState<string | null>(null);
    const [executing, setExecuting] = useState(false);

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
    const logEndRef = useRef<HTMLDivElement>(null);
    useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [execLog]);

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
        if (session.result) setExecResult(session.result);
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
            setExecResult(e.payload);
            setExecuting(false);
            orch.loadPlan(sid).then(setSession).catch(() => {});
        }).then((fn) => { unlistenR = fn; });
        return () => { unlistenP?.(); unlistenR?.(); };
    }, [reopenId, session?.session_id, session?.status]);

    const sessionId = session?.session_id;
    const plan: Plan | null = session?.plan ?? null;
    const allApproved = !!plan && plan.steps.length > 0 && plan.steps.every((s) => s.status === 'approved');

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
        const unlistenProgress = await listen<string>(`orchestrator-progress-${sid}`, (e) => {
            setExecLog((prev) => [...prev, e.payload]);
        });
        const unlistenResult = await listen<string>(`orchestrator-result-${sid}`, (e) => {
            setExecResult(e.payload);
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
            await orch.applyReviewComments(projectPath, comments);
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
            const res = await orch.createPr(projectPath, plan.goal, buildPrBody(plan.goal, report));
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
                {(executing || execLog.length > 0) && (
                    <div className="rounded-xl border border-zinc-800 bg-[#0c0c0e] overflow-hidden">
                        <div className="flex items-center gap-2 px-4 py-2 border-b border-zinc-800">
                            {executing
                                ? <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                                : <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
                            <Terminal className="w-3.5 h-3.5 text-zinc-500" />
                            <span className="text-[12px] font-medium text-zinc-200">
                                {executing ? 'Executing plan…' : 'Execution log'}
                            </span>
                        </div>
                        <div className="px-4 py-3 max-h-72 overflow-y-auto">
                            <pre className="text-[11px] leading-relaxed font-mono text-zinc-300 whitespace-pre-wrap break-words">
                                {execLog.join('\n')}
                            </pre>
                            <div ref={logEndRef} />
                        </div>
                    </div>
                )}

                {execResult && (
                    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 overflow-hidden">
                        <div className="flex items-center gap-2 px-4 py-2 border-b border-emerald-500/20">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                            <span className="text-[12px] font-semibold text-foreground">Result</span>
                        </div>
                        <div className="px-4 py-3">
                            <Markdown>{execResult}</Markdown>
                        </div>
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
                                <button
                                    onClick={doCreatePr}
                                    disabled={prBusy}
                                    className="w-full flex items-center justify-center gap-2 rounded-xl bg-foreground text-background px-4 py-3 text-[13px] font-medium hover:bg-foreground/90 transition-colors disabled:opacity-50"
                                >
                                    {prBusy
                                        ? <><Loader2 className="w-4 h-4 animate-spin" /> Opening PR…</>
                                        : <><GitPullRequest className="w-4 h-4" /> Create PR</>}
                                </button>
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
function buildPrBody(goal: string, report: ValidationReport | null): string {
    const lines = [`## Summary`, ``, goal, ``];
    if (report) {
        lines.push(`## Validation`, ``, `**Risk: ${report.risk_level}** — ${report.risk_reasons.join('; ')}`, ``);
        if (report.checks.length) {
            lines.push(`### Checks`);
            for (const c of report.checks) lines.push(`- ${c.passed ? '✅' : '❌'} ${c.name}`);
            lines.push(``);
        }
        if (report.auto_fixed.length) {
            lines.push(`### Auto-fixed`);
            for (const t of report.auto_fixed) lines.push(`- ${t}`);
            lines.push(``);
        }
        const escalations = report.findings.filter((f) => f.action === 'escalate');
        if (escalations.length) {
            lines.push(`### Findings to review`);
            for (const f of escalations) lines.push(`- **[${f.severity}]** ${f.title} — ${f.detail}`);
            lines.push(``);
        }
    }
    return lines.join('\n');
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
