import React, { useState, useEffect, useCallback, useRef } from 'react';
import { invokeCommand } from '../../lib/tauri';
import * as tm from '../../lib/terminalManager';
import { toast } from 'sonner';
import {
    Play, Square, Bot, Zap, Monitor, ExternalLink,
    Plus, RefreshCw, Clock, FileCode, GitBranch,
    X, Eye, Globe, ChevronDown, ChevronRight, ArrowLeft, LayoutGrid,
    ListChecks,
} from 'lucide-react';
import { TerminalGrid } from './TerminalGrid';
import { SmartCommandStrip, RouteResultView, type DirectResponse } from './SmartCommandStrip';
import { PlanReviewPanel } from './PlanReviewPanel';
import * as orch from '../../lib/orchestrator';
import type { SessionView } from '../../lib/orchestrator';
import type { SessionMetrics } from '../../types';

/** One entry in the Agents conversation thread. */
type ChatMsg =
    | { id: string; role: 'user'; text: string }
    | { id: string; role: 'assistant'; kind: 'route'; response: DirectResponse }
    | { id: string; role: 'assistant'; kind: 'plan'; prompt: string; sessionId?: string; goal?: string; status?: string };

interface AgentSession {
    id: string;
    agent_type: string;
    display_name: string;
    status: string;
    pid: number | null;
    project_id: string;
    created_at: string;
}

interface FileDiffStat {
    file: string;
    additions: number;
    deletions: number;
}

interface SessionDiff {
    stat_summary: string;
    changed_files: string[];
    file_stats: FileDiffStat[];
}

interface ListeningPort {
    port: number;
    pid: number;
    process: string;
    is_project: boolean;
}

interface SessionsTabProps {
    projectId: string;
    projectPath: string;
}

const AGENT_TYPES = [
    { id: 'claude', label: 'Claude Code', icon: Bot, accent: 'bg-orange-500', accentMuted: 'bg-orange-500/15', accentText: 'text-orange-400' },
    { id: 'codex', label: 'Codex CLI', icon: Zap, accent: 'bg-emerald-500', accentMuted: 'bg-emerald-500/15', accentText: 'text-emerald-400' },
    { id: 'custom', label: 'Terminal', icon: Monitor, accent: 'bg-sky-500', accentMuted: 'bg-sky-500/15', accentText: 'text-sky-400' },
] as const;

const getAgentConfig = (type: string) => AGENT_TYPES.find(a => a.id === type) ?? AGENT_TYPES[2];

function formatElapsed(createdAt: string): string {
    const ms = Date.now() - new Date(createdAt).getTime();
    const mins = Math.floor(ms / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ${mins % 60}m`;
    return `${Math.floor(hours / 24)}d`;
}

export const TerminalTab: React.FC<SessionsTabProps> = ({ projectId, projectPath }) => {
    const [sessions, setSessions] = useState<AgentSession[]>([]);
    const [showLauncher, setShowLauncher] = useState(false);
    const [isLaunching, setIsLaunching] = useState(false);
    const [diff, setDiff] = useState<SessionDiff | null>(null);
    const [ports, setPorts] = useState<ListeningPort[]>([]);
    const [portsExpanded, setPortsExpanded] = useState(true);

    const [selectedAgent, setSelectedAgent] = useState('claude');
    const [agentCount, setAgentCount] = useState(1);
    const [injectContext, setInjectContext] = useState(true);
    const [launchMode, setLaunchMode] = useState<'external' | 'embedded'>('embedded');
    const [selectedModel, setSelectedModel] = useState('');
    const [launchInstructions, setLaunchInstructions] = useState('');
    const [taskMode, setTaskMode] = useState(false);

    const [view, setView] = useState<'dashboard' | 'grid'>('dashboard');
    const [planTask, setPlanTask] = useState<string | null>(null);
    const [planReopenId, setPlanReopenId] = useState<string | null>(null);
    const [planUseGsd, setPlanUseGsd] = useState(false);
    const [planSummaries, setPlanSummaries] = useState<orch.PlanSummary[]>([]);

    const loadPlans = useCallback(async () => {
        try {
            setPlanSummaries(await orch.listPlans(projectId));
        } catch {
            // non-critical
        }
    }, [projectId]);
    const [focusedTerminalId, setFocusedTerminalId] = useState<string | null>(null);
    const [embeddedSessionIds] = useState<Set<string>>(() => new Set());
    const [taskSessionIds] = useState<Set<string>>(() => new Set());
    const [sessionMetrics, setSessionMetrics] = useState<Map<string, SessionMetrics>>(() => new Map());

    const loadSessions = useCallback(async () => {
        try {
            const data = await invokeCommand<AgentSession[]>('list_agent_sessions', {});
            setSessions(data.filter(s => s.project_id === projectId));
        } catch {
            // non-critical
        }
    }, [projectId]);

    const loadDiff = useCallback(async () => {
        try {
            const d = await invokeCommand<SessionDiff>('get_session_diff', { projectPath });
            setDiff(d);
        } catch {
            setDiff(null);
        }
    }, [projectPath]);

    const loadPorts = useCallback(async () => {
        try {
            const p = await invokeCommand<ListeningPort[]>('scan_listening_ports', { projectPath });
            setPorts(p);
        } catch {
            setPorts([]);
        }
    }, [projectPath]);

    useEffect(() => {
        loadSessions();
        loadDiff();
        loadPorts();
        loadPlans();
        const interval = setInterval(() => { loadSessions(); loadDiff(); loadPorts(); }, 5000);
        return () => clearInterval(interval);
    }, [loadSessions, loadDiff, loadPorts, loadPlans]);

    const handleLaunch = async () => {
        if (taskMode && !launchInstructions.trim()) {
            toast.error('Instructions are required for task mode');
            return;
        }
        setIsLaunching(true);
        try {
            if (launchMode === 'embedded') {
                const launched: AgentSession[] = [];
                for (let i = 0; i < agentCount; i++) {
                    const sessionId = crypto.randomUUID();
                    await tm.create(sessionId, (status) => {
                        setSessions(prev => prev.map(s =>
                            s.id === sessionId ? { ...s, status } : s
                        ));
                        if (status === 'stopped') {
                            invokeCommand<SessionMetrics | null>('get_session_metrics', { sessionId })
                                .then(m => {
                                    if (m) setSessionMetrics(prev => new Map(prev).set(sessionId, m));
                                })
                                .catch(() => {});
                        }
                    });
                    const session = await invokeCommand<AgentSession>('launch_embedded_session', {
                        agentType: selectedAgent,
                        projectId,
                        projectPath,
                        model: selectedModel || null,
                        instructions: launchInstructions.trim() || null,
                        injectContext,
                        taskMode: taskMode || null,
                        sessionId,
                        rows: null,
                        cols: null,
                    });
                    embeddedSessionIds.add(session.id);
                    if (taskMode) taskSessionIds.add(session.id);
                    launched.push(session);
                }
                setSessions(prev => [...prev, ...launched]);
                setShowLauncher(false);
                setView('grid');
                toast.success(`Launched ${launched.length} embedded session(s)`);
            } else {
                const newSessions = await invokeCommand<AgentSession[]>('launch_agent_sessions', {
                    agentType: selectedAgent,
                    count: agentCount,
                    projectId,
                    projectPath,
                    instructions: launchInstructions.trim() || null,
                    injectContext,
                });
                setSessions(prev => [...prev, ...newSessions]);
                setShowLauncher(false);
                toast.success(`Launched ${newSessions.length} session(s)`);
            }
        } catch (err) {
            toast.error(`Failed to launch: ${err}`);
        } finally {
            setIsLaunching(false);
        }
    };

    const handleStop = async (sessionId: string) => {
        try {
            await invokeCommand('stop_agent_session', { sessionId });
            setSessions(prev => prev.map(s =>
                s.id === sessionId ? { ...s, status: 'stopped' } : s
            ));
            toast.success('Session stopped');
        } catch {
            toast.error('Failed to stop session');
        }
    };

    const handleRemove = async (sessionId: string) => {
        try {
            await invokeCommand('remove_agent_session', { sessionId });
            if (embeddedSessionIds.has(sessionId)) {
                tm.dispose(sessionId);
                embeddedSessionIds.delete(sessionId);
            }
            setSessions(prev => prev.filter(s => s.id !== sessionId));
        } catch {
            toast.error('Failed to remove session');
        }
    };

    const handleFocusExternal = async () => {
        try {
            await invokeCommand('focus_agent_terminals');
        } catch {
            toast.error('Failed to focus terminal');
        }
    };

    const handleSessionFocus = useCallback((session: AgentSession) => {
        if (embeddedSessionIds.has(session.id)) {
            setFocusedTerminalId(session.id);
            setView('grid');
        } else {
            handleFocusExternal();
        }
    }, [embeddedSessionIds]);

    const handleOpenEditor = async () => {
        try {
            await invokeCommand('open_in_editor', { path: projectPath });
        } catch {
            toast.error('Failed to open editor');
        }
    };

    // The conversation thread — user prompts, direct answers, and plan cards
    // accumulate here so nothing is overwritten and it reads like a chat.
    const [thread, setThread] = useState<ChatMsg[]>([]);
    const [openMsgId, setOpenMsgId] = useState<string | null>(null);
    const msgIdc = useRef(0);
    const activePlanMsgId = useRef<string | null>(null);
    const nextMsgId = () => `m${msgIdc.current++}`;

    // A direct Q&A is one exchange (question + answer). A task is ONE plan card —
    // no separate user bubble — that updates in place.
    const handleDirectResult = useCallback((query: string, response: DirectResponse) => {
        setThread((t) => [
            ...t,
            { id: nextMsgId(), role: 'user', text: query },
            { id: nextMsgId(), role: 'assistant', kind: 'route', response },
        ]);
    }, []);

    // Complex queries enter the plan-first loop: append a plan card to the thread
    // and open it in the side panel. Each task is its own message (no overwrite).
    const handleSmartTask = useCallback((prompt: string, useGsd: boolean) => {
        const id = nextMsgId();
        activePlanMsgId.current = id;
        setThread((t) => [...t, { id, role: 'assistant', kind: 'plan', prompt }]);
        setOpenMsgId(id);
        setPlanUseGsd(useGsd);
        setPlanReopenId(null);
        setPlanTask(prompt);
    }, []);

    // When a plan's session is created, link it back to its thread card so the
    // card can reopen it later and show its goal/status.
    const handlePlanSession = useCallback((view: SessionView) => {
        const id = activePlanMsgId.current;
        if (!id) return;
        setThread((t) => t.map((m) =>
            m.id === id && m.role === 'assistant' && m.kind === 'plan'
                ? { ...m, sessionId: view.session_id, goal: view.plan?.goal, status: view.status }
                : m));
        activePlanMsgId.current = null;
    }, []);

    // Keep each plan card's status + goal in sync with the persisted summaries,
    // so the single card updates in place (planning → reviewing → done).
    useEffect(() => {
        if (planSummaries.length === 0) return;
        setThread((t) => t.map((m) => {
            if (m.role !== 'assistant' || m.kind !== 'plan' || !m.sessionId) return m;
            const s = planSummaries.find((p) => p.session_id === m.sessionId);
            return s ? { ...m, goal: s.goal ?? m.goal, status: s.status } : m;
        }));
    }, [planSummaries]);

    const runningSessions = sessions.filter(s => s.status === 'running');
    const stoppedSessions = sessions.filter(s => s.status !== 'running');
    const totalAdditions = diff?.file_stats.reduce((sum, f) => sum + f.additions, 0) ?? 0;
    const totalDeletions = diff?.file_stats.reduce((sum, f) => sum + f.deletions, 0) ?? 0;
    const projectPorts = ports.filter(p => p.is_project);
    const otherPorts = ports.filter(p => !p.is_project);

    const COMMON_DEV_PORTS = [3000, 3001, 3002, 4000, 5000, 5173, 5174, 8000, 8080, 8888];
    const occupiedSet = new Set(ports.map(p => p.port));
    const suggestedPorts = COMMON_DEV_PORTS.filter(p => !occupiedSet.has(p)).slice(0, 6);

    const activeEmbeddedIds = sessions
        .filter(s => embeddedSessionIds.has(s.id) && s.status === 'running')
        .map(s => s.id);
    const allEmbeddedIds = sessions
        .filter(s => embeddedSessionIds.has(s.id))
        .map(s => s.id);

    // The conversation persists: a task opens the plan as a side panel next to
    // the composer + thread, instead of replacing the whole view.
    const planActive = !!(planTask || planReopenId);

    return (
        <div className="h-full flex">
            {/* Conversation column — always present; narrows to a rail beside a plan */}
            <div className={planActive ? "w-[400px] shrink-0 overflow-hidden flex flex-col" : "flex-1 overflow-hidden flex flex-col"}>
                {view === 'grid' && !planActive ? (
                    <>
                        {/* Grid toolbar */}
                        <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-muted/10 shrink-0">
                            <button
                                onClick={() => { setView('dashboard'); setFocusedTerminalId(null); }}
                                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12px] font-medium text-muted-foreground hover:text-foreground hover:bg-foreground/6 transition-colors"
                            >
                                <ArrowLeft className="w-3.5 h-3.5" />
                                Dashboard
                            </button>
                            <div className="w-px h-4 bg-border" />
                            <span className="text-[12px] text-muted-foreground">
                                {activeEmbeddedIds.length} active
                            </span>
                            {activeEmbeddedIds.length !== allEmbeddedIds.length && (
                                <span className="text-[10px] text-muted-foreground/50">
                                    ({allEmbeddedIds.length} total)
                                </span>
                            )}
                            <div className="flex-1" />
                            <button
                                onClick={() => { setView('dashboard'); setShowLauncher(true); }}
                                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12px] font-medium bg-foreground text-background hover:bg-foreground/90 transition-colors"
                            >
                                <Plus className="w-3 h-3" />
                                New
                            </button>
                        </div>
                        {allEmbeddedIds.length > 0 ? (
                            <TerminalGrid
                                sessionIds={allEmbeddedIds}
                                sessions={sessions}
                                focusedId={focusedTerminalId}
                                onFocus={setFocusedTerminalId}
                                onUnfocus={() => setFocusedTerminalId(null)}
                            />
                        ) : (
                            <div className="flex-1 flex items-center justify-center">
                                <div className="text-center">
                                    <Bot className="w-8 h-8 text-muted-foreground/20 mx-auto mb-3" />
                                    <p className="text-[12px] text-muted-foreground/40">No embedded sessions</p>
                                    <button
                                        onClick={() => { setView('dashboard'); setShowLauncher(true); }}
                                        className="mt-3 text-[12px] text-foreground underline underline-offset-2"
                                    >
                                        Launch agents
                                    </button>
                                </div>
                            </div>
                        )}
                    </>
                ) : (
                    <div className="flex-1 flex flex-col min-h-0">
                        <div className="flex-1 overflow-y-auto hide-scrollbar">
                        <div className={planActive ? "p-4 space-y-3" : "max-w-3xl mx-auto p-6 space-y-3"}>
                            {/* Conversation thread */}
                            {thread.length === 0 && !planActive && (
                                <div className="text-center py-12">
                                    <Bot className="w-8 h-8 text-muted-foreground/20 mx-auto mb-2" />
                                    <p className="text-[12px] text-muted-foreground/50">Ask anything, or describe a task to build.</p>
                                </div>
                            )}
                            {thread.map((m) => (
                                m.role === 'user' ? (
                                    <div key={m.id} className="flex justify-end">
                                        <div className="max-w-[85%] rounded-2xl bg-foreground text-background px-3.5 py-2 text-[13px] whitespace-pre-wrap">{m.text}</div>
                                    </div>
                                ) : m.kind === 'route' ? (
                                    <RouteResultView key={m.id} response={m.response} />
                                ) : (
                                    <button key={m.id}
                                        onClick={() => { if (m.sessionId) { setOpenMsgId(m.id); setPlanTask(null); setPlanReopenId(m.sessionId); } }}
                                        className={`w-full text-left flex items-center gap-3 rounded-xl border bg-card px-4 py-2.5 transition-colors ${openMsgId === m.id ? 'border-foreground/30 bg-foreground/[0.03]' : 'border-border hover:border-foreground/20'}`}>
                                        <ListChecks className="w-3.5 h-3.5 text-violet-400 shrink-0" />
                                        <div className="flex-1 min-w-0">
                                            <div className="text-[12px] font-medium text-foreground truncate">{m.goal ?? m.prompt}</div>
                                            <div className="text-[10px] text-muted-foreground/50">{m.sessionId ? (m.status ?? 'plan') : 'planning…'}</div>
                                        </div>
                                        <ChevronRight className="w-4 h-4 text-muted-foreground/30 shrink-0" />
                                    </button>
                                )
                            ))}

                            {/* Recent Plans (history) */}
                            {!planActive && planSummaries.length > 0 && (
                                <div className="space-y-1.5">
                                    <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground/70 px-1">
                                        <ListChecks className="w-3.5 h-3.5" /> Recent Plans
                                    </div>
                                    <div className="space-y-1.5">
                                        {planSummaries.map((p) => (
                                            <div
                                                key={p.session_id}
                                                onClick={() => { setOpenMsgId(null); setPlanTask(null); setPlanReopenId(p.session_id); }}
                                                className={`group w-full text-left flex items-center gap-3 rounded-xl border bg-card px-4 py-2.5 hover:border-foreground/20 transition-colors cursor-pointer ${planReopenId === p.session_id ? 'border-foreground/30 bg-foreground/[0.03]' : 'border-border'}`}
                                            >
                                                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                                    p.status === 'done' ? 'bg-emerald-400'
                                                    : p.status === 'executing' ? 'bg-sky-400'
                                                    : p.status === 'errored' ? 'bg-red-400'
                                                    : p.status === 'cancelled' ? 'bg-muted-foreground/30'
                                                    : 'bg-violet-400'}`} />
                                                <div className="flex-1 min-w-0">
                                                    <div className="text-[12px] font-medium text-foreground truncate">{p.goal ?? p.task}</div>
                                                    <div className="text-[10px] text-muted-foreground/50">
                                                        {p.status}{p.version ? ` · plan v${p.version}` : ''}{p.step_count ? ` · ${p.step_count} steps` : ''}
                                                    </div>
                                                </div>
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        orch.deletePlan(p.session_id).then(loadPlans).catch(() => {});
                                                    }}
                                                    className="p-1 rounded-md text-muted-foreground/30 hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                                                    title="Delete plan"
                                                >
                                                    <X className="w-3.5 h-3.5" />
                                                </button>
                                                <ChevronRight className="w-4 h-4 text-muted-foreground/30 shrink-0" />
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {!planActive && (<>
                            {/* Quick actions bar */}
                            <div className="flex items-center gap-2 flex-wrap">
                                <button
                                    onClick={() => setShowLauncher(!showLauncher)}
                                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-medium bg-foreground text-background hover:bg-foreground/90 transition-colors"
                                >
                                    <Plus className="w-3.5 h-3.5" />
                                    New Session
                                </button>
                                {allEmbeddedIds.length > 0 && (
                                    <button
                                        onClick={() => setView('grid')}
                                        className="flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-foreground/4 transition-colors"
                                    >
                                        <LayoutGrid className="w-3.5 h-3.5" />
                                        View Grid
                                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-medium tabular-nums">
                                            {activeEmbeddedIds.length}
                                        </span>
                                    </button>
                                )}
                                {runningSessions.some(s => !embeddedSessionIds.has(s.id)) && (
                                    <button
                                        onClick={handleFocusExternal}
                                        className="flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-foreground/4 transition-colors"
                                    >
                                        <Eye className="w-3.5 h-3.5" />
                                        Show Terminals
                                    </button>
                                )}
                                <button
                                    onClick={handleOpenEditor}
                                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-foreground/4 transition-colors"
                                >
                                    <ExternalLink className="w-3.5 h-3.5" />
                                    Open in Editor
                                </button>
                                <div className="flex-1" />
                                <button
                                    onClick={() => { loadSessions(); loadDiff(); loadPorts(); }}
                                    className="p-2 rounded-md text-muted-foreground/40 hover:text-foreground hover:bg-foreground/4 transition-colors"
                                    title="Refresh"
                                >
                                    <RefreshCw className="w-3.5 h-3.5" />
                                </button>
                            </div>

                            {/* Launch panel */}
                            {showLauncher && (
                                <div className="rounded-lg border border-border bg-card p-4 space-y-3">
                                    <div className="flex items-center justify-between">
                                        <span className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">Launch Agent</span>
                                        <button onClick={() => setShowLauncher(false)} className="p-1 rounded hover:bg-foreground/6 text-muted-foreground">
                                            <X className="w-3.5 h-3.5" />
                                        </button>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {AGENT_TYPES.map(agent => {
                                            const Icon = agent.icon;
                                            return (
                                                <button
                                                    key={agent.id}
                                                    onClick={() => setSelectedAgent(agent.id)}
                                                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] font-medium transition-all duration-150 ${
                                                        selectedAgent === agent.id
                                                            ? `${agent.accentMuted} ${agent.accentText}`
                                                            : 'bg-foreground/4 text-muted-foreground hover:text-foreground'
                                                    }`}
                                                >
                                                    <Icon className="w-3.5 h-3.5" />
                                                    {agent.label}
                                                </button>
                                            );
                                        })}
                                    </div>
                                    <div className="flex items-center gap-4 flex-wrap">
                                        <div className="flex items-center gap-2">
                                            <span className="text-[11px] text-muted-foreground">Mode:</span>
                                            <div className="flex gap-1">
                                                {([['embedded', 'Embedded'], ['external', 'External Window']] as const).map(([mode, label]) => (
                                                    <button
                                                        key={mode}
                                                        onClick={() => setLaunchMode(mode)}
                                                        className={`px-2.5 py-1.5 rounded-md text-[11px] font-medium transition-all ${
                                                            launchMode === mode
                                                                ? 'bg-foreground text-background'
                                                                : 'bg-foreground/4 text-muted-foreground hover:bg-foreground/8 hover:text-foreground'
                                                        }`}
                                                    >
                                                        {label}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-[11px] text-muted-foreground">Count:</span>
                                            <div className="flex gap-1">
                                                {[1, 2, 3, 4, 5, 6].map(n => (
                                                    <button
                                                        key={n}
                                                        onClick={() => setAgentCount(n)}
                                                        className={`w-7 h-7 rounded-md text-[11px] font-medium tabular-nums transition-all ${
                                                            agentCount === n
                                                                ? 'bg-foreground text-background'
                                                                : 'bg-foreground/4 text-muted-foreground hover:bg-foreground/8 hover:text-foreground'
                                                        }`}
                                                    >
                                                        {n}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                        <label className="flex items-center gap-2 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={injectContext}
                                                onChange={e => setInjectContext(e.target.checked)}
                                                className="rounded border-border accent-foreground w-3.5 h-3.5"
                                            />
                                            <span className="text-[11px] text-muted-foreground">Inject context</span>
                                        </label>
                                    </div>
                                    {selectedAgent === 'claude' && launchMode === 'embedded' && (
                                        <div className="flex items-center gap-4 flex-wrap">
                                            <div className="flex items-center gap-2">
                                                <span className="text-[11px] text-muted-foreground">Model:</span>
                                                <select
                                                    value={selectedModel}
                                                    onChange={e => setSelectedModel(e.target.value)}
                                                    className="px-2 py-1.5 rounded-md text-[11px] bg-foreground/4 text-foreground border border-border focus:outline-none focus:ring-1 focus:ring-foreground/20"
                                                >
                                                    <option value="">Default</option>
                                                    <option value="claude-sonnet-5">Sonnet 5</option>
                                                    <option value="claude-opus-4-8">Opus 4.8</option>
                                                    <option value="claude-haiku-4-5-20251001">Haiku 4.5</option>
                                                </select>
                                            </div>
                                            <label className="flex items-center gap-2 cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    checked={taskMode}
                                                    onChange={e => setTaskMode(e.target.checked)}
                                                    className="rounded border-border accent-foreground w-3.5 h-3.5"
                                                />
                                                <span className="text-[11px] text-muted-foreground">
                                                    Task mode
                                                </span>
                                                <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 font-medium">
                                                    autonomous
                                                </span>
                                            </label>
                                        </div>
                                    )}
                                    <textarea
                                        value={launchInstructions}
                                        onChange={e => setLaunchInstructions(e.target.value)}
                                        placeholder={taskMode ? "Task instructions (required)... e.g. 'Fix the login bug in src/auth.ts'" : "Instructions for the agent (optional)... e.g. 'Fix the login bug in src/auth.ts'"}
                                        rows={2}
                                        className="w-full px-3 py-2 rounded-md text-[12px] bg-foreground/4 text-foreground border border-border placeholder:text-muted-foreground/30 focus:outline-none focus:ring-1 focus:ring-foreground/20 resize-none"
                                    />
                                    <button
                                        onClick={handleLaunch}
                                        disabled={isLaunching}
                                        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium bg-foreground text-background hover:bg-foreground/90 transition-colors duration-150 disabled:opacity-50"
                                    >
                                        {isLaunching ? (
                                            <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Launching...</>
                                        ) : (
                                            <><Play className="w-3.5 h-3.5" /> Launch {agentCount} {getAgentConfig(selectedAgent).label}{agentCount > 1 ? 's' : ''}</>
                                        )}
                                    </button>
                                </div>
                            )}

                            {/* Running sessions */}
                            {runningSessions.length > 0 && (
                                <div>
                                    <div className="flex items-center gap-2 mb-3">
                                        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Active Sessions</span>
                                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-medium tabular-nums">{runningSessions.length}</span>
                                    </div>
                                    <div className="space-y-2">
                                        {runningSessions.map(session => (
                                            <SessionRow
                                                key={session.id}
                                                session={session}
                                                onStop={handleStop}
                                                onRemove={handleRemove}
                                                onFocus={() => handleSessionFocus(session)}
                                                isEmbedded={embeddedSessionIds.has(session.id)}
                                                isTask={taskSessionIds.has(session.id)}
                                                metrics={sessionMetrics.get(session.id)}
                                            />
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Stopped sessions */}
                            {stoppedSessions.length > 0 && (
                                <div>
                                    <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-3 block">Recent Sessions</span>
                                    <div className="space-y-1">
                                        {stoppedSessions.slice(0, 5).map(session => (
                                            <SessionRow
                                                key={session.id}
                                                session={session}
                                                onStop={handleStop}
                                                onRemove={handleRemove}
                                                onFocus={() => handleSessionFocus(session)}
                                                isEmbedded={embeddedSessionIds.has(session.id)}
                                                isTask={taskSessionIds.has(session.id)}
                                                metrics={sessionMetrics.get(session.id)}
                                            />
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Empty state */}
                            {sessions.length === 0 && !showLauncher && (
                                <div className="flex flex-col items-center justify-center py-16 text-center">
                                    <div className="w-14 h-14 rounded-2xl bg-foreground/[0.04] flex items-center justify-center mb-5">
                                        <Bot className="w-6 h-6 text-muted-foreground/40" />
                                    </div>
                                    <h3 className="text-sm font-semibold text-foreground mb-1.5">Launch AI Agents</h3>
                                    <p className="text-[12px] text-muted-foreground max-w-xs mb-6 leading-relaxed">
                                        Spawn Claude Code, Codex, or custom terminal sessions — embedded right here or in external windows.
                                    </p>
                                </div>
                            )}
                            </>)}
                        </div>
                        </div>

                        {/* Composer pinned at the bottom — the conversation continues here */}
                        <div className="shrink-0 border-t border-border bg-background">
                            <div className={planActive ? "p-3" : "max-w-3xl mx-auto px-6 py-3"}>
                                <SmartCommandStrip
                                    projectId={projectId}
                                    projectPath={projectPath}
                                    onSpawnTask={handleSmartTask}
                                    onDirectResult={handleDirectResult}
                                />
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Right side: the active plan/review, or the ports + changes sidebar */}
            {planActive ? (
                <div className="flex-1 min-w-0 border-l border-border">
                    <PlanReviewPanel
                        key={planReopenId ?? planTask ?? 'plan'}
                        projectId={projectId}
                        projectPath={projectPath}
                        task={planTask ?? undefined}
                        reopenId={planReopenId ?? undefined}
                        useGsd={planUseGsd}
                        model={selectedModel || null}
                        onClose={() => { setPlanTask(null); setPlanReopenId(null); setOpenMsgId(null); loadPlans(); }}
                        onConfirmed={loadPlans}
                        onSession={handlePlanSession}
                    />
                </div>
            ) : (
            <div className="w-64 shrink-0 border-l border-border flex flex-col bg-muted/10 overflow-y-auto hide-scrollbar">
                {/* Ports section */}
                <div>
                    <button
                        onClick={() => setPortsExpanded(!portsExpanded)}
                        className="w-full px-3 py-2.5 border-b border-border flex items-center justify-between hover:bg-foreground/[0.02] transition-colors"
                    >
                        <div className="flex items-center gap-2">
                            <Globe className="w-3.5 h-3.5 text-muted-foreground" />
                            <span className="text-[12px] font-semibold text-muted-foreground">Ports</span>
                        </div>
                        <div className="flex items-center gap-2">
                            {ports.length > 0 && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-foreground/6 text-muted-foreground tabular-nums">{ports.length}</span>
                            )}
                            {portsExpanded ? <ChevronDown className="w-3 h-3 text-muted-foreground/40" /> : <ChevronRight className="w-3 h-3 text-muted-foreground/40" />}
                        </div>
                    </button>
                    {portsExpanded && (
                        <div className="py-1">
                            {projectPorts.length > 0 && (
                                <div className="px-3 py-1.5">
                                    <span className="text-[9px] font-semibold text-muted-foreground/40 uppercase tracking-wider">Project</span>
                                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                                        {projectPorts.map(p => (
                                            <span key={p.port} className="inline-flex items-center gap-1 px-2 py-1 rounded bg-emerald-500/10 text-emerald-400 text-[11px] font-mono font-medium" title={`${p.process} (PID ${p.pid})`}>
                                                {p.port}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {otherPorts.length > 0 && (
                                <div className="px-3 py-1.5">
                                    <span className="text-[9px] font-semibold text-muted-foreground/40 uppercase tracking-wider">System</span>
                                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                                        {otherPorts.slice(0, 20).map(p => (
                                            <span key={p.port} className="inline-flex items-center px-2 py-1 rounded bg-foreground/[0.04] text-muted-foreground/60 text-[11px] font-mono" title={`${p.process} (PID ${p.pid})`}>
                                                {p.port}
                                            </span>
                                        ))}
                                        {otherPorts.length > 20 && (
                                            <span className="text-[10px] text-muted-foreground/30 self-center">+{otherPorts.length - 20}</span>
                                        )}
                                    </div>
                                </div>
                            )}
                            {suggestedPorts.length > 0 && (
                                <div className="px-3 py-1.5">
                                    <span className="text-[9px] font-semibold text-muted-foreground/40 uppercase tracking-wider">Available</span>
                                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                                        {suggestedPorts.map(p => (
                                            <span key={p} className="inline-flex items-center px-2 py-1 rounded border border-dashed border-border text-muted-foreground/40 text-[11px] font-mono">
                                                {p}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {ports.length === 0 && suggestedPorts.length === 0 && (
                                <div className="px-3 py-4 text-center">
                                    <p className="text-[10px] text-muted-foreground/30">No listening ports</p>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Changes section */}
                <div>
                    <div className="px-3 py-2.5 border-b border-t border-border flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <GitBranch className="w-3.5 h-3.5 text-muted-foreground" />
                            <span className="text-[12px] font-semibold text-muted-foreground">Changes</span>
                        </div>
                        {(totalAdditions > 0 || totalDeletions > 0) && (
                            <div className="flex items-center gap-1.5 font-mono text-[10px] tabular-nums">
                                {totalAdditions > 0 && <span className="text-emerald-500">+{totalAdditions}</span>}
                                {totalDeletions > 0 && <span className="text-red-400">-{totalDeletions}</span>}
                            </div>
                        )}
                    </div>
                    <div className="py-1">
                        {diff && diff.file_stats.length > 0 ? (
                            diff.file_stats.map((file) => {
                                const parts = file.file.split('/');
                                const fileName = parts.pop() ?? file.file;
                                const dirPath = parts.join('/');
                                return (
                                    <div
                                        key={file.file}
                                        className="flex items-center gap-2 px-3 py-1.5 hover:bg-foreground/[0.02] transition-colors"
                                    >
                                        <FileCode className="w-3.5 h-3.5 text-muted-foreground/30 shrink-0" />
                                        <div className="flex-1 min-w-0">
                                            <span className="text-[12px] text-foreground/80 truncate block">{fileName}</span>
                                            {dirPath && (
                                                <span className="text-[10px] text-muted-foreground/30 truncate block font-mono">{dirPath}/</span>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-1 shrink-0 font-mono text-[10px] tabular-nums">
                                            {file.additions > 0 && <span className="text-emerald-500">+{file.additions}</span>}
                                            {file.deletions > 0 && <span className="text-red-400">-{file.deletions}</span>}
                                        </div>
                                    </div>
                                );
                            })
                        ) : (
                            <div className="flex flex-col items-center justify-center py-8 text-center px-4">
                                <GitBranch className="w-4 h-4 text-muted-foreground/15 mb-2" />
                                <p className="text-[10px] text-muted-foreground/30">No uncommitted changes</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
            )}
        </div>
    );
};

interface SessionRowProps {
    session: AgentSession;
    onStop: (id: string) => void;
    onRemove: (id: string) => void;
    onFocus: () => void;
    isEmbedded?: boolean;
    isTask?: boolean;
    metrics?: SessionMetrics;
}

function formatTokens(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return String(n);
}

function formatDuration(ms: number): string {
    const s = ms / 1000;
    if (s < 60) return `${s.toFixed(1)}s`;
    const m = Math.floor(s / 60);
    return `${m}m ${Math.round(s % 60)}s`;
}

const SessionRow: React.FC<SessionRowProps> = ({ session, onStop, onRemove, onFocus, isEmbedded, isTask, metrics }) => {
    const config = getAgentConfig(session.agent_type);
    const isRunning = session.status === 'running';
    const Icon = config.icon;

    return (
        <div className="group flex items-center gap-3 px-3 py-2.5 rounded-lg border border-border hover:bg-foreground/[0.02] transition-all duration-100">
            <div className={`w-8 h-8 rounded-lg ${config.accentMuted} flex items-center justify-center shrink-0 relative`}>
                <Icon className={`w-4 h-4 ${config.accentText}`} />
                {isRunning && (
                    <span className={`absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ${config.accent} border-2 border-background`} />
                )}
            </div>

            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium text-foreground truncate">{session.display_name}</span>
                    <span className="text-[10px] text-muted-foreground/50">{config.label}</span>
                    {isEmbedded && !isTask && (
                        <span className="text-[9px] px-1 py-0.5 rounded bg-sky-500/10 text-sky-400 font-medium">embedded</span>
                    )}
                    {isTask && (
                        <span className="text-[9px] px-1 py-0.5 rounded bg-blue-500/10 text-blue-400 font-medium flex items-center gap-0.5">
                            <ListChecks className="w-2.5 h-2.5" />
                            task
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-3 mt-0.5 text-[11px] text-muted-foreground/50">
                    <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatElapsed(session.created_at)}
                    </span>
                    {isRunning && (
                        <span className="flex items-center gap-1 text-emerald-400/60">
                            <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" />
                            running
                        </span>
                    )}
                    {metrics && (
                        <span className="flex items-center gap-2 font-mono text-[10px] tabular-nums">
                            <span>{formatTokens(metrics.input_tokens)}in + {formatTokens(metrics.output_tokens)}out</span>
                            <span>${metrics.cost_usd.toFixed(4)}</span>
                            <span>{formatDuration(metrics.duration_ms)}</span>
                        </span>
                    )}
                </div>
            </div>

            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                {isRunning && (
                    <>
                        <button
                            onClick={onFocus}
                            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-foreground/6 transition-colors"
                            title={isEmbedded ? 'Open terminal' : 'Show terminal'}
                        >
                            <Eye className="w-3.5 h-3.5" />
                        </button>
                        <button
                            onClick={() => onStop(session.id)}
                            className="p-1.5 rounded-md text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
                            title="Stop"
                        >
                            <Square className="w-3.5 h-3.5" />
                        </button>
                    </>
                )}
                <button
                    onClick={() => onRemove(session.id)}
                    className="p-1.5 rounded-md text-muted-foreground/40 hover:text-muted-foreground hover:bg-foreground/6 transition-colors"
                    title="Remove"
                >
                    <X className="w-3 h-3" />
                </button>
            </div>
        </div>
    );
};
