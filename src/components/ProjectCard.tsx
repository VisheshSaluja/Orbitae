import React, { useState } from 'react';
import type { Project } from '../types';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "./ui/card";
import { Button } from "./ui/button";
import { Terminal, FolderOpen, Key, Pencil, Trash2, FolderSearch } from 'lucide-react';
import { motion } from 'framer-motion';
import { useAppStore } from '../stores/useAppStore';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "./ui/dialog";
import { Input } from "./ui/input";
import { open } from '@tauri-apps/plugin-dialog';

interface ProjectCardProps {
  project: Project;
  onLaunch: (id: string) => void;
}

export const ProjectCard: React.FC<ProjectCardProps> = ({ project, onLaunch }) => {
  const { deleteProject, updateProject } = useAppStore();
  const [showEdit, setShowEdit] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  
  // Edit State
  const [editName, setEditName] = useState(project.name);
  const [editPath, setEditPath] = useState(project.path);
  const [editKey, setEditKey] = useState(project.ssh_key_path || '');

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await deleteProject(project.id);
    setShowDelete(false);
  };

  const handleUpdate = async () => {
    await updateProject(project.id, editName, editPath, editKey || undefined);
    setShowEdit(false);
  };

  const handleBrowse = async () => {
      try {
          const selected = await open({
              directory: true,
              multiple: false,
              defaultPath: editPath,
          });
          
          if (selected && typeof selected === 'string') {
              setEditPath(selected);
          }
      } catch {
          // Dialog open failed — non-critical
      }
  };

  return (
    <>
    <motion.div
        whileHover={{ y: -2 }}
        transition={{ duration: 0.2 }}
        className="relative"
    >
        <Card className="group overflow-hidden border-border/50 bg-card hover:border-primary/50 transition-colors">
            <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
                <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
                    <div className="p-1.5 rounded-md bg-blue-500/10 text-blue-500">
                      <FolderOpen className="w-4 h-4" />
                    </div>
                    {project.name}
                </CardTitle>
                
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); setShowEdit(true); }}>
                        <Pencil className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-6 w-6 hover:bg-destructive/10 hover:text-destructive" onClick={(e) => { e.stopPropagation(); setShowDelete(true); }}>
                        <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                </div>
            </CardHeader>
            <CardContent>
                <div className="text-xs font-mono text-muted-foreground bg-muted/50 p-2 rounded-md truncate">
                    {project.path}
                </div>
                {project.ssh_key_path && (
                    <div className="flex items-center gap-1.5 mt-3 text-xs text-muted-foreground">
                        <Key className="w-3 h-3 text-orange-500/80" />
                        <span className="truncate">{project.ssh_key_path}</span>
                    </div>
                )}
            </CardContent>
            <CardFooter className="pt-0">
                <Button 
                    variant="default" 
                    size="sm" 
                    className="w-full gap-2 group-hover:bg-primary/90"
                    onClick={() => onLaunch(project.id)}
                >
                    <Terminal className="w-3.5 h-3.5" />
                    Launch
                </Button>
            </CardFooter>
        </Card>
    </motion.div>

    {/* Edit Dialog */}
    <Dialog open={showEdit} onOpenChange={setShowEdit}>
        <DialogContent onClick={e => e.stopPropagation()}>
            <DialogHeader>
                <DialogTitle>Edit Workspace</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
                <div className="space-y-2">
                    <div className="text-sm font-medium">Name</div>
                    <Input value={editName} onChange={e => setEditName(e.target.value)} />
                </div>
                <div className="space-y-2">
                    <div className="text-sm font-medium">Path</div>
                    <div className="flex gap-2">
                        <Input value={editPath} onChange={e => setEditPath(e.target.value)} />
                        <Button variant="outline" size="icon" onClick={handleBrowse} title="Browse Directory">
                            <FolderSearch className="w-4 h-4" />
                        </Button>
                    </div>
                </div>
                <div className="space-y-2">
                    <div className="text-sm font-medium">SSH Key (Optional)</div>
                    <Input value={editKey} onChange={e => setEditKey(e.target.value)} placeholder="~/.ssh/id_rsa" />
                </div>
            </div>
            <DialogFooter>
                <Button variant="outline" onClick={() => setShowEdit(false)}>Cancel</Button>
                <Button onClick={handleUpdate}>Save Changes</Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>

    {/* Delete Dialog */}
    <Dialog open={showDelete} onOpenChange={setShowDelete}>
        <DialogContent onClick={e => e.stopPropagation()}>
            <DialogHeader>
                <DialogTitle>Delete Workspace</DialogTitle>
                <DialogDescription>
                    Are you sure you want to delete <b>{project.name}</b>? This will remove all notes and snippets. The actual folder on disk will NOT be deleted.
                </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 sm:justify-end">
                <Button variant="outline" onClick={() => setShowDelete(false)}>Cancel</Button>
                <Button variant="destructive" onClick={handleDelete}>Delete Workspace</Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
    </>
  );
};
