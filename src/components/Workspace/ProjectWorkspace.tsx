import React, { useState, useMemo, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../ui/dialog';
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
import {
    FolderOpen, ScrollText, Play, LayoutDashboard, Lock, GitBranch,
    Terminal, Rocket, Database, Bot, PanelLeftClose, PanelLeft,
    type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { ErrorBoundary } from '../ui/error-boundary';

interface NavItem {
    id: string;
    label: string;
    icon: LucideIcon;
}

interface NavGroup {
    label: string;
    items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
    {
        label: 'Core',
        items: [
            { id: 'overview', label: 'Overview', icon: LayoutDashboard },
            { id: 'agent', label: 'Agent', icon: Bot },
        ],
    },
    {
        label: 'Infrastructure',
        items: [
            { id: 'processes', label: 'Processes', icon: Terminal },
            { id: 'database', label: 'Databases', icon: Database },
            { id: 'keys', label: 'Keys & Secrets', icon: Lock },
        ],
    },
    {
        label: 'Development',
        items: [
            { id: 'git', label: 'Git', icon: GitBranch },
            { id: 'scripts', label: 'Scripts', icon: Play },
            { id: 'launchpad', label: 'Launchpad', icon: Rocket },
        ],
    },
    {
        label: 'Content',
        items: [
            { id: 'notes', label: 'Notes', icon: ScrollText },
            { id: 'snippets', label: 'Snippets', icon: ScrollText },
        ],
    },
];

interface ProjectWorkspaceProps {
    project: Project;
    onClose: () => void;
}

export const ProjectWorkspace: React.FC<ProjectWorkspaceProps> = ({ project, onClose }) => {
    const [activeTab, setActiveTab] = useState('overview');
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

    const handleRunSnippet = useCallback(async (command: string) => {
        try {
            await navigator.clipboard.writeText(command);
            toast.success("Command copied to clipboard!");
        } catch {
            toast.error("Failed to copy command");
        }
    }, []);

    const panelContent = useMemo(() => {
        switch (activeTab) {
            case 'overview':
                return <OverviewPanel project={project} onNavigate={setActiveTab} />;
            case 'launchpad':
                return <LaunchpadPanel projectId={project.id} projectPath={project.path} />;
            case 'agent':
                return <AgentPanel projectId={project.id} project={project} />;
            case 'scripts':
                return <ScriptRunner path={project.path} onNavigate={setActiveTab} />;
            case 'git':
                return <GitPanel path={project.path} />;
            case 'keys':
                return <KeysPanel projectId={project.id} />;
            case 'snippets':
                return <SnippetsPanel projectId={project.id} onRun={handleRunSnippet} />;
            case 'notes':
                return <NotesPanel projectId={project.id} />;
            case 'processes':
                return <ProcessManager path={project.path} projectId={project.id} />;
            case 'database':
                return <DatabasePanel projectId={project.id} />;
            default:
                return null;
        }
    }, [activeTab, project, handleRunSnippet]);

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

                <div className="flex-1 overflow-hidden flex flex-row">
                    {/* Sidebar Navigation */}
                    <nav className={`${sidebarCollapsed ? 'w-12' : 'w-48'} shrink-0 border-r border-border/40 bg-muted/10 flex flex-col transition-all duration-200`}>
                        <div className="flex-1 overflow-y-auto py-2">
                            {NAV_GROUPS.map((group) => (
                                <div key={group.label} className="mb-1">
                                    {!sidebarCollapsed && (
                                        <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                                            {group.label}
                                        </div>
                                    )}
                                    {group.items.map((item) => {
                                        const Icon = item.icon;
                                        const isActive = activeTab === item.id;
                                        return (
                                            <button
                                                key={item.id}
                                                onClick={() => setActiveTab(item.id)}
                                                title={sidebarCollapsed ? item.label : undefined}
                                                className={`w-full flex items-center gap-2.5 text-xs font-medium transition-colors ${
                                                    sidebarCollapsed ? 'justify-center px-0 py-2 mx-auto' : 'px-3 py-1.5'
                                                } ${
                                                    isActive
                                                        ? 'text-primary bg-primary/10 border-r-2 border-primary'
                                                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                                                }`}
                                            >
                                                <Icon className="w-3.5 h-3.5 shrink-0" />
                                                {!sidebarCollapsed && item.label}
                                            </button>
                                        );
                                    })}
                                </div>
                            ))}
                        </div>
                        <button
                            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                            className="p-2 border-t border-border/40 text-muted-foreground hover:text-foreground transition-colors flex items-center justify-center"
                            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                        >
                            {sidebarCollapsed ? <PanelLeft className="w-3.5 h-3.5" /> : <PanelLeftClose className="w-3.5 h-3.5" />}
                        </button>
                    </nav>

                    {/* Panel Content */}
                    <div className="flex-1 overflow-hidden bg-background relative">
                        <ErrorBoundary key={activeTab}>
                            {panelContent}
                        </ErrorBoundary>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
};
