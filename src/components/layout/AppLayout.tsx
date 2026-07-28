import React from 'react';
import { Sidebar } from '../Sidebar';

interface AppLayoutProps {
    children: React.ReactNode;
    projectCount: number;
    onNewProject: (mode: 'create' | 'import' | 'clone') => void;
}

export const AppLayout: React.FC<AppLayoutProps> = ({ children, projectCount, onNewProject }) => {
    return (
        <div className="flex h-screen bg-background font-sans text-foreground selection:bg-primary/20">
            <Sidebar onNewProject={onNewProject} />

            <main className="flex-1 min-w-0 flex flex-col h-full">
                <header className="h-12 shrink-0 border-b border-border flex items-center justify-between px-6">
                    <div className="flex items-center gap-3">
                        <h1 className="text-sm font-semibold text-foreground">Projects</h1>
                        {projectCount > 0 && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-foreground/[0.06] text-muted-foreground font-mono tabular-nums">
                                {projectCount}
                            </span>
                        )}
                    </div>
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
