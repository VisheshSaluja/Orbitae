import React, { useEffect, useState } from 'react';
import { Gitgraph, templateExtend, TemplateName, Orientation } from '@gitgraph/react';
import { invokeCommand } from '../../lib/tauri';
import type { Commit, GitStatus } from '../../types';
import { toast } from 'sonner';
import { RefreshCw, GitBranch, ArrowUp, ArrowDown, Globe, GitCommitHorizontal } from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';

interface GitPanelProps {
    path: string;
}

export const GitPanel: React.FC<GitPanelProps> = ({ path }) => {
    const [commits, setCommits] = useState<Commit[]>([]);
    const [status, setStatus] = useState<GitStatus | null>(null);
    const [loading, setLoading] = useState(false);
    const [graphError, setGraphError] = useState(false);

    const fetchData = async () => {
        setLoading(true);
        setGraphError(false);
        try {
            const [historyData, statusData] = await Promise.all([
                invokeCommand<Commit[]>('get_git_history', { path, limit: 50 }),
                invokeCommand<GitStatus | null>('get_git_status', { path })
            ]);
            setCommits(historyData);
            setStatus(statusData);
        } catch (e) {
            console.error(e);
            toast.error("Failed to load git data");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, [path]);

    return (
        <div className="h-full flex flex-col">
            {/* Status Header */}
            <div className="p-4 border-b border-border bg-muted/10 grid grid-cols-2 md:grid-cols-4 gap-4 shrink-0">
                <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Branch</span>
                    <div className="flex items-center gap-2 font-mono text-sm">
                        <GitBranch className="w-4 h-4 text-primary" />
                        {status?.branch || '-'}
                    </div>
                </div>
                <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Sync</span>
                    <div className="flex items-center gap-3 text-sm">
                        <div className="flex items-center gap-1 text-green-500">
                            <ArrowUp className="w-3.5 h-3.5" />
                            {status?.ahead || 0}
                        </div>
                        <div className="flex items-center gap-1 text-red-500">
                            <ArrowDown className="w-3.5 h-3.5" />
                            {status?.behind || 0}
                        </div>
                    </div>
                </div>
                 <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Changes</span>
                    <div className="flex items-center gap-2 text-sm">
                        <Badge variant={status?.modified_count ? "destructive" : "secondary"}>
                            {status?.modified_count || 0} files
                        </Badge>
                    </div>
                </div>
                 <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Remote</span>
                    <div className="flex items-center gap-2 text-sm truncate" title={status?.remote_url}>
                        <Globe className="w-4 h-4 text-blue-500" />
                        <span className="truncate max-w-[120px]">{status?.remote_url ? 'Origin Configured' : 'No Remote'}</span>
                    </div>
                </div>
            </div>

            <div className="border-b border-border flex items-center justify-between px-4 py-2 bg-muted/20 shrink-0">
                <h3 className="text-sm font-medium flex items-center gap-2">
                    <GitCommitHorizontal className="w-4 h-4 text-primary" />
                    Commit History
                    <span className="text-xs text-muted-foreground ml-2">({commits.length} commits)</span>
                </h3>
                <Button variant="ghost" size="sm" onClick={fetchData} disabled={loading}>
                    <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                </Button>
            </div>
            
            <div className="flex-1 h-0 overflow-y-auto min-h-0 p-4 bg-background relative w-full">
                {loading && commits.length === 0 ? (
                     <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground">
                        Loading history...
                    </div>
                ) : commits.length > 0 && !graphError ? (
                    <ErrorBoundary onError={() => setGraphError(true)}>
                        <div className="min-w-fit pr-8 pl-6 pb-12">
                            <Gitgraph options={{
                                template: templateExtend(TemplateName.Metro, {
                                    colors: ["#3b82f6", "#10b981", "#f59e0b", "#ef4444"],
                                    commit: {
                                        message: {
                                            displayAuthor: true,
                                            displayHash: true,
                                            font: "normal 12px sans-serif",
                                            color: "#888888" 
                                        },
                                        spacing: 40, // Increase vertical spacing
                                    },
                                    branch: {
                                        spacing: 20, // Increase horizontal branch spacing
                                        label: {
                                            font: "normal 12px sans-serif"
                                        }
                                    }
                                }),
                                orientation: Orientation.VerticalReverse,
                            }}>
                                {(gitgraph) => {
                                    // GitGraph expects commits in chronological order (oldest to newest) to build the graph correctly
                                    const importData = [...commits].reverse().map(c => {
                                        // Clean refs: remove parens containing (HEAD -> main, origin/main)
                                        const cleanRefs = c.refs 
                                            ? c.refs.replace(/[()]/g, '').split(',').map(r => r.trim()).filter(Boolean)
                                            : [];
                                            
                                        return {
                                            hash: c.hash,
                                            subject: c.message,
                                            author: { name: c.author, email: "" },
                                            date: c.date,
                                            refs: cleanRefs,
                                            parents: c.parents.filter(Boolean)
                                        };
                                    });
                                    gitgraph.import(importData);
                                }}
                            </Gitgraph>
                        </div>
                    </ErrorBoundary>
                ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground">
                        {graphError ? "Graph failed to render." : "No git history found."}
                        {graphError && (
                             <div className="mt-4 p-4 bg-muted/50 rounded text-left overflow-auto max-h-[200px] w-full max-w-md text-xs font-mono">
                                <p className="font-semibold mb-2">Raw Commits:</p>
                                {commits.slice(0, 5).map(c => (
                                    <div key={c.hash} className="mb-1">{c.hash.substring(0,7)} - {c.message}</div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

class ErrorBoundary extends React.Component<{ onError: () => void, children: React.ReactNode }> {
    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        console.error("GitGraph Error:", error);
        this.props.onError();
    }
    render() { return this.props.children; }
}
