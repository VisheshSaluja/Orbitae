import React, { useState, useEffect } from 'react';
import { Plus, FolderInput, GitBranch, ChevronUp, Sun, Moon } from 'lucide-react';
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
    const [isDark, setIsDark] = useState(() =>
        document.documentElement.classList.contains('dark')
    );

    useEffect(() => {
        document.documentElement.classList.toggle('dark', isDark);
        localStorage.setItem('orbitae-theme', isDark ? 'dark' : 'light');
    }, [isDark]);

    return (
        <div className="w-56 border-r border-white/[0.06] bg-[#0e0e11] flex flex-col h-full">
            <div className="px-5 pt-5 pb-4 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                    <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                    <span className="text-[15px] font-semibold tracking-tight text-[#e4e4e7]">
                        Orbitae
                    </span>
                </div>
                <button
                    onClick={() => setIsDark(prev => !prev)}
                    className="p-1.5 rounded-md text-[#71717a] hover:text-[#e4e4e7] hover:bg-white/[0.06] transition-colors duration-150"
                >
                    {isDark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
                </button>
            </div>

            <div className="flex-1" />

            <div className="p-3 border-t border-white/[0.06]">
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <button className="w-full flex items-center justify-between gap-2 bg-blue-600 hover:bg-blue-500 text-white px-3 py-2 rounded-lg text-[13px] font-medium transition-colors duration-150">
                            <span className="flex items-center gap-2">
                                <Plus className="w-3.5 h-3.5" />
                                New Project
                            </span>
                            <ChevronUp className="w-3 h-3 opacity-50" />
                        </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent side="top" className="w-52" align="center">
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
