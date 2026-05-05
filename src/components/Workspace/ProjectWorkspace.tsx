import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '../ui/tabs';
import { OverviewPanel } from './OverviewPanel';
import { GitPanel } from './GitPanel';
import { KeysPanel } from './KeysPanel';
import { SnippetsPanel } from './SnippetsPanel';
import { NotesPanel } from './NotesPanel';
import { ScriptRunner } from './ScriptRunner';
import { ProcessManager } from './ProcessManager';
import { LaunchpadPanel } from './LaunchpadPanel';
import { DatabasePanel } from './DatabasePanel';
import { AgentPanel } from './AgentPanel';
import type { Project } from '../../types';
import { FolderOpen, ScrollText, Play, LayoutDashboard, Lock, GitBranch, Terminal, Rocket, Database, Bot } from 'lucide-react';
import { toast } from 'sonner';
import { ErrorBoundary } from '../ui/error-boundary';

interface ProjectWorkspaceProps {
    project: Project;
    onClose: () => void;
}

export const ProjectWorkspace: React.FC<ProjectWorkspaceProps> = ({ project, onClose }) => {
    const [activeTab, setActiveTab] = useState('overview');

    const handleRunSnippet = async (command: string) => {
        try {
            await navigator.clipboard.writeText(command);
            toast.success("Command copied to clipboard!");
        } catch (err) {
            toast.error("Failed to copy command");
        }
    };

    return (
        <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-[95vw] md:max-w-7xl h-[90vh] flex flex-col p-0 gap-0 border-border bg-background overflow-hidden shadow-2xl">
                <DialogHeader className="px-4 py-3 border-b border-border bg-muted/20 flex flex-row items-center justify-between shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="flex gap-1.5 mr-2">
                            <div className="w-3 h-3 rounded-full bg-red-500/20 border border-red-500/50" />
                            <div className="w-3 h-3 rounded-full bg-yellow-500/20 border border-yellow-500/50" />
                            <div className="w-3 h-3 rounded-full bg-green-500/20 border border-green-500/50" />
                        </div>
                        <DialogTitle className="text-sm font-medium flex items-center gap-2">
                            <FolderOpen className="w-4 h-4 text-primary" />
                            {project.name}
                        </DialogTitle>
                        <DialogDescription className="hidden">Project Workspace</DialogDescription>
                    </div>
                </DialogHeader>

                <div className="flex-1 overflow-hidden flex flex-col">
                    <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
                        <div className="px-4 py-2 border-b border-border/40 bg-muted/20">
                            <TabsList className="bg-muted/50">
                                <TabsTrigger value="overview" className="gap-2">
                                    <LayoutDashboard className="w-3.5 h-3.5" />
                                    Overview
                                </TabsTrigger>
                                <TabsTrigger value="launchpad" className="gap-2">
                                    <Rocket className="w-3.5 h-3.5" />
                                    Launchpad
                                </TabsTrigger>
                                <TabsTrigger value="agent" className="gap-2">
                                    <Bot className="w-3.5 h-3.5" />
                                    Agent
                                </TabsTrigger>
                                <TabsTrigger value="scripts" className="gap-2">
                                    <Play className="w-3.5 h-3.5" />
                                    Scripts
                                </TabsTrigger>
                                <TabsTrigger value="git" className="gap-2">
                                    <GitBranch className="w-3.5 h-3.5" />
                                    Git
                                </TabsTrigger>
                                <TabsTrigger value="keys" className="gap-2">
                                    <Lock className="w-3.5 h-3.5" />
                                    Keys
                                </TabsTrigger>
                                <TabsTrigger value="snippets" className="gap-2">
                                    <ScrollText className="w-3.5 h-3.5" />
                                    Snippets
                                </TabsTrigger>
                                <TabsTrigger value="notes" className="gap-2">
                                    <ScrollText className="w-3.5 h-3.5" />
                                    Notes
                                </TabsTrigger>
                                <TabsTrigger value="processes" className="gap-2">
                                    <Terminal className="w-3.5 h-3.5" />
                                    Processes
                                </TabsTrigger>
                                <TabsTrigger value="database" className="gap-2">
                                    <Database className="w-3.5 h-3.5" />
                                    Databases
                                </TabsTrigger>
                            </TabsList>
                        </div>
                        
                        <div className="flex-1 overflow-hidden p-0 bg-background relative">
                            {activeTab === 'overview' && (
                                <ErrorBoundary>
                                    <OverviewPanel project={project} onNavigate={setActiveTab} />
                                </ErrorBoundary>
                            )}

                            <div className={activeTab === 'launchpad' ? 'h-full' : 'hidden h-full'}>
                                {activeTab === 'launchpad' && (
                                    <ErrorBoundary>
                                        <LaunchpadPanel projectId={project.id} projectPath={project.path} />
                                    </ErrorBoundary>
                                )}
                            </div>

                            <div className={activeTab === 'agent' ? 'h-full' : 'hidden h-full'}>
                                {activeTab === 'agent' && (
                                    <ErrorBoundary>
                                        <AgentPanel projectId={project.id} project={project} />
                                    </ErrorBoundary>
                                )}
                            </div>

                            <div className={activeTab === 'scripts' ? 'h-full' : 'hidden h-full'}>
                                {activeTab === 'scripts' && (
                                    <ErrorBoundary>
                                        <ScriptRunner path={project.path} onNavigate={setActiveTab} />
                                    </ErrorBoundary>
                                )}
                            </div>

                            <div className={activeTab === 'git' ? 'h-full' : 'hidden h-full'}>
                                {activeTab === 'git' && (
                                    <ErrorBoundary>
                                        <GitPanel path={project.path} />
                                    </ErrorBoundary>
                                )}
                            </div>

                            <div className={activeTab === 'keys' ? 'h-full' : 'hidden h-full'}>
                                {activeTab === 'keys' && (
                                    <ErrorBoundary>
                                        <KeysPanel
                                            projectId={project.id}
                                        />
                                    </ErrorBoundary>
                                )}
                            </div>

                            <div className={activeTab === 'snippets' ? 'h-full' : 'hidden h-full'}>
                                {activeTab === 'snippets' && (
                                    <ErrorBoundary>
                                        <SnippetsPanel
                                            projectId={project.id}
                                            onRun={handleRunSnippet}
                                        />
                                    </ErrorBoundary>
                                )}
                            </div>

                            <div className={activeTab === 'notes' ? 'h-full' : 'hidden h-full'}>
                                {activeTab === 'notes' && (
                                    <ErrorBoundary>
                                        <NotesPanel
                                            projectId={project.id}
                                        />
                                    </ErrorBoundary>
                                )}
                            </div>

                            <div className={activeTab === 'processes' ? 'h-full' : 'hidden h-full'}>
                                {activeTab === 'processes' && (
                                    <ErrorBoundary>
                                        <ProcessManager path={project.path} projectId={project.id} />
                                    </ErrorBoundary>
                                )}
                            </div>

                            <div className={activeTab === 'database' ? 'h-full' : 'hidden h-full'}>
                                {activeTab === 'database' && (
                                    <ErrorBoundary>
                                        <DatabasePanel projectId={project.id} />
                                    </ErrorBoundary>
                                )}
                            </div>
                        </div>
                    </Tabs>
                </div>
            </DialogContent>
        </Dialog>
    );
};
