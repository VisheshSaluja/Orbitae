import React, { useEffect, useState } from 'react';
import { invokeCommand } from '../../lib/tauri';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { Input } from '../ui/input';
import { ExternalLink, Plus, Trash2, Globe, Rocket, Terminal, FileCode } from 'lucide-react';
import { toast } from 'sonner';
import { Tabs, TabsList, TabsTrigger } from '../ui/tabs';

interface ProjectLink {
    id: string;
    project_id: string;
    title: string;
    url: string;
    icon: string | null;
    kind: 'url' | 'command' | 'repository';
    working_directory?: string;
}

interface LinksPanelProps {
    projectId: string;
    projectPath: string;
}

export const LinksPanel: React.FC<LinksPanelProps> = ({ projectId, projectPath }) => {
    const [links, setLinks] = useState<ProjectLink[]>([]);
    const [newTitle, setNewTitle] = useState('');
    const [newValue, setNewValue] = useState('');
    const [newCwd, setNewCwd] = useState('');
    const [isCreating, setIsCreating] = useState(false);
    const [createType, setCreateType] = useState<'url' | 'command' | 'repository'>('url');

    useEffect(() => {
        loadLinks();
    }, [projectId]);

    const loadLinks = async () => {
        try {
            const data = await invokeCommand<ProjectLink[]>('get_project_links', { projectId });
            const normalized = data.map(d => ({ ...d, kind: d.kind || 'url' }));
            setLinks(normalized);
        } catch {
            // Failed to load links — non-critical
        }
    };

    const ensureProtocol = (url: string) => {
        if (!url) return '';
        if (url.startsWith('http://') || url.startsWith('https://')) return url;
        return `https://${url}`;
    };

    const handleCreate = async () => {
        if (!newTitle || !newValue) return;
        
        let finalValue = newValue;
        if (createType === 'url') {
            finalValue = ensureProtocol(newValue);
        }

        try {
            await invokeCommand('add_project_link', {
                projectId,
                title: newTitle,
                url: finalValue,
                icon: null,
                kind: createType,
                working_directory: createType === 'command' && newCwd ? newCwd : null
            });
            setNewTitle('');
            setNewValue('');
            setNewCwd('');
            setIsCreating(false);
            loadLinks();
            toast.success("Item added");
        } catch {
            toast.error("Failed to add item");
        }
    };

    const handleDelete = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        try {
            await invokeCommand('delete_project_link', { id });
            loadLinks();
            toast.success("Removed");
        } catch {
            toast.error("Failed to remove");
        }
    };

    const handleOpen = async (link: ProjectLink) => {
        try {
            if (link.kind === 'command') {
                const cwd = link.working_directory || projectPath;
                await invokeCommand('start_process', { 
                    command: link.url, 
                    cwd
                });
                toast.success(`Started: ${link.title} in ${cwd.split('/').pop()}`);
            } else if (link.kind === 'repository') {
                await invokeCommand('open_in_editor', { path: link.url });
                toast.success(`Opening ${link.title} in Editor`);
            } else {
                const validUrl = ensureProtocol(link.url);
                await invokeCommand('open_url', { url: validUrl });
            }
        } catch {
            toast.error("Failed to launch");
        }
    };

    const handleOpenAll = async () => {
        if (links.length === 0) return;
        let successCount = 0;
        try {
            for (const link of links) {
                const kind = link.kind || 'url';
                
                if (kind === 'command') {
                     const cwd = link.working_directory || projectPath;
                     await invokeCommand('start_process', { 
                        command: link.url, 
                        cwd
                    });
                     successCount++;
                } else if (kind === 'repository') {
                    await invokeCommand('open_in_editor', { path: link.url });
                    successCount++;
                } else {
                    const validUrl = ensureProtocol(link.url);
                    await invokeCommand('open_url', { url: validUrl });
                    successCount++;
                }
            }
            toast.success(`Launched ${successCount} items`);
        } catch {
            toast.error("Failed to launch all items");
        }
    };

    const getIcon = (kind: string) => {
        switch (kind) {
            case 'command': return <Terminal className="w-4 h-4" />;
            case 'repository': return <FileCode className="w-4 h-4" />;
            default: return <Globe className="w-4 h-4" />;
        }
    };
    
    const getBgColor = (kind: string) => {
         switch (kind) {
            case 'command': return 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400';
            case 'repository': return 'bg-orange-100 dark:bg-orange-950/30 text-orange-600 dark:text-orange-400';
            default: return 'bg-primary/10 text-primary';
        }
    };

    return (
        <div className="space-y-3 h-full flex flex-col">
            {/* Header */}
            <div className="flex justify-between items-center p-1">
                 <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <Rocket className="w-4 h-4" />
                    Launchpad
                </h3>
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setIsCreating(!isCreating)} title="Add Item">
                    <Plus className="w-4 h-4" />
                </Button>
            </div>

            {/* Launch Action */}
            {links.length > 0 && (
                <Button variant="default" className="w-full gap-2 shadow-sm" onClick={handleOpenAll}>
                    <Rocket className="w-4 h-4" />
                    Launch Environment
                </Button>
            )}

            {isCreating && (
                <div className="p-3 border border-border/50 rounded-lg bg-muted/50 space-y-3">
                    <Tabs value={createType} onValueChange={(v: string) => setCreateType(v as 'url' | 'command' | 'repository')} className="w-full">
                        <TabsList className="grid w-full grid-cols-3 h-7 p-0.5">
                            <TabsTrigger value="url" className="text-xs h-6">Link</TabsTrigger>
                            <TabsTrigger value="command" className="text-xs h-6">Command</TabsTrigger>
                            <TabsTrigger value="repository" className="text-xs h-6">Repo</TabsTrigger>
                        </TabsList>
                    </Tabs>
                    <Input 
                        placeholder="Title (e.g. Backend Repo / Start DB)"
                        value={newTitle} 
                        onChange={e => setNewTitle(e.target.value)}
                        className="bg-background h-8 text-sm"
                    />
                    <div className="flex flex-col gap-2">
                         <div className="flex gap-2">
                            <Input 
                                placeholder={
                                    createType === 'url' ? "https://..." : 
                                    createType === 'repository' ? "/absolute/path/to/repo" : "npm run dev"
                                }
                                value={newValue} 
                                onChange={e => setNewValue(e.target.value)}
                                className="font-mono text-xs bg-background h-8 flex-1"
                            />
                            <Button onClick={handleCreate} disabled={!newTitle || !newValue} size="sm" className="h-8">
                                Save
                            </Button>
                        </div>
                        {createType === 'command' && (
                             <Input 
                                placeholder="Working Directory (Optional, defaults to project root)" 
                                value={newCwd} 
                                onChange={e => setNewCwd(e.target.value)}
                                className="font-mono text-[10px] bg-background h-7"
                            />
                        )}
                        {createType === 'repository' && (
                             <p className="text-[10px] text-muted-foreground px-1">
                                 Path to the repository folder. Launches in your default editor.
                             </p>
                        )}
                    </div>
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 overflow-y-auto pr-1">
                {links.length === 0 && !isCreating && (
                   <p className="text-center text-xs text-muted-foreground py-8 col-span-2 border border-dashed border-border rounded-lg">
                       Add links, repos, or commands to your launch environment.
                   </p>
                )}
                {links.map(link => (
                    <Card key={link.id} className="group hover:border-primary/40 transition-all shadow-sm cursor-pointer" onClick={() => handleOpen(link)}>
                        <CardContent className="p-3 flex items-center justify-between">
                            <div className="flex items-center gap-3 min-w-0">
                                <div className={`p-1.5 rounded-md ${getBgColor(link.kind)}`}>
                                    {getIcon(link.kind)}
                                </div>
                                <div className="min-w-0">
                                    <div className="font-medium text-sm text-foreground truncate">{link.title}</div>
                                    <div className="text-xs text-muted-foreground truncate opacity-70 font-mono max-w-[150px]">
                                        {link.url}
                                        {link.working_directory && (
                                            <span className="ml-1 text-[10px] opacity-50 block">in .../{link.working_directory.split('/').pop()}</span>
                                        )}
                                    </div>
                                </div>
                            </div>
                            
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Button 
                                    variant="ghost" 
                                    size="icon" 
                                    className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                    onClick={(e) => handleDelete(link.id, e)}
                                    title="Remove"
                                >
                                    <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                                <Button 
                                    variant="ghost" 
                                    size="icon" 
                                    className="h-7 w-7 text-primary hover:bg-primary/10"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleOpen(link);
                                    }}
                                    title="Launch"
                                >
                                    <ExternalLink className="w-3.5 h-3.5" />
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>
        </div>
    );
};
