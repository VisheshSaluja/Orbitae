import React, { useState, useMemo, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../ui/dialog';
import { CommandCenterPanel } from './CommandCenterPanel';
import { AgentPanel } from './AgentPanel';
import { WorkspacePanel } from './WorkspacePanel';
import { SettingsPanel } from './SettingsPanel';
import type { Project } from '../../types';
import {
    FolderOpen, PanelLeftClose, PanelLeft,
    Rocket, Bot, ScrollText, Settings,
    type LucideIcon,
} from 'lucide-react';
import { ErrorBoundary } from '../ui/error-boundary';

interface NavItem {
    id: string;
    label: string;
    icon: LucideIcon;
    description: string;
}

const NAV_ITEMS: NavItem[] = [
    { id: 'command-center', label: 'Command Center', icon: Rocket, description: 'Project cockpit' },
    { id: 'agent', label: 'Agent', icon: Bot, description: 'AI assistant' },
    { id: 'workspace', label: 'Workspace', icon: ScrollText, description: 'Notes & knowledge' },
    { id: 'settings', label: 'Settings', icon: Settings, description: 'Configuration' },
];

interface ProjectWorkspaceProps {
    project: Project;
    onClose: () => void;
}

export const ProjectWorkspace: React.FC<ProjectWorkspaceProps> = ({ project, onClose }) => {
    const [activeTab, setActiveTab] = useState('command-center');
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

    const handleNavigate = useCallback((tab: string) => {
        setActiveTab(tab);
    }, []);

    const panelContent = useMemo(() => {
        switch (activeTab) {
            case 'command-center':
                return <CommandCenterPanel project={project} onNavigate={handleNavigate} />;
            case 'agent':
                return <AgentPanel projectId={project.id} project={project} onNavigate={handleNavigate} />;
            case 'workspace':
                return <WorkspacePanel projectId={project.id} projectPath={project.path} />;
            case 'settings':
                return <SettingsPanel projectId={project.id} />;
            default:
                return null;
        }
    }, [activeTab, project, handleNavigate]);

    return (
        <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-[95vw] md:max-w-7xl h-[90vh] flex flex-col p-0 gap-0 border-border bg-background overflow-hidden shadow-2xl">
                <DialogHeader className="px-4 py-2.5 border-b border-border/40 bg-background flex flex-row items-center justify-between shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="flex gap-1.5 mr-2">
                            <div className="w-3 h-3 rounded-full bg-red-500/20 border border-red-500/40 hover:bg-red-500/60 transition-colors cursor-pointer" onClick={onClose} />
                            <div className="w-3 h-3 rounded-full bg-yellow-500/20 border border-yellow-500/40" />
                            <div className="w-3 h-3 rounded-full bg-green-500/20 border border-green-500/40" />
                        </div>
                        <DialogTitle className="text-sm font-medium flex items-center gap-2 text-foreground/90">
                            <FolderOpen className="w-4 h-4 text-primary" />
                            {project.name}
                        </DialogTitle>
                        <DialogDescription className="hidden">Project Workspace</DialogDescription>
                    </div>
                </DialogHeader>

                <div className="flex-1 overflow-hidden flex flex-row">
                    {/* Sidebar */}
                    <nav className={`${sidebarCollapsed ? 'w-14' : 'w-52'} shrink-0 border-r border-border/30 bg-muted/5 flex flex-col transition-all duration-200`}>
                        <div className="flex-1 py-3 px-2 space-y-1">
                            {NAV_ITEMS.map((item) => {
                                const Icon = item.icon;
                                const isActive = activeTab === item.id;
                                return (
                                    <button
                                        key={item.id}
                                        onClick={() => setActiveTab(item.id)}
                                        title={sidebarCollapsed ? item.label : undefined}
                                        className={`w-full flex items-center gap-3 rounded-lg text-xs font-medium transition-all duration-150 ${
                                            sidebarCollapsed ? 'justify-center p-2.5' : 'px-3 py-2.5'
                                        } ${
                                            isActive
                                                ? 'bg-primary/10 text-primary shadow-sm shadow-primary/5'
                                                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                                        }`}
                                    >
                                        <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-primary' : ''}`} />
                                        {!sidebarCollapsed && (
                                            <div className="text-left min-w-0">
                                                <div className={`text-[13px] leading-tight ${isActive ? 'font-semibold' : 'font-medium'}`}>
                                                    {item.label}
                                                </div>
                                                <div className="text-[10px] text-muted-foreground/60 mt-0.5">
                                                    {item.description}
                                                </div>
                                            </div>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                        <button
                            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                            className="p-3 border-t border-border/30 text-muted-foreground/40 hover:text-muted-foreground transition-colors flex items-center justify-center"
                            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                        >
                            {sidebarCollapsed ? <PanelLeft className="w-3.5 h-3.5" /> : <PanelLeftClose className="w-3.5 h-3.5" />}
                        </button>
                    </nav>

                    {/* Panel */}
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
