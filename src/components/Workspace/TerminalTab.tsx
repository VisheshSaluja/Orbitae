import React, { useState, useEffect, useCallback } from 'react';
import { invokeCommand } from '../../lib/tauri';
import { toast } from 'sonner';
import {
    Play, Square, Bot, Zap, Monitor, ExternalLink,
    Plus, RefreshCw, Clock, FileCode, GitBranch,
    ChevronRight, X, Eye,
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
    { id: 'claude', label: 'Claude Code', icon: Bot, color: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/30', dot: 'bg-orange-400' },
    { id: 'codex', label: 'Codex CLI', icon: Zap, color: 'text-green-400', bg: 'bg-green-500/10', border: 'border-green-500/30', dot: 'bg-green-400' },
    { id: 'custom', label: 'Terminal', icon: Monitor, color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/30', dot: 'bg-blue-400' },
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

    const runningSessions = sessions.filter(s => s.status === 'running');
    const selectedSession = sessions.find(s => s.id === selectedSessionId);
    const totalAdditions = diff?.file_stats.reduce((sum, f) => sum + f.additions, 0) ?? 0;
    const totalDeletions = diff?.file_stats.reduce((sum, f) => sum + f.deletions, 0) ?? 0;

    // Empty state
    if (sessions.length === 0 && !showLauncher) {
        return (
            <div className="h-full flex flex-col items-center justify-center text-center px-6">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500/20 to-purple-500/20 border border-white/[0.06] flex items-center justify-center mb-5">
                    <Bot className="w-7 h-7 text-blue-400" />
                </div>
                <h3 className="text-[15px] font-semibold text-[#e4e4e7] mb-1.5">Launch AI Agents</h3>
                <p className="text-[12px] text-[#71717a] max-w-xs mb-6 leading-relaxed">
                    Spawn Claude Code, Codex, or custom terminal sessions that run in native windows. Each agent gets your project context automatically.
                </p>
                <button
                    onClick={() => setShowLauncher(true)}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-[13px] font-medium bg-blue-600 hover:bg-blue-500 text-white transition-colors duration-150 shadow-lg shadow-blue-500/20"
                >
                    <Plus className="w-4 h-4" />
                    New Session
                </button>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col">
            {/* Session tab bar — Superset-inspired */}
            <div className="shrink-0 flex items-center gap-1 px-3 py-2 border-b border-white/[0.06] bg-[#0e0e11] overflow-x-auto">
                {sessions.map(session => {
                    const config = getAgentConfig(session.agent_type);
                    const Icon = config.icon;
                    const isSelected = session.id === selectedSessionId;
                    const isRunning = session.status === 'running';
                    return (
                        <button
                            key={session.id}
                            onClick={() => setSelectedSessionId(session.id)}
                            className={`group shrink-0 flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all duration-150 ${
                                isSelected
                                    ? `${config.bg} ${config.color} border ${config.border}`
                                    : 'text-[#71717a] hover:text-[#a1a1aa] hover:bg-white/[0.04] border border-transparent'
                            }`}
                        >
                            <Icon className="w-3.5 h-3.5" />
                            <span>{session.display_name}</span>
                            {isRunning && (
                                <span className={`w-1.5 h-1.5 rounded-full ${config.dot} animate-pulse`} />
                            )}
                            {!isRunning && (
                                <span className="w-1.5 h-1.5 rounded-full bg-[#52525b]" />
                            )}
                            <button
                                onClick={(e) => { e.stopPropagation(); handleStop(session.id); }}
                                className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-white/10 transition-all"
                                title="Stop"
                            >
                                <X className="w-3 h-3" />
                            </button>
                        </button>
                    );
                })}
                <button
                    onClick={() => setShowLauncher(!showLauncher)}
                    className="shrink-0 flex items-center justify-center w-7 h-7 rounded-md text-[#52525b] hover:text-[#a1a1aa] hover:bg-white/[0.04] transition-colors"
                    title="New session"
                >
                    <Plus className="w-3.5 h-3.5" />
                </button>

                <div className="flex-1" />

                <button
                    onClick={loadSessions}
                    className="shrink-0 p-1.5 rounded-md text-[#52525b] hover:text-[#a1a1aa] hover:bg-white/[0.04] transition-colors"
                    title="Refresh"
                >
                    <RefreshCw className="w-3.5 h-3.5" />
                </button>
            </div>

            {/* Launch panel (slides in) */}
            {showLauncher && (
                <div className="shrink-0 border-b border-white/[0.06] bg-[#111114] p-4 space-y-3">
                    <div className="flex items-center justify-between">
                        <span className="text-[12px] font-semibold text-[#a1a1aa] uppercase tracking-wider">Launch Agent</span>
                        <button onClick={() => setShowLauncher(false)} className="p-1 rounded hover:bg-white/[0.06] text-[#52525b]">
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
                                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-[12px] font-medium border transition-all duration-150 ${
                                        selectedAgent === agent.id
                                            ? `${agent.bg} ${agent.color} ${agent.border}`
                                            : 'border-white/[0.06] text-[#71717a] hover:border-white/[0.12] hover:text-[#a1a1aa]'
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
                            <span className="text-[11px] text-[#71717a]">Count:</span>
                            <div className="flex gap-1">
                                {[1, 2, 3, 4, 5, 6].map(n => (
                                    <button
                                        key={n}
                                        onClick={() => setAgentCount(n)}
                                        className={`w-7 h-7 rounded-md text-[11px] font-medium transition-all ${
                                            agentCount === n
                                                ? 'bg-blue-600 text-white'
                                                : 'bg-white/[0.04] text-[#71717a] hover:bg-white/[0.08] hover:text-[#a1a1aa]'
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
                                className="rounded border-[#52525b] accent-blue-500 w-3.5 h-3.5"
                            />
                            <span className="text-[11px] text-[#71717a]">Inject context</span>
                        </label>
                    </div>
                    <button
                        onClick={handleLaunch}
                        disabled={isLaunching}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-[13px] font-medium bg-blue-600 hover:bg-blue-500 text-white transition-colors duration-150 disabled:opacity-50 shadow-lg shadow-blue-500/10"
                    >
                        {isLaunching ? 'Launching...' : (
                            <><Play className="w-3.5 h-3.5" /> Launch {agentCount} {getAgentConfig(selectedAgent).label} Session{agentCount > 1 ? 's' : ''}</>
                        )}
                    </button>
                </div>
            )}

            {/* Main content: selected session detail + diff panel */}
            <div className="flex-1 flex min-h-0">
                {/* Left: Session detail */}
                <div className="flex-1 min-w-0 overflow-y-auto p-5">
                    {selectedSession ? (
                        <div className="space-y-5">
                            {/* Session info card */}
                            <div className="rounded-xl border border-white/[0.06] bg-[#111114] p-5">
                                <div className="flex items-start justify-between mb-4">
                                    <div className="flex items-center gap-3">
                                        <div className={`p-2.5 rounded-xl ${getAgentConfig(selectedSession.agent_type).bg}`}>
                                            {React.createElement(getAgentConfig(selectedSession.agent_type).icon, {
                                                className: `w-5 h-5 ${getAgentConfig(selectedSession.agent_type).color}`
                                            })}
                                        </div>
                                        <div>
                                            <h3 className="text-[14px] font-semibold text-[#e4e4e7]">{selectedSession.display_name}</h3>
                                            <span className="text-[11px] text-[#71717a]">{getAgentConfig(selectedSession.agent_type).label}</span>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        {selectedSession.status === 'running' ? (
                                            <span className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-emerald-500/10 text-emerald-400 text-[10px] font-medium">
                                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                                Running
                                            </span>
                                        ) : (
                                            <span className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-white/[0.04] text-[#71717a] text-[10px] font-medium">
                                                <span className="w-1.5 h-1.5 rounded-full bg-[#52525b]" />
                                                Stopped
                                            </span>
                                        )}
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-3 text-[12px]">
                                    <div className="flex items-center gap-2 text-[#71717a]">
                                        <Clock className="w-3.5 h-3.5" />
                                        <span>{formatElapsed(selectedSession.created_at)}</span>
                                    </div>
                                    {selectedSession.pid && (
                                        <div className="flex items-center gap-2 text-[#71717a]">
                                            <span className="font-mono text-[11px]">PID {selectedSession.pid}</span>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Action buttons */}
                            <div className="flex items-center gap-2">
                                {selectedSession.status === 'running' && (
                                    <>
                                        <button
                                            onClick={handleFocus}
                                            className="flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-medium bg-white/[0.06] hover:bg-white/[0.1] text-[#e4e4e7] border border-white/[0.06] transition-all duration-150"
                                        >
                                            <Eye className="w-3.5 h-3.5" />
                                            Focus Window
                                        </button>
                                        <button
                                            onClick={() => handleStop(selectedSession.id)}
                                            className="flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-medium text-red-400 hover:bg-red-500/10 border border-white/[0.06] hover:border-red-500/20 transition-all duration-150"
                                        >
                                            <Square className="w-3.5 h-3.5" />
                                            Stop
                                        </button>
                                    </>
                                )}
                                <button
                                    onClick={handleOpenEditor}
                                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-medium text-[#a1a1aa] hover:bg-white/[0.06] border border-white/[0.06] transition-all duration-150"
                                >
                                    <ExternalLink className="w-3.5 h-3.5" />
                                    Open in Editor
                                </button>
                            </div>

                            {/* Running sessions summary */}
                            {runningSessions.length > 1 && (
                                <div className="rounded-xl border border-white/[0.06] bg-[#111114] p-4">
                                    <h4 className="text-[11px] font-semibold text-[#71717a] uppercase tracking-wider mb-3">All Active Sessions</h4>
                                    <div className="space-y-2">
                                        {runningSessions.map(s => {
                                            const cfg = getAgentConfig(s.agent_type);
                                            return (
                                                <button
                                                    key={s.id}
                                                    onClick={() => setSelectedSessionId(s.id)}
                                                    className={`w-full flex items-center justify-between p-2.5 rounded-lg text-[12px] transition-all duration-150 ${
                                                        s.id === selectedSessionId
                                                            ? `${cfg.bg} ${cfg.color}`
                                                            : 'hover:bg-white/[0.04] text-[#a1a1aa]'
                                                    }`}
                                                >
                                                    <div className="flex items-center gap-2">
                                                        <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot} animate-pulse`} />
                                                        <span className="font-medium">{s.display_name}</span>
                                                    </div>
                                                    <span className="text-[#52525b]">{formatElapsed(s.created_at)}</span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="flex items-center justify-center h-full text-[#52525b] text-[13px]">
                            Select a session to view details
                        </div>
                    )}
                </div>

                {/* Right: Changes panel — Superset-inspired diff view */}
                <div className="w-72 shrink-0 border-l border-white/[0.06] bg-[#0e0e11] flex flex-col">
                    <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <GitBranch className="w-3.5 h-3.5 text-[#71717a]" />
                            <span className="text-[12px] font-semibold text-[#a1a1aa]">Changes</span>
                        </div>
                        {(totalAdditions > 0 || totalDeletions > 0) && (
                            <div className="flex items-center gap-1.5 text-[11px] font-mono">
                                {totalAdditions > 0 && <span className="text-emerald-400">+{totalAdditions}</span>}
                                {totalDeletions > 0 && <span className="text-red-400">-{totalDeletions}</span>}
                            </div>
                        )}
                    </div>
                    <div className="flex-1 overflow-y-auto">
                        {diff && diff.file_stats.length > 0 ? (
                            <div className="py-1">
                                {diff.file_stats.map((file) => {
                                    const parts = file.file.split('/');
                                    const fileName = parts.pop() ?? file.file;
                                    const dirPath = parts.join('/');
                                    return (
                                        <div
                                            key={file.file}
                                            className="flex items-center gap-2 px-4 py-2 hover:bg-white/[0.03] transition-colors group"
                                        >
                                            <FileCode className="w-3.5 h-3.5 text-[#52525b] shrink-0" />
                                            <div className="flex-1 min-w-0">
                                                <span className="text-[12px] text-[#e4e4e7] truncate block">{fileName}</span>
                                                {dirPath && (
                                                    <span className="text-[10px] text-[#52525b] truncate block">{dirPath}/</span>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-1 shrink-0 text-[11px] font-mono">
                                                {file.additions > 0 && <span className="text-emerald-400">+{file.additions}</span>}
                                                {file.deletions > 0 && <span className="text-red-400">-{file.deletions}</span>}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center h-full text-center px-4">
                                <ChevronRight className="w-5 h-5 text-[#3f3f46] mb-2" />
                                <p className="text-[11px] text-[#52525b]">No uncommitted changes</p>
                                <p className="text-[10px] text-[#3f3f46] mt-1">Changes will appear here as agents work</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
