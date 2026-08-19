import React, { useState, useRef, useCallback, useMemo } from 'react';
import { invokeCommand } from '../../lib/tauri';
import { logger } from '../../lib/logger';
import { toast } from 'sonner';
import { useAppStore } from '../../stores/useAppStore';
import type { ProjectSettings, AutonomousPermissionMode } from '../../types';
import {
    Sparkles, Send, Loader2, GitBranch, FileCode, Radio,
    Info, Bot, Rocket, Bug, BookOpen, Activity, Zap, FileText,
    ChevronDown, ChevronUp, X, Shield, ShieldAlert,
} from 'lucide-react';

interface RouteMatch {
    route_id: string;
    route_name: string;
    confidence: number;
    handler: string;
}

export interface DirectResponse {
    kind: 'direct';
    route_id: string;
    route_name: string;
    confidence: number;
    data: Record<string, unknown>;
}

interface OrchestrateResponse {
    kind: 'orchestrate';
    route_id: string;
    route_name: string;
    confidence: number;
    suggested_prompt: string;
    template_id: string | null;
}

interface FallbackResponse {
    kind: 'fallback';
    query: string;
    top_match: RouteMatch | null;
}

type RouteResponse = DirectResponse | OrchestrateResponse | FallbackResponse;

interface SmartCommandStripProps {
    projectId: string;
    projectPath: string;
    onSpawnTask: (prompt: string, useGsd: boolean) => void;
    /** Called with a direct (zero-token) answer + the question — for the thread. */
    onDirectResult?: (query: string, response: DirectResponse) => void;
    /** Intercept app-command intents (launch sessions, open editor…) before
     *  routing. Return true if the command was handled. */
    onLocalCommand?: (query: string) => boolean;
    /** Answer a question conversationally (no plan) — for non-build queries. */
    onAsk?: (query: string) => void;
}

const ROUTE_ICONS: Record<string, React.ElementType> = {
    git_status: GitBranch,
    git_changes: FileCode,
    listening_ports: Radio,
    project_context: Info,
    active_sessions: Bot,
    boot_environment: Rocket,
    debug_error: Bug,
    explain_codebase: BookOpen,
    status_check: Activity,
    generate_playbook: Zap,
    document_convention: FileText,
};

export const SmartCommandStrip: React.FC<SmartCommandStripProps> = ({
    projectId,
    projectPath,
    onSpawnTask,
    onDirectResult,
    onLocalCommand,
    onAsk,
}) => {
    const [query, setQuery] = useState('');
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<DirectResponse | null>(null);
    const [expanded, setExpanded] = useState(true);
    const [useGsd, setUseGsd] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    const project = useAppStore(s => s.projects.find(p => p.id === projectId));
    const updateProjectSettings = useAppStore(s => s.updateProjectSettings);

    const permissionMode: AutonomousPermissionMode = useMemo(() => {
        if (!project?.settings) return 'acceptEdits';
        try {
            const parsed: ProjectSettings = JSON.parse(project.settings);
            return parsed.autonomous_permission_mode ?? 'acceptEdits';
        } catch {
            return 'acceptEdits';
        }
    }, [project?.settings]);

    const togglePermissionMode = useCallback(async () => {
        const next: AutonomousPermissionMode = permissionMode === 'skip' ? 'acceptEdits' : 'skip';
        let existing: Partial<ProjectSettings> = {};
        if (project?.settings) {
            try { existing = JSON.parse(project.settings); } catch { /* ignore */ }
        }
        const merged = { ...existing, autonomous_permission_mode: next };
        try {
            await updateProjectSettings(projectId, JSON.stringify(merged));
            toast.success(next === 'skip'
                ? 'Full autonomy enabled — agents can run any command in this project'
                : 'Safe mode — agents can edit files but not run arbitrary commands');
        } catch (err) {
            toast.error(`Failed to update setting: ${err}`);
        }
    }, [permissionMode, project?.settings, projectId, updateProjectSettings]);

    const handleSubmit = useCallback(async () => {
        const trimmed = query.trim();
        if (!trimmed || loading) return;

        setQuery('');
        // App-command intents (launch sessions, open editor…) execute directly
        // rather than routing to a read or a plan.
        if (onLocalCommand?.(trimmed)) return;

        setLoading(true);
        setResult(null);

        try {
            const response = await invokeCommand<RouteResponse>('route_request', {
                projectId,
                projectPath,
                query: trimmed,
            });

            switch (response.kind) {
                case 'direct':
                    // Prefer the thread; fall back to the inline card when used standalone.
                    if (onDirectResult) onDirectResult(trimmed, response);
                    else setResult(response);
                    break;

                // Conversation-first: everything goes to the chat agent, which
                // decides for itself whether to answer or to invoke its
                // `create_plan` tool. No client-side guessing, no Plan button.
                case 'orchestrate':
                case 'fallback':
                    if (onAsk) onAsk(trimmed);
                    else onSpawnTask(trimmed, useGsd);
                    break;
            }
        } catch (err) {
            logger.error('[SmartCmd] route_request failed:', err);
            toast.error(`Command failed: ${err}`);
        } finally {
            setLoading(false);
        }
    }, [query, loading, projectId, projectPath, onSpawnTask, useGsd]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
        }
        if (e.key === 'Escape') {
            setResult(null);
            setQuery('');
            inputRef.current?.blur();
        }
    };

    return (
        <div className="space-y-2">
            {/* Input bar */}
            <div className="relative flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 focus-within:border-foreground/20 transition-colors">
                <Sparkles className="w-4 h-4 text-amber-400/70 shrink-0" />
                <input
                    ref={inputRef}
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Ask anything — git status, debug, boot dev, or a full task..."
                    className="flex-1 bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground/40 outline-none"
                    disabled={loading}
                />
                <button
                    onClick={() => setUseGsd(v => !v)}
                    title={useGsd
                        ? 'GSD: thorough, codebase-grounded planning (get-shit-done methodology). Click for lean planning.'
                        : 'Lean planning (fast). Click to enable GSD — thorough, codebase-grounded planning.'}
                    className={`flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium shrink-0 transition-colors ${
                        useGsd ? 'text-violet-400 hover:bg-violet-500/10' : 'text-muted-foreground/50 hover:bg-foreground/6'
                    }`}
                >
                    <Zap className="w-3 h-3" /> {useGsd ? 'GSD' : 'Lean'}
                </button>
                <button
                    onClick={togglePermissionMode}
                    title={permissionMode === 'skip'
                        ? 'Full autonomy: agents can run any command in this project. Click to switch to Safe mode.'
                        : 'Safe mode: agents can edit files but not run arbitrary commands. Click to enable full autonomy.'}
                    className={`flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium shrink-0 transition-colors ${
                        permissionMode === 'skip'
                            ? 'text-amber-500 hover:bg-amber-500/10'
                            : 'text-muted-foreground/50 hover:bg-foreground/6'
                    }`}
                >
                    {permissionMode === 'skip'
                        ? <><ShieldAlert className="w-3 h-3" /> Full</>
                        : <><Shield className="w-3 h-3" /> Safe</>}
                </button>
                {loading ? (
                    <Loader2 className="w-4 h-4 text-muted-foreground animate-spin shrink-0" />
                ) : query.trim() ? (
                    <button
                        onClick={handleSubmit}
                        title="Send (chat)"
                        className="p-1 rounded-md text-foreground/60 hover:text-foreground hover:bg-foreground/6 transition-colors"
                    >
                        <Send className="w-3.5 h-3.5" />
                    </button>
                ) : null}
            </div>

            {/* Result card */}
            {result && (
                <ResultCard
                    response={result}
                    expanded={expanded}
                    onToggle={() => setExpanded(!expanded)}
                    onDismiss={() => setResult(null)}
                />
            )}
        </div>
    );
};

interface ResultCardProps {
    response: DirectResponse;
    expanded: boolean;
    onToggle: () => void;
    onDismiss: () => void;
}

const ResultCard: React.FC<ResultCardProps> = ({ response, expanded, onToggle, onDismiss }) => {
    const Icon = ROUTE_ICONS[response.route_id] ?? Info;

    return (
        <div className="rounded-xl border border-border bg-card overflow-hidden animate-in slide-in-from-top-2 duration-200">
            {/* Header */}
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/50">
                <Icon className="w-3.5 h-3.5 text-amber-400/70" />
                <span className="text-[12px] font-semibold text-foreground">{response.route_name}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 font-medium">
                    {Math.round(response.confidence * 100)}% match
                </span>
                <div className="flex-1" />
                <button onClick={onToggle} className="p-1 rounded hover:bg-foreground/6 text-muted-foreground/40">
                    {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>
                <button onClick={onDismiss} className="p-1 rounded hover:bg-foreground/6 text-muted-foreground/40">
                    <X className="w-3 h-3" />
                </button>
            </div>

            {/* Body */}
            {expanded && (
                <div className="px-4 py-3">
                    <RouteResultBody routeId={response.route_id} data={response.data} />
                </div>
            )}
        </div>
    );
};

/** A direct route result rendered as a thread message (no dismiss/toggle chrome). */
export const RouteResultView: React.FC<{ response: DirectResponse }> = ({ response }) => {
    const Icon = ROUTE_ICONS[response.route_id] ?? Info;
    return (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2 border-b border-border/50">
                <Icon className="w-3.5 h-3.5 text-amber-400/70" />
                <span className="text-[12px] font-semibold text-foreground">{response.route_name}</span>
            </div>
            <div className="px-4 py-3">
                <RouteResultBody routeId={response.route_id} data={response.data} />
            </div>
        </div>
    );
};

interface RouteResultBodyProps {
    routeId: string;
    data: Record<string, unknown>;
}

const RouteResultBody: React.FC<RouteResultBodyProps> = ({ routeId, data }) => {
    switch (routeId) {
        case 'git_status':
            return <GitStatusResult data={data} />;
        case 'git_changes':
            return <GitChangesResult data={data} />;
        case 'listening_ports':
            return <PortsResult data={data} />;
        case 'active_sessions':
            return <SessionsResult data={data} />;
        case 'project_context':
            return <ContextResult data={data} />;
        default:
            return <GenericResult data={data} />;
    }
};

const GitStatusResult: React.FC<{ data: Record<string, unknown> }> = ({ data }) => {
    const branch = data.branch as string;
    const files = (data.files as string[]) ?? [];

    return (
        <div className="space-y-2">
            <div className="flex items-center gap-2">
                <GitBranch className="w-3.5 h-3.5 text-purple-400" />
                <span className="text-[13px] font-mono font-medium text-foreground">{branch}</span>
            </div>
            {files.length > 0 ? (
                <div className="space-y-0.5">
                    <span className="text-[11px] text-muted-foreground font-medium">{files.length} modified file{files.length !== 1 ? 's' : ''}</span>
                    <div className="max-h-40 overflow-y-auto space-y-0.5">
                        {files.map((f, i) => {
                            const status = f.substring(0, 2).trim();
                            const path = f.substring(3);
                            const color = status === 'M' ? 'text-amber-400' : status === 'A' ? 'text-emerald-400' : status === 'D' ? 'text-red-400' : 'text-muted-foreground';
                            return (
                                <div key={i} className="flex items-center gap-2 text-[11px] font-mono">
                                    <span className={`w-4 text-center ${color}`}>{status}</span>
                                    <span className="text-foreground/80">{path}</span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            ) : (
                <span className="text-[11px] text-emerald-400">Working tree clean</span>
            )}
        </div>
    );
};

const GitChangesResult: React.FC<{ data: Record<string, unknown> }> = ({ data }) => {
    const files = (data.files as Array<{ file: string; additions: number; deletions: number }>) ?? [];
    const totalFiles = (data.total_files as number) ?? 0;

    return (
        <div className="space-y-2">
            <span className="text-[11px] text-muted-foreground font-medium">{totalFiles} file{totalFiles !== 1 ? 's' : ''} changed</span>
            {files.length > 0 && (
                <div className="max-h-48 overflow-y-auto space-y-0.5">
                    {files.map((f, i) => (
                        <div key={i} className="flex items-center gap-2 text-[11px] font-mono">
                            <span className="text-emerald-400 w-8 text-right">+{f.additions}</span>
                            <span className="text-red-400 w-8 text-right">-{f.deletions}</span>
                            <span className="text-foreground/80 truncate">{f.file}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

const PortsResult: React.FC<{ data: Record<string, unknown> }> = ({ data }) => {
    const ports = (data.ports as Array<{ port: number; process: string; pid: number }>) ?? [];

    if (ports.length === 0) {
        return <span className="text-[11px] text-muted-foreground">No listening ports found</span>;
    }

    return (
        <div className="space-y-0.5">
            {ports.map((p, i) => (
                <div key={i} className="flex items-center gap-3 text-[11px] font-mono">
                    <span className="text-amber-400 w-12 text-right">:{p.port}</span>
                    <span className="text-foreground/80">{p.process}</span>
                    <span className="text-muted-foreground/40">pid {p.pid}</span>
                </div>
            ))}
        </div>
    );
};

const SessionsResult: React.FC<{ data: Record<string, unknown> }> = ({ data }) => {
    const sessions = (data.sessions as Array<{ id: string; display_name: string; status: string; agent_type: string }>) ?? [];
    const count = (data.count as number) ?? 0;

    if (count === 0) {
        return <span className="text-[11px] text-muted-foreground">No active sessions</span>;
    }

    return (
        <div className="space-y-1">
            {sessions.map((s) => (
                <div key={s.id} className="flex items-center gap-2 text-[11px]">
                    <span className={`w-1.5 h-1.5 rounded-full ${s.status === 'running' ? 'bg-emerald-400' : 'bg-muted-foreground/30'}`} />
                    <span className="text-foreground/80 font-medium">{s.display_name}</span>
                    <span className="text-muted-foreground/40">{s.status}</span>
                </div>
            ))}
        </div>
    );
};

const ContextResult: React.FC<{ data: Record<string, unknown> }> = ({ data }) => {
    const context = (data.context as string) ?? '';
    const length = (data.length as number) ?? 0;
    const [showFull, setShowFull] = useState(false);

    const preview = showFull ? context : context.substring(0, 500);

    return (
        <div className="space-y-2">
            <span className="text-[11px] text-muted-foreground">{length} chars</span>
            <pre className="text-[11px] text-foreground/80 font-mono whitespace-pre-wrap max-h-64 overflow-y-auto bg-muted/30 rounded-lg p-3">
                {preview}
                {!showFull && context.length > 500 && '...'}
            </pre>
            {context.length > 500 && (
                <button
                    onClick={() => setShowFull(!showFull)}
                    className="text-[11px] text-foreground/50 hover:text-foreground underline underline-offset-2"
                >
                    {showFull ? 'Show less' : 'Show full context'}
                </button>
            )}
        </div>
    );
};

const GenericResult: React.FC<{ data: Record<string, unknown> }> = ({ data }) => (
    <pre className="text-[11px] text-foreground/80 font-mono whitespace-pre-wrap max-h-64 overflow-y-auto">
        {JSON.stringify(data, null, 2)}
    </pre>
);
