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
        <div className="w-52 border-r border-white/[0.06] bg-[#0c0c0f] flex flex-col h-full select-none">
            {/* Brand */}
            <div className="px-4 pt-4 pb-3 flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
                    <span className="text-white text-[11px] font-bold">O</span>
                </div>
                <div>
                    <span className="text-[13px] font-semibold tracking-tight text-[#e4e4e7]">Orbitae</span>
                    <span className="text-[9px] text-[#52525b] ml-1.5 font-mono">v0.1</span>
                </div>
            </div>

            {/* Nav */}
            <div className="px-2 py-1">
                <div className="px-2.5 py-2 rounded-md bg-white/[0.06] text-[#e4e4e7] text-[12px] font-medium flex items-center gap-2">
                    <div className="w-1 h-1 rounded-full bg-blue-400" />
                    Projects
                </div>
            </div>

            <div className="flex-1" />

            {/* Bottom actions */}
            <div className="p-2 space-y-1 border-t border-white/[0.06]">
                <button
                    className="w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-[12px] text-[#71717a] hover:text-[#a1a1aa] hover:bg-white/[0.04] transition-colors duration-150"
                    onClick={() => {}}
                >
                    <Settings className="w-3.5 h-3.5" />
                    Settings
                </button>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <button className="w-full flex items-center justify-between gap-2 bg-blue-600 hover:bg-blue-500 text-white px-3 py-2 rounded-lg text-[12px] font-medium transition-colors duration-150 shadow-lg shadow-blue-500/20">
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
