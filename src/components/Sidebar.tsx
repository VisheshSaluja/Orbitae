import React from 'react';
import { LayoutGrid, Plus, FolderInput, GitBranch, ChevronUp } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu"

interface SidebarProps {
  onNewProject: (mode: 'create' | 'import' | 'clone') => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ onNewProject }) => {
  return (
    <div className="w-64 border-r border-border bg-card flex flex-col h-full">
      <div className="p-6">
        <h1 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-primary animate-pulse" />
          Orbitae
        </h1>
      </div>

      <nav className="flex-1 px-4 space-y-1">
        <div
          className="w-full flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-md bg-accent text-accent-foreground"
        >
          <LayoutGrid className="w-4 h-4" />
          Projects
        </div>
      </nav>

      <div className="p-4 border-t border-border">
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <button 
                className="w-full flex items-center justify-between gap-2 bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2 rounded-md text-sm font-medium transition-colors"
                >
                <span className="flex items-center gap-2">
                    <Plus className="w-4 h-4" />
                    New Project
                </span>
                <ChevronUp className="w-3 h-3 opacity-50" />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" className="w-56" align="center">
                <DropdownMenuItem onClick={() => onNewProject('create')}>
                    <Plus className="w-4 h-4 mr-2" />
                    Create New
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onNewProject('import')}>
                    <FolderInput className="w-4 h-4 mr-2" />
                    Import Folder
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onNewProject('clone')}>
                    <GitBranch className="w-4 h-4 mr-2" />
                    Clone Repository
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
};
