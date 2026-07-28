import React, { useState, useEffect, useCallback } from 'react';
import { invokeCommand } from '../../lib/tauri';
import { toast } from 'sonner';
import {
    Play, Square, Bot, Zap, Monitor,
    Plus, RefreshCw,
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

interface SessionsTabProps {
    projectId: string;
    projectPath: string;
}

const AGENT_TYPES = [
    { id: 'claude', label: 'Claude Code', icon: Bot, color: 'text-orange-400', bgColor: 'bg-orange-500/10' },
    { id: 'codex', label: 'Codex CLI', icon: Zap, color: 'text-green-400', bgColor: 'bg-green-500/10' },
    { id: 'custom', label: 'Terminal', icon: Monitor, color: 'text-blue-400', bgColor: 'bg-blue-500/10' },
];

export const TerminalTab: React.FC<SessionsTabProps> = ({ projectId, projectPath }) => {
    const [sessions, setSessions] = useState<AgentSession[]>([]);
    const [isLaunching, setIsLaunching] = useState(false);
    const [showLauncher, setShowLauncher] = useState(false);

    // Launch config
    const [selectedAgent, setSelectedAgent] = useState('claude');
    const [agentCount, setAgentCount] = useState(1);
    const [injectContext, setInjectContext] = useState(true);

    const loadSessions = useCallback(async () => {
        try {
            const data = await invokeCommand<AgentSession[]>('list_agent_sessions', {});
            setSessions(data.filter(s => s.project_id === projectId));
        } catch {
            // sessions not loaded — not critical
        }
    }, [projectId]);

    useEffect(() => {
        loadSessions();
        const interval = setInterval(loadSessions, 5000);
        return () => clearInterval(interval);
    }, [loadSessions]);

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
            setShowLauncher(false);
            toast.success(`Launched ${newSessions.length} ${selectedAgent} session(s)`);
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

    const runningSessions = sessions.filter(s => s.status === 'running');
    const stoppedSessions = sessions.filter(s => s.status === 'stopped');

    const getAgentConfig = (type: string) => AGENT_TYPES.find(a => a.id === type) ?? AGENT_TYPES[2];

    return (
        <div className="h-full flex flex-col bg-background">
            {/* Header */}
            <div className="shrink-0 flex items-center justify-between border-b border-border/40 bg-muted/5 px-4 py-3">
                <div className="flex items-center gap-2">
                    <h2 className="text-sm font-semibold text-foreground">Agent Sessions</h2>
                    {runningSessions.length > 0 && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-500 font-medium">
                            {runningSessions.length} active
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={loadSessions}
                        className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                        title="Refresh"
                    >
                        <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                    <button
                        onClick={() => setShowLauncher(!showLauncher)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                    >
                        <Plus className="w-3.5 h-3.5" />
                        Launch Agents
                    </button>
                </div>
            </div>

            {/* Launch panel */}
            {showLauncher && (
                <div className="shrink-0 border-b border-border/40 bg-card/50 p-4 space-y-4">
                    <div className="flex items-center gap-3">
                        <span className="text-xs font-medium text-muted-foreground w-16">Agent:</span>
                        <div className="flex gap-2">
                            {AGENT_TYPES.map(agent => {
                                const Icon = agent.icon;
                                return (
                                    <button
                                        key={agent.id}
                                        onClick={() => setSelectedAgent(agent.id)}
                                        className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium border transition-all ${
                                            selectedAgent === agent.id
                                                ? `border-primary/50 ${agent.bgColor} ${agent.color}`
                                                : 'border-border/40 text-muted-foreground hover:border-border hover:text-foreground'
                                        }`}
                                    >
                                        <Icon className="w-3.5 h-3.5" />
                                        {agent.label}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <span className="text-xs font-medium text-muted-foreground w-16">Count:</span>
                        <div className="flex gap-1.5">
                            {[1, 2, 3, 4, 5, 6].map(n => (
                                <button
                                    key={n}
                                    onClick={() => setAgentCount(n)}
                                    className={`w-8 h-8 rounded-md text-xs font-medium transition-all ${
                                        agentCount === n
                                            ? 'bg-primary text-primary-foreground'
                                            : 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground'
                                    }`}
                                >
                                    {n}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <span className="text-xs font-medium text-muted-foreground w-16">Layout:</span>
                        <span className="text-xs text-muted-foreground">
                            {agentCount === 1 && 'Full screen'}
                            {agentCount === 2 && 'Side by side'}
                            {agentCount === 3 && '2 top + 1 bottom'}
                            {agentCount === 4 && '2x2 grid'}
                            {agentCount === 5 && '3 top + 2 bottom'}
                            {agentCount === 6 && '3x2 grid'}
                        </span>
                    </div>
                    <div className="flex items-center gap-3">
                        <span className="text-xs font-medium text-muted-foreground w-16">Context:</span>
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={injectContext}
                                onChange={e => setInjectContext(e.target.checked)}
                                className="rounded border-border accent-primary"
                            />
                            <span className="text-xs text-muted-foreground">
                                Inject vault keys, notes, git diff, and env vars
                            </span>
                        </label>
                    </div>
                    <button
                        onClick={handleLaunch}
                        disabled={isLaunching}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                    >
                        {isLaunching ? (
                            <>Launching...</>
                        ) : (
                            <>
                                <Play className="w-4 h-4" />
                                Launch {agentCount} {getAgentConfig(selectedAgent).label} Session{agentCount > 1 ? 's' : ''}
                            </>
                        )}
                    </button>
                </div>
            )}

            {/* Sessions list */}
            <div className="flex-1 overflow-y-auto p-4">
                {sessions.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground space-y-3">
                        <div className="p-4 rounded-full bg-primary/5">
                            <Bot className="w-10 h-10 text-primary/30" />
                        </div>
                        <div className="space-y-1">
                            <p className="text-sm font-medium text-foreground/80">No agent sessions</p>
                            <p className="text-xs max-w-xs">
                                Launch AI coding agents that open in native terminal windows,
                                automatically tiled on your screen.
                            </p>
                        </div>
                        <button
                            onClick={() => setShowLauncher(true)}
                            className="mt-2 flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                        >
                            <Plus className="w-3.5 h-3.5" />
                            Launch Your First Agents
                        </button>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {runningSessions.length > 0 && (
                            <div className="space-y-2">
                                <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Running</h3>
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                    {runningSessions.map(session => {
                                        const config = getAgentConfig(session.agent_type);
                                        const Icon = config.icon;
                                        return (
                                            <div key={session.id} className="group p-4 rounded-xl border border-border/40 bg-card/30 hover:bg-card/50 hover:border-border/60 transition-all">
                                                <div className="flex items-start justify-between">
                                                    <div className="flex items-center gap-3">
                                                        <div className={`p-2 rounded-lg ${config.bgColor}`}>
                                                            <Icon className={`w-4 h-4 ${config.color}`} />
                                                        </div>
                                                        <div>
                                                            <p className="text-sm font-medium text-foreground">{session.display_name}</p>
                                                            <p className="text-[10px] text-muted-foreground mt-0.5">{config.label}</p>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-1.5">
                                                        <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                                                        <button
                                                            onClick={() => handleStop(session.id)}
                                                            className="p-1.5 rounded-md text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-all"
                                                            title="Stop session"
                                                        >
                                                            <Square className="w-3 h-3" />
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {stoppedSessions.length > 0 && (
                            <div className="space-y-2">
                                <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Stopped</h3>
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                    {stoppedSessions.map(session => {
                                        const config = getAgentConfig(session.agent_type);
                                        const Icon = config.icon;
                                        return (
                                            <div key={session.id} className="p-4 rounded-xl border border-border/20 bg-muted/10 opacity-60">
                                                <div className="flex items-center gap-3">
                                                    <div className={`p-2 rounded-lg bg-muted/30`}>
                                                        <Icon className="w-4 h-4 text-muted-foreground" />
                                                    </div>
                                                    <div>
                                                        <p className="text-sm font-medium text-muted-foreground">{session.display_name}</p>
                                                        <p className="text-[10px] text-muted-foreground/60 mt-0.5">Stopped</p>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};
