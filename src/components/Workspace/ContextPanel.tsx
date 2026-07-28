import React, { useState } from 'react';
import { KeysPanel } from './KeysPanel';
import { NotesPanel } from './NotesPanel';
import { PlaybookEditor } from './PlaybookEditor';
import { PlaybookRunStatus } from './PlaybookRunStatus';
import { invokeCommand } from '../../lib/tauri';
import { toast } from 'sonner';
import { ErrorBoundary } from '../ui/error-boundary';
import type { ProjectPlaybook, PlaybookRunWithSteps } from '../../types';
import {
    Lock, Notebook, BookOpen, Plus,
    Play, Trash2, Clock, Wand2, FileCode, Check,
    type LucideIcon,
} from 'lucide-react';

interface ContextPanelProps {
    projectId: string;
    projectPath: string;
}

type Section = 'vault' | 'runbooks' | 'notes';

interface SubTab {
    id: Section;
    label: string;
    icon: LucideIcon;
}

const SUB_TABS: SubTab[] = [
    { id: 'vault', label: 'Vault', icon: Lock },
    { id: 'runbooks', label: 'Runbooks', icon: BookOpen },
    { id: 'notes', label: 'Notes', icon: Notebook },
];

interface PlaybookListItem {
    playbook: ProjectPlaybook;
    lastRun: PlaybookRunWithSteps | null;
}

interface DiscoveredCommand {
    name: string;
    command: string;
    source: string;
    raw_command: string;
}

export const ContextPanel: React.FC<ContextPanelProps> = ({ projectId, projectPath }) => {
    const [activeSection, setActiveSection] = useState<Section>('vault');

    const [playbooks, setPlaybooks] = React.useState<PlaybookListItem[]>([]);
    const [activePlaybook, setActivePlaybook] = React.useState<ProjectPlaybook | null>(null);
    const [, setActiveRun] = React.useState<PlaybookRunWithSteps | null>(null);
    const [view, setView] = React.useState<'list' | 'editor' | 'run'>('list');

    const [discoveredCmds, setDiscoveredCmds] = React.useState<DiscoveredCommand[]>([]);
    const [selectedCmds, setSelectedCmds] = React.useState<Set<string>>(new Set());
    const [isScanning, setIsScanning] = React.useState(false);
    const [showDiscovered, setShowDiscovered] = React.useState(false);

    React.useEffect(() => {
        loadPlaybooks();
    }, [projectId]);

    const loadPlaybooks = async () => {
        try {
            const pbs = await invokeCommand<ProjectPlaybook[]>('get_project_playbooks', { projectId });
            const items: PlaybookListItem[] = await Promise.all(
                pbs.map(async (pb) => {
                    try {
                        const runs = await invokeCommand<PlaybookRunWithSteps[]>('get_project_playbook_runs', { projectId: pb.project_id });
                        const pbRuns = runs.filter(r => r.run.playbook_id === pb.id);
                        return { playbook: pb, lastRun: pbRuns[0] ?? null };
                    } catch {
                        return { playbook: pb, lastRun: null };
                    }
                })
            );
            setPlaybooks(items);
        } catch {
            // non-critical
        }
    };

    const handleCreatePlaybook = async () => {
        try {
            const name = `Runbook ${playbooks.length + 1}`;
            await invokeCommand('create_playbook', { projectId, name, description: '' });
            await loadPlaybooks();
            toast.success('Runbook created');
        } catch {
            toast.error('Failed to create runbook');
        }
    };

    const handleDeletePlaybook = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        try {
            await invokeCommand('delete_playbook', { id });
            await loadPlaybooks();
            toast.success('Runbook deleted');
        } catch {
            toast.error('Failed to delete runbook');
        }
    };

    const handleScanProject = async () => {
        setIsScanning(true);
        try {
            const cmds = await invokeCommand<DiscoveredCommand[]>('scan_project_commands', { projectPath });
            setDiscoveredCmds(cmds);
            setSelectedCmds(new Set(cmds.map(c => c.command)));
            setShowDiscovered(true);
        } catch {
            toast.error('Failed to scan project');
        } finally {
            setIsScanning(false);
        }
    };

    const handleGenerateRunbook = async () => {
        const selected = discoveredCmds.filter(c => selectedCmds.has(c.command));
        if (selected.length === 0) { toast.error('Select at least one command'); return; }

        try {
            const name = `Auto-generated Runbook`;
            const pb = await invokeCommand<ProjectPlaybook>('create_playbook', { projectId, name, description: `Generated from: ${[...new Set(selected.map(c => c.source))].join(', ')}` });

            for (let i = 0; i < selected.length; i++) {
                const cmd = selected[i];
                await invokeCommand('create_playbook_step', {
                    playbookId: pb.id,
                    name: cmd.name,
                    stepType: 'command',
                    command: cmd.command,
                    dependsOn: null,
                    expectedOutput: null,
                });
            }

            setShowDiscovered(false);
            setDiscoveredCmds([]);
            await loadPlaybooks();
            toast.success(`Runbook created with ${selected.length} steps`);

            const loaded = await invokeCommand<ProjectPlaybook[]>('get_project_playbooks', { projectId });
            const created = loaded.find(p => p.id === pb.id);
            if (created) { setActivePlaybook(created); setView('editor'); }
        } catch (err) {
            toast.error(`Failed to generate: ${err}`);
        }
    };

    const toggleCmd = (cmd: string) => {
        setSelectedCmds(prev => {
            const next = new Set(prev);
            if (next.has(cmd)) next.delete(cmd); else next.add(cmd);
            return next;
        });
    };

    const handleRunPlaybook = async (pb: ProjectPlaybook) => {
        try {
            const result = await invokeCommand<PlaybookRunWithSteps>('run_playbook', {
                playbookId: pb.id,
                projectId: pb.project_id,
                projectPath,
            });
            setActiveRun(result);
            setView('run');
            toast.success('Runbook started');
        } catch (err) {
            toast.error(`Failed to run: ${err}`);
        }
    };

    if (view === 'editor' && activePlaybook) {
        return (
            <ErrorBoundary>
                <PlaybookEditor
                    projectId={projectId}
                    playbook={activePlaybook}
                    onClose={() => { setView('list'); setActivePlaybook(null); }}
                    onSaved={() => { setView('list'); setActivePlaybook(null); loadPlaybooks(); }}
                />
            </ErrorBoundary>
        );
    }

    if (view === 'run') {
        return (
            <ErrorBoundary>
                <PlaybookRunStatus
                    projectId={projectId}
                    projectPath={projectPath}
                    onEditPlaybook={(playbookId) => {
                        const pb = playbooks.find(p => p.playbook.id === playbookId);
                        if (pb) { setActivePlaybook(pb.playbook); setView('editor'); }
                    }}
                    onNewPlaybook={() => { setView('list'); setActiveRun(null); loadPlaybooks(); }}
                />
            </ErrorBoundary>
        );
    }

    return (
        <div className="h-full flex flex-col">
            {/* Sub-tab bar */}
            <div className="shrink-0 flex items-center gap-1 px-3 py-2 border-b border-border">
                {SUB_TABS.map(tab => {
                    const Icon = tab.icon;
                    const isActive = activeSection === tab.id;
                    return (
                        <button
                            key={tab.id}
                            onClick={() => setActiveSection(tab.id)}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium transition-all duration-100 ${
                                isActive
                                    ? 'bg-foreground/8 text-foreground'
                                    : 'text-muted-foreground hover:text-foreground hover:bg-foreground/4'
                            }`}
                        >
                            <Icon className="w-3.5 h-3.5" />
                            {tab.label}
                            {tab.id === 'runbooks' && playbooks.length > 0 && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-foreground/6 text-muted-foreground tabular-nums">{playbooks.length}</span>
                            )}
                        </button>
                    );
                })}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-hidden">
                {activeSection === 'vault' && (
                    <ErrorBoundary>
                        <KeysPanel projectId={projectId} />
                    </ErrorBoundary>
                )}

                {activeSection === 'runbooks' && (
                    <div className="h-full overflow-y-auto p-4">
                        <div className="flex items-center justify-between mb-4">
                            <div>
                                <h3 className="text-sm font-semibold text-foreground">Runbooks</h3>
                                <p className="text-[11px] text-muted-foreground mt-0.5">Automate repeatable workflows for your project.</p>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={handleScanProject}
                                    disabled={isScanning}
                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-foreground/4 transition-colors disabled:opacity-50"
                                >
                                    <Wand2 className="w-3.5 h-3.5" />
                                    {isScanning ? 'Scanning...' : 'Generate from Project'}
                                </button>
                                <button
                                    onClick={handleCreatePlaybook}
                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-foreground text-background hover:bg-foreground/90 transition-colors"
                                >
                                    <Plus className="w-3.5 h-3.5" />
                                    New Runbook
                                </button>
                            </div>
                        </div>

                        {/* Discovered commands panel */}
                        {showDiscovered && discoveredCmds.length > 0 && (
                            <div className="mb-4 rounded-lg border border-border bg-card p-4 space-y-3">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <span className="text-[12px] font-semibold text-foreground">Discovered Commands</span>
                                        <span className="text-[10px] text-muted-foreground ml-2">{selectedCmds.size} of {discoveredCmds.length} selected</span>
                                    </div>
                                    <button onClick={() => setShowDiscovered(false)} className="p-1 rounded hover:bg-foreground/6 text-muted-foreground">
                                        <Trash2 className="w-3 h-3" />
                                    </button>
                                </div>
                                <div className="space-y-1 max-h-64 overflow-y-auto">
                                    {discoveredCmds.map(cmd => (
                                        <label
                                            key={cmd.command}
                                            className={`flex items-center gap-3 p-2.5 rounded-md cursor-pointer transition-colors ${
                                                selectedCmds.has(cmd.command) ? 'bg-foreground/[0.04]' : 'hover:bg-foreground/[0.02]'
                                            }`}
                                        >
                                            <div
                                                onClick={() => toggleCmd(cmd.command)}
                                                className={`w-4 h-4 rounded border shrink-0 flex items-center justify-center transition-colors ${
                                                    selectedCmds.has(cmd.command)
                                                        ? 'bg-foreground border-foreground'
                                                        : 'border-border'
                                                }`}
                                            >
                                                {selectedCmds.has(cmd.command) && <Check className="w-3 h-3 text-background" />}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-[12px] font-medium text-foreground">{cmd.name}</span>
                                                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-foreground/6 text-muted-foreground/60">{cmd.source}</span>
                                                </div>
                                                <span className="text-[11px] font-mono text-muted-foreground/50 truncate block">{cmd.command}</span>
                                            </div>
                                        </label>
                                    ))}
                                </div>
                                <button
                                    onClick={handleGenerateRunbook}
                                    disabled={selectedCmds.size === 0}
                                    className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-[12px] font-medium bg-foreground text-background hover:bg-foreground/90 transition-colors disabled:opacity-50"
                                >
                                    <FileCode className="w-3.5 h-3.5" />
                                    Create Runbook ({selectedCmds.size} steps)
                                </button>
                            </div>
                        )}

                        {showDiscovered && discoveredCmds.length === 0 && !isScanning && (
                            <div className="mb-4 rounded-lg border border-dashed border-border p-6 text-center">
                                <p className="text-[12px] text-muted-foreground">No commands discovered. Try adding a package.json, Makefile, or docker-compose.yml.</p>
                            </div>
                        )}

                        {playbooks.length === 0 && !showDiscovered ? (
                            <div className="flex flex-col items-center justify-center py-16 text-center">
                                <div className="w-12 h-12 rounded-xl bg-foreground/[0.04] flex items-center justify-center mb-3">
                                    <BookOpen className="w-5 h-5 text-muted-foreground/40" />
                                </div>
                                <p className="text-[12px] text-muted-foreground mb-2">No runbooks yet</p>
                                <p className="text-[11px] text-muted-foreground/50 max-w-xs mb-4">Click "Generate from Project" to auto-discover commands from your package.json, Makefile, and docker-compose, or create one manually.</p>
                                <button onClick={handleScanProject} disabled={isScanning} className="text-[12px] text-muted-foreground hover:text-foreground underline underline-offset-2">
                                    {isScanning ? 'Scanning...' : 'Auto-generate'}
                                </button>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {playbooks.map(({ playbook, lastRun }) => (
                                    <div
                                        key={playbook.id}
                                        className="group flex items-center justify-between p-3 rounded-lg border border-border hover:bg-foreground/[0.02] transition-all duration-150 cursor-pointer"
                                        onClick={() => { setActivePlaybook(playbook); setView('editor'); }}
                                    >
                                        <div className="min-w-0">
                                            <div className="text-[13px] font-medium text-foreground truncate">{playbook.name}</div>
                                            {lastRun && (
                                                <div className="flex items-center gap-1.5 mt-1 text-[10px] text-muted-foreground">
                                                    <Clock className="w-3 h-3" />
                                                    <span>{lastRun.run.status}</span>
                                                </div>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button
                                                onClick={(e) => { e.stopPropagation(); handleRunPlaybook(playbook); }}
                                                className="p-1.5 rounded-md text-emerald-400 hover:bg-emerald-500/10 transition-colors"
                                                title="Run"
                                            >
                                                <Play className="w-3.5 h-3.5" />
                                            </button>
                                            <button
                                                onClick={(e) => handleDeletePlaybook(playbook.id, e)}
                                                className="p-1.5 rounded-md text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
                                                title="Delete"
                                            >
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {activeSection === 'notes' && (
                    <ErrorBoundary>
                        <NotesPanel projectId={projectId} />
                    </ErrorBoundary>
                )}
            </div>
        </div>
    );
};
