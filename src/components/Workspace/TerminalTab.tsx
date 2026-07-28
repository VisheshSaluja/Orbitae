import React, { useState, useEffect, useCallback } from 'react';
import { invokeCommand } from '../../lib/tauri';
import { toast } from 'sonner';
import {
    Play, Square, Bot, Zap, Monitor, ExternalLink,
    Plus, RefreshCw, Clock, FileCode, GitBranch,
    X, Eye,
} from 'lucide-react';

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
    const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
    const [showLauncher, setShowLauncher] = useState(false);
    const [isLaunching, setIsLaunching] = useState(false);
    const [diff, setDiff] = useState<SessionDiff | null>(null);

    const [selectedAgent, setSelectedAgent] = useState('claude');
    const [agentCount, setAgentCount] = useState(1);
    const [injectContext, setInjectContext] = useState(true);

    const loadSessions = useCallback(async () => {
        try {
            const data = await invokeCommand<AgentSession[]>('list_agent_sessions', {});
            const projectSessions = data.filter(s => s.project_id === projectId);
            setSessions(projectSessions);
            if (!selectedSessionId && projectSessions.length > 0) {
                setSelectedSessionId(projectSessions[0].id);
            }
        } catch {
            // non-critical
        }
    }, [projectId, selectedSessionId]);

    const loadDiff = useCallback(async () => {
        try {
            const d = await invokeCommand<SessionDiff>('get_session_diff', { projectPath });
            setDiff(d);
        } catch {
            setDiff(null);
        }
    }, [projectPath]);

    useEffect(() => {
        loadSessions();
        loadDiff();
        const interval = setInterval(() => { loadSessions(); loadDiff(); }, 5000);
        return () => clearInterval(interval);
    }, [loadSessions, loadDiff]);

    const handleLaunch = async () => {
        setIsLaunching(true);
        try {
            const newSessions = await invokeCommand<AgentSession[]>('launch_agent_sessions', {
                agentType: selectedAgent,
                count: agentCount,
                projectId,
                projectPath,
                instructions: null,
                injectContext,
            });
            setSessions(prev => [...prev, ...newSessions]);
            if (newSessions.length > 0) setSelectedSessionId(newSessions[0].id);
            setShowLauncher(false);
            toast.success(`Launched ${newSessions.length} session(s)`);
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

    const handleCloseTab = async (sessionId: string) => {
        try {
            const session = sessions.find(s => s.id === sessionId);
            if (session?.status === 'running') {
                await invokeCommand('stop_agent_session', { sessionId });
            }
        } catch {
            // still remove from list even if stop fails
        }
        setSessions(prev => {
            const remaining = prev.filter(s => s.id !== sessionId);
            if (selectedSessionId === sessionId) {
                setSelectedSessionId(remaining.length > 0 ? remaining[0].id : null);
            }
            return remaining;
        });
    };

    const handleFocus = async () => {
        try {
            await invokeCommand('focus_agent_terminals');
        } catch {
            toast.error('Failed to focus terminal');
        }
    };

    const handleOpenEditor = async () => {
        try {
            await invokeCommand('open_in_editor', { path: projectPath });
        } catch {
            toast.error('Failed to open editor');
        }
    };

    const selectedSession = sessions.find(s => s.id === selectedSessionId);
    const totalAdditions = diff?.file_stats.reduce((sum, f) => sum + f.additions, 0) ?? 0;
    const totalDeletions = diff?.file_stats.reduce((sum, f) => sum + f.deletions, 0) ?? 0;

    // Empty state
    if (sessions.length === 0 && !showLauncher) {
        return (
            <div className="h-full flex flex-col items-center justify-center text-center px-6">
                <div className="w-14 h-14 rounded-2xl bg-foreground/6 flex items-center justify-center mb-5">
                    <Bot className="w-6 h-6 text-muted-foreground" />
                </div>
                <h3 className="text-sm font-semibold text-foreground mb-1.5">Launch AI Agents</h3>
                <p className="text-[12px] text-muted-foreground max-w-xs mb-6 leading-relaxed">
                    Spawn Claude Code, Codex, or custom terminal sessions that run in native windows with your project context.
                </p>
                <button
                    onClick={() => setShowLauncher(true)}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium bg-foreground text-background hover:bg-foreground/90 transition-colors duration-150"
                >
                    <Plus className="w-4 h-4" />
                    New Session
                </button>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col">
            {/* Session strip — horizontal tabs */}
            <div className="shrink-0 flex items-center gap-1 px-3 py-2 border-b border-border overflow-x-auto hide-scrollbar">
                {sessions.map(session => {
                    const config = getAgentConfig(session.agent_type);
                    const isSelected = session.id === selectedSessionId;
                    const isRunning = session.status === 'running';
                    return (
                        <button
                            key={session.id}
                            onClick={() => setSelectedSessionId(session.id)}
                            className={`group shrink-0 flex items-center gap-2 pl-2.5 pr-1.5 py-1.5 rounded-md text-[12px] font-medium transition-all duration-100 ${
                                isSelected
                                    ? 'bg-foreground/8 text-foreground'
                                    : 'text-muted-foreground hover:text-foreground hover:bg-foreground/4'
                            }`}
                        >
                            {/* Agent-colored dot */}
                            <span className="relative flex items-center justify-center w-4 h-4 shrink-0">
                                {isRunning && (
                                    <span className={`absolute w-3 h-3 rounded-full ${config.accent} opacity-20 animate-ping`} />
                                )}
                                <span className={`relative w-1.5 h-1.5 rounded-full ${isRunning ? config.accent : 'bg-muted-foreground/30'}`} />
                            </span>
                            <span>{session.display_name}</span>
                            <button
                                onClick={(e) => { e.stopPropagation(); handleCloseTab(session.id); }}
                                className="ml-0.5 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-foreground/10 text-muted-foreground hover:text-foreground transition-all"
                                title="Close"
                            >
                                <X className="w-3 h-3" />
                            </button>
                        </button>
                    );
                })}

                <button
                    onClick={() => setShowLauncher(!showLauncher)}
                    className="shrink-0 flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground/50 hover:text-foreground hover:bg-foreground/4 transition-colors"
                    title="New session"
                >
                    <Plus className="w-3.5 h-3.5" />
                </button>

                <div className="flex-1" />

                <button
                    onClick={loadSessions}
                    className="shrink-0 p-1.5 rounded-md text-muted-foreground/50 hover:text-foreground hover:bg-foreground/4 transition-colors"
                    title="Refresh"
                >
                    <RefreshCw className="w-3 h-3" />
                </button>
            </div>

            {/* Launch panel */}
            {showLauncher && (
                <div className="shrink-0 border-b border-border bg-card p-4 space-y-3">
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
                    <div className="flex items-center gap-4">
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
                    <button
                        onClick={handleLaunch}
                        disabled={isLaunching}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium bg-foreground text-background hover:bg-foreground/90 transition-colors duration-150 disabled:opacity-50"
                    >
                        {isLaunching ? 'Launching...' : (
                            <><Play className="w-3.5 h-3.5" /> Launch {agentCount} {getAgentConfig(selectedAgent).label} Session{agentCount > 1 ? 's' : ''}</>
                        )}
                    </button>
                </div>
            )}

            {/* Main content area */}
            <div className="flex-1 flex min-h-0">
                {/* Session detail */}
                <div className="flex-1 min-w-0 overflow-y-auto p-6">
                    {selectedSession ? (
                        <div className="max-w-2xl mx-auto space-y-5">
                            {/* Session header card */}
                            <div className="rounded-lg border border-border bg-card p-5">
                                <div className="flex items-center justify-between mb-4">
                                    <div className="flex items-center gap-3">
                                        <div className={`w-10 h-10 rounded-lg ${getAgentConfig(selectedSession.agent_type).accentMuted} flex items-center justify-center`}>
                                            {React.createElement(getAgentConfig(selectedSession.agent_type).icon, {
                                                className: `w-5 h-5 ${getAgentConfig(selectedSession.agent_type).accentText}`
                                            })}
                                        </div>
                                        <div>
                                            <h3 className="text-sm font-semibold text-foreground">{selectedSession.display_name}</h3>
                                            <span className="text-[11px] text-muted-foreground">{getAgentConfig(selectedSession.agent_type).label}</span>
                                        </div>
                                    </div>
                                    {selectedSession.status === 'running' ? (
                                        <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 text-[10px] font-medium">
                                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                            Running
                                        </span>
                                    ) : (
                                        <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-foreground/4 text-muted-foreground text-[10px] font-medium">
                                            <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/30" />
                                            Stopped
                                        </span>
                                    )}
                                </div>

                                <div className="flex items-center gap-4 text-[12px] text-muted-foreground">
                                    <div className="flex items-center gap-1.5">
                                        <Clock className="w-3.5 h-3.5" />
                                        <span>{formatElapsed(selectedSession.created_at)}</span>
                                    </div>
                                    {selectedSession.pid && (
                                        <span className="font-mono text-[11px]">Window #{selectedSession.pid}</span>
                                    )}
                                </div>
                            </div>

                            {/* Actions */}
                            <div className="flex items-center gap-2 flex-wrap">
                                {selectedSession.status === 'running' && (
                                    <>
                                        <button
                                            onClick={handleFocus}
                                            className="flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-medium bg-foreground text-background hover:bg-foreground/90 transition-all duration-150"
                                        >
                                            <Eye className="w-3.5 h-3.5" />
                                            Open Terminal
                                        </button>
                                        <button
                                            onClick={() => handleStop(selectedSession.id)}
                                            className="flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-medium text-destructive hover:bg-destructive/10 border border-border hover:border-destructive/20 transition-all duration-150"
                                        >
                                            <Square className="w-3.5 h-3.5" />
                                            Stop
                                        </button>
                                    </>
                                )}
                                <button
                                    onClick={handleOpenEditor}
                                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-medium text-muted-foreground hover:text-foreground hover:bg-foreground/5 border border-border transition-all duration-150"
                                >
                                    <ExternalLink className="w-3.5 h-3.5" />
                                    Open in Editor
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                            Select a session to view details
                        </div>
                    )}
                </div>

                {/* Changes sidebar */}
                <div className="w-64 shrink-0 border-l border-border bg-muted/20 flex flex-col">
                    <div className="px-3 py-2.5 border-b border-border flex items-center justify-between">
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
                    <div className="flex-1 overflow-y-auto hide-scrollbar">
                        {diff && diff.file_stats.length > 0 ? (
                            <div className="py-1">
                                {diff.file_stats.map((file) => {
                                    const parts = file.file.split('/');
                                    const fileName = parts.pop() ?? file.file;
                                    const dirPath = parts.join('/');
                                    return (
                                        <div
                                            key={file.file}
                                            className="flex items-center gap-2 px-3 py-1.5 hover:bg-foreground/3 transition-colors"
                                        >
                                            <FileCode className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0" />
                                            <div className="flex-1 min-w-0">
                                                <span className="text-[12px] text-foreground/80 truncate block">{fileName}</span>
                                                {dirPath && (
                                                    <span className="text-[10px] text-muted-foreground/40 truncate block font-mono">{dirPath}/</span>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-1 shrink-0 font-mono text-[10px] tabular-nums">
                                                {file.additions > 0 && <span className="text-emerald-500">+{file.additions}</span>}
                                                {file.deletions > 0 && <span className="text-red-400">-{file.deletions}</span>}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center h-full text-center px-4">
                                <GitBranch className="w-5 h-5 text-muted-foreground/20 mb-2" />
                                <p className="text-[11px] text-muted-foreground/40">No uncommitted changes</p>
                                <p className="text-[10px] text-muted-foreground/25 mt-1">Changes appear here as agents work</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
