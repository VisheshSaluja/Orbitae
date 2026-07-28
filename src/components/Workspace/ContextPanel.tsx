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
    Lock, Notebook, BookOpen, ChevronDown, ChevronRight, Plus,
    Play, Trash2, Clock,
} from 'lucide-react';

interface ContextPanelProps {
    projectId: string;
    projectPath: string;
}

type Section = 'vault' | 'runbooks' | 'notes';

interface PlaybookListItem {
    playbook: ProjectPlaybook;
    lastRun: PlaybookRunWithSteps | null;
}

export const ContextPanel: React.FC<ContextPanelProps> = ({ projectId, projectPath }) => {
    const [expanded, setExpanded] = useState<Record<Section, boolean>>({
        vault: true,
        runbooks: true,
        notes: true,
    });

    const [playbooks, setPlaybooks] = React.useState<PlaybookListItem[]>([]);
    const [activePlaybook, setActivePlaybook] = React.useState<ProjectPlaybook | null>(null);
    const [, setActiveRun] = React.useState<PlaybookRunWithSteps | null>(null);
    const [view, setView] = React.useState<'list' | 'editor' | 'run'>('list');

    const toggle = (section: Section) => {
        setExpanded(prev => ({ ...prev, [section]: !prev[section] }));
    };

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
        <div className="h-full overflow-y-auto">
            {/* Vault Section */}
            <SectionHeader
                icon={Lock}
                label="Vault"
                count={null}
                expanded={expanded.vault}
                onToggle={() => toggle('vault')}
            />
            {expanded.vault && (
                <ErrorBoundary>
                    <KeysPanel projectId={projectId} />
                </ErrorBoundary>
            )}

            {/* Runbooks Section */}
            <SectionHeader
                icon={BookOpen}
                label="Runbooks"
                count={playbooks.length}
                expanded={expanded.runbooks}
                onToggle={() => toggle('runbooks')}
                action={<button onClick={handleCreatePlaybook} className="p-1 rounded hover:bg-white/[0.06] text-[#71717a] hover:text-[#e4e4e7] transition-colors"><Plus className="w-3.5 h-3.5" /></button>}
            />
            {expanded.runbooks && (
                <div className="px-4 pb-4">
                    {playbooks.length === 0 ? (
                        <div className="py-8 text-center text-[#71717a] border border-dashed border-white/[0.06] rounded-lg">
                            <BookOpen className="w-6 h-6 mx-auto mb-2 opacity-30" />
                            <p className="text-[12px]">No runbooks yet</p>
                            <button onClick={handleCreatePlaybook} className="text-[12px] text-blue-400 hover:text-blue-300 mt-1">Create one</button>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {playbooks.map(({ playbook, lastRun }) => (
                                <div
                                    key={playbook.id}
                                    className="group flex items-center justify-between p-3 rounded-lg bg-[#141417] border border-white/[0.06] hover:border-white/[0.12] transition-all duration-150 cursor-pointer"
                                    onClick={() => { setActivePlaybook(playbook); setView('editor'); }}
                                >
                                    <div className="min-w-0">
                                        <div className="text-[13px] font-medium text-[#e4e4e7] truncate">{playbook.name}</div>
                                        {lastRun && (
                                            <div className="flex items-center gap-1.5 mt-1 text-[10px] text-[#71717a]">
                                                <Clock className="w-3 h-3" />
                                                <span>{lastRun.run.status}</span>
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button
                                            onClick={(e) => { e.stopPropagation(); handleRunPlaybook(playbook); }}
                                            className="p-1.5 rounded-md text-green-400 hover:bg-green-500/10 transition-colors"
                                            title="Run"
                                        >
                                            <Play className="w-3.5 h-3.5" />
                                        </button>
                                        <button
                                            onClick={(e) => handleDeletePlaybook(playbook.id, e)}
                                            className="p-1.5 rounded-md text-[#71717a] hover:text-red-400 hover:bg-red-500/10 transition-colors"
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

            {/* Notes Section */}
            <SectionHeader
                icon={Notebook}
                label="Notes"
                count={null}
                expanded={expanded.notes}
                onToggle={() => toggle('notes')}
            />
            {expanded.notes && (
                <ErrorBoundary>
                    <NotesPanel projectId={projectId} />
                </ErrorBoundary>
            )}
        </div>
    );
};

interface SectionHeaderProps {
    icon: React.FC<{ className?: string }>;
    label: string;
    count: number | null;
    expanded: boolean;
    onToggle: () => void;
    action?: React.ReactNode;
}

const SectionHeader: React.FC<SectionHeaderProps> = ({ icon: Icon, label, count, expanded, onToggle, action }) => (
    <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-2.5 bg-[#0a0a0b]/95 backdrop-blur-sm border-b border-white/[0.04]">
        <button onClick={onToggle} className="flex items-center gap-2 text-[12px] font-semibold text-[#a1a1aa] uppercase tracking-wider hover:text-[#e4e4e7] transition-colors">
            {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            <Icon className="w-3.5 h-3.5" />
            {label}
            {count !== null && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-white/[0.06] text-[#71717a] font-medium normal-case">{count}</span>
            )}
        </button>
        {action}
    </div>
);
