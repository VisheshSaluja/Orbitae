import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { CommandCenterPanel } from './CommandCenterPanel';
import { AgentPanel } from './AgentPanel';
import { WorkspacePanel } from './WorkspacePanel';
import { SettingsPanel } from './SettingsPanel';
import { TerminalTab } from './TerminalTab';
import type { Project } from '../../types';
import {
    ChevronLeft, FolderOpen, PanelLeftClose, PanelLeft,
    Rocket, Bot, Terminal, ScrollText, Settings, Search,
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
    { id: 'terminal', label: 'Terminal', icon: Terminal, description: 'Shell access' },
    { id: 'workspace', label: 'Workspace', icon: ScrollText, description: 'Notes & knowledge' },
    { id: 'settings', label: 'Settings', icon: Settings, description: 'Configuration' },
];

interface ProjectWorkspaceProps {
    project: Project;
    onClose: () => void;
}

interface CommandAction {
    id: string;
    label: string;
    icon: LucideIcon;
    section: string;
    action: () => void;
}

export const ProjectWorkspace: React.FC<ProjectWorkspaceProps> = ({ project, onClose }) => {
    const [activeTab, setActiveTab] = useState('command-center');
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const [paletteOpen, setPaletteOpen] = useState(false);
    const [paletteQuery, setPaletteQuery] = useState('');
    const [paletteIndex, setPaletteIndex] = useState(0);
    const paletteInputRef = useRef<HTMLInputElement>(null);

    const handleNavigate = useCallback((tab: string) => {
        setActiveTab(tab);
    }, []);

    const commandActions: CommandAction[] = useMemo(() => [
        { id: 'nav-command-center', label: 'Go to Command Center', icon: Rocket, section: 'Navigation', action: () => setActiveTab('command-center') },
        { id: 'nav-agent', label: 'Go to Agent', icon: Bot, section: 'Navigation', action: () => setActiveTab('agent') },
        { id: 'nav-terminal', label: 'Go to Terminal', icon: Terminal, section: 'Navigation', action: () => setActiveTab('terminal') },
        { id: 'nav-workspace', label: 'Go to Workspace', icon: ScrollText, section: 'Navigation', action: () => setActiveTab('workspace') },
        { id: 'nav-settings', label: 'Go to Settings', icon: Settings, section: 'Navigation', action: () => setActiveTab('settings') },
        { id: 'toggle-sidebar', label: 'Toggle Sidebar', icon: PanelLeft, section: 'View', action: () => setSidebarCollapsed(p => !p) },
        { id: 'close-project', label: 'Close Project', icon: FolderOpen, section: 'Project', action: onClose },
    ], [onClose]);

    const filteredActions = useMemo(() => {
        if (!paletteQuery.trim()) return commandActions;
        const q = paletteQuery.toLowerCase();
        return commandActions.filter(a => a.label.toLowerCase().includes(q) || a.section.toLowerCase().includes(q));
    }, [paletteQuery, commandActions]);

    useEffect(() => {
        setPaletteIndex(0);
    }, [paletteQuery]);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault();
                setPaletteOpen(prev => !prev);
                setPaletteQuery('');
            }
            if ((e.metaKey || e.ctrlKey) && e.key === 't') {
                e.preventDefault();
                setActiveTab('terminal');
            }
            if ((e.metaKey || e.ctrlKey) && e.key >= '1' && e.key <= '5') {
                e.preventDefault();
                const idx = parseInt(e.key) - 1;
                if (NAV_ITEMS[idx]) setActiveTab(NAV_ITEMS[idx].id);
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, []);

    useEffect(() => {
        if (paletteOpen) {
            setTimeout(() => paletteInputRef.current?.focus(), 50);
        }
    }, [paletteOpen]);

    const executePaletteAction = useCallback((action: CommandAction) => {
        action.action();
        setPaletteOpen(false);
        setPaletteQuery('');
    }, []);

    const handlePaletteKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setPaletteIndex(i => Math.min(i + 1, filteredActions.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setPaletteIndex(i => Math.max(i - 1, 0));
        } else if (e.key === 'Enter' && filteredActions[paletteIndex]) {
            e.preventDefault();
            executePaletteAction(filteredActions[paletteIndex]);
        } else if (e.key === 'Escape') {
            setPaletteOpen(false);
        }
    }, [filteredActions, paletteIndex, executePaletteAction]);

    const panelContent = useMemo(() => {
        switch (activeTab) {
            case 'command-center':
                return <CommandCenterPanel project={project} onNavigate={handleNavigate} />;
            case 'agent':
                return <AgentPanel projectId={project.id} project={project} onNavigate={handleNavigate} />;
            case 'terminal':
                return <TerminalTab projectId={project.id} projectPath={project.path} />;
            case 'workspace':
                return <WorkspacePanel projectId={project.id} projectPath={project.path} />;
            case 'settings':
                return <SettingsPanel projectId={project.id} />;
            default:
                return null;
        }
    }, [activeTab, project, handleNavigate]);

    return (
        <div className="flex flex-col h-screen bg-background">
            {/* Title bar — breadcrumb navigation */}
            <header className="h-11 shrink-0 border-b border-border/40 bg-background flex items-center justify-between px-4 select-none">
                <div className="flex items-center gap-3">
                    <button
                        onClick={onClose}
                        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                        <ChevronLeft className="w-3.5 h-3.5" />
                        Projects
                    </button>
                    <span className="text-border/60">/</span>
                    <span className="text-sm font-medium flex items-center gap-2 text-foreground/90">
                        <FolderOpen className="w-4 h-4 text-primary" />
                        {project.name}
                    </span>
                </div>
                <div className="flex items-center gap-2">
                    <kbd className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border/40">
                        {navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}K
                    </kbd>
                </div>
            </header>

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

            {/* Command palette — fixed overlay */}
            {paletteOpen && (
                <div
                    className="fixed inset-0 z-[9999] flex items-start justify-center pt-[20vh]"
                    onClick={() => setPaletteOpen(false)}
                    onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === 'Escape') setPaletteOpen(false);
                    }}
                >
                    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" />
                    <div
                        className="relative w-full max-w-lg bg-background border border-border rounded-xl shadow-2xl overflow-hidden"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="flex items-center gap-3 px-4 py-3 border-b border-border/40">
                            <Search className="w-4 h-4 text-muted-foreground shrink-0" />
                            <input
                                ref={paletteInputRef}
                                type="text"
                                value={paletteQuery}
                                onChange={e => setPaletteQuery(e.target.value)}
                                onKeyDown={(e) => {
                                    e.stopPropagation();
                                    handlePaletteKeyDown(e);
                                }}
                                placeholder="Type a command..."
                                className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
                                autoFocus
                            />
                            <kbd className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border/40">ESC</kbd>
                        </div>
                        <div className="max-h-64 overflow-y-auto py-1">
                            {filteredActions.length === 0 && (
                                <p className="text-sm text-muted-foreground text-center py-6">No matching commands</p>
                            )}
                            {filteredActions.map((action, idx) => {
                                const Icon = action.icon;
                                return (
                                    <button
                                        key={action.id}
                                        onClick={() => executePaletteAction(action)}
                                        className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                                            idx === paletteIndex ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-muted/50'
                                        }`}
                                    >
                                        <Icon className="w-4 h-4 shrink-0" />
                                        <span className="flex-1 text-left">{action.label}</span>
                                        <span className="text-[10px] text-muted-foreground/50">{action.section}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
