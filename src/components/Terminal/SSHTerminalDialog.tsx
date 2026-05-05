import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { TerminalPanel } from '../Workspace/TerminalPanel';
import { invokeCommand } from '../../lib/tauri';
import { Terminal as TerminalIcon } from 'lucide-react';
import type { Project } from '../../types';

interface SSHTerminalDialogProps {
    host: string;
    onClose: () => void;
}

export const SSHTerminalDialog: React.FC<SSHTerminalDialogProps> = ({ host, onClose }) => {
    // We create a "temp" project ID for SSH sessions or handle it purely via spawn logic
    // But currently spawn_shell takes a project_id to look up CWD/Envs.
    // For SSH, we might need a "default" or "null" project_id concept in backend,
    // OR we just pick any project/dummy project.
    // However, the backend `spawn_shell` expects a `project_id` to fetch path/envs.
    // IF we pass a dummy UUID that doesn't exist, `get_project` fails.
    
    // WORKAROUND: For this iteration, since we haven't refactored backend to support "No Project" shells,
    // we need to either:
    // 1. Create a "Global/Scratch" project in the DB that we use for these.
    // 2. Or update `spawn_shell` to treat `project_id` as optional.
    
    // Given constraints, simplest path: Update backend `spawn_shell` to handle "scratch" mode if project_id is empty/special?
    // Actually, the prompt says "Wire the SSH Connect Button".
    // If I pass `initial_command` ("ssh user@host"), I still need a base shell.
    // I will try to use the FIRST available project as a host, or if none, we have an issue.
    // Let's check if we can pass a specific flag.
    
    // Better approach: modifying logic on fly might be risky.
    // Let's assume we can use the "id" of the host as project_id? No, DB FK constraint.
    
    // PLAN: 
    // I will auto-create a "local-scratch" project if it doesn't exist? No.
    // I will grab the list of projects and use the first one as the "host" environment?
    // Or I'll request the user to "Select a context" to launch SSH from?
    // The requirement says "Open Terminal Modal immediately".
    
    // Let's use `invokeCommand` to `create_project` silently if "scratchpad" doesn't exist?
    // Or just fetch `list_projects` and use the first one.
    // If no projects, we can't spawn shell easily without backend change.
    
    // Wait, let's look at `spawn_shell` again.
    // `let project = ... context("Project not found")?;`
    // It strictly requires a valid project.
    
    // PROPOSAL: I will assume there is at least one project. 
    // If not, I'll alert the user "Please create a Workspace first to use as a launchpad".
    
    // To make this robust, I'll fetch projects here.
    
    const [projectId, setProjectId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    React.useEffect(() => {
        invokeCommand<Project[]>('list_projects').then(projects => {
            if (projects.length > 0) {
                setProjectId(projects[0].id);
            } else {
                setError("No workspaces found. Please create a project to act as a terminal host.");
            }
        });
    }, []);

    // Construct the SSH command string
    // host string from basic list is 'user@hostname' or just 'hostname' from config
    // We already have the full host string passed in
    const initialCommand = `ssh ${host}`;

    if (error) {
         return (
            <Dialog open={true} onOpenChange={() => onClose()}>
                <DialogContent>
                    <DialogHeader><DialogTitle>Error</DialogTitle></DialogHeader>
                    <div className="p-4 text-red-500">{error}</div>
                </DialogContent>
            </Dialog>
         );
    }

    if (!projectId) return null; // Loading

    return (
        <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-[80vw] h-[80vh] flex flex-col p-0 gap-0 border-border bg-background overflow-hidden shadow-2xl">
                <DialogHeader className="px-4 py-3 border-b border-border bg-muted/30 flex flex-row items-center justify-between">
                     <div className="flex items-center gap-2">
                        <TerminalIcon className="w-4 h-4 text-green-500" />
                        <DialogTitle className="text-sm font-mono text-muted-foreground font-normal">
                            {initialCommand}
                        </DialogTitle>
                    </div>
                </DialogHeader>
                 <div className="flex-1 p-1 bg-background relative">
                    <TerminalPanel 
                        projectId={projectId} 
                        initialCommand={initialCommand}
                    />
                </div>
            </DialogContent>
        </Dialog>
    );
};
