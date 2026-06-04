import React, { useEffect, useState, useMemo } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Card, CardContent } from '../ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '../ui/dialog';
import { Plus, Trash2, Calendar, Notebook, Loader2, Settings2, X, FileText, Presentation } from 'lucide-react';
import { invokeCommand } from '../../lib/tauri';
import { toast } from 'sonner';
import { useAppStore } from '../../stores/useAppStore';
import type { ProjectNote, ProjectSettings } from '../../types';
import { Editor } from '../ui/editor';
import { WhiteboardEditor } from '../ui/whiteboard';
import { Tabs, TabsList, TabsTrigger } from '../ui/tabs';

interface NotesPanelProps {
    projectId: string;
}

const DEFAULT_LABELS: Record<string, string> = {
    yellow: 'General',
    blue: 'Idea',
    green: 'Done',
    red: 'Bug',
    purple: 'Feature'
};

const COLORS = [
    { id: 'yellow', bg: 'bg-yellow-50 dark:bg-yellow-950/30', border: 'border-yellow-200 dark:border-yellow-800', indicator: 'bg-yellow-400' },
    { id: 'blue', bg: 'bg-blue-50 dark:bg-blue-950/30', border: 'border-blue-200 dark:border-blue-800', indicator: 'bg-blue-400' },
    { id: 'green', bg: 'bg-green-50 dark:bg-green-950/30', border: 'border-green-200 dark:border-green-800', indicator: 'bg-green-400' },
    { id: 'red', bg: 'bg-red-50 dark:bg-red-950/30', border: 'border-red-200 dark:border-red-800', indicator: 'bg-red-400' },
    { id: 'purple', bg: 'bg-purple-50 dark:bg-purple-950/30', border: 'border-purple-200 dark:border-purple-800', indicator: 'bg-purple-400' },
];

export const NotesPanel: React.FC<NotesPanelProps> = ({ projectId }) => {
    const [notes, setNotes] = useState<ProjectNote[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    
    // Project Settings from Store
    const project = useAppStore(s => s.projects.find(p => p.id === projectId));
    const updateProjectSettings = useAppStore(s => s.updateProjectSettings);

    const labels = useMemo(() => {
        if (!project?.settings) return DEFAULT_LABELS;
        try {
            const parsed: ProjectSettings = JSON.parse(project.settings);
            return { ...DEFAULT_LABELS, ...parsed.note_labels };
        } catch (e) {
            return DEFAULT_LABELS;
        }
    }, [project?.settings]);

    // Editor State
    const [isEditorOpen, setIsEditorOpen] = useState(false);
    const [viewMode, setViewMode] = useState<'view' | 'edit'>('view');
    const [editingNote, setEditingNote] = useState<ProjectNote | null>(null);
    const [title, setTitle] = useState('');
    const [content, setContent] = useState('');
    const [color, setColor] = useState('yellow');
    const [kind, setKind] = useState<'text' | 'canvas'>('text');

    // Settings State
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [tempLabels, setTempLabels] = useState<Record<string, string>>(DEFAULT_LABELS);

    // Delete State
    const [noteToDelete, setNoteToDelete] = useState<ProjectNote | null>(null);

    // Filter State
    const [activeFilter, setActiveFilter] = useState<string | null>(null);

    // Filtered Notes
    const filteredNotes = useMemo(() => {
        if (!activeFilter) return notes;
        return notes.filter(n => n.color === activeFilter);
    }, [notes, activeFilter]);

    const fetchNotes = async () => {
        setIsLoading(true);
        try {
            const data = await invokeCommand<ProjectNote[]>('get_project_notes', { projectId });
            // Normalize kind if missing (for old notes)
            const normalized = data.map(n => ({...n, kind: n.kind || 'text'}));
            setNotes(normalized);
        } catch {
            toast.error("Failed to load notes");
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchNotes();
    }, [projectId]);

    const handleCreate = () => {
        setEditingNote(null);
        setTitle('');
        setContent('');
        setColor('yellow');
        setKind('text'); // Default to text
        setViewMode('edit'); 
        setIsEditorOpen(true);
    };

    const handleOpenNote = (note: ProjectNote) => {
        setEditingNote(note);
        setTitle(note.title);
        setContent(note.content);
        setColor(note.color);
        setKind(note.kind || 'text');
        setViewMode('view');
        setIsEditorOpen(true);
    };

    const handleSave = async () => {
        let safeTitle = title.trim();
        if (!safeTitle) safeTitle = "Untitled Note";

        try {
            if (editingNote) {
                await invokeCommand('update_project_note', {
                    id: editingNote.id,
                    title: safeTitle,
                    content,
                    color,
                    kind
                });
                toast.success("Note saved");
                setViewMode('view');
            } else {
                await invokeCommand('create_project_note', {
                    projectId,
                    title: safeTitle,
                    content,
                    color,
                    kind
                });
                toast.success("Note created");
                setIsEditorOpen(false); 
            }
            fetchNotes(); 
        } catch {
            toast.error("Failed to save note");
        }
    };

    const confirmDelete = async () => {
        if (!noteToDelete) return;
        
        try {
            await invokeCommand('delete_project_note', { id: noteToDelete.id });
            toast.success("Note deleted");
            setNoteToDelete(null);
            fetchNotes();
        } catch {
            toast.error("Failed to delete note");
        }
    };

    const openSettings = () => {
        setTempLabels({...labels});
        setIsSettingsOpen(true);
    }

    const saveSettings = async () => {
        try {
            const settingsObj: ProjectSettings = { note_labels: tempLabels };
            await updateProjectSettings(projectId, JSON.stringify(settingsObj));
            toast.success("Labels updated");
            setIsSettingsOpen(false);
        } catch (e) {
            toast.error("Failed to save labels");
        }
    }

    const getColorStyle = (id: string) => COLORS.find(c => c.id === id) || COLORS[0];

    return (
        <div className="h-full flex flex-col p-4 space-y-4 overflow-hidden">
            <div className="flex items-center justify-between shrink-0">
                <div>
                    <h2 className="text-lg font-semibold flex items-center gap-2">
                        <Notebook className="w-5 h-5 text-primary" />
                        Project Notes
                    </h2>
                    <p className="text-sm text-muted-foreground">
                        Keep track of ideas, bugs, and designs.
                    </p>
                </div>
                <div className="flex gap-2 items-center">
                    {/* Filter UI */}
                    <div className="flex gap-1 mr-2 px-2 py-1 bg-muted/20 rounded-lg">
                        {COLORS.map(c => {
                            const isActive = activeFilter === c.id;
                            const label = labels[c.id];
                            return (
                                <button
                                    key={c.id}
                                    onClick={() => setActiveFilter(isActive ? null : c.id)}
                                    className={`w-4 h-4 rounded-full transition-all ${c.indicator} ${isActive ? 'ring-2 ring-foreground ring-offset-2 scale-110' : 'opacity-40 hover:opacity-80 hover:scale-105'}`}
                                    title={`Filter by ${label}`}
                                />
                            )
                        })}
                        {activeFilter && (
                             <button
                                onClick={() => setActiveFilter(null)}
                                className="ml-1 text-muted-foreground hover:text-foreground"
                                title="Clear filter"
                            >
                                <X className="w-3 h-3" />
                            </button>
                        )}
                    </div>
                
                    <Button variant="outline" size="sm" onClick={openSettings}>
                        <Settings2 className="w-4 h-4 mr-1" />
                        Labels
                    </Button>
                    <Button size="sm" onClick={handleCreate} className="gap-1">
                        <Plus className="w-4 h-4" />
                        New Note
                    </Button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto min-h-0">
                {isLoading ? (
                    <div className="flex items-center justify-center h-40">
                        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                    </div>
                ) : filteredNotes.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-60 text-muted-foreground border-2 border-dashed rounded-lg">
                        <Notebook className="w-10 h-10 mb-2 opacity-20" />
                        <p>{notes.length > 0 ? "No notes match this filter" : "No notes yet"}</p>
                        {notes.length === 0 && (
                            <Button variant="link" onClick={handleCreate}>Create one</Button>
                        )}
                        {notes.length > 0 && (
                            <Button variant="link" onClick={() => setActiveFilter(null)}>Clear filter</Button>
                        )}
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pb-10">
                        {filteredNotes.map(note => {
                            const style = getColorStyle(note.color);
                            const label = labels[note.color] || 'Note';
                            const isCanvas = note.kind === 'canvas';
                            
                            return (
                                <Card 
                                    key={note.id} 
                                    className={`group cursor-pointer transition-all hover:scale-[1.02] hover:shadow-md ${style.bg} ${style.border} border h-[240px] flex flex-col`}
                                    onClick={() => handleOpenNote(note)}
                                >
                                    <div className={`h-1 w-full rounded-t-lg ${style.indicator}`} />
                                    <CardContent className="p-4 space-y-2 flex-1 flex flex-col overflow-hidden">
                                        <div className="flex justify-between items-start shrink-0">
                                            <div className="space-y-1 overflow-hidden">
                                                <div className="text-[10px] uppercase font-bold tracking-wider opacity-60 flex items-center gap-1">
                                                    {isCanvas ? <Presentation className="w-3 h-3" /> : <FileText className="w-3 h-3" />}
                                                    {label}
                                                </div>
                                                <h3 className="font-semibold leading-tight truncate pr-1">{note.title}</h3>
                                            </div>
                                            <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                                                 <Button 
                                                    variant="ghost" 
                                                    size="icon" 
                                                    className="h-6 w-6 text-muted-foreground hover:text-red-500 hover:bg-red-500/10 -mt-1 -mr-2 relative z-10"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setNoteToDelete(note);
                                                    }}
                                                >
                                                    <Trash2 className="w-3 h-3" />
                                                </Button>
                                            </div>
                                        </div>
                                        
                                        {/* Content Preview */}
                                        <div className="flex-1 overflow-hidden relative text-sm text-muted-foreground">
                                            {isCanvas ? (
                                                <div className="flex items-center justify-center h-full opacity-50 bg-background/50 rounded-md">
                                                    <div className="text-center">
                                                        <Presentation className="w-8 h-8 mx-auto mb-1 opacity-50" />
                                                        <span className="text-xs">Whiteboard Canvas</span>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div 
                                                    className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-headings:my-2 prose-blockquote:my-1 text-[13px] leading-relaxed opacity-80 pointer-events-none"
                                                    dangerouslySetInnerHTML={{ __html: note.content }} 
                                                />
                                            )}
                                            {!isCanvas && <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-background/10 to-transparent" />}
                                        </div>

                                        <div className="pt-2 flex items-center text-[10px] text-muted-foreground/70 gap-1 shrink-0 border-t border-border/10 mt-1">
                                            <Calendar className="w-3 h-3" />
                                            {note.updated_at} 
                                        </div>
                                    </CardContent>
                                </Card>
                            )
                        })}
                    </div>
                )}
            </div>

            {/* Editor Dialog */}
            <Dialog 
                open={isEditorOpen} 
                onOpenChange={(open) => {
                    if (!open && viewMode === 'edit') {
                        // Implicit save
                        handleSave(); 
                    }
                    setIsEditorOpen(open);
                }}
            >
                <DialogContent className="max-w-6xl max-h-[95vh] h-[90vh] flex flex-col p-6">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                             {viewMode === 'edit' ? (editingNote ? 'Edit Note' : 'New Note') : (
                                <span className="flex items-center gap-2">
                                    {kind === 'canvas' ? <Presentation className="w-4 h-4 text-primary" /> : <FileText className="w-4 h-4 text-primary" />}
                                    Note Details
                                </span>
                             )}
                        </DialogTitle>
                    </DialogHeader>
                    
                    <div className="flex-1 flex flex-col space-y-4 overflow-hidden">
                        <div className="flex gap-4">
                            <div className="flex-1 space-y-1">
                                {viewMode === 'edit' ? (
                                    <>
                                        <div className="flex items-center justify-between mb-1">
                                             <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Title</label>
                                             {/* Only show toggle for NEW notes */}
                                             {!editingNote && (
                                                <Tabs value={kind} onValueChange={(v: string) => setKind(v as 'text' | 'canvas')} className="h-6">
                                                    <TabsList className="h-6 p-0 bg-muted/50">
                                                        <TabsTrigger value="text" className="text-xs px-2 h-5">Text</TabsTrigger>
                                                        <TabsTrigger value="canvas" className="text-xs px-2 h-5">Canvas</TabsTrigger>
                                                    </TabsList>
                                                </Tabs>
                                             )}
                                        </div>
                                        <Input 
                                            className="text-lg font-semibold"
                                            placeholder="Note Title" 
                                            value={title}
                                            onChange={e => setTitle(e.target.value)}
                                            autoFocus
                                        />
                                    </>
                                ) : (
                                    <h1 className="text-2xl font-bold tracking-tight py-2">{title}</h1>
                                )}
                            </div>

                            <div className="space-y-1 shrink-0">
                                {viewMode === 'edit' && <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Category</label>}
                                <div className="flex gap-2 items-center h-full">
                                    {COLORS.map(c => (
                                        <button
                                            key={c.id}
                                            onClick={() => viewMode === 'edit' && setColor(c.id)}
                                            className={`w-9 h-9 rounded-full border text-xs font-medium transition-all flex items-center justify-center ${c.bg} ${c.border} ${color === c.id ? 'ring-2 ring-primary ring-offset-2 scale-110' : 'opacity-70 hover:opacity-100 scale-100'} ${viewMode === 'view' && color !== c.id ? 'hidden' : ''} ${viewMode === 'view' ? 'cursor-default ring-0 scale-100' : ''}`}
                                            title={labels[c.id]}
                                            disabled={viewMode === 'view'}
                                        >
                                            <span className={`w-3 h-3 rounded-full ${c.indicator}`} />
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>

                        <div className={`flex-1 overflow-hidden flex flex-col relative ${viewMode === 'view' && kind === 'text' ? '' : 'border rounded-lg bg-background'}`}>
                            {kind === 'canvas' ? (
                                <WhiteboardEditor 
                                    initialData={content} 
                                    onChange={setContent}
                                    editable={viewMode === 'edit'}
                                />
                            ) : (
                                <Editor 
                                    content={content} 
                                    onChange={setContent} 
                                    projectId={projectId}
                                    editable={viewMode === 'edit'}
                                    className={viewMode === 'view' ? 'prose-headings:mt-0 px-0' : ''}
                                />
                            )}
                        </div>
                    </div>

                    <div className="mt-2 text-sm text-muted-foreground w-full flex justify-between items-center">
                        {viewMode === 'view' ? (
                            <>
                                <p className="text-xs">
                                    Last updated: {editingNote?.updated_at}
                                </p>
                                <div className="flex gap-2">
                                    <Button variant="outline" onClick={() => setIsEditorOpen(false)}>Close</Button>
                                    <Button onClick={() => setViewMode('edit')}>Edit Note</Button>
                                </div>
                            </>
                        ) : (
                            <>
                                <p className="text-xs italic opacity-70">
                                    {kind === 'canvas' ? "Drawings auto-save" : "Changes are saved automatically"}
                                </p>
                                <div className="flex gap-2">
                                    <Button onClick={handleSave}>Done</Button>
                                </div>
                            </>
                        )}
                    </div>
                </DialogContent>
            </Dialog>

            {/* Settings Dialog */}
            <Dialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Customize Labels</DialogTitle>
                        <DialogDescription>
                            Define what each color represents for this project.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        {COLORS.map(c => (
                            <div key={c.id} className="grid grid-cols-4 items-center gap-4">
                                <div className="flex items-center gap-2 col-span-1">
                                    <div className={`w-4 h-4 rounded-full ${c.indicator}`} />
                                    <span className="text-sm font-medium capitalize">{c.id}</span>
                                </div>
                                <Input 
                                    className="col-span-3" 
                                    value={tempLabels[c.id] || ''} 
                                    onChange={e => setTempLabels(prev => ({...prev, [c.id]: e.target.value}))}
                                    placeholder={`Label for ${c.id}`}
                                />
                            </div>
                        ))}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsSettingsOpen(false)}>Cancel</Button>
                        <Button onClick={saveSettings}>Save Changes</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Delete Confirmation Dialog */}
            <Dialog open={!!noteToDelete} onOpenChange={(open) => !open && setNoteToDelete(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Delete Note</DialogTitle>
                        <DialogDescription>
                            Are you sure you want to delete <span className="font-semibold text-foreground">"{noteToDelete?.title}"</span>? This action cannot be undone.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setNoteToDelete(null)}>Cancel</Button>
                        <Button variant="destructive" onClick={confirmDelete}>Delete</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
};
