import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import type { NodeObject, LinkObject, ForceGraphMethods } from 'react-force-graph-2d';
import { invokeCommand } from '../../lib/tauri';
import { logger } from '../../lib/logger';
import { NotesPanel } from './NotesPanel';
import { toast } from 'sonner';
import type { KnowledgeNode, KnowledgeEdge } from '../../types';
import {
    ScrollText, Brain, Trash2, Network, List, X,
} from 'lucide-react';

interface WorkspacePanelProps {
    projectId: string;
    projectPath: string;
}

type WorkspaceTab = 'knowledge' | 'notes';
type KnowledgeView = 'graph' | 'list';

const TAB_CONFIG: { id: WorkspaceTab; label: string; icon: React.ElementType }[] = [
    { id: 'knowledge', label: 'Knowledge', icon: Brain },
    { id: 'notes', label: 'Notes', icon: ScrollText },
];

const KIND_COLORS: Record<string, string> = {
    architecture: 'bg-blue-500/10 text-blue-400',
    convention: 'bg-green-500/10 text-green-400',
    decision: 'bg-purple-500/10 text-purple-400',
    runbook: 'bg-orange-500/10 text-orange-400',
    debug_log: 'bg-red-500/10 text-red-400',
    reference: 'bg-cyan-500/10 text-cyan-400',
    source_code: 'bg-fuchsia-500/10 text-fuchsia-400',
    config: 'bg-amber-500/10 text-amber-400',
    documentation: 'bg-sky-500/10 text-sky-400',
};

const KIND_NODE_COLORS: Record<string, string> = {
    architecture: '#3b82f6',
    convention: '#22c55e',
    decision: '#a855f7',
    runbook: '#f97316',
    debug_log: '#ef4444',
    reference: '#06b6d4',
    source_code: '#e879f9',
    config: '#fbbf24',
    documentation: '#38bdf8',
};

const DEFAULT_NODE_COLOR = '#6b7280';
const NODE_SIZE_MIN = 5;
const NODE_SIZE_MAX = 14;
const LABEL_TRUNCATE_LENGTH = 28;
function getLinkColor(highlight: boolean): string {
    const isDark = document.documentElement.classList.contains('dark');
    if (highlight) return isDark ? 'rgba(255,255,255,0.7)' : 'rgba(80,80,120,0.6)';
    return isDark ? 'rgba(255,255,255,0.25)' : 'rgba(80,80,120,0.25)';
}

function getLabelColor(dimmed: boolean): string {
    const isDark = document.documentElement.classList.contains('dark');
    if (dimmed) return isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)';
    return isDark ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.75)';
}


/** Link distance varies by relation type for visual clarity. */
const LINK_DISTANCE_BY_RELATION: Record<string, number> = {
    imports: 50,
    references: 70,
    'co-located': 120,
};

interface GraphNode {
    id: string;
    title: string;
    kind: string;
    content: string;
    source: string;
    status: string;
    tags: string;
    color: string;
    nodeSize: number;
    created_at: string;
    updated_at: string;
}

interface GraphLink {
    source: string;
    target: string;
    relation: string;
}

interface GraphData {
    nodes: GraphNode[];
    links: GraphLink[];
}

function computeNodeSize(contentLength: number, minLen: number, maxLen: number): number {
    if (maxLen <= minLen) return (NODE_SIZE_MIN + NODE_SIZE_MAX) / 2;
    const normalized = Math.max(0, Math.min(1, (contentLength - minLen) / (maxLen - minLen)));
    return NODE_SIZE_MIN + normalized * (NODE_SIZE_MAX - NODE_SIZE_MIN);
}

function truncateLabel(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength - 1) + '…';
}

export const WorkspacePanel: React.FC<WorkspacePanelProps> = ({ projectId, projectPath }) => {
    const [activeTab, setActiveTab] = useState<WorkspaceTab>('knowledge');
    const [knowledgeNodes, setKnowledgeNodes] = useState<KnowledgeNode[]>([]);
    const [knowledgeEdges, setKnowledgeEdges] = useState<KnowledgeEdge[]>([]);
    const [knowledgeView, setKnowledgeView] = useState<KnowledgeView>('graph');
    const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
    const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

    const graphContainerRef = useRef<HTMLDivElement>(null);
    const graphRef = useRef<ForceGraphMethods<NodeObject<GraphNode>, LinkObject<GraphNode, GraphLink>> | undefined>(undefined);
    const isScanningRef = useRef(false);
    const [graphDimensions, setGraphDimensions] = useState<{ width: number; height: number } | null>(null);

    // Measure graph container and re-zoom on resize
    useEffect(() => {
        const container = graphContainerRef.current;
        if (!container) return;

        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const { width, height } = entry.contentRect;
                if (width > 0 && height > 0) {
                    setGraphDimensions({ width: Math.floor(width), height: Math.floor(height) });
                    // Re-zoom after dimension change
                    setTimeout(() => {
                        graphRef.current?.zoomToFit(300, 50);
                    }, 200);
                }
            }
        });

        observer.observe(container);
        return () => observer.disconnect();
    }, [activeTab, knowledgeView]);

    const loadKnowledgeNodes = useCallback(async () => {
        try {
            const nodes = await invokeCommand<KnowledgeNode[]>('get_project_knowledge_nodes', { projectId });
            setKnowledgeNodes(nodes);
        } catch (err) {
            logger.error('Failed to load knowledge nodes:', err);
        }
    }, [projectId]);

    const loadKnowledgeEdges = useCallback(async () => {
        try {
            const edges = await invokeCommand<KnowledgeEdge[]>('get_knowledge_edges', { projectId });
            setKnowledgeEdges(edges);
        } catch (err) {
            logger.error('Failed to load knowledge edges:', err);
        }
    }, [projectId]);

    useEffect(() => {
        if (activeTab === 'knowledge') {
            if (isScanningRef.current) return;
            isScanningRef.current = true;
            const ingestAndLoad = async () => {
                try {
                    await Promise.allSettled([
                        invokeCommand('auto_ingest_project_docs', { projectId, projectPath }),
                        invokeCommand('scan_project_codebase', { projectId, projectPath }),
                    ]);
                    await Promise.all([loadKnowledgeNodes(), loadKnowledgeEdges()]);
                } finally {
                    isScanningRef.current = false;
                }
            };
            ingestAndLoad();
        }
    }, [activeTab, projectId, projectPath, loadKnowledgeNodes, loadKnowledgeEdges]);

    // Build connected-node set for hover highlighting
    const connectedNodeIds = useMemo(() => {
        if (!hoveredNodeId) return new Set<string>();
        const connected = new Set<string>();
        connected.add(hoveredNodeId);
        for (const edge of knowledgeEdges) {
            if (edge.from_node === hoveredNodeId) connected.add(edge.to_node);
            if (edge.to_node === hoveredNodeId) connected.add(edge.from_node);
        }
        return connected;
    }, [hoveredNodeId, knowledgeEdges]);

    // Build graph data from nodes + edges
    const graphData = useMemo((): GraphData => {
        if (knowledgeNodes.length === 0) return { nodes: [], links: [] };

        const contentLengths = knowledgeNodes.map(n => n.content.length);
        const minLen = Math.min(...contentLengths);
        const maxLen = Math.max(...contentLengths);

        const nodeIds = new Set(knowledgeNodes.map(n => n.id));

        const nodes: GraphNode[] = knowledgeNodes.map(node => ({
            id: node.id,
            title: node.title,
            kind: node.kind,
            content: node.content,
            source: node.source,
            status: node.status,
            tags: node.tags,
            color: KIND_NODE_COLORS[node.kind] ?? DEFAULT_NODE_COLOR,
            nodeSize: computeNodeSize(node.content.length, minLen, maxLen),
            created_at: node.created_at,
            updated_at: node.updated_at,
        }));

        const links: GraphLink[] = knowledgeEdges
            .filter(edge => nodeIds.has(edge.from_node) && nodeIds.has(edge.to_node))
            .map(edge => ({
                source: edge.from_node,
                target: edge.to_node,
                relation: edge.relation,
            }));

        return { nodes, links };
    }, [knowledgeNodes, knowledgeEdges]);

    // Configure d3 forces and zoom-to-fit after graph settles
    useEffect(() => {
        const fg = graphRef.current;
        if (!fg) return;

        // Increase repulsion so nodes spread to fill the canvas
        const chargeForce = fg.d3Force('charge');
        if (chargeForce && typeof (chargeForce as Record<string, unknown>).strength === 'function') {
            (chargeForce as unknown as { strength: (v: number) => void }).strength(-120);
        }

        // Link distance varies by relation type
        const linkForce = fg.d3Force('link');
        if (linkForce && typeof (linkForce as Record<string, unknown>).distance === 'function') {
            (linkForce as unknown as { distance: (fn: (link: GraphLink) => number) => void }).distance(
                (link: GraphLink) => LINK_DISTANCE_BY_RELATION[link.relation] ?? 80
            );
        }

    }, [graphData]);

    const selectedNode = useMemo(() => {
        if (!selectedNodeId) return null;
        return knowledgeNodes.find(n => n.id === selectedNodeId) ?? null;
    }, [selectedNodeId, knowledgeNodes]);

    const deleteKnowledgeNode = async (nodeId: string) => {
        try {
            await invokeCommand('delete_knowledge_node', { id: nodeId });
            setKnowledgeNodes(prev => prev.filter(n => n.id !== nodeId));
            setKnowledgeEdges(prev => prev.filter(e => e.from_node !== nodeId && e.to_node !== nodeId));
            if (selectedNodeId === nodeId) setSelectedNodeId(null);
            toast.success('Node deleted');
        } catch {
            toast.error('Failed to delete node');
        }
    };

    const handleNodeClick = useCallback((node: NodeObject<GraphNode>) => {
        const nodeId = node.id as string | undefined;
        if (nodeId) {
            setSelectedNodeId(prev => prev === nodeId ? null : nodeId);
        }
    }, []);

    const handleNodeHover = useCallback((node: NodeObject<GraphNode> | null) => {
        setHoveredNodeId((node?.id as string | undefined) ?? null);
    }, []);

    const handleBackgroundClick = useCallback(() => {
        setSelectedNodeId(null);
    }, []);

    const nodeCanvasObject = useCallback(
        (node: NodeObject<GraphNode>, ctx: CanvasRenderingContext2D, globalScale: number) => {
            const x = node.x ?? 0;
            const y = node.y ?? 0;
            const size = (node as GraphNode).nodeSize ?? 6;
            const color = (node as GraphNode).color ?? DEFAULT_NODE_COLOR;
            const label = truncateLabel((node as GraphNode).title ?? '', LABEL_TRUNCATE_LENGTH);
            const nodeId = node.id as string | undefined;

            const isHovered = hoveredNodeId !== null && connectedNodeIds.has(nodeId ?? '');
            const isSelected = nodeId === selectedNodeId;
            const isDimmed = hoveredNodeId !== null && !connectedNodeIds.has(nodeId ?? '');

            // Outer glow for non-dimmed nodes (Obsidian-style)
            if (!isDimmed) {
                ctx.beginPath();
                ctx.arc(x, y, size + 3, 0, 2 * Math.PI, false);
                ctx.fillStyle = `${color}18`;
                ctx.fill();
            }

            // Draw node circle
            ctx.beginPath();
            ctx.arc(x, y, size, 0, 2 * Math.PI, false);
            ctx.fillStyle = isDimmed ? `${color}40` : color;
            ctx.fill();

            // Highlight ring for hovered/selected
            if (isHovered || isSelected) {
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 2 / globalScale;
                ctx.stroke();
            }

            // Draw label if zoomed in enough
            if (globalScale >= 0.6) {
                const fontSize = Math.max(10 / globalScale, 3);
                ctx.font = `${fontSize}px Inter, system-ui, sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'top';
                ctx.fillStyle = getLabelColor(isDimmed);
                ctx.fillText(label, x, y + size + 2);
            }
        },
        [hoveredNodeId, connectedNodeIds, selectedNodeId],
    );

    const nodePointerAreaPaint = useCallback(
        (node: NodeObject<GraphNode>, paintColor: string, ctx: CanvasRenderingContext2D) => {
            const x = node.x ?? 0;
            const y = node.y ?? 0;
            const size = (node as GraphNode).nodeSize ?? 6;
            ctx.beginPath();
            ctx.arc(x, y, size + 2, 0, 2 * Math.PI, false);
            ctx.fillStyle = paintColor;
            ctx.fill();
        },
        [],
    );

    const linkColor = useCallback(
        (link: LinkObject<GraphNode, GraphLink>) => {
            if (!hoveredNodeId) return getLinkColor(false);
            const sourceId = typeof link.source === 'object' ? (link.source as GraphNode)?.id : link.source;
            const targetId = typeof link.target === 'object' ? (link.target as GraphNode)?.id : link.target;
            if (sourceId === hoveredNodeId || targetId === hoveredNodeId) return getLinkColor(true);
            return getLinkColor(false);
        },
        [hoveredNodeId],
    );

    const linkWidth = useCallback(
        (link: LinkObject<GraphNode, GraphLink>) => {
            if (!hoveredNodeId) return 1;
            const sourceId = typeof link.source === 'object' ? (link.source as GraphNode)?.id : link.source;
            const targetId = typeof link.target === 'object' ? (link.target as GraphNode)?.id : link.target;
            if (sourceId === hoveredNodeId || targetId === hoveredNodeId) return 2.5;
            return 0.5;
        },
        [hoveredNodeId],
    );

    const handleEngineStop = useCallback(() => {
        const fg = graphRef.current;
        if (fg) fg.zoomToFit(400, 60);
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

                {activeTab === 'knowledge' && (
                    <div className="h-full flex flex-col">
                        {/* Knowledge view toggle */}
                        <div className="shrink-0 flex items-center justify-between px-4 py-2 border-b border-border/30">
                            <div className="flex items-center gap-1 rounded-lg bg-muted/30 p-0.5">
                                <button
                                    onClick={() => setKnowledgeView('graph')}
                                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                                        knowledgeView === 'graph'
                                            ? 'bg-background text-foreground shadow-sm'
                                            : 'text-muted-foreground hover:text-foreground'
                                    }`}
                                >
                                    <Network className="w-3.5 h-3.5" />
                                    Graph
                                </button>
                                <button
                                    onClick={() => setKnowledgeView('list')}
                                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                                        knowledgeView === 'list'
                                            ? 'bg-background text-foreground shadow-sm'
                                            : 'text-muted-foreground hover:text-foreground'
                                    }`}
                                >
                                    <List className="w-3.5 h-3.5" />
                                    List
                                </button>
                            </div>
                            <span className="text-[10px] text-muted-foreground">
                                {knowledgeNodes.length} nodes &middot; {knowledgeEdges.length} edges
                            </span>
                        </div>

                        {knowledgeNodes.length === 0 ? (
                            <div className="flex-1 flex flex-col items-center justify-center text-center text-muted-foreground space-y-3">
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
                        ) : knowledgeView === 'graph' ? (
                            <div className="flex-1 flex overflow-hidden min-h-0">
                                {/* Force-directed graph — fills all available space */}
                                <div ref={graphContainerRef} className="flex-1 w-full h-full min-h-0 min-w-0 relative">
                                    {graphDimensions && <ForceGraph2D
                                        ref={graphRef as React.MutableRefObject<ForceGraphMethods<NodeObject<GraphNode>, LinkObject<GraphNode, GraphLink>> | undefined>}
                                        width={graphDimensions.width}
                                        height={graphDimensions.height}
                                        graphData={graphData}
                                        nodeId="id"
                                        linkSource="source"
                                        linkTarget="target"
                                        backgroundColor="rgba(0,0,0,0)"
                                        nodeCanvasObject={nodeCanvasObject}
                                        nodeCanvasObjectMode={() => 'replace'}
                                        nodePointerAreaPaint={nodePointerAreaPaint}
                                        linkColor={linkColor}
                                        linkWidth={linkWidth}
                                        linkDirectionalArrowLength={3.5}
                                        linkDirectionalArrowRelPos={1}
                                        linkDirectionalArrowColor={linkColor}
                                        onNodeClick={handleNodeClick}
                                        onNodeHover={handleNodeHover}
                                        onBackgroundClick={handleBackgroundClick}
                                        onEngineStop={handleEngineStop}
                                        enableNodeDrag={true}
                                        enableZoomInteraction={true}
                                        enablePanInteraction={true}
                                        cooldownTicks={80}
                                        d3AlphaDecay={0.03}
                                        d3VelocityDecay={0.35}
                                    />}
                                </div>

                                {/* Detail panel */}
                                {selectedNode && (
                                    <div className="w-72 shrink-0 border-l border-border/40 bg-card/50 overflow-y-auto scrollbar-thin">
                                        <div className="p-4 space-y-4">
                                            <div className="flex items-start justify-between gap-2">
                                                <h3 className="text-sm font-semibold text-foreground leading-tight flex-1">
                                                    {selectedNode.title}
                                                </h3>
                                                <button
                                                    onClick={() => setSelectedNodeId(null)}
                                                    className="text-muted-foreground hover:text-foreground p-0.5 shrink-0 transition-colors"
                                                >
                                                    <X className="w-3.5 h-3.5" />
                                                </button>
                                            </div>

                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium uppercase tracking-wide ${KIND_COLORS[selectedNode.kind] ?? 'bg-muted text-muted-foreground'}`}>
                                                    {selectedNode.kind}
                                                </span>
                                                <span className="text-[10px] text-muted-foreground/50">
                                                    {selectedNode.source}
                                                </span>
                                            </div>

                                            <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">
                                                {selectedNode.content}
                                            </p>

                                            {selectedNode.tags && (
                                                <div className="flex flex-wrap gap-1">
                                                    {selectedNode.tags.split(',').filter(Boolean).map(tag => (
                                                        <span key={tag.trim()} className="text-[10px] px-1.5 py-0.5 rounded bg-muted/50 text-muted-foreground">
                                                            {tag.trim()}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}

                                            <div className="pt-2 border-t border-border/30">
                                                <button
                                                    onClick={() => deleteKnowledgeNode(selectedNode.id)}
                                                    className="flex items-center gap-1.5 text-xs text-destructive hover:text-destructive/80 transition-colors"
                                                >
                                                    <Trash2 className="w-3 h-3" />
                                                    Delete node
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-thin">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    {knowledgeNodes.map(node => (
                                        <div
                                            key={node.id}
                                            className="group p-4 rounded-xl border border-border/40 bg-card/30 hover:bg-card/50 hover:border-border/60 transition-all"
                                        >
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="flex-1 min-w-0 space-y-2">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium uppercase tracking-wide ${KIND_COLORS[node.kind] ?? 'bg-muted text-muted-foreground'}`}>
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
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};
