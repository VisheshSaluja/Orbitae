import React, { useEffect, useState } from 'react';
import { Play, Loader2, FileJson } from 'lucide-react';
import { Button } from '../ui/button';
import { invokeCommand } from '../../lib/tauri';
import { toast } from 'sonner';

interface ProjectScript {
    name: string;
    command: string;
    source: string;
}

interface ScriptRunnerProps {
    path: string;
    onNavigate: (tab: string) => void;
}

export const ScriptRunner: React.FC<ScriptRunnerProps> = ({ path, onNavigate }) => {
    const [scripts, setScripts] = useState<ProjectScript[]>([]);
    const [loading, setLoading] = useState(false);
    const [runningScript, setRunningScript] = useState<string | null>(null);

    const fetchScripts = async () => {
        setLoading(true);
        try {
            const data = await invokeCommand<ProjectScript[]>('get_project_scripts', { path });
            setScripts(data);
        } catch {
            toast.error("Failed to load scripts");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchScripts();
    }, [path]);

    const runScript = async (script: ProjectScript) => {
        setRunningScript(script.name);
        try {
            // Determine the command runner based on source
            let fullCommand = script.command;
            
            if (script.source === 'package.json') {
                fullCommand = `npm run ${script.name}`;
            }

            // Use the internal process manager
            await invokeCommand('start_process', { 
                cwd: path, 
                command: fullCommand 
            });
            
            toast.success(`Started: ${script.name}`);
            
            // Switch to processes tab to show output
            onNavigate('processes');
        } catch {
            toast.error(`Failed to run ${script.name}`);
        } finally {
            setRunningScript(null);
        }
    };

    if (loading && scripts.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                <Loader2 className="w-6 h-6 animate-spin mb-2" />
                <span>Scanning project scripts...</span>
            </div>
        );
    }

    if (scripts.length === 0) {
         return (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8 text-center">
                <div className="p-3 bg-muted rounded-full mb-4">
                    <FileJson className="w-8 h-8 opacity-50" />
                </div>
                <h3 className="text-lg font-medium text-foreground mb-1">No Scripts Found</h3>
                <p className="text-sm max-w-sm">
                    We couldn't find any common script files (like package.json) in this project.
                </p>
            </div>
        );
    }

    return (
        <div className="h-full overflow-auto p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {scripts.map((script) => (
                    <div 
                        key={`${script.source}-${script.name}`}
                        className="group flex flex-col border border-border bg-card hover:border-primary/50 transition-colors rounded-lg overflow-hidden shadow-sm"
                    >
                        <div className="p-4 flex-1">
                            <div className="flex items-start justify-between mb-2">
                                <h4 className="font-semibold text-sm truncate" title={script.name}>
                                    {script.name}
                                </h4>
                                <span className="text-[10px] uppercase tracking-wider text-muted-foreground bg-muted px-1.5 py-0.5 rounded border border-border">
                                    {script.source}
                                </span>
                            </div>
                            <code className="text-xs text-muted-foreground font-mono bg-muted/30 px-1.5 py-1 rounded block truncate" title={script.command}>
                                {script.command}
                            </code>
                        </div>
                        <div className="p-2 bg-muted/10 border-t border-border flex justify-end">
                            <Button 
                                size="sm" 
                                variant="ghost" 
                                className="h-8 gap-1.5 hover:bg-primary hover:text-primary-foreground w-full justify-center transition-colors"
                                onClick={() => runScript(script)}
                                disabled={runningScript === script.name}
                            >
                                {runningScript === script.name ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                    <Play className="w-3.5 h-3.5 fill-current" />
                                )}
                                {runningScript === script.name ? 'Running...' : 'Run Script'}
                            </Button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};
