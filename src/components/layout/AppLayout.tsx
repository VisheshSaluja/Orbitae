import React from 'react';
import { Sidebar } from '../Sidebar';

interface AppLayoutProps {
    children: React.ReactNode;
    projectCount: number;
    onNewProject: (mode: 'create' | 'import' | 'clone') => void;
}

export const AppLayout: React.FC<AppLayoutProps> = ({ children, projectCount, onNewProject }) => {
    return (
        <div className="flex h-screen bg-[#0a0a0b] font-sans text-[#e4e4e7] selection:bg-blue-500/20">
            <Sidebar onNewProject={onNewProject} />

            <main className="flex-1 min-w-0 flex flex-col h-full">
                <header className="h-12 shrink-0 border-b border-white/[0.06] flex items-center px-6">
                    <span className="text-[13px] font-semibold text-[#e4e4e7]">Projects</span>
                    {projectCount > 0 && (
                        <span className="ml-2 text-[11px] px-1.5 py-0.5 rounded-md bg-white/[0.06] text-[#71717a] font-medium">
                            {projectCount}
                        </span>
                    )}
                </header>

                <div className="flex-1 overflow-auto p-6">
                    <div className="max-w-6xl mx-auto">
                        {children}
                    </div>
                </div>
            </main>
        </div>
    );
};
