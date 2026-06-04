import React, { useEffect, useState } from 'react';
import type { Snippet } from '../../types';
import { invokeCommand } from '../../lib/tauri';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { Input } from '../ui/input';
import { Plus, Play, Copy, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

interface SnippetsPanelProps {
    projectId: string;
    onRun: (command: string) => void;
}

export const SnippetsPanel: React.FC<SnippetsPanelProps> = ({ projectId, onRun }) => {
    const [snippets, setSnippets] = useState<Snippet[]>([]);
    const [newLabel, setNewLabel] = useState('');
    const [newCommand, setNewCommand] = useState('');
    const [isCreating, setIsCreating] = useState(false);

    useEffect(() => {
        loadSnippets();
    }, [projectId]);

    const loadSnippets = async () => {
        try {
            const data = await invokeCommand<Snippet[]>('get_project_snippets', { projectId });
            setSnippets(data);
        } catch {
            // Failed to load snippets — non-critical
        }
    };

    const handleCreate = async () => {
        if (!newLabel || !newCommand) return;
        try {
            await invokeCommand('add_snippet', {
                projectId,
                label: newLabel,
                command: newCommand,
                description: null
            });
            setNewLabel('');
            setNewCommand('');
            setIsCreating(false);
            loadSnippets();
            toast.success("Snippet saved");
        } catch {
            toast.error("Failed to save snippet");
        }
    };

    const handleDelete = async (id: string) => {
        try {
            await invokeCommand('delete_snippet', { id });
            toast.success("Snippet deleted");
            loadSnippets();
        } catch {
            toast.error("Failed to delete snippet");
        }
    };

    return (
        <div className="space-y-4 h-full flex flex-col">
            <div className="flex justify-between items-center">
                <h3 className="text-sm font-medium text-muted-foreground">Saved Commands</h3>
                <Button size="sm" variant="ghost" onClick={() => setIsCreating(!isCreating)}>
                    <Plus className="w-4 h-4 mr-2" />
                    New Snippet
                </Button>
            </div>

            {isCreating && (
                <div className="p-4 border border-border/50 rounded-lg bg-muted/50 space-y-3">
                    <Input 
                        placeholder="Label (e.g. Deploy Prod)" 
                        value={newLabel} 
                        onChange={e => setNewLabel(e.target.value)}
                        className="bg-background"
                    />
                    <div className="flex gap-2">
                        <Input 
                            placeholder="Command (e.g. npm run deploy)" 
                            value={newCommand} 
                            onChange={e => setNewCommand(e.target.value)}
                            className="font-mono text-sm bg-background"
                        />
                        <Button onClick={handleCreate} disabled={!newLabel || !newCommand}>
                            Save
                        </Button>
                    </div>
                </div>
            )}

            <div className="space-y-2 flex-1 overflow-auto">
                {snippets.length === 0 && !isCreating && (
                   <p className="text-center text-sm text-muted-foreground py-8">No snippets yet.</p>
                )}
                {snippets.map(snippet => (
                    <Card key={snippet.id} className="group hover:border-sidebar-accent/50 transition-colors">
                        <CardContent className="p-3 flex items-center justify-between">
                            <div className="min-w-0 flex-1 mr-4">
                                <div className="font-medium text-sm text-foreground">{snippet.label}</div>
                                <div className="font-mono text-xs text-muted-foreground truncate">{snippet.command}</div>
                            </div>
                            <div className="flex items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                                <Button 
                                    variant="ghost" 
                                    size="icon" 
                                    className="h-7 w-7"
                                    onClick={() => navigator.clipboard.writeText(snippet.command)}
                                    title="Copy to Clipboard"
                                >
                                    <Copy className="w-3.5 h-3.5" />
                                </Button>
                                <Button 
                                    variant="secondary" 
                                    size="sm" 
                                    className="h-7 gap-1.5"
                                    onClick={() => onRun(snippet.command)}
                                >
                                    <Play className="w-3 h-3" />
                                    Run
                                </Button>
                                <Button 
                                    variant="ghost" 
                                    size="icon" 
                                    className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                    onClick={() => handleDelete(snippet.id)}
                                    title="Delete Snippet"
                                >
                                    <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>
        </div>
    );
};
