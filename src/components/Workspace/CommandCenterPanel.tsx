import React, { useEffect, useState, useRef, useCallback } from 'react';
import type { Project, GitStatus, ProjectPlaybook, PlaybookStep } from '../../types';
import { invokeCommand } from '../../lib/tauri';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { toast } from 'sonner';
import { PlaybookRunStatus, type PlaybookRunStatusHandle } from './PlaybookRunStatus';
import { PlaybookEditor } from './PlaybookEditor';
import {
    Terminal, ExternalLink,
    Rocket, Globe, FileCode, Play,
    Square, Plus, Trash2, Bot, ChevronRight,
    ArrowUpRight,
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

export const CommandCenterPanel: React.FC<CommandCenterPanelProps> = ({ project, onNavigate }) => {
    const playbookRef = useRef<PlaybookRunStatusHandle>(null);
    const [editorOpen, setEditorOpen] = useState(false);
    const [editingPlaybook, setEditingPlaybook] = useState<ProjectPlaybook | undefined>();
    const [editingSteps, setEditingSteps] = useState<PlaybookStep[] | undefined>();

    const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
    const [processes, setProcesses] = useState<Process[]>([]);
    const [links, setLinks] = useState<ProjectLink[]>([]);
    const [newCommand, setNewCommand] = useState('');
    const [showServices, setShowServices] = useState(false);
    const [showPlaybooks, setShowPlaybooks] = useState(false);
    const [expandedProcess, setExpandedProcess] = useState<string | null>(null);
    const [processOutput, setProcessOutput] = useState<string>('');
    const [showLinks, setShowLinks] = useState(false);

    useEffect(() => {
        loadAll();
        const interval = setInterval(loadProcesses, 3000);
        return () => clearInterval(interval);
    }, [project.id, project.path]);

    const loadAll = () => {
        invokeCommand<GitStatus | null>('get_git_status', { path: project.path }).then(setGitStatus).catch(() => {});
        loadProcesses();
        invokeCommand<ProjectLink[]>('get_project_links', { projectId: project.id })
            .then(data => setLinks(data.map(d => ({ ...d, kind: d.kind || 'url' }))))
            .catch(() => {});
    };

    const loadProcesses = async () => {
        try {
            const data = await invokeCommand<Process[]>('get_active_processes', { projectId: project.id });
            setProcesses(data);
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
        } catch { toast.error('Failed to start process'); }
    };

    const handleStopProcess = async (id: string) => {
        try {
            await invokeCommand('stop_process', { id });
            setProcesses(prev => prev.filter(p => p.id !== id));
        } catch { toast.error('Failed to stop'); }
    };

    const toggleProcessOutput = async (procId: string) => {
        if (expandedProcess === procId) {
            setExpandedProcess(null);
            setProcessOutput('');
            return;
        }
        setExpandedProcess(procId);
        try {
            const output = await invokeCommand<string>('get_process_history', { id: procId });
            setProcessOutput(output);
        } catch {
            setProcessOutput('(unable to load output)');
        }
    };

    const handleOpenTerminal = async () => {
        try { await invokeCommand('open_external_terminal', { path: project.path }); }
        catch { toast.error('Failed'); }
    };

    const handleOpenEditor = async () => {
        try { await invokeCommand('open_in_editor', { path: project.path }); }
        catch { toast.error('Failed'); }
    };

    const ensureProtocol = (url: string) => {
        if (!url || url.startsWith('http://') || url.startsWith('https://')) return url || '';
        return `https://${url}`;
    };

    const handleOpenLink = async (link: ProjectLink) => {
        try {
            if (link.kind === 'command') {
                await invokeCommand('start_process', { command: link.url, cwd: link.working_directory || project.path });
            } else if (link.kind === 'repository') {
                await invokeCommand('open_in_editor', { path: link.url });
            } else {
                await invokeCommand('open_url', { url: ensureProtocol(link.url) });
            }
        } catch { toast.error('Failed to open'); }
    };

    const handleDeleteLink = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        try { await invokeCommand('delete_project_link', { id }); setLinks(prev => prev.filter(l => l.id !== id)); }
        catch { toast.error('Failed'); }
    };

    const handleLaunchAll = async () => {
        if (playbookRef.current?.hasPlaybooks && !playbookRef.current.isRunning) {
            playbookRef.current.runFirst();
        }
        for (const link of links) {
            try {
                if (link.kind === 'command') await invokeCommand('start_process', { command: link.url, cwd: link.working_directory || project.path });
                else if (link.kind === 'repository') await invokeCommand('open_in_editor', { path: link.url });
                else await invokeCommand('open_url', { url: ensureProtocol(link.url) });
            } catch {}
        }
        if (links.length > 0) toast.success(`Launched ${links.length} items`);
    };

    const handleNewPlaybook = useCallback(() => { setEditingPlaybook(undefined); setEditingSteps(undefined); setEditorOpen(true); }, []);
    const handleEditPlaybook = useCallback(async (playbookId: string) => {
        try {
            const playbooks = await invokeCommand<ProjectPlaybook[]>('get_project_playbooks', { projectId: project.id });
            const pb = playbooks.find(p => p.id === playbookId);
            const steps = await invokeCommand<PlaybookStep[]>('get_playbook_steps', { playbookId });
            setEditingPlaybook(pb); setEditingSteps(steps); setEditorOpen(true);
        } catch { toast.error('Failed to load playbook'); }
    }, [project.id]);

    const runningCount = processes.filter(p => p.running).length;
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

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

    return (
        <div className="h-full w-full overflow-y-auto bg-background scrollbar-thin">
            <div className="max-w-3xl mx-auto px-6 py-10 space-y-10">

                {/* === HERO === */}
                <div className="space-y-4">
                    <div className="space-y-1">
                        <h1 className="text-3xl font-bold tracking-tight text-foreground">
                            {greeting}.
                        </h1>
                        <p className="text-base text-muted-foreground">
                            {project.name} is {runningCount > 0 ? (
                                <span className="text-green-400 font-medium">{runningCount} service{runningCount !== 1 ? 's' : ''} running</span>
                            ) : (
                                <span className="text-muted-foreground/70">idle</span>
                            )}
                            {gitStatus && (
                                <span className="text-muted-foreground">
                                    {' · '}
                                    <span className="font-mono text-foreground/80">{gitStatus.branch}</span>
                                    {gitStatus.modified_count > 0 && (
                                        <span className="text-yellow-400"> · {gitStatus.modified_count} changed</span>
                                    )}
                                </span>
                            )}
                        </p>
                    </div>

                    {/* Quick actions — small, inline */}
                    <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1.5 rounded-full px-3" onClick={handleOpenTerminal}>
                            <Terminal className="w-3 h-3" /> Terminal
                        </Button>
                        <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1.5 rounded-full px-3" onClick={handleOpenEditor}>
                            <ExternalLink className="w-3 h-3" /> Editor
                        </Button>
                        <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1.5 rounded-full px-3" onClick={() => onNavigate('agent')}>
                            <Bot className="w-3 h-3" /> Ask Agent
                        </Button>
                    </div>
                </div>

                {/* === LAUNCH === */}
                {(links.length > 0 || playbookRef.current?.hasPlaybooks) && (
                    <button
                        onClick={handleLaunchAll}
                        className="w-full group flex items-center justify-between p-5 rounded-2xl border border-primary/20 bg-primary/5 hover:bg-primary/10 hover:border-primary/30 transition-all"
                    >
                        <div className="flex items-center gap-4">
                            <div className="p-3 rounded-xl bg-primary/10 text-primary group-hover:bg-primary/20 transition-colors">
                                <Rocket className="w-6 h-6" />
                            </div>
                            <div className="text-left">
                                <div className="text-sm font-semibold text-foreground">Launch Environment</div>
                                <div className="text-xs text-muted-foreground mt-0.5">
                                    Start all services, run playbooks, and open links
                                </div>
                            </div>
                        </div>
                        <ChevronRight className="w-5 h-5 text-primary/50 group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
                    </button>
                )}

                {/* === COLLAPSIBLE SECTIONS === */}
                <div className="space-y-2">

                    {/* Services */}
                    <div className="rounded-xl border border-border/30 overflow-hidden">
                        <button
                            onClick={() => setShowServices(!showServices)}
                            className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors"
                        >
                            <div className="flex items-center gap-3">
                                <div className={`w-2 h-2 rounded-full ${runningCount > 0 ? 'bg-green-500' : 'bg-muted-foreground/30'}`} />
                                <span className="text-sm font-medium text-foreground">Services</span>
                                {runningCount > 0 && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-400 font-medium">
                                        {runningCount} running
                                    </span>
                                )}
                            </div>
                            <ChevronRight className={`w-4 h-4 text-muted-foreground transition-transform ${showServices ? 'rotate-90' : ''}`} />
                        </button>
                        {showServices && (
                            <div className="border-t border-border/20">
                                {processes.filter(p => p.running).map(proc => (
                                    <div key={proc.id} className="border-b border-border/10 last:border-0">
                                        <div
                                            className="flex items-center justify-between px-4 py-2.5 hover:bg-muted/20 transition-colors group cursor-pointer"
                                            onClick={() => toggleProcessOutput(proc.id)}
                                        >
                                            <div className="flex items-center gap-3 min-w-0">
                                                <span className="relative flex h-1.5 w-1.5 shrink-0">
                                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                                                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-500" />
                                                </span>
                                                <code className="text-xs text-foreground/90 truncate">{proc.command}</code>
                                                <ChevronRight className={`w-3 h-3 text-muted-foreground/40 transition-transform ${expandedProcess === proc.id ? 'rotate-90' : ''}`} />
                                            </div>
                                            <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive" onClick={(e) => { e.stopPropagation(); handleStopProcess(proc.id); }}>
                                                <Square className="w-2.5 h-2.5 fill-current" />
                                            </Button>
                                        </div>
                                        {expandedProcess === proc.id && (
                                            <div className="px-4 pb-3">
                                                <pre className="bg-black/80 text-green-400 text-[11px] font-mono p-3 rounded-lg max-h-48 overflow-y-auto whitespace-pre-wrap leading-relaxed">
                                                    {processOutput || '(waiting for output...)'}
                                                </pre>
                                            </div>
                                        )}
                                    </div>
                                ))}
                                {processes.filter(p => p.running).length === 0 && (
                                    <div className="px-4 py-4 text-xs text-muted-foreground/50 text-center">No active services</div>
                                )}
                                <form onSubmit={handleStartProcess} className="flex items-center gap-2 px-4 py-2 bg-muted/5 border-t border-border/10">
                                    <Plus className="w-3 h-3 text-muted-foreground/40 shrink-0" />
                                    <Input
                                        value={newCommand}
                                        onChange={e => setNewCommand(e.target.value)}
                                        placeholder="Run a command..."
                                        className="h-6 border-0 bg-transparent text-xs font-mono focus-visible:ring-0 shadow-none px-0"
                                    />
                                    {newCommand.trim() && (
                                        <Button type="submit" size="sm" variant="ghost" className="h-6 px-1.5">
                                            <Play className="w-3 h-3" />
                                        </Button>
                                    )}
                                </form>
                            </div>
                        )}
                    </div>

                    {/* Playbooks */}
                    <div className="rounded-xl border border-border/30 overflow-hidden">
                        <button
                            onClick={() => setShowPlaybooks(!showPlaybooks)}
                            className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors"
                        >
                            <div className="flex items-center gap-3">
                                <div className="w-2 h-2 rounded-full bg-primary/50" />
                                <span className="text-sm font-medium text-foreground">Playbooks</span>
                            </div>
                            <ChevronRight className={`w-4 h-4 text-muted-foreground transition-transform ${showPlaybooks ? 'rotate-90' : ''}`} />
                        </button>
                        {showPlaybooks && (
                            <div className="border-t border-border/20 p-4">
                                <PlaybookRunStatus
                                    ref={playbookRef}
                                    projectId={project.id}
                                    projectPath={project.path}
                                    onNewPlaybook={handleNewPlaybook}
                                    onEditPlaybook={handleEditPlaybook}
                                />
                            </div>
                        )}
                    </div>

                    {/* Quick Links */}
                    {links.length > 0 && (
                        <div className="rounded-xl border border-border/30 overflow-hidden">
                            <button
                                onClick={() => setShowLinks(!showLinks)}
                                className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors"
                            >
                                <div className="flex items-center gap-3">
                                    <div className="w-2 h-2 rounded-full bg-blue-500/50" />
                                    <span className="text-sm font-medium text-foreground">Quick Links</span>
                                    <span className="text-[10px] text-muted-foreground">{links.length}</span>
                                </div>
                                <ChevronRight className={`w-4 h-4 text-muted-foreground transition-transform ${showLinks ? 'rotate-90' : ''}`} />
                            </button>
                            {showLinks && (
                                <div className="border-t border-border/20">
                                    {links.map(link => (
                                        <button
                                            key={link.id}
                                            onClick={() => handleOpenLink(link)}
                                            className="w-full group flex items-center justify-between px-4 py-2.5 border-b border-border/10 last:border-0 hover:bg-muted/20 transition-colors text-left"
                                        >
                                            <div className="flex items-center gap-3 min-w-0">
                                                {link.kind === 'command' ? <Terminal className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" /> :
                                                 link.kind === 'repository' ? <FileCode className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" /> :
                                                 <Globe className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />}
                                                <span className="text-xs font-medium text-foreground/90 truncate">{link.title}</span>
                                                <span className="text-[10px] text-muted-foreground/40 font-mono truncate hidden sm:block">{link.url}</span>
                                            </div>
                                            <div className="flex items-center gap-1 shrink-0">
                                                <ArrowUpRight className="w-3 h-3 text-muted-foreground/30 group-hover:text-foreground/60 transition-colors" />
                                                <Button
                                                    variant="ghost" size="icon"
                                                    className="h-5 w-5 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                                                    onClick={(e) => handleDeleteLink(link.id, e)}
                                                >
                                                    <Trash2 className="w-2.5 h-2.5" />
                                                </Button>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                </div>

                {/* === BOTTOM HINT === */}
                <div className="text-center pt-4">
                    <p className="text-[11px] text-muted-foreground/40">
                        Press <kbd className="px-1.5 py-0.5 rounded bg-muted/50 text-muted-foreground/60 font-mono text-[10px]">Cmd+K</kbd> for quick actions
                    </p>
                </div>

            </div>
        </div>
    );
};
