import React, { useState, useEffect, useCallback } from 'react';
import { invokeCommand } from '../../lib/tauri';
import { logger } from '../../lib/logger';
import { NotesPanel } from './NotesPanel';
import { SnippetsPanel } from './SnippetsPanel';
import { toast } from 'sonner';
import type { KnowledgeNode } from '../../types';
import {
    ScrollText, Code2, Brain, Trash2,
} from 'lucide-react';

interface WorkspacePanelProps {
    projectId: string;
    projectPath: string;
}

type WorkspaceTab = 'notes' | 'snippets' | 'knowledge';

const TAB_CONFIG: { id: WorkspaceTab; label: string; icon: React.ElementType }[] = [
    { id: 'notes', label: 'Notes', icon: ScrollText },
    { id: 'snippets', label: 'Snippets', icon: Code2 },
    { id: 'knowledge', label: 'Knowledge', icon: Brain },
];

const KIND_COLORS: Record<string, string> = {
    architecture: 'bg-blue-500/10 text-blue-400',
    convention: 'bg-green-500/10 text-green-400',
    decision: 'bg-purple-500/10 text-purple-400',
    runbook: 'bg-orange-500/10 text-orange-400',
    debug_log: 'bg-red-500/10 text-red-400',
    reference: 'bg-cyan-500/10 text-cyan-400',
};

export const WorkspacePanel: React.FC<WorkspacePanelProps> = ({ projectId, projectPath }) => {
    const [activeTab, setActiveTab] = useState<WorkspaceTab>('notes');
    const [knowledgeNodes, setKnowledgeNodes] = useState<KnowledgeNode[]>([]);

    const loadKnowledgeNodes = useCallback(async () => {
        try {
            const nodes = await invokeCommand<KnowledgeNode[]>('get_project_knowledge_nodes', { projectId });
            setKnowledgeNodes(nodes);
        } catch (err) {
            logger.error('Failed to load knowledge nodes:', err);
        }
    }, [projectId]);

    useEffect(() => {
        if (activeTab === 'knowledge') {
            const ingestAndLoad = async () => {
                try {
                    await invokeCommand('auto_ingest_project_docs', { projectId, projectPath });
                } catch {}
                await loadKnowledgeNodes();
            };
            ingestAndLoad();
        }
    }, [activeTab, projectId, projectPath, loadKnowledgeNodes]);

    const deleteKnowledgeNode = async (nodeId: string) => {
        try {
            await invokeCommand('delete_knowledge_node', { id: nodeId });
            setKnowledgeNodes(prev => prev.filter(n => n.id !== nodeId));
            toast.success('Node deleted');
        } catch {
            toast.error('Failed to delete node');
        }
    };

    const handleRunSnippet = useCallback(async (command: string) => {
        try {
            await navigator.clipboard.writeText(command);
            toast.success('Copied to clipboard');
        } catch {
            toast.error('Failed to copy');
        }
    }, []);

    return (
        <div className="h-full flex flex-col bg-background">
            {/* Tab bar */}
            <div className="shrink-0 border-b border-border/40 bg-muted/5">
                <div className="flex items-center px-4">
                    {TAB_CONFIG.map(tab => {
                        const Icon = tab.icon;
                        const isActive = activeTab === tab.id;
                        return (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`flex items-center gap-2 px-4 py-3 text-xs font-medium border-b-2 transition-colors ${
                                    isActive
                                        ? 'border-primary text-primary'
                                        : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
                                }`}
                            >
                                <Icon className="w-3.5 h-3.5" />
                                {tab.label}
                                {tab.id === 'knowledge' && knowledgeNodes.length > 0 && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                                        {knowledgeNodes.length}
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-hidden">
                {activeTab === 'notes' && (
                    <NotesPanel projectId={projectId} />
                )}

                {activeTab === 'snippets' && (
                    <div className="h-full p-4">
                        <SnippetsPanel projectId={projectId} onRun={handleRunSnippet} />
                    </div>
                )}

                {activeTab === 'knowledge' && (
                    <div className="h-full overflow-y-auto p-4 space-y-3 scrollbar-thin">
                        {knowledgeNodes.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground space-y-3">
                                <div className="p-4 rounded-full bg-amber-500/5">
                                    <Brain className="w-10 h-10 text-amber-500/30" />
                                </div>
                                <div className="space-y-1">
                                    <p className="text-sm font-medium text-foreground/80">No knowledge yet</p>
                                    <p className="text-xs max-w-xs text-muted-foreground">
                                        The AI agent automatically builds your project's knowledge graph as you work.
                                        Run playbooks, chat with the agent, or add docs to get started.
                                    </p>
                                </div>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                {knowledgeNodes.map(node => (
                                    <div
                                        key={node.id}
                                        className="group p-4 rounded-xl border border-border/40 bg-card/30 hover:bg-card/50 hover:border-border/60 transition-all"
                                    >
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="flex-1 min-w-0 space-y-2">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium uppercase tracking-wide ${KIND_COLORS[node.kind] || 'bg-muted text-muted-foreground'}`}>
                                                        {node.kind}
                                                    </span>
                                                    <span className="text-[10px] text-muted-foreground/50">{node.source}</span>
                                                </div>
                                                <h4 className="text-sm font-medium text-foreground leading-tight">{node.title}</h4>
                                                <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">{node.content}</p>
                                            </div>
                                            <button
                                                onClick={() => deleteKnowledgeNode(node.id)}
                                                className="text-muted-foreground/40 hover:text-destructive p-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
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
            </div>
        </div>
    );
};
