import React, { useEffect, useState, useRef, useCallback } from 'react';
import { invokeCommand } from '../../lib/tauri';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Plus, Trash2, Globe, Rocket, Terminal, FileCode, Play } from 'lucide-react';
import { toast } from 'sonner';
import { Tabs, TabsList, TabsTrigger } from '../ui/tabs';
import { Badge } from '../ui/badge';
import { PlaybookRunStatus, type PlaybookRunStatusHandle } from './PlaybookRunStatus';
import { PlaybookEditor } from './PlaybookEditor';
import type { ProjectPlaybook, PlaybookStep } from '../../types';

interface ProjectLink {
    id: string;
    project_id: string;
    title: string;
    url: string;
    icon: string | null;
    kind: 'url' | 'command' | 'repository';
    working_directory?: string;
}

interface LaunchpadPanelProps {
    projectId: string;
    projectPath: string;
}

export const LaunchpadPanel: React.FC<LaunchpadPanelProps> = ({ projectId, projectPath }) => {
    const playbookRef = useRef<PlaybookRunStatusHandle>(null);
    const [editorOpen, setEditorOpen] = useState(false);
    const [editingPlaybook, setEditingPlaybook] = useState<ProjectPlaybook | undefined>();
    const [editingSteps, setEditingSteps] = useState<PlaybookStep[] | undefined>();
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
            toast.success("Item added to Launchpad");
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
                toast.success(`Started: ${link.title}`);
            } else if (link.kind === 'repository') {
                await invokeCommand('open_in_editor', { path: link.url });
                toast.success(`Opening Editor`);
            } else {
                const validUrl = ensureProtocol(link.url);
                await invokeCommand('open_url', { url: validUrl });
            }
        } catch {
            toast.error("Failed to launch");
        }
    };

    const handleOpenAll = async () => {
        if (links.length === 0 && !playbookRef.current?.hasPlaybooks) return;

        if (playbookRef.current?.hasPlaybooks && !playbookRef.current.isRunning) {
            playbookRef.current.runFirst();
        }

        let successCount = 0;
        try {
            for (const link of links) {
                const kind = link.kind || 'url';
                if (kind === 'command') {
                     const cwd = link.working_directory || projectPath;
                     await invokeCommand('start_process', { command: link.url, cwd });
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
            if (successCount > 0) {
                toast.success(`Launched ${successCount} items`);
            }
        } catch {
            toast.error("Launch sequence interrupted");
        }
    };

    const handleNewPlaybook = useCallback(() => {
        setEditingPlaybook(undefined);
        setEditingSteps(undefined);
        setEditorOpen(true);
    }, []);

    const handleEditPlaybook = useCallback(async (playbookId: string) => {
        try {
            const playbooks = await invokeCommand<ProjectPlaybook[]>('get_project_playbooks', { projectId });
            const pb = playbooks.find(p => p.id === playbookId);
            const steps = await invokeCommand<PlaybookStep[]>('get_playbook_steps', { playbookId });
            setEditingPlaybook(pb);
            setEditingSteps(steps);
            setEditorOpen(true);
        } catch {
            toast.error('Failed to load playbook');
        }
    }, [projectId]);

    const handleEditorClose = useCallback(() => {
        setEditorOpen(false);
        setEditingPlaybook(undefined);
        setEditingSteps(undefined);
    }, []);

    const repos = links.filter(l => l.kind === 'repository');
    const commands = links.filter(l => l.kind === 'command');
    const urls = links.filter(l => l.kind === 'url' || !l.kind); // Default to url

    const renderCard = (link: ProjectLink, icon: React.ReactNode, bgColor: string) => (
        <Card key={link.id} className="group hover:border-primary/50 transition-all shadow-sm cursor-pointer" onClick={() => handleOpen(link)}>
            <CardContent className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-4 min-w-0">
                    <div className={`p-2 rounded-md ${bgColor}`}>
                        {icon}
                    </div>
                    <div className="min-w-0">
                        <div className="font-medium text-sm text-foreground truncate">{link.title}</div>
                        <div className="text-xs text-muted-foreground truncate font-mono max-w-[300px] flex items-center gap-2">
                             {link.url}
                             {link.working_directory && (
                                <Badge variant="outline" className="text-[10px] h-4 px-1 py-0 border-border/50 text-muted-foreground">
                                    in .../{link.working_directory.split('/').pop()}
                                </Badge>
                             )}
                        </div>
                    </div>
                </div>
                
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        onClick={(e) => handleDelete(link.id, e)}
                        title="Remove"
                    >
                        <Trash2 className="w-4 h-4" />
                    </Button>
                    <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-8 w-8 text-primary hover:bg-primary/10"
                        onClick={(e) => {
                            e.stopPropagation();
                            handleOpen(link);
                        }}
                        title="Launch"
                    >
                        <Play className="w-4 h-4" />
                    </Button>
                </div>
            </CardContent>
        </Card>
    );

    if (editorOpen) {
        return (
            <PlaybookEditor
                projectId={projectId}
                playbook={editingPlaybook}
                existingSteps={editingSteps}
                onClose={handleEditorClose}
                onSaved={() => {
                    handleEditorClose();
                    // PlaybookRunStatus will reload on its own via loadPlaybooks
                }}
            />
        );
    }

    return (
        <div className="h-full w-full p-6 overflow-y-auto bg-muted/5 scrollbar-thin">
            <div className="max-w-5xl mx-auto space-y-8">
                
                {/* Header */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
                            <Rocket className="w-6 h-6 text-primary" />
                            Launchpad
                        </h1>
                        <p className="text-muted-foreground text-sm mt-1">
                            Orchestrate your development environment with one click.
                        </p>
                    </div>
                    <div className="flex gap-3">
                         {links.length > 0 && (
                            <Button size="default" className="gap-2 shadow-sm" onClick={handleOpenAll}>
                                <Rocket className="w-4 h-4" />
                                Launch Environment
                            </Button>
                        )}
                        <Button variant="secondary" onClick={() => setIsCreating(true)}>
                            <Plus className="w-4 h-4 mr-2" />
                            Add Item
                        </Button>
                    </div>
                </div>

                {/* Create Dialog / Area */}
                {isCreating && (
                     <Card className="border-border shadow-sm animate-in fade-in slide-in-from-top-2">
                        <CardHeader className="pb-3">
                             <CardTitle className="text-base">Add Launch Item</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                             <Tabs value={createType} onValueChange={(v: string) => setCreateType(v as 'url' | 'command' | 'repository')} className="w-full">
                                <TabsList className="grid w-full grid-cols-3">
                                    <TabsTrigger value="url">Link</TabsTrigger>
                                    <TabsTrigger value="command">Command</TabsTrigger>
                                    <TabsTrigger value="repository">Repository</TabsTrigger>
                                </TabsList>
                            </Tabs>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                     <label className="text-xs font-medium">Display Title</label>
                                     <Input 
                                        placeholder="e.g. Backend Server"
                                        value={newTitle}
                                        onChange={e => setNewTitle(e.target.value)}
                                     />
                                </div>
                                <div className="space-y-2">
                                     <label className="text-xs font-medium">
                                         {createType === 'url' ? 'URL' : createType === 'command' ? 'Terminal Command' : 'Repository Path'}
                                     </label>
                                     <Input 
                                        placeholder={createType === 'url' ? "https://..." : createType === 'command' ? "npm run dev" : "/absolute/path/to/repo"}
                                        value={newValue}
                                        onChange={e => setNewValue(e.target.value)}
                                        className="font-mono text-sm"
                                     />
                                </div>
                            </div>

                            {createType === 'command' && (
                                <div className="space-y-2">
                                    <label className="text-xs font-medium">Working Directory (Optional)</label>
                                    <Input 
                                        placeholder="Defaults to project root" 
                                        value={newCwd} 
                                        onChange={e => setNewCwd(e.target.value)}
                                        className="font-mono text-sm" 
                                    />
                                </div>
                            )}

                            <div className="flex justify-end gap-2 pt-2">
                                <Button variant="ghost" onClick={() => setIsCreating(false)}>Cancel</Button>
                                <Button onClick={handleCreate} disabled={!newTitle || !newValue}>Add Item</Button>
                            </div>
                        </CardContent>
                     </Card>
                )}

                {/* Sections */}
                <div className="space-y-8">

                    {/* Playbooks */}
                    <PlaybookRunStatus
                        ref={playbookRef}
                        projectId={projectId}
                        projectPath={projectPath}
                        onNewPlaybook={handleNewPlaybook}
                        onEditPlaybook={handleEditPlaybook}
                    />

                    {/* Repositories */}
                    <div className="space-y-3">
                        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                            <FileCode className="w-4 h-4" />
                            Repositories
                        </h2>
                        {repos.length === 0 ? (
                            <div className="p-8 border border-dashed rounded-lg text-center text-muted-foreground text-sm bg-muted/50">
                                Link related repositories to open them instantly.
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                {repos.map(l => renderCard(l, <FileCode className="w-5 h-5" />, 'bg-orange-100 dark:bg-orange-950/30 text-orange-600 dark:text-orange-400'))}
                            </div>
                        )}
                    </div>

                    {/* Commands */}
                    <div className="space-y-3">
                        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                            <Terminal className="w-4 h-4" />
                            Startup Commands
                        </h2>
                        {commands.length === 0 ? (
                             <div className="p-8 border border-dashed rounded-lg text-center text-muted-foreground text-sm bg-muted/50">
                                Add startup scripts (npm run dev, docker compose, etc.).
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                {commands.map(l => renderCard(l, <Terminal className="w-5 h-5" />, 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'))}
                            </div>
                        )}
                    </div>

                    {/* Context Links */}
                    <div className="space-y-3">
                        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                            <Globe className="w-4 h-4" />
                            Context & Links
                        </h2>
                        {urls.length === 0 ? (
                             <div className="p-8 border border-dashed rounded-lg text-center text-muted-foreground text-sm bg-muted/50">
                                Add project links (Figma, Linear, Localhost) for quick access.
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                                {urls.map(l => renderCard(l, <Globe className="w-5 h-5" />, 'bg-blue-100 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400'))}
                            </div>
                        )}
                    </div>

                </div>
            </div>
        </div>
    );
};
