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
    Play, Trash2, Clock,
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

export const ContextPanel: React.FC<ContextPanelProps> = ({ projectId, projectPath }) => {
    const [activeSection, setActiveSection] = useState<Section>('vault');

    const [playbooks, setPlaybooks] = React.useState<PlaybookListItem[]>([]);
    const [activePlaybook, setActivePlaybook] = React.useState<ProjectPlaybook | null>(null);
    const [, setActiveRun] = React.useState<PlaybookRunWithSteps | null>(null);
    const [view, setView] = React.useState<'list' | 'editor' | 'run'>('list');

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
                            <button
                                onClick={handleCreatePlaybook}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-foreground text-background hover:bg-foreground/90 transition-colors"
                            >
                                <Plus className="w-3.5 h-3.5" />
                                New Runbook
                            </button>
                        </div>
                        {playbooks.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-16 text-center">
                                <div className="w-12 h-12 rounded-xl bg-foreground/[0.04] flex items-center justify-center mb-3">
                                    <BookOpen className="w-5 h-5 text-muted-foreground/40" />
                                </div>
                                <p className="text-[12px] text-muted-foreground">No runbooks yet</p>
                                <button onClick={handleCreatePlaybook} className="text-[12px] text-muted-foreground hover:text-foreground mt-2 underline underline-offset-2">Create one</button>
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
