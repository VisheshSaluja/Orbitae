import React, { useCallback, useState, useMemo } from 'react';
import {
    ReactFlow,
    Background,
    Controls,
    MiniMap,
    addEdge,
    useNodesState,
    useEdgesState,
    Handle,
    Position,
    type Connection,
    type Node,
    type Edge,
    type NodeTypes,
    MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { invokeCommand } from '../../lib/tauri';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import {
    Save, X, Terminal, Clock, Activity, ArrowLeft,
    Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import type { PlaybookStep, ProjectPlaybook } from '../../types';

interface PlaybookEditorProps {
    projectId: string;
    playbook?: ProjectPlaybook;
    existingSteps?: PlaybookStep[];
    onClose: () => void;
    onSaved: () => void;
}

interface StepNodeData {
    label: string;
    stepType: string;
    command: string;
    expectedOutput: string;
    onFailure: string;
    maxRetries: number;
    retryDelayMs: number;
    onSelect: (id: string) => void;
    onDelete: (id: string) => void;
    [key: string]: unknown;
}

const STEP_TYPE_CONFIG: Record<string, { icon: React.ReactNode; color: string }> = {
    command: { icon: <Terminal className="w-3.5 h-3.5" />, color: 'border-blue-500/50 bg-blue-500/5' },
    health_check: { icon: <Activity className="w-3.5 h-3.5" />, color: 'border-green-500/50 bg-green-500/5' },
    delay: { icon: <Clock className="w-3.5 h-3.5" />, color: 'border-amber-500/50 bg-amber-500/5' },
};

function StepNode({ id, data }: { id: string; data: StepNodeData }) {
    const config = STEP_TYPE_CONFIG[data.stepType] ?? STEP_TYPE_CONFIG.command;
    return (
        <div
            className={`rounded-lg border-2 ${config.color} p-3 min-w-[180px] cursor-pointer shadow-sm`}
            onClick={() => data.onSelect(id)}
        >
            <Handle type="target" position={Position.Top} className="!bg-primary !w-2.5 !h-2.5" />
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                    {config.icon}
                    <span className="text-sm font-medium truncate">{data.label}</span>
                </div>
                <Badge variant="outline" className="text-[10px] h-4 px-1 shrink-0">{data.stepType}</Badge>
            </div>
            {data.command && (
                <div className="text-[11px] text-muted-foreground font-mono mt-1.5 truncate">{data.command}</div>
            )}
            <Handle type="source" position={Position.Bottom} className="!bg-primary !w-2.5 !h-2.5" />
        </div>
    );
}

const nodeTypes: NodeTypes = { step: StepNode };

let nodeCounter = 0;

export const PlaybookEditor: React.FC<PlaybookEditorProps> = ({
    projectId, playbook, existingSteps, onClose, onSaved,
}) => {
    const [playbookName, setPlaybookName] = useState(playbook?.name ?? '');
    const [playbookDesc, setPlaybookDesc] = useState(playbook?.description ?? '');
    const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    const handleSelect = useCallback((id: string) => setSelectedNodeId(id), []);
    const handleDeleteNode = useCallback((id: string) => {
        setNodes(nds => nds.filter(n => n.id !== id));
        setEdges(eds => eds.filter(e => e.source !== id && e.target !== id));
        if (selectedNodeId === id) setSelectedNodeId(null);
    }, [selectedNodeId]);

    const initialNodes: Node[] = useMemo(() => {
        if (!existingSteps?.length) return [];
        const stepIdMap = new Map<string, string>();
        return existingSteps.map((step, i) => {
            const nodeId = `step-${i}`;
            stepIdMap.set(step.id, nodeId);
            nodeCounter = Math.max(nodeCounter, i + 1);
            return {
                id: nodeId,
                type: 'step',
                position: { x: 100 + (i % 3) * 250, y: 80 + Math.floor(i / 3) * 150 },
                data: {
                    label: step.name,
                    stepType: step.type,
                    command: step.command ?? '',
                    expectedOutput: step.expected_output ?? '',
                    onFailure: step.on_failure ?? 'abort',
                    maxRetries: step.max_retries ?? 0,
                    retryDelayMs: step.retry_delay_ms ?? 1000,
                    onSelect: handleSelect,
                    onDelete: handleDeleteNode,
                    _stepId: step.id,
                } as StepNodeData,
            };
        });
    }, [existingSteps, handleSelect, handleDeleteNode]);

    const initialEdges: Edge[] = useMemo(() => {
        if (!existingSteps?.length) return [];
        const stepIdToNodeId = new Map<string, string>();
        existingSteps.forEach((step, i) => stepIdToNodeId.set(step.id, `step-${i}`));

        const edges: Edge[] = [];
        existingSteps.forEach((step, i) => {
            if (!step.depends_on) return;
            step.depends_on.split(',').forEach(dep => {
                const sourceNodeId = stepIdToNodeId.get(dep.trim());
                if (sourceNodeId) {
                    edges.push({
                        id: `e-${sourceNodeId}-step-${i}`,
                        source: sourceNodeId,
                        target: `step-${i}`,
                        markerEnd: { type: MarkerType.ArrowClosed },
                        style: { stroke: 'hsl(var(--primary))' },
                    });
                }
            });
        });
        return edges;
    }, [existingSteps]);

    const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
    const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

    const onConnect = useCallback((params: Connection) => {
        setEdges(eds => addEdge({
            ...params,
            markerEnd: { type: MarkerType.ArrowClosed },
            style: { stroke: 'hsl(var(--primary))' },
        }, eds));
    }, [setEdges]);

    const addStep = useCallback((stepType: string) => {
        const id = `step-${nodeCounter++}`;
        const newNode: Node = {
            id,
            type: 'step',
            position: { x: 200 + Math.random() * 200, y: 100 + Math.random() * 200 },
            data: {
                label: `New ${stepType} step`,
                stepType,
                command: '',
                expectedOutput: '',
                onFailure: 'abort',
                maxRetries: 0,
                retryDelayMs: 1000,
                onSelect: handleSelect,
                onDelete: handleDeleteNode,
            } as StepNodeData,
        };
        setNodes(nds => [...nds, newNode]);
        setSelectedNodeId(id);
    }, [setNodes, handleSelect, handleDeleteNode]);

    const updateNodeData = useCallback((nodeId: string, updates: Partial<StepNodeData>) => {
        setNodes(nds => nds.map(n =>
            n.id === nodeId ? { ...n, data: { ...n.data, ...updates } } : n
        ));
    }, [setNodes]);

    const selectedNode = nodes.find(n => n.id === selectedNodeId);

    const handleSave = useCallback(async () => {
        if (!playbookName.trim()) {
            toast.error('Playbook name is required');
            return;
        }
        if (nodes.length === 0) {
            toast.error('Add at least one step');
            return;
        }

        setSaving(true);
        try {
            let pbId = playbook?.id;

            if (!pbId) {
                const pb = await invokeCommand<ProjectPlaybook>('create_playbook', {
                    projectId,
                    name: playbookName,
                    description: playbookDesc || null,
                });
                pbId = pb.id;
            }

            const edgeMap = new Map<string, string[]>();
            for (const edge of edges) {
                const deps = edgeMap.get(edge.target) ?? [];
                deps.push(edge.source);
                edgeMap.set(edge.target, deps);
            }

            const nodeIdToStepId = new Map<string, string>();

            for (const node of nodes) {
                const d = node.data as StepNodeData;
                const depNodeIds = edgeMap.get(node.id) ?? [];
                const depStepIds = depNodeIds.map(nid => nodeIdToStepId.get(nid)).filter(Boolean);

                const step = await invokeCommand<PlaybookStep>('create_playbook_step', {
                    playbookId: pbId,
                    name: d.label,
                    type: d.stepType,
                    command: d.command || null,
                    dependsOn: depStepIds.length > 0 ? depStepIds.join(',') : null,
                    expectedOutput: d.expectedOutput || null,
                });
                nodeIdToStepId.set(node.id, step.id);
            }

            toast.success('Playbook saved');
            onSaved();
        } catch {
            toast.error('Failed to save playbook');
        } finally {
            setSaving(false);
        }
    }, [playbookName, playbookDesc, nodes, edges, playbook, projectId, onSaved]);

    return (
        <div className="h-full w-full flex flex-col bg-background">
            {/* Toolbar */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-muted/30">
                <div className="flex items-center gap-3">
                    <Button variant="ghost" size="sm" onClick={onClose} className="gap-1.5">
                        <ArrowLeft className="w-4 h-4" />
                        Back
                    </Button>
                    <div className="h-5 w-px bg-border" />
                    <Input
                        value={playbookName}
                        onChange={e => setPlaybookName(e.target.value)}
                        placeholder="Playbook name"
                        className="h-8 w-48 text-sm"
                    />
                    <Input
                        value={playbookDesc}
                        onChange={e => setPlaybookDesc(e.target.value)}
                        placeholder="Description (optional)"
                        className="h-8 w-56 text-sm"
                    />
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground mr-2">Add step:</span>
                    <Button variant="outline" size="sm" className="gap-1.5 h-7" onClick={() => addStep('command')}>
                        <Terminal className="w-3 h-3" /> Command
                    </Button>
                    <Button variant="outline" size="sm" className="gap-1.5 h-7" onClick={() => addStep('health_check')}>
                        <Activity className="w-3 h-3" /> Health Check
                    </Button>
                    <Button variant="outline" size="sm" className="gap-1.5 h-7" onClick={() => addStep('delay')}>
                        <Clock className="w-3 h-3" /> Delay
                    </Button>
                    <div className="h-5 w-px bg-border ml-1" />
                    <Button size="sm" className="gap-1.5" onClick={handleSave} disabled={saving}>
                        <Save className="w-3.5 h-3.5" />
                        {saving ? 'Saving...' : 'Save'}
                    </Button>
                </div>
            </div>

            {/* Canvas + Properties */}
            <div className="flex-1 flex">
                <div className="flex-1 relative">
                    <ReactFlow
                        nodes={nodes}
                        edges={edges}
                        onNodesChange={onNodesChange}
                        onEdgesChange={onEdgesChange}
                        onConnect={onConnect}
                        nodeTypes={nodeTypes}
                        fitView
                        className="bg-muted/10"
                        defaultEdgeOptions={{
                            markerEnd: { type: MarkerType.ArrowClosed },
                            style: { stroke: 'hsl(var(--primary))' },
                        }}
                    >
                        <Background gap={20} size={1} />
                        <Controls className="!bg-background !border-border !shadow-sm" />
                        <MiniMap className="!bg-background !border-border" nodeColor="hsl(var(--primary))" />
                    </ReactFlow>
                </div>

                {/* Properties Panel */}
                {selectedNode && (
                    <div className="w-72 border-l border-border bg-background overflow-y-auto">
                        <Card className="border-0 rounded-none shadow-none">
                            <CardHeader className="pb-3">
                                <div className="flex items-center justify-between">
                                    <CardTitle className="text-sm">Step Properties</CardTitle>
                                    <div className="flex items-center gap-1">
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-6 w-6 text-destructive"
                                            onClick={() => handleDeleteNode(selectedNode.id)}
                                        >
                                            <Trash2 className="w-3.5 h-3.5" />
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-6 w-6"
                                            onClick={() => setSelectedNodeId(null)}
                                        >
                                            <X className="w-3.5 h-3.5" />
                                        </Button>
                                    </div>
                                </div>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="space-y-1.5">
                                    <label className="text-xs font-medium">Name</label>
                                    <Input
                                        value={(selectedNode.data as StepNodeData).label}
                                        onChange={e => updateNodeData(selectedNode.id, { label: e.target.value })}
                                        className="h-8 text-sm"
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-xs font-medium">Type</label>
                                    <select
                                        value={(selectedNode.data as StepNodeData).stepType}
                                        onChange={e => updateNodeData(selectedNode.id, { stepType: e.target.value })}
                                        className="w-full h-8 rounded-md border border-input bg-background px-2 text-sm"
                                    >
                                        <option value="command">Command</option>
                                        <option value="health_check">Health Check</option>
                                        <option value="delay">Delay</option>
                                    </select>
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-xs font-medium">
                                        {(selectedNode.data as StepNodeData).stepType === 'delay' ? 'Delay (ms)' :
                                         (selectedNode.data as StepNodeData).stepType === 'health_check' ? 'Target URL / host:port' :
                                         'Command'}
                                    </label>
                                    <Input
                                        value={(selectedNode.data as StepNodeData).command}
                                        onChange={e => updateNodeData(selectedNode.id, { command: e.target.value })}
                                        placeholder={
                                            (selectedNode.data as StepNodeData).stepType === 'delay' ? '1000' :
                                            (selectedNode.data as StepNodeData).stepType === 'health_check' ? 'http://localhost:3000' :
                                            'npm run dev'
                                        }
                                        className="h-8 text-sm font-mono"
                                    />
                                </div>
                                {(selectedNode.data as StepNodeData).stepType === 'health_check' && (
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-medium">Check Mode</label>
                                        <select
                                            value={(selectedNode.data as StepNodeData).expectedOutput || 'http'}
                                            onChange={e => updateNodeData(selectedNode.id, { expectedOutput: e.target.value })}
                                            className="w-full h-8 rounded-md border border-input bg-background px-2 text-sm"
                                        >
                                            <option value="http">HTTP (wait for 2xx)</option>
                                            <option value="tcp">TCP (wait for port)</option>
                                        </select>
                                    </div>
                                )}
                                <div className="space-y-1.5">
                                    <label className="text-xs font-medium">On Failure</label>
                                    <select
                                        value={(selectedNode.data as StepNodeData).onFailure}
                                        onChange={e => updateNodeData(selectedNode.id, { onFailure: e.target.value })}
                                        className="w-full h-8 rounded-md border border-input bg-background px-2 text-sm"
                                    >
                                        <option value="abort">Abort playbook</option>
                                        <option value="skip">Skip and continue</option>
                                        <option value="retry">Retry</option>
                                    </select>
                                </div>
                                {(selectedNode.data as StepNodeData).onFailure === 'retry' && (
                                    <>
                                        <div className="space-y-1.5">
                                            <label className="text-xs font-medium">Max Retries</label>
                                            <Input
                                                type="number"
                                                min={1}
                                                value={(selectedNode.data as StepNodeData).maxRetries}
                                                onChange={e => updateNodeData(selectedNode.id, { maxRetries: parseInt(e.target.value) || 0 })}
                                                className="h-8 text-sm"
                                            />
                                        </div>
                                        <div className="space-y-1.5">
                                            <label className="text-xs font-medium">Retry Delay (ms)</label>
                                            <Input
                                                type="number"
                                                min={100}
                                                step={100}
                                                value={(selectedNode.data as StepNodeData).retryDelayMs}
                                                onChange={e => updateNodeData(selectedNode.id, { retryDelayMs: parseInt(e.target.value) || 1000 })}
                                                className="h-8 text-sm"
                                            />
                                        </div>
                                    </>
                                )}
                            </CardContent>
                        </Card>
                    </div>
                )}
            </div>
        </div>
    );
};
