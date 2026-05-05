import React, { useState, useEffect } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { ScrollArea } from '../ui/scroll-area';
import { Square, Plus, Terminal as TerminalIcon, LayoutList, Trash2 } from 'lucide-react';
import { ProjectTerminal } from './ProjectTerminal';
import { invokeCommand } from '../../lib/tauri';
import { toast } from 'sonner';
import type { Process, Snippet } from '../../types';

interface ProcessManagerProps {
    projectId: string; // Added projectId
    path: string;
}

export const ProcessManager: React.FC<ProcessManagerProps> = ({ projectId, path }) => {
    const [processes, setProcesses] = useState<Process[]>([]);
    const [snippets, setSnippets] = useState<Snippet[]>([]);
    const [newCommand, setNewCommand] = useState('');
    const [selectedId, setSelectedId] = useState<string | null>(null);

    useEffect(() => {
        // Fetch active processes
        invokeCommand<Process[]>('get_active_processes')
            .then(setProcesses)
            .catch(err => {
                console.error("Failed to fetch active processes:", err);
                toast.error("Failed to restore process list");
            });

        // Fetch saved snippets
        fetchSnippets();
    }, [projectId]); // Re-fetch if project changes

    const fetchSnippets = async () => {
        try {
            const data = await invokeCommand<Snippet[]>('get_project_snippets', { projectId });
            setSnippets(data);
        } catch (e) {
            console.error("Failed to fetch saved commands:", e);
        }
    };

    const handleSaveCommand = async (e: React.MouseEvent) => {
        e.preventDefault(); // Prevent form submit if inside form
        if (!newCommand.trim()) return;

        try {
            await invokeCommand('add_snippet', {
                projectId,
                label: newCommand.trim(), // Use command as label by default
                command: newCommand.trim(),
                description: null
            });
            toast.success("Command saved!");
            fetchSnippets();
        } catch (e) {
            console.error(e);
            toast.error("Failed to save command");
        }
    };

    const handleDeleteSnippet = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        try {
            await invokeCommand('delete_snippet', { id });
            toast.success("Command deleted");
            fetchSnippets();
        } catch (err) {
            console.error(err);
            toast.error("Failed to delete command");
        }
    };

    const handleStart = async (e: React.FormEvent, cmdOverride?: string) => {
        if (e) e.preventDefault();
        const cmdToRun = cmdOverride || newCommand;
        if (!cmdToRun.trim()) return;

        try {
            const process = await invokeCommand<Process>('start_process', { 
                command: cmdToRun, 
                cwd: path 
            });
            setProcesses(prev => [...prev, process]);
            setSelectedId(process.id);
            if (!cmdOverride) setNewCommand('');
            toast.success("Process started");
        } catch (err) {
            console.error(err);
            toast.error("Failed to start process");
        }
    };

    const handleStop = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        try {
            await invokeCommand('stop_process', { id });
            setProcesses(prev => prev.filter(p => p.id !== id));
            if (selectedId === id) setSelectedId(null);
            toast.success("Process terminated");
        } catch (err) {
            toast.error("Failed to stop process");
        }
    };

    return (
        <div className="flex h-full w-full bg-background">
            {/* Sidebar List */}
            <div className="w-64 border-r border-border flex flex-col bg-muted/5">
                <div className="p-4 border-b border-border">
                    <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
                        <LayoutList className="w-4 h-4" />
                        Active Processes
                    </h3>
                    <form onSubmit={handleStart} className="flex gap-2">
                        <Input 
                            value={newCommand}
                            onChange={(e) => setNewCommand(e.target.value)}
                            placeholder="npm run dev..."
                            className="h-8 text-xs font-mono"
                        />
                        <Button 
                            type="button" 
                            size="icon" 
                            variant="secondary"
                            className="h-8 w-8 shrink-0"
                            title="Save Command"
                            onClick={handleSaveCommand}
                            disabled={!newCommand.trim()}
                        >
                            <span className="text-xs font-bold">+S</span> 
                        </Button>
                        <Button type="submit" size="icon" className="h-8 w-8 shrink-0" title="Run Command">
                            <Plus className="w-4 h-4" />
                        </Button>
                    </form>
                </div>
                
                <ScrollArea className="flex-1">
                    <div className="p-2 space-y-1">
                        {processes.map(proc => (
                            <div 
                                key={proc.id}
                                onClick={() => setSelectedId(proc.id)}
                                className={`
                                    group flex items-center justify-between p-2 rounded-md cursor-pointer text-sm transition-colors
                                    ${selectedId === proc.id ? 'bg-primary/10 text-primary' : 'hover:bg-muted'}
                                `}
                            >
                                <div className="flex items-center gap-2 truncate flex-1 min-w-0">
                                    <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse shrink-0" />
                                    <span className="truncate font-mono text-xs" title={proc.command}>
                                        {proc.command}
                                    </span>
                                </div>
                                <Button 
                                    variant="ghost" 
                                    size="icon" 
                                    className="h-6 w-6 opacity-0 group-hover:opacity-100 hover:text-destructive hover:bg-destructive/10"
                                    onClick={(e) => handleStop(proc.id, e)}
                                >
                                    <Square className="w-3 h-3 fill-current" />
                                </Button>
                            </div>
                        ))}
                        {processes.length === 0 && (
                            <div className="p-4 text-center text-xs text-muted-foreground">
                                No active processes
                            </div>
                        )}

                        {snippets.length > 0 && (
                            <>
                                <div className="mt-4 mb-2 px-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                    Saved Commands
                                </div>
                                {snippets.map((snip: Snippet) => (
                                    <div
                                        key={snip.id}
                                        onClick={(e) => {
                                            handleStart(e as unknown as React.FormEvent, snip.command);
                                        }}
                                        className="group/item flex items-center justify-between p-2 rounded-md hover:bg-muted cursor-pointer text-sm font-mono text-muted-foreground hover:text-foreground transition-colors"
                                    >
                                        <div className="flex items-center gap-2 truncate flex-1 min-w-0">
                                            <Plus className="w-3 h-3 shrink-0 opacity-50" />
                                            <span className="truncate" title={snip.command}>{snip.label}</span>
                                        </div>
                                        <Button 
                                            variant="ghost" 
                                            size="icon" 
                                            className="h-6 w-6 opacity-0 group-hover/item:opacity-100 hover:text-destructive hover:bg-destructive/10"
                                            onClick={(e) => handleDeleteSnippet(snip.id, e)}
                                        >
                                            <Trash2 className="w-3 h-3" />
                                        </Button>
                                    </div>
                                ))}
                            </>
                        )}
                    </div>
                </ScrollArea>
            </div>

            {/* Main Terminal Area */}
            <div className="flex-1 h-full min-w-0 bg-zinc-950 flex flex-col">
                {selectedId ? (
                    <ProjectTerminal processId={selectedId} />
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-zinc-500 gap-2">
                        <TerminalIcon className="w-12 h-12 opacity-20" />
                        <p className="text-sm">Select or start a process</p>
                    </div>
                )}
            </div>
        </div>
    );
};
