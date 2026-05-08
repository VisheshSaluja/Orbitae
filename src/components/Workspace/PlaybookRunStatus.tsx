import React, { useEffect, useState, useCallback, useImperativeHandle, forwardRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invokeCommand } from '../../lib/tauri';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import {
    Play, CheckCircle2, XCircle, Loader2, SkipForward,
    Clock, ChevronDown, ChevronRight, AlertTriangle, Rocket,
    Download, Upload, Plus, Pencil, Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import { generatePlaybookYaml } from '../../lib/agent/generatePlaybook';
import type {
    ProjectPlaybook, PlaybookRunWithSteps, PlaybookRun,
    StepRun, RunStatus,
} from '../../types';

interface PlaybookRunStatusProps {
    projectId: string;
    projectPath: string;
    onEditPlaybook?: (playbookId: string) => void;
    onNewPlaybook?: () => void;
}

export interface PlaybookRunStatusHandle {
    runFirst: () => Promise<void>;
    hasPlaybooks: boolean;
    isRunning: boolean;
}

interface RunEvent {
    runId: string;
    status: string;
}

interface StepEvent {
    runId: string;
    stepRunId: string;
    stepName: string;
    status: string;
    exitCode: number | null;
}

const STATUS_CONFIG: Record<RunStatus, { icon: React.ReactNode; color: string; label: string }> = {
    pending: { icon: <Clock className="w-3.5 h-3.5" />, color: 'text-muted-foreground', label: 'Pending' },
    running: { icon: <Loader2 className="w-3.5 h-3.5 animate-spin" />, color: 'text-blue-500', label: 'Running' },
    passed: { icon: <CheckCircle2 className="w-3.5 h-3.5" />, color: 'text-green-500', label: 'Passed' },
    failed: { icon: <XCircle className="w-3.5 h-3.5" />, color: 'text-red-500', label: 'Failed' },
    aborted: { icon: <AlertTriangle className="w-3.5 h-3.5" />, color: 'text-amber-500', label: 'Aborted' },
    skipped: { icon: <SkipForward className="w-3.5 h-3.5" />, color: 'text-muted-foreground', label: 'Skipped' },
};

function StepStatusBadge({ status }: { status: RunStatus }) {
    const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
    return (
        <span className={`flex items-center gap-1.5 text-xs font-medium ${config.color}`}>
            {config.icon}
            {config.label}
        </span>
    );
}

function StepRunRow({ step }: { step: StepRun }) {
    const [expanded, setExpanded] = useState(false);
    const hasOutput = step.stdout || step.stderr;

    return (
        <div className="border border-border/50 rounded-md overflow-hidden">
            <button
                className="w-full flex items-center justify-between px-3 py-2 hover:bg-muted/50 transition-colors text-left"
                onClick={() => hasOutput && setExpanded(!expanded)}
                disabled={!hasOutput}
            >
                <div className="flex items-center gap-3 min-w-0">
                    <StepStatusBadge status={step.status} />
                    <span className="text-sm font-medium truncate">{step.step_name}</span>
                    <Badge variant="outline" className="text-[10px] h-4 px-1.5">{step.step_type}</Badge>
                    {step.attempt > 1 && (
                        <Badge variant="outline" className="text-[10px] h-4 px-1.5 border-amber-500/50 text-amber-500">
                            attempt {step.attempt}
                        </Badge>
                    )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    {step.exit_code !== null && step.exit_code !== 0 && (
                        <span className="text-xs text-red-400 font-mono">exit {step.exit_code}</span>
                    )}
                    {hasOutput && (
                        expanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    )}
                </div>
            </button>
            {expanded && hasOutput && (
                <div className="border-t border-border/50 bg-black/20 px-3 py-2 space-y-2 max-h-48 overflow-y-auto">
                    {step.stdout && (
                        <pre className="text-xs font-mono text-green-400 whitespace-pre-wrap break-all">{step.stdout}</pre>
                    )}
                    {step.stderr && (
                        <pre className="text-xs font-mono text-red-400 whitespace-pre-wrap break-all">{step.stderr}</pre>
                    )}
                </div>
            )}
        </div>
    );
}

export const PlaybookRunStatus = forwardRef<PlaybookRunStatusHandle, PlaybookRunStatusProps>(({ projectId, projectPath, onEditPlaybook, onNewPlaybook }, ref) => {
    const [playbooks, setPlaybooks] = useState<ProjectPlaybook[]>([]);
    const [activeRun, setActiveRun] = useState<PlaybookRunWithSteps | null>(null);
    const [recentRuns, setRecentRuns] = useState<PlaybookRun[]>([]);
    const [runningPlaybookId, setRunningPlaybookId] = useState<string | null>(null);
    const [generating, setGenerating] = useState(false);

    const loadPlaybooks = useCallback(async () => {
        try {
            const data = await invokeCommand<ProjectPlaybook[]>('get_project_playbooks', { projectId });
            setPlaybooks(data);
        } catch {
            /* no-op */
        }
    }, [projectId]);

    const loadRecentRuns = useCallback(async () => {
        try {
            const data = await invokeCommand<PlaybookRun[]>('get_project_playbook_runs', {
                projectId,
                limit: 5,
            });
            setRecentRuns(data);
        } catch {
            /* no-op */
        }
    }, [projectId]);

    useEffect(() => {
        loadPlaybooks();
        loadRecentRuns();
    }, [loadPlaybooks, loadRecentRuns]);

    useEffect(() => {
        if (!activeRun) return;

        const runId = activeRun.run.id;
        let unlistenRun: (() => void) | undefined;
        let unlistenStep: (() => void) | undefined;

        const setup = async () => {
            unlistenRun = await listen<RunEvent>('playbook-run-update', (event) => {
                if (event.payload.runId !== runId) return;
                setActiveRun(prev => {
                    if (!prev) return prev;
                    return {
                        ...prev,
                        run: { ...prev.run, status: event.payload.status as RunStatus },
                    };
                });
                if (['passed', 'failed', 'aborted'].includes(event.payload.status)) {
                    setRunningPlaybookId(null);
                    loadRecentRuns();
                }
            });

            unlistenStep = await listen<StepEvent>('playbook-step-update', (event) => {
                if (event.payload.runId !== runId) return;
                setActiveRun(prev => {
                    if (!prev) return prev;
                    return {
                        ...prev,
                        steps: prev.steps.map(s =>
                            s.id === event.payload.stepRunId
                                ? { ...s, status: event.payload.status as RunStatus, exit_code: event.payload.exitCode }
                                : s
                        ),
                    };
                });
            });
        };

        setup();
        return () => {
            unlistenRun?.();
            unlistenStep?.();
        };
    }, [activeRun?.run.id, loadRecentRuns]);

    const handleRunPlaybook = useCallback(async (playbookId: string) => {
        setRunningPlaybookId(playbookId);
        try {
            const result = await invokeCommand<PlaybookRunWithSteps>('run_playbook', { playbookId });
            setActiveRun(result);
            loadRecentRuns();
        } catch {
            setRunningPlaybookId(null);
        }
    }, [loadRecentRuns]);

    const handleViewRun = useCallback(async (runId: string) => {
        try {
            const result = await invokeCommand<PlaybookRunWithSteps>('get_playbook_run', { runId });
            setActiveRun(result);
        } catch {
            /* no-op */
        }
    }, []);

    const handleExport = useCallback(async (playbookId: string, name: string) => {
        try {
            const yaml = await invokeCommand<string>('export_playbook_yaml', { playbookId });
            const blob = new Blob([yaml], { type: 'text/yaml' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${name.toLowerCase().replace(/\s+/g, '-')}.yaml`;
            a.click();
            URL.revokeObjectURL(url);
            toast.success('Playbook exported');
        } catch {
            toast.error('Failed to export playbook');
        }
    }, []);

    const handleImport = useCallback(async () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.yaml,.yml';
        input.onchange = async (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) return;
            const yamlContent = await file.text();
            try {
                await invokeCommand('import_playbook_yaml', { projectId, yamlContent });
                toast.success('Playbook imported');
                loadPlaybooks();
            } catch {
                toast.error('Failed to import playbook');
            }
        };
        input.click();
    }, [projectId, loadPlaybooks]);

    const handleGenerate = useCallback(async () => {
        setGenerating(true);
        try {
            const yamlContent = await generatePlaybookYaml(projectId, projectPath, projectPath.split('/').pop() ?? 'project');
            await invokeCommand('import_playbook_yaml', { projectId, yamlContent });
            toast.success('AI playbook generated and saved');
            loadPlaybooks();
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Failed to generate playbook';
            toast.error(msg);
        } finally {
            setGenerating(false);
        }
    }, [projectId, projectPath, loadPlaybooks]);

    const runFirst = useCallback(async () => {
        if (playbooks.length === 0 || runningPlaybookId) return;
        await handleRunPlaybook(playbooks[0].id);
    }, [playbooks, runningPlaybookId, handleRunPlaybook]);

    useImperativeHandle(ref, () => ({
        runFirst,
        hasPlaybooks: playbooks.length > 0,
        isRunning: !!runningPlaybookId,
    }), [runFirst, playbooks.length, runningPlaybookId]);

    const isRunning = activeRun?.run.status === 'running';
    const completedSteps = activeRun?.steps.filter(s => ['passed', 'failed', 'skipped'].includes(s.status)).length ?? 0;
    const totalSteps = activeRun?.steps.length ?? 0;

    if (playbooks.length === 0) {
        return (
            <div className="space-y-3">
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                    <Play className="w-4 h-4" />
                    Playbooks
                </h2>
                <div className="p-8 border border-dashed rounded-lg text-center text-muted-foreground text-sm bg-muted/50 space-y-3">
                    <p>No playbooks yet. Create one to automate your dev environment setup.</p>
                    <div className="flex items-center justify-center gap-2">
                        <Button variant="default" size="sm" className="gap-1.5" onClick={handleGenerate} disabled={generating}>
                            {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                            {generating ? 'Generating...' : 'Generate with AI'}
                        </Button>
                        {onNewPlaybook && (
                            <Button variant="outline" size="sm" className="gap-1.5" onClick={onNewPlaybook}>
                                <Plus className="w-3.5 h-3.5" />
                                New Playbook
                            </Button>
                        )}
                        <Button variant="outline" size="sm" className="gap-1.5" onClick={handleImport}>
                            <Upload className="w-3.5 h-3.5" />
                            Import YAML
                        </Button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                    <Play className="w-4 h-4" />
                    Playbooks
                </h2>
                {playbooks.length > 0 && (
                    <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" className="gap-1.5" onClick={handleGenerate} disabled={generating}>
                            {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                            {generating ? 'Generating...' : 'AI'}
                        </Button>
                        {onNewPlaybook && (
                            <Button variant="outline" size="sm" className="gap-1.5" onClick={onNewPlaybook}>
                                <Plus className="w-3.5 h-3.5" />
                                New
                            </Button>
                        )}
                        <Button variant="outline" size="sm" className="gap-1.5" onClick={handleImport}>
                            <Upload className="w-3.5 h-3.5" />
                            Import
                        </Button>
                        <Button
                            size="default"
                            className="gap-2 shadow-sm"
                            disabled={!!runningPlaybookId}
                            onClick={runFirst}
                        >
                            {runningPlaybookId ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                                <Rocket className="w-4 h-4" />
                            )}
                            {runningPlaybookId ? 'Starting...' : 'Start Environment'}
                        </Button>
                    </div>
                )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {playbooks.map(pb => {
                    const isActive = runningPlaybookId === pb.id;
                    return (
                        <Card key={pb.id} className="shadow-sm">
                            <CardContent className="p-4 flex items-center justify-between">
                                <div className="min-w-0">
                                    <div className="font-medium text-sm">{pb.name}</div>
                                    {pb.description && (
                                        <div className="text-xs text-muted-foreground truncate">{pb.description}</div>
                                    )}
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                    {onEditPlaybook && (
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            className="gap-1 h-8 px-2 text-muted-foreground"
                                            onClick={() => onEditPlaybook(pb.id)}
                                            title="Edit"
                                        >
                                            <Pencil className="w-3.5 h-3.5" />
                                        </Button>
                                    )}
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        className="gap-1 h-8 px-2 text-muted-foreground"
                                        onClick={() => handleExport(pb.id, pb.name)}
                                        title="Export YAML"
                                    >
                                        <Download className="w-3.5 h-3.5" />
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant={isActive ? 'secondary' : 'default'}
                                        className="gap-1.5"
                                        disabled={isActive}
                                        onClick={() => handleRunPlaybook(pb.id)}
                                    >
                                        {isActive ? (
                                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                        ) : (
                                            <Play className="w-3.5 h-3.5" />
                                        )}
                                        {isActive ? 'Running...' : 'Run'}
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    );
                })}
            </div>

            {activeRun && (
                <Card className="shadow-sm border-border">
                    <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                            <CardTitle className="text-base flex items-center gap-2">
                                Run Status
                                <StepStatusBadge status={activeRun.run.status} />
                            </CardTitle>
                            {totalSteps > 0 && (
                                <span className="text-xs text-muted-foreground">
                                    {completedSteps} / {totalSteps} steps
                                </span>
                            )}
                        </div>
                        {totalSteps > 0 && (
                            <div className="w-full bg-muted rounded-full h-1.5 mt-2">
                                <div
                                    className={`h-1.5 rounded-full transition-all duration-300 ${
                                        activeRun.run.status === 'passed' ? 'bg-green-500' :
                                        activeRun.run.status === 'failed' || activeRun.run.status === 'aborted' ? 'bg-red-500' :
                                        'bg-blue-500'
                                    }`}
                                    style={{ width: `${(completedSteps / totalSteps) * 100}%` }}
                                />
                            </div>
                        )}
                    </CardHeader>
                    <CardContent className="space-y-1.5">
                        {activeRun.steps.map(step => (
                            <StepRunRow key={step.id} step={step} />
                        ))}
                    </CardContent>
                </Card>
            )}

            {recentRuns.length > 0 && !isRunning && (
                <div className="space-y-2">
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Recent Runs</h3>
                    <div className="space-y-1">
                        {recentRuns.map(run => (
                            <button
                                key={run.id}
                                className="w-full flex items-center justify-between px-3 py-2 rounded-md hover:bg-muted/50 transition-colors text-left"
                                onClick={() => handleViewRun(run.id)}
                            >
                                <div className="flex items-center gap-2">
                                    <StepStatusBadge status={run.status} />
                                    <span className="text-xs text-muted-foreground font-mono">{run.id.slice(0, 8)}</span>
                                </div>
                                <span className="text-xs text-muted-foreground">
                                    {run.started_at ? new Date(run.started_at).toLocaleString() : '—'}
                                </span>
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
});

PlaybookRunStatus.displayName = 'PlaybookRunStatus';
