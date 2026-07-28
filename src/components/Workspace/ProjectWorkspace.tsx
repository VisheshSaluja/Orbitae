import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { TerminalTab } from './TerminalTab';
import { ContextPanel } from './ContextPanel';
import { ConnectPanel } from './ConnectPanel';
import type { Project } from '../../types';
import {
    ChevronLeft, FolderOpen, Bot, FileText, Database, Search,
    Download, Upload,
    type LucideIcon,
} from 'lucide-react';
import { ErrorBoundary } from '../ui/error-boundary';
import { invokeCommand } from '../../lib/tauri';
import { toast } from 'sonner';

interface TabItem {
    id: string;
    label: string;
    icon: LucideIcon;
}

const TABS: TabItem[] = [
    { id: 'agents', label: 'Agents', icon: Bot },
    { id: 'context', label: 'Context', icon: FileText },
    { id: 'connect', label: 'Connect', icon: Database },
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
    const [activeTab, setActiveTab] = useState('agents');
    const [paletteOpen, setPaletteOpen] = useState(false);
    const [paletteQuery, setPaletteQuery] = useState('');
    const [paletteIndex, setPaletteIndex] = useState(0);
    const paletteInputRef = useRef<HTMLInputElement>(null);

    const handleExport = useCallback(async () => {
        try {
            const path = await invokeCommand<string>('export_project', { projectId: project.id });
            toast.success(`Exported to ${path}`);
        } catch (err) {
            toast.error(`Export failed: ${err}`);
        }
    }, [project.id]);

    const handleImport = useCallback(async () => {
        try {
            const { open } = await import('@tauri-apps/plugin-dialog');
            const selected = await open({
                filters: [{ name: 'Orbitae', extensions: ['orbitae'] }],
                multiple: false,
            });
            if (!selected || typeof selected !== 'string') return;
            const result = await invokeCommand<{
                imported_envs: number;
                imported_notes: number;
                imported_playbooks: number;
                vault_keys_needed: string[];
            }>('import_project_bundle', { projectId: project.id, filePath: selected });
            let msg = `Imported: ${result.imported_envs} env vars, ${result.imported_notes} notes, ${result.imported_playbooks} runbooks`;
            if (result.vault_keys_needed.length > 0) {
                msg += `. Vault keys needed: ${result.vault_keys_needed.join(', ')}`;
            }
            toast.success(msg);
        } catch (err) {
            toast.error(`Import failed: ${err}`);
        }
    }, [project.id]);

    const commandActions: CommandAction[] = useMemo(() => [
        { id: 'nav-agents', label: 'Go to Agents', icon: Bot, section: 'Navigation', action: () => setActiveTab('agents') },
        { id: 'nav-context', label: 'Go to Context', icon: FileText, section: 'Navigation', action: () => setActiveTab('context') },
        { id: 'nav-connect', label: 'Go to Connect', icon: Database, section: 'Navigation', action: () => setActiveTab('connect') },
        { id: 'export-project', label: 'Export .orbitae', icon: Download, section: 'Project', action: handleExport },
        { id: 'import-project', label: 'Import .orbitae', icon: Upload, section: 'Project', action: handleImport },
        { id: 'close-project', label: 'Close Project', icon: FolderOpen, section: 'Project', action: onClose },
    ], [onClose, handleExport, handleImport]);

    const filteredActions = useMemo(() => {
        if (!paletteQuery.trim()) return commandActions;
        const q = paletteQuery.toLowerCase();
        return commandActions.filter(a => a.label.toLowerCase().includes(q));
    }, [paletteQuery, commandActions]);

    useEffect(() => { setPaletteIndex(0); }, [paletteQuery]);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault();
                setPaletteOpen(prev => !prev);
                setPaletteQuery('');
            }
            if ((e.metaKey || e.ctrlKey) && e.key >= '1' && e.key <= '3') {
                e.preventDefault();
                const idx = parseInt(e.key) - 1;
                if (TABS[idx]) setActiveTab(TABS[idx].id);
            }
            if ((e.metaKey || e.ctrlKey) && e.key === 'e') {
                e.preventDefault();
                handleExport();
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [handleExport]);

    useEffect(() => {
        if (paletteOpen) setTimeout(() => paletteInputRef.current?.focus(), 50);
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
            case 'agents':
                return <TerminalTab projectId={project.id} projectPath={project.path} />;
            case 'context':
                return <ContextPanel projectId={project.id} projectPath={project.path} />;
            case 'connect':
                return <ConnectPanel projectId={project.id} projectPath={project.path} />;
            default:
                return null;
        }
    }, [activeTab, project]);

    return (
        <div className="flex flex-col h-screen bg-background">
            {/* Header */}
            <header className="h-12 shrink-0 border-b border-border flex items-center justify-between px-4 select-none">
                <div className="flex items-center gap-3">
                    <button
                        onClick={onClose}
                        className="flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground transition-colors duration-150"
                    >
                        <ChevronLeft className="w-3.5 h-3.5" />
                        Projects
                    </button>
                    <span className="text-border">/</span>
                    <span className="text-sm font-medium flex items-center gap-2 text-foreground">
                        <FolderOpen className="w-3.5 h-3.5 text-muted-foreground" />
                        {project.name}
                    </span>
                </div>
                <kbd className="text-[10px] px-1.5 py-0.5 rounded bg-foreground/[0.06] text-muted-foreground border border-border">
                    {navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}K
                </kbd>
            </header>

            {/* Tab bar — Superset-style underline tabs */}
            <div className="shrink-0 flex items-center border-b border-border px-4">
                {TABS.map((tab, idx) => {
                    const Icon = tab.icon;
                    const isActive = activeTab === tab.id;
                    return (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`relative flex items-center gap-1.5 px-4 py-2.5 text-[13px] font-medium transition-colors ${
                                isActive
                                    ? 'text-foreground'
                                    : 'text-muted-foreground hover:text-foreground'
                            }`}
                        >
                            <Icon className="w-3.5 h-3.5" />
                            {tab.label}
                            <kbd className="text-[9px] text-muted-foreground/50 ml-0.5 tabular-nums">{idx + 1}</kbd>
                            {isActive && (
                                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-foreground rounded-full" />
                            )}
                        </button>
                    );
                })}
            </div>

            {/* Panel */}
            <div className="flex-1 overflow-hidden">
                <ErrorBoundary key={activeTab}>
                    {panelContent}
                </ErrorBoundary>
            </div>

            {/* Command palette */}
            {paletteOpen && (
                <div
                    className="fixed inset-0 z-[9999] flex items-start justify-center pt-[20vh]"
                    onClick={() => setPaletteOpen(false)}
                >
                    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" />
                    <div
                        className="relative w-full max-w-md bg-popover border border-border rounded-xl shadow-2xl overflow-hidden"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
                            <Search className="w-4 h-4 text-muted-foreground shrink-0" />
                            <input
                                ref={paletteInputRef}
                                type="text"
                                value={paletteQuery}
                                onChange={e => setPaletteQuery(e.target.value)}
                                onKeyDown={e => { e.stopPropagation(); handlePaletteKeyDown(e); }}
                                placeholder="Type a command..."
                                className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/50"
                                autoFocus
                            />
                            <kbd className="text-[10px] px-1.5 py-0.5 rounded bg-foreground/[0.06] text-muted-foreground">ESC</kbd>
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
                                        className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors duration-100 ${
                                            idx === paletteIndex ? 'bg-accent text-foreground' : 'text-foreground hover:bg-accent/50'
                                        }`}
                                    >
                                        <Icon className="w-4 h-4 shrink-0" />
                                        <span className="flex-1 text-left">{action.label}</span>
                                        <span className="text-[10px] text-muted-foreground">{action.section}</span>
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
