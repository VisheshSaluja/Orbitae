import React from 'react';
import { Plus, FolderInput, GitBranch, ChevronUp, Settings } from 'lucide-react';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from './ui/dropdown-menu';

interface SidebarProps {
    onNewProject: (mode: 'create' | 'import' | 'clone') => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ onNewProject }) => {
    return (
        <div className="w-56 border-r border-border bg-muted/40 flex flex-col h-full select-none">
            {/* Brand */}
            <div className="px-4 pt-4 pb-3 flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-foreground/10 flex items-center justify-center">
                    <span className="text-foreground text-[12px] font-bold tracking-tight">O</span>
                </div>
                <div className="flex items-baseline gap-1.5">
                    <span className="text-[13px] font-semibold tracking-tight text-foreground">Orbitae</span>
                    <span className="text-[9px] text-muted-foreground font-mono">v0.1</span>
                </div>
            </div>

            {/* Nav */}
            <div className="px-2 py-1">
                <div className="px-2.5 py-2 rounded-md bg-foreground/[0.08] text-foreground text-[13px] font-medium flex items-center gap-2.5 cursor-default">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    Projects
                </div>
            </div>

            <div className="flex-1" />

            {/* Bottom */}
            <div className="p-2 space-y-1 border-t border-border">
                <button
                    className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[13px] text-muted-foreground hover:text-foreground hover:bg-foreground/[0.05] transition-colors duration-150"
                    onClick={() => {}}
                >
                    <Settings className="w-3.5 h-3.5" />
                    Settings
                </button>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <button className="w-full flex items-center justify-between bg-foreground text-background px-3 py-2 rounded-lg text-[13px] font-medium transition-colors duration-150 hover:bg-foreground/90">
                            <span className="flex items-center gap-2">
                                <Plus className="w-3.5 h-3.5" />
                                New Project
                            </span>
                            <ChevronUp className="w-3 h-3 opacity-50" />
                        </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent side="top" className="w-48" align="center">
                        <DropdownMenuItem onClick={() => onNewProject('create')}>
                            <Plus className="w-3.5 h-3.5 mr-2" />
                            Create New
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onNewProject('import')}>
                            <FolderInput className="w-3.5 h-3.5 mr-2" />
                            Import Folder
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onNewProject('clone')}>
                            <GitBranch className="w-3.5 h-3.5 mr-2" />
                            Clone Repository
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </div>
    );
};
