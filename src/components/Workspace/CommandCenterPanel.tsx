import React, { useEffect, useState, useRef, useCallback } from 'react';
import type { Project, GitStatus, ProjectPlaybook, PlaybookStep } from '../../types';
import { invokeCommand } from '../../lib/tauri';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { toast } from 'sonner';
import { PlaybookRunStatus, type PlaybookRunStatusHandle } from './PlaybookRunStatus';
import { PlaybookEditor } from './PlaybookEditor';
import {
    Terminal, FolderOpen, GitBranch, ExternalLink, RefreshCw,
    ArrowUp, ArrowDown, Rocket, Globe, FileCode, Play,
    Square, Plus, Trash2, Zap, Brain, Bot, Cpu,
    type LucideIcon,
} from 'lucide-react';

interface Process {
    id: string;
    command: string;
    cwd: string;
    running: boolean;
    pid: number;
}

interface ProjectLink {
    id: string;
    project_id: string;
    title: string;
    url: string;
    icon: string | null;
    kind: 'url' | 'command' | 'repository';
    working_directory?: string;
}

interface CommandCenterPanelProps {
    project: Project;
    onNavigate: (tab: string) => void;
}

interface StatusCardProps {
    icon: LucideIcon;
    label: string;
    value: string;
    accent: string;
    pulse?: boolean;
    onClick?: () => void;
}

const StatusCard: React.FC<StatusCardProps> = ({ icon: Icon, label, value, accent, pulse, onClick }) => (
    <button
        onClick={onClick}
        className={`flex items-center gap-3 p-3.5 rounded-xl border border-border/40 bg-card/50 hover:bg-card/80 hover:border-border/60 transition-all text-left ${onClick ? 'cursor-pointer' : 'cursor-default'}`}
    >
        <div className={`p-2 rounded-lg ${accent}`}>
            <Icon className="w-4 h-4" />
        </div>
        <div className="min-w-0">
            <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">{label}</div>
            <div className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                {value}
                {pulse && (
                    <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                    </span>
                )}
            </div>
        </div>
    </button>
);

export const CommandCenterPanel: React.FC<CommandCenterPanelProps> = ({ project, onNavigate }) => {
    const playbookRef = useRef<PlaybookRunStatusHandle>(null);
    const [editorOpen, setEditorOpen] = useState(false);
    const [editingPlaybook, setEditingPlaybook] = useState<ProjectPlaybook | undefined>();
    const [editingSteps, setEditingSteps] = useState<PlaybookStep[] | undefined>();

    const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
    const [isGitLoading, setIsGitLoading] = useState(false);
    const [processes, setProcesses] = useState<Process[]>([]);
    const [links, setLinks] = useState<ProjectLink[]>([]);
    const [knowledgeCount, setKnowledgeCount] = useState(0);
    const [newCommand, setNewCommand] = useState('');

    useEffect(() => {
        loadGitStatus();
        loadProcesses();
        loadLinks();
        loadKnowledgeCount();

        const interval = setInterval(loadProcesses, 3000);
        return () => clearInterval(interval);
    }, [project.id, project.path]);

    const loadGitStatus = () => {
        setIsGitLoading(true);
        invokeCommand<GitStatus | null>('get_git_status', { path: project.path })
            .then(setGitStatus)
            .catch(() => {})
            .finally(() => setIsGitLoading(false));
    };

    const loadProcesses = async () => {
        try {
            const data = await invokeCommand<Process[]>('get_active_processes', { projectId: project.id });
            setProcesses(data);
        } catch {}
    };

    const loadLinks = async () => {
        try {
            const data = await invokeCommand<ProjectLink[]>('get_project_links', { projectId: project.id });
            setLinks(data.map(d => ({ ...d, kind: d.kind || 'url' })));
        } catch {}
    };

    const loadKnowledgeCount = async () => {
        try {
            const nodes = await invokeCommand<{ id: string }[]>('get_project_knowledge_nodes', { projectId: project.id });
            setKnowledgeCount(nodes.length);
        } catch {}
    };

    const handleStartProcess = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newCommand.trim()) return;
        try {
            const proc = await invokeCommand<Process>('start_process', { command: newCommand, cwd: project.path });
            setProcesses(prev => [...prev, proc]);
            setNewCommand('');
            toast.success('Process started');
        } catch {
            toast.error('Failed to start process');
        }
    };

    const handleStopProcess = async (id: string) => {
        try {
            await invokeCommand('stop_process', { id });
            setProcesses(prev => prev.filter(p => p.id !== id));
            toast.success('Process stopped');
        } catch {
            toast.error('Failed to stop process');
        }
    };

    const handleOpenTerminal = async () => {
        try { await invokeCommand('open_external_terminal', { path: project.path }); }
        catch { toast.error('Failed to open terminal'); }
    };

    const handleOpenEditor = async () => {
        try {
            await invokeCommand('open_in_editor', { path: project.path });
            toast.success('Opening editor...');
        } catch { toast.error('Failed to open editor'); }
    };

    const handleReveal = async () => {
        try { await invokeCommand('reveal_in_finder', { path: project.path }); }
        catch { toast.error('Failed to reveal'); }
    };

    const ensureProtocol = (url: string) => {
        if (!url) return '';
        if (url.startsWith('http://') || url.startsWith('https://')) return url;
        return `https://${url}`;
    };

    const handleOpenLink = async (link: ProjectLink) => {
        try {
            if (link.kind === 'command') {
                await invokeCommand('start_process', { command: link.url, cwd: link.working_directory || project.path });
                toast.success(`Started: ${link.title}`);
            } else if (link.kind === 'repository') {
                await invokeCommand('open_in_editor', { path: link.url });
            } else {
                await invokeCommand('open_url', { url: ensureProtocol(link.url) });
            }
        } catch { toast.error('Failed to open'); }
    };

    const handleDeleteLink = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        try {
            await invokeCommand('delete_project_link', { id });
            loadLinks();
        } catch { toast.error('Failed to delete'); }
    };

    const handleLaunchAll = async () => {
        if (playbookRef.current?.hasPlaybooks && !playbookRef.current.isRunning) {
            playbookRef.current.runFirst();
        }
        for (const link of links) {
            try {
                if (link.kind === 'command') {
                    await invokeCommand('start_process', { command: link.url, cwd: link.working_directory || project.path });
                } else if (link.kind === 'repository') {
                    await invokeCommand('open_in_editor', { path: link.url });
                } else {
                    await invokeCommand('open_url', { url: ensureProtocol(link.url) });
                }
            } catch {}
        }
        if (links.length > 0) toast.success(`Launched ${links.length} items`);
    };

    const handleNewPlaybook = useCallback(() => {
        setEditingPlaybook(undefined);
        setEditingSteps(undefined);
        setEditorOpen(true);
    }, []);

    const handleEditPlaybook = useCallback(async (playbookId: string) => {
        try {
            const playbooks = await invokeCommand<ProjectPlaybook[]>('get_project_playbooks', { projectId: project.id });
            const pb = playbooks.find(p => p.id === playbookId);
            const steps = await invokeCommand<PlaybookStep[]>('get_playbook_steps', { playbookId });
            setEditingPlaybook(pb);
            setEditingSteps(steps);
            setEditorOpen(true);
        } catch { toast.error('Failed to load playbook'); }
    }, [project.id]);

    const runningCount = processes.filter(p => p.running).length;

    if (editorOpen) {
        return (
            <PlaybookEditor
                projectId={project.id}
                playbook={editingPlaybook}
                existingSteps={editingSteps}
                onClose={() => { setEditorOpen(false); setEditingPlaybook(undefined); setEditingSteps(undefined); }}
                onSaved={() => { setEditorOpen(false); setEditingPlaybook(undefined); setEditingSteps(undefined); }}
            />
        );
    }

    const linkIcon = (kind: string) => {
        if (kind === 'command') return <Terminal className="w-3.5 h-3.5" />;
        if (kind === 'repository') return <FileCode className="w-3.5 h-3.5" />;
        return <Globe className="w-3.5 h-3.5" />;
    };

    return (
        <div className="h-full w-full overflow-y-auto bg-background scrollbar-thin">
            <div className="max-w-5xl mx-auto p-6 space-y-8">

                {/* === HEADER === */}
                <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1 min-w-0">
                        <h1 className="text-2xl font-bold tracking-tight text-foreground">{project.name}</h1>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono">
                            <FolderOpen className="w-3.5 h-3.5 shrink-0" />
                            <span className="truncate">{project.path}</span>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={handleOpenTerminal}>
                            <Terminal className="w-3.5 h-3.5" /> Terminal
                        </Button>
                        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={handleOpenEditor}>
                            <ExternalLink className="w-3.5 h-3.5" /> Editor
                        </Button>
                        <Button variant="outline" size="icon" className="h-8 w-8" onClick={handleReveal} title="Reveal in Finder">
                            <FolderOpen className="w-3.5 h-3.5" />
                        </Button>
                    </div>
                </div>

                {/* === STATUS CARDS === */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <StatusCard
                        icon={Cpu}
                        label="Services"
                        value={runningCount > 0 ? `${runningCount} running` : 'Idle'}
                        accent="bg-green-500/10 text-green-500"
                        pulse={runningCount > 0}
                    />
                    <StatusCard
                        icon={GitBranch}
                        label="Repository"
                        value={gitStatus ? `${gitStatus.branch}${gitStatus.modified_count > 0 ? ` · ${gitStatus.modified_count} changed` : ''}` : 'No repo'}
                        accent="bg-blue-500/10 text-blue-500"
                        onClick={loadGitStatus}
                    />
                    <StatusCard
                        icon={Bot}
                        label="Agent"
                        value="Ready"
                        accent="bg-purple-500/10 text-purple-500"
                        onClick={() => onNavigate('agent')}
                    />
                    <StatusCard
                        icon={Brain}
                        label="Knowledge"
                        value={knowledgeCount > 0 ? `${knowledgeCount} nodes` : 'Empty'}
                        accent="bg-amber-500/10 text-amber-500"
                        onClick={() => onNavigate('workspace')}
                    />
                </div>

                {/* === LAUNCH BUTTON === */}
                {(links.length > 0 || playbookRef.current?.hasPlaybooks) && (
                    <Button
                        size="lg"
                        className="w-full h-12 gap-2.5 text-sm font-semibold bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70 shadow-lg shadow-primary/20"
                        onClick={handleLaunchAll}
                    >
                        <Rocket className="w-5 h-5" />
                        Launch Environment
                    </Button>
                )}

                {/* === GIT STATUS (expanded) === */}
                {gitStatus && (
                    <div className="rounded-xl border border-border/40 bg-card/30 p-4">
                        <div className="flex items-center justify-between mb-3">
                            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 flex items-center gap-2">
                                <GitBranch className="w-3.5 h-3.5" /> Repository
                            </h2>
                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={loadGitStatus} disabled={isGitLoading}>
                                <RefreshCw className={`w-3 h-3 ${isGitLoading ? 'animate-spin' : ''}`} />
                            </Button>
                        </div>
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <code className="text-sm font-semibold text-foreground">{gitStatus.branch}</code>
                                {gitStatus.modified_count > 0 ? (
                                    <Badge variant="outline" className="text-[10px] text-yellow-500 border-yellow-500/30 bg-yellow-500/5">
                                        {gitStatus.modified_count} modified
                                    </Badge>
                                ) : (
                                    <Badge variant="outline" className="text-[10px] text-green-500 border-green-500/30 bg-green-500/5">
                                        Clean
                                    </Badge>
                                )}
                            </div>
                            <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                <span className="flex items-center gap-1" title="Ahead">
                                    <ArrowUp className={`w-3 h-3 ${gitStatus.ahead > 0 ? 'text-blue-400' : ''}`} /> {gitStatus.ahead}
                                </span>
                                <span className="flex items-center gap-1" title="Behind">
                                    <ArrowDown className={`w-3 h-3 ${gitStatus.behind > 0 ? 'text-red-400' : ''}`} /> {gitStatus.behind}
                                </span>
                            </div>
                        </div>
                    </div>
                )}

                {/* === RUNNING SERVICES === */}
                <div className="space-y-3">
                    <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 flex items-center gap-2">
                        <Zap className="w-3.5 h-3.5" /> Services
                    </h2>
                    <div className="rounded-xl border border-border/40 bg-card/30 overflow-hidden">
                        {processes.filter(p => p.running).map(proc => (
                            <div key={proc.id} className="flex items-center justify-between px-4 py-3 border-b border-border/20 last:border-0 hover:bg-muted/30 transition-colors group">
                                <div className="flex items-center gap-3 min-w-0">
                                    <span className="relative flex h-2 w-2 shrink-0">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                                        <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                                    </span>
                                    <code className="text-sm text-foreground truncate">{proc.command}</code>
                                </div>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-opacity"
                                    onClick={() => handleStopProcess(proc.id)}
                                >
                                    <Square className="w-3 h-3 fill-current" />
                                </Button>
                            </div>
                        ))}
                        {processes.filter(p => p.running).length === 0 && (
                            <div className="px-4 py-6 text-center text-xs text-muted-foreground/60">
                                No running services
                            </div>
                        )}
                        <form onSubmit={handleStartProcess} className="flex items-center gap-2 px-4 py-2.5 bg-muted/10 border-t border-border/20">
                            <Plus className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
                            <Input
                                value={newCommand}
                                onChange={e => setNewCommand(e.target.value)}
                                placeholder="Run a command..."
                                className="h-7 border-0 bg-transparent text-xs font-mono focus-visible:ring-0 shadow-none px-0"
                            />
                            <Button type="submit" size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={!newCommand.trim()}>
                                <Play className="w-3 h-3" />
                            </Button>
                        </form>
                    </div>
                </div>

                {/* === PLAYBOOKS === */}
                <div className="space-y-3">
                    <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 flex items-center gap-2">
                        <Rocket className="w-3.5 h-3.5" /> Playbooks
                    </h2>
                    <PlaybookRunStatus
                        ref={playbookRef}
                        projectId={project.id}
                        projectPath={project.path}
                        onNewPlaybook={handleNewPlaybook}
                        onEditPlaybook={handleEditPlaybook}
                    />
                </div>

                {/* === QUICK LINKS === */}
                {links.length > 0 && (
                    <div className="space-y-3">
                        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 flex items-center gap-2">
                            <Globe className="w-3.5 h-3.5" /> Quick Access
                        </h2>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                            {links.map(link => (
                                <button
                                    key={link.id}
                                    onClick={() => handleOpenLink(link)}
                                    className="group flex items-center gap-3 p-3 rounded-lg border border-border/30 bg-card/20 hover:bg-card/50 hover:border-border/50 transition-all text-left"
                                >
                                    <div className="p-1.5 rounded-md bg-muted/50 text-muted-foreground group-hover:text-foreground transition-colors">
                                        {linkIcon(link.kind)}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="text-xs font-medium text-foreground truncate">{link.title}</div>
                                        <div className="text-[10px] text-muted-foreground/70 font-mono truncate">{link.url}</div>
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-6 w-6 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all shrink-0"
                                        onClick={(e) => handleDeleteLink(link.id, e)}
                                    >
                                        <Trash2 className="w-3 h-3" />
                                    </Button>
                                </button>
                            ))}
                        </div>
                    </div>
                )}

            </div>
        </div>
    );
};
