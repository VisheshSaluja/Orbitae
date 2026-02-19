import React, { useEffect, useState, useMemo } from 'react';
import type { Project, ProjectNote, ProjectSettings, GitStatus } from '../../types';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Terminal, ScrollText, FolderOpen, GitBranch, ExternalLink, RefreshCw, ArrowUp, ArrowDown, Activity, Tag, Cpu } from 'lucide-react';
import { motion } from 'framer-motion';
import { invokeCommand } from '../../lib/mock-tauri';
import { toast } from 'sonner';

interface Process {
    id: string;
    command: string;
    cwd: string;
    running: boolean;
    pid: number;
}

interface OverviewPanelProps {
    project: Project;
    onNavigate: (tab: string) => void;
}

const DEFAULT_LABELS: Record<string, string> = {
    yellow: 'General',
    blue: 'Idea',
    green: 'Done',
    red: 'Bug',
    purple: 'Feature'
};

const COLORS = [
    { id: 'yellow', bg: 'bg-yellow-50 dark:bg-yellow-950/30', border: 'border-yellow-200 dark:border-yellow-800', indicator: 'bg-yellow-400', text: 'text-yellow-600 dark:text-yellow-400' },
    { id: 'blue', bg: 'bg-blue-50 dark:bg-blue-950/30', border: 'border-blue-200 dark:border-blue-800', indicator: 'bg-blue-400', text: 'text-blue-600 dark:text-blue-400' },
    { id: 'green', bg: 'bg-green-50 dark:bg-green-950/30', border: 'border-green-200 dark:border-green-800', indicator: 'bg-green-400', text: 'text-green-600 dark:text-green-400' },
    { id: 'red', bg: 'bg-red-50 dark:bg-red-950/30', border: 'border-red-200 dark:border-red-800', indicator: 'bg-red-400', text: 'text-red-600 dark:text-red-400' },
    { id: 'purple', bg: 'bg-purple-50 dark:bg-purple-950/30', border: 'border-purple-200 dark:border-purple-800', indicator: 'bg-purple-400', text: 'text-purple-600 dark:text-purple-400' },
];

export const OverviewPanel: React.FC<OverviewPanelProps> = ({ project, onNavigate }) => {
    const [notes, setNotes] = useState<ProjectNote[]>([]);
    const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
    const [isGitLoading, setIsGitLoading] = useState(false);
    const [processes, setProcesses] = useState<Process[]>([]);

    useEffect(() => {
        invokeCommand<ProjectNote[]>('get_project_notes', { projectId: project.id })
            .then(setNotes)
            .catch(console.error);
        
        loadGitStatus();
        loadProcesses();
        
        // Refresh processes periodically to keep status live
        const interval = setInterval(loadProcesses, 3000);
        return () => clearInterval(interval);
    }, [project.id, project.path]);

    const loadGitStatus = () => {
        setIsGitLoading(true);
        invokeCommand<GitStatus | null>('get_git_status', { path: project.path })
            .then(setGitStatus)
            .catch(err => console.error("Git status failed", err))
            .finally(() => setIsGitLoading(false));
    };

    const loadProcesses = async () => {
        try {
            const data = await invokeCommand<Process[]>('get_active_processes', { projectId: project.id });
            setProcesses(data.filter(p => p.running)); // Only show running ones or filtered by active state? Backend usually returns all tracked.
            // Actually get_active_processes might return active ones? Or all? Let's assume all tracked.
            // But we want to show "Running Processes".
        } catch (e) {
            console.error("Failed to load processes", e);
        }
    };

    const labels = useMemo(() => {
        if (!project.settings) return DEFAULT_LABELS;
        try {
            const parsed: ProjectSettings = JSON.parse(project.settings);
            return { ...DEFAULT_LABELS, ...parsed.note_labels };
        } catch (e) {
            return DEFAULT_LABELS;
        }
    }, [project.settings]);

    const noteStats = useMemo(() => {
        const stats: Record<string, number> = {};
        notes.forEach(note => {
            stats[note.color] = (stats[note.color] || 0) + 1;
        });
        return stats;
    }, [notes]);

    const handleLaunchTerminal = async () => {
        try {
            await invokeCommand('open_external_terminal', { path: project.path });
        } catch (e) {
            console.error(e);
            toast.error("Failed to launch terminal");
        }
    };

    const handleOpenEditor = async () => {
        try {
            await invokeCommand('open_in_editor', { path: project.path });
            toast.success("Opening Editor...");
        } catch (e) {
            console.error(e);
            toast.error("Failed to open editor");
        }
    };

    const handleReveal = async () => {
        try {
            await invokeCommand('reveal_in_finder', { path: project.path });
        } catch (e) {
            console.error(e);
            toast.error("Failed to reveal directory");
        }
    };

    const activeProcessCount = processes.filter(p => p.running).length;

    return (
        <div className="h-full w-full p-4 overflow-y-auto bg-muted/5 scrollbar-thin">
            <div className="max-w-5xl mx-auto space-y-6">
                
                {/* Header Section */}
                <div className="flex flex-row items-center justify-between">
                    <div className="flex items-center gap-3">
                        <FolderOpen className="w-8 h-8 text-primary/80" />
                        <div>
                            <h1 className="text-2xl font-bold tracking-tight text-foreground">{project.name}</h1>
                            <div className="text-xs text-muted-foreground font-mono truncate max-w-md flex items-center gap-2">
                                {project.path}
                                <Button variant="ghost" size="icon" className="h-4 w-4" onClick={handleReveal} title="Reveal in Finder">
                                    <ExternalLink className="w-3 h-3" />
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Quick Actions Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-3">
                    <motion.div whileHover={{ y: -1 }} transition={{ duration: 0.2 }}>
                        <Card className="hover:border-primary/50 transition-colors cursor-pointer group shadow-sm h-full" onClick={handleLaunchTerminal}>
                            <CardHeader className="p-4 pb-2">
                                <CardTitle className="text-sm font-medium flex items-center gap-2">
                                    <Terminal className="w-4 h-4 text-blue-500" />
                                    Terminal
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="p-4 pt-0">
                                <p className="text-xs text-muted-foreground mb-3">Integrated shell access</p>
                                <Button variant="secondary" size="sm" className="w-full h-8 text-xs" onClick={(e) => {
                                    e.stopPropagation();
                                    handleLaunchTerminal();
                                }}>Launch External</Button>
                            </CardContent>
                        </Card>
                    </motion.div>

                    <motion.div whileHover={{ y: -1 }} transition={{ duration: 0.2 }}>
                        <Card className="hover:border-primary/50 transition-colors cursor-pointer group shadow-sm h-full" onClick={handleOpenEditor}>
                            <CardHeader className="p-4 pb-2">
                                <CardTitle className="text-sm font-medium flex items-center gap-2">
                                    <svg className="w-4 h-4 text-blue-600" viewBox="0 0 24 24" fill="currentColor"><path d="M23.15 2.587L18.21.21a1.494 1.494 0 0 0-1.705.29l-9.46 8.63-4.12-3.128a1.5 1.5 0 0 0-1.722.289L.325 7.96a1.5 1.5 0 0 0 .194 2.292l6.236 5.06-6.73 5.42a1.5 1.5 0 0 0 .195 2.293l1.166 1.054a1.499 1.499 0 0 0 2.016.03l6.216-5.06 4.16 3.127a1.495 1.495 0 0 0 1.706-.29l9.49-8.61a1.5 1.5 0 0 0-.17-2.689zM8.54 13.568L2.91 9.3l.858-.756 8.13 6.175zM21.16 3.65l-9.516 8.63-9.5-8.63 1.16 1.054 8.35 6.34-8.35-6.34L21.16 3.65z"/></svg>
                                    Editor
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="p-4 pt-0">
                                <p className="text-xs text-muted-foreground mb-3">Open Visual Studio Code</p>
                                <Button variant="secondary" size="sm" className="w-full h-8 text-xs">Open Code</Button>
                            </CardContent>
                        </Card>
                    </motion.div>

                    <motion.div whileHover={{ y: -1 }} transition={{ duration: 0.2 }}>
                        <Card className="hover:border-primary/50 transition-colors cursor-pointer group shadow-sm h-full" onClick={() => onNavigate('notes')}>
                            <CardHeader className="p-4 pb-2">
                                <CardTitle className="text-sm font-medium flex items-center gap-2">
                                    <ScrollText className="w-4 h-4 text-yellow-500" />
                                    Notes
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="p-4 pt-0">
                                <p className="text-xs text-muted-foreground mb-3">
                                    {notes.length === 0 ? "No notes yet" : `${notes.length} note${notes.length === 1 ? '' : 's'} recorded`}
                                </p>
                                <Button variant="secondary" size="sm" className="w-full h-8 text-xs">Manage Notes</Button>
                            </CardContent>
                        </Card>
                    </motion.div>

                    <motion.div whileHover={{ y: -1 }} transition={{ duration: 0.2 }}>
                        <Card className="hover:border-primary/50 transition-colors cursor-pointer group shadow-sm h-full" onClick={() => onNavigate('processes')}>
                            <CardHeader className="p-4 pb-2">
                                <CardTitle className="text-sm font-medium flex items-center gap-2">
                                    <Cpu className="w-4 h-4 text-green-500" />
                                    Processes
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="p-4 pt-0">
                                <div className="flex items-center gap-2 mb-3">
                                    <span className="text-xs text-muted-foreground">{activeProcessCount > 0 ? `${activeProcessCount} active` : "Idle"}</span>
                                    {activeProcessCount > 0 && (
                                        <span className="flex h-2 w-2">
                                            <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-green-400 opacity-75"></span>
                                            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                                        </span>
                                    )}
                                </div>
                                <Button variant="secondary" size="sm" className="w-full h-8 text-xs">Manage Tasks</Button>
                            </CardContent>
                        </Card>
                    </motion.div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {/* Git Pulse Card */}
                    <Card className="border-border/50 bg-card/50 shadow-sm md:col-span-3">
                         <CardHeader className="p-4 py-3 border-b border-border/50 flex flex-row items-center justify-between">
                            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                                <GitBranch className="w-3.5 h-3.5" />
                                Repository
                            </CardTitle>
                            <Button variant="ghost" size="icon" className="h-6 w-6 -mr-2" onClick={loadGitStatus} disabled={isGitLoading}>
                                <RefreshCw className={`w-3 h-3 ${isGitLoading ?'animate-spin' : ''}`} />
                            </Button>
                        </CardHeader>
                        <CardContent className="p-4">
                            {gitStatus ? (
                                <div className="space-y-4">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <GitBranch className="w-4 h-4 text-primary" />
                                            <span className="font-mono text-sm font-semibold">{gitStatus.branch}</span>
                                        </div>
                                        {gitStatus.modified_count > 0 ? (
                                            <span className="text-xs text-yellow-500 font-medium">{gitStatus.modified_count} modified</span>
                                        ) : (
                                            <span className="text-xs text-green-500 font-medium">Clean</span>
                                        )}
                                    </div>
                                    
                                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                                        <div className="flex items-center gap-1" title="Ahead of remote">
                                            <ArrowUp className={`w-3 h-3 ${gitStatus.ahead > 0 ? 'text-blue-500' : ''}`} />
                                            {gitStatus.ahead}
                                        </div>
                                        <div className="flex items-center gap-1" title="Behind remote">
                                            <ArrowDown className={`w-3 h-3 ${gitStatus.behind > 0 ? 'text-red-500' : ''}`} />
                                            {gitStatus.behind}
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="flex flex-col items-center justify-center py-6 text-muted-foreground space-y-2">
                                    <GitBranch className="w-8 h-8 opacity-20" />
                                    <p className="text-xs">Not a git repository</p>
                                    <Button variant="link" size="sm" className="h-auto p-0 text-xs">Initialize Git</Button>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* Project Status / Health */}
                    <Card className="border-border/50 bg-card/50 shadow-sm md:col-span-3">
                        <CardHeader className="p-4 py-3 border-b border-border/50">
                            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                                <Activity className="w-3.5 h-3.5" />
                                Project Status
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="p-0">
                            {notes.length === 0 ? (
                                <div className="p-8 text-xs text-muted-foreground text-center italic flex flex-col items-center gap-2">
                                    <Tag className="w-8 h-8 opacity-20" />
                                    Create notes with labels to see project health stats here.
                                </div>
                            ) : (
                                <div className="grid grid-cols-2 md:grid-cols-5 divide-x divide-border/50">
                                    {COLORS.map(c => {
                                        const count = noteStats[c.id] || 0;
                                        const label = labels[c.id] || c.id;
                                        
                                        return (
                                            <div key={c.id} className="p-4 flex flex-col items-center justify-center gap-1 hover:bg-muted/50 transition-colors">
                                                <div className={`text-2xl font-bold ${c.text}`}>
                                                    {count}
                                                </div>
                                                <div className="flex items-center gap-1.5">
                                                    <div className={`w-2 h-2 rounded-full ${c.indicator}`} />
                                                    <span className="text-xs font-medium text-muted-foreground capitalize truncate max-w-[80px]" title={label}>
                                                        {label}
                                                    </span>
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
};
