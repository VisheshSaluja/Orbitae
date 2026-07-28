import React, { useState, useEffect } from 'react';
import type { Project, GitStatus } from '../types';
import { Button } from './ui/button';
import { FolderOpen, Pencil, Trash2, FolderSearch, GitBranch, ChevronRight } from 'lucide-react';
import { useAppStore } from '../stores/useAppStore';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from './ui/dialog';
import { Input } from './ui/input';
import { invokeCommand } from '../lib/tauri';
import { open } from '@tauri-apps/plugin-dialog';

interface ProjectCardProps {
    project: Project;
    onLaunch: (id: string) => void;
}

export const ProjectCard: React.FC<ProjectCardProps> = ({ project, onLaunch }) => {
    const { deleteProject, updateProject } = useAppStore();
    const [showEdit, setShowEdit] = useState(false);
    const [showDelete, setShowDelete] = useState(false);
    const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);

    const [editName, setEditName] = useState(project.name);
    const [editPath, setEditPath] = useState(project.path);

    useEffect(() => {
        invokeCommand<GitStatus | null>('get_git_status', { path: project.path })
            .then(setGitStatus)
            .catch(() => {});
    }, [project.path]);

    const handleDelete = async (e: React.MouseEvent) => {
        e.stopPropagation();
        await deleteProject(project.id);
        setShowDelete(false);
    };

    const handleUpdate = async () => {
        await updateProject(project.id, editName, editPath);
        setShowEdit(false);
    };

    const handleBrowse = async () => {
        try {
            const selected = await open({ directory: true, multiple: false, defaultPath: editPath });
            if (selected && typeof selected === 'string') setEditPath(selected);
        } catch { /* dialog cancelled */ }
    };

    const folderName = project.path.split('/').filter(Boolean).pop() ?? project.path;

    return (
        <>
            <button
                onClick={() => onLaunch(project.id)}
                className="group w-full text-left rounded-xl bg-[#111114] border border-white/[0.06] hover:border-white/[0.12] transition-all duration-200 overflow-hidden"
            >
                {/* Top accent gradient */}
                <div className="h-1 bg-gradient-to-r from-blue-500/60 via-blue-400/30 to-transparent" />

                <div className="p-4">
                    <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3 min-w-0">
                            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500/15 to-purple-500/10 border border-white/[0.06] flex items-center justify-center shrink-0">
                                <FolderOpen className="w-4 h-4 text-blue-400" />
                            </div>
                            <div className="min-w-0">
                                <div className="text-[13px] font-semibold text-[#e4e4e7] truncate group-hover:text-white transition-colors">
                                    {project.name}
                                </div>
                                <div className="text-[10px] font-mono text-[#52525b] truncate mt-0.5">
                                    ~/{folderName}
                                </div>
                            </div>
                        </div>

                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150 shrink-0">
                            <button
                                className="p-1.5 rounded-md text-[#52525b] hover:text-[#e4e4e7] hover:bg-white/[0.06] transition-colors"
                                onClick={(e) => { e.stopPropagation(); setShowEdit(true); }}
                            >
                                <Pencil className="w-3 h-3" />
                            </button>
                            <button
                                className="p-1.5 rounded-md text-[#52525b] hover:text-red-400 hover:bg-red-500/10 transition-colors"
                                onClick={(e) => { e.stopPropagation(); setShowDelete(true); }}
                            >
                                <Trash2 className="w-3 h-3" />
                            </button>
                        </div>
                    </div>

                    {/* Git status row */}
                    <div className="flex items-center justify-between mt-3.5 pt-3 border-t border-white/[0.04]">
                        <div className="flex items-center gap-3">
                            {gitStatus ? (
                                <>
                                    <div className="flex items-center gap-1.5 text-[11px] text-[#71717a]">
                                        <GitBranch className="w-3 h-3" />
                                        <span className="font-mono">{gitStatus.branch}</span>
                                    </div>
                                    {gitStatus.modified_count > 0 && (
                                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 font-mono">
                                            {gitStatus.modified_count} changed
                                        </span>
                                    )}
                                </>
                            ) : (
                                <span className="text-[10px] text-[#3f3f46]">No git repo</span>
                            )}
                        </div>
                        <ChevronRight className="w-3.5 h-3.5 text-[#3f3f46] group-hover:text-[#71717a] transition-colors" />
                    </div>
                </div>
            </button>

            <Dialog open={showEdit} onOpenChange={setShowEdit}>
                <DialogContent onClick={e => e.stopPropagation()}>
                    <DialogHeader>
                        <DialogTitle>Edit Project</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <div className="text-[13px] font-medium">Name</div>
                            <Input value={editName} onChange={e => setEditName(e.target.value)} />
                        </div>
                        <div className="space-y-2">
                            <div className="text-[13px] font-medium">Path</div>
                            <div className="flex gap-2">
                                <Input value={editPath} onChange={e => setEditPath(e.target.value)} className="font-mono text-[11px]" />
                                <Button variant="outline" size="icon" onClick={handleBrowse}>
                                    <FolderSearch className="w-4 h-4" />
                                </Button>
                            </div>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowEdit(false)}>Cancel</Button>
                        <Button onClick={handleUpdate}>Save</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={showDelete} onOpenChange={setShowDelete}>
                <DialogContent onClick={e => e.stopPropagation()}>
                    <DialogHeader>
                        <DialogTitle>Delete Project</DialogTitle>
                        <DialogDescription>
                            Delete <b>{project.name}</b>? Notes and secrets will be removed. Files on disk are kept.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowDelete(false)}>Cancel</Button>
                        <Button variant="destructive" onClick={handleDelete}>Delete</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
};
