'use client';

import React, { useState } from 'react';
import { Tabs, TabsList, TabsTrigger } from '../ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../ui/dialog';
import { FolderOpen, LayoutDashboard, Rocket, Play, GitBranch, Lock, ScrollText, Terminal, Database } from 'lucide-react';
import { OverviewPanel } from './OverviewPanel';
import { DatabasePanel } from './DatabasePanel';
import { TerminalPanel } from './TerminalPanel';
import { NotesPanel } from './NotesPanel';
import { GitPanel } from './GitPanel';
import { KeysPanel } from './KeysPanel';
import type { Project } from '../../types';

const DEMO_PROJECT: Project = {
    id: 'demo-1',
    name: 'orbitae-core',
    path: '~/projects/orbitae-core',
    created_at: new Date().toISOString()
};

export const InteractiveDemo = () => {
    const [activeTab, setActiveTab] = useState('overview');

    return (
        <div className="w-full h-[85vh] max-h-[800px] min-h-[600px] bg-background border border-border rounded-xl overflow-hidden shadow-2xl flex flex-col relative">
            {/* Top Bar with Traffic Lights - Simulating a Window */}
            <div className="px-4 py-3 border-b border-border bg-muted/20 flex flex-row items-center justify-between shrink-0 select-none">
                <div className="flex items-center gap-3">
                    <div className="flex gap-1.5 mr-2">
                        <div className="w-3 h-3 rounded-full bg-red-500/20 border border-red-500/50" />
                        <div className="w-3 h-3 rounded-full bg-yellow-500/20 border border-yellow-500/50" />
                        <div className="w-3 h-3 rounded-full bg-green-500/20 border border-green-500/50" />
                    </div>
                    <div className="text-sm font-medium flex items-center gap-2 text-foreground/80">
                        <FolderOpen className="w-4 h-4 text-primary" />
                        {DEMO_PROJECT.name}
                    </div>
                </div>
                <div className="text-xs text-muted-foreground hidden sm:block">
                    Interactive Demo
                </div>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 overflow-hidden flex flex-col bg-background h-full">
                <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col h-full">
                    <div className="px-4 py-2 border-b border-border/40 bg-muted/10 shrink-0">
                        <TabsList className="bg-muted/50 w-full sm:w-auto overflow-x-auto justify-start">
                            <TabsTrigger value="overview" className="gap-2">
                                <LayoutDashboard className="w-3.5 h-3.5" />
                                Overview
                            </TabsTrigger>
                            <TabsTrigger value="database" className="gap-2">
                                <Database className="w-3.5 h-3.5" />
                                Databases
                            </TabsTrigger>
                            <TabsTrigger value="processes" className="gap-2">
                                <Terminal className="w-3.5 h-3.5" />
                                Terminal
                            </TabsTrigger>
                            <TabsTrigger value="notes" className="gap-2">
                                <ScrollText className="w-3.5 h-3.5" />
                                Notes
                            </TabsTrigger>
                            <TabsTrigger value="git" className="gap-2">
                                <GitBranch className="w-3.5 h-3.5" />
                                Git
                            </TabsTrigger>
                             <TabsTrigger value="keys" className="gap-2">
                                <Lock className="w-3.5 h-3.5" />
                                Keys
                            </TabsTrigger>
                        </TabsList>
                    </div>
                    
                    <div className="flex-1 overflow-hidden p-0 bg-background relative">
                        {activeTab === 'overview' && (
                            <OverviewPanel project={DEMO_PROJECT} onNavigate={setActiveTab} />
                        )}
                        
                        {activeTab === 'database' && (
                             <DatabasePanel projectId={DEMO_PROJECT.id} />
                        )}

                        <div className={activeTab === 'processes' ? 'h-full p-0 bg-[#18181b]' : 'hidden h-full'}>
                            {activeTab === 'processes' && (
                                <TerminalPanel projectId={DEMO_PROJECT.id} initialCommand="help" />
                            )}
                        </div>

                        {activeTab === 'notes' && (
                            <NotesPanel projectId={DEMO_PROJECT.id} />
                        )}

                        {activeTab === 'git' && (
                            <GitPanel path={DEMO_PROJECT.path} />
                        )}

                        {activeTab === 'keys' && (
                            <KeysPanel projectId={DEMO_PROJECT.id} />
                        )}
                    </div>
                </Tabs>
            </div>
        </div>
    );
};
