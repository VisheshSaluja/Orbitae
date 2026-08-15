import React, { useState } from 'react';
import { KeysPanel } from './KeysPanel';
import { DatabasePanel } from './DatabasePanel';
import { AiProviderSettings } from './AiProviderSettings';
import { OrchestrationSettingsPanel } from './OrchestrationSettingsPanel';
import {
    Lock, Database, Bot, SlidersHorizontal,
} from 'lucide-react';

interface SettingsPanelProps {
    projectId: string;
}

type SettingsTab = 'secrets' | 'databases' | 'ai' | 'limits';

const TAB_CONFIG: { id: SettingsTab; label: string; icon: React.ElementType }[] = [
    { id: 'secrets', label: 'Keys & Secrets', icon: Lock },
    { id: 'databases', label: 'Databases', icon: Database },
    { id: 'ai', label: 'AI Provider', icon: Bot },
    { id: 'limits', label: 'Limits & Budget', icon: SlidersHorizontal },
];

export const SettingsPanel: React.FC<SettingsPanelProps> = ({ projectId }) => {
    const [activeTab, setActiveTab] = useState<SettingsTab>('secrets');

    return (
        <div className="h-full flex flex-col bg-background">
            {/* Tab bar */}
            <div className="shrink-0 border-b border-border/40 bg-muted/5">
                <div className="flex items-center px-4">
                    {TAB_CONFIG.map(tab => {
                        const Icon = tab.icon;
                        const isActive = activeTab === tab.id;
                        return (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`flex items-center gap-2 px-4 py-3 text-xs font-medium border-b-2 transition-colors ${
                                    isActive
                                        ? 'border-primary text-primary'
                                        : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
                                }`}
                            >
                                <Icon className="w-3.5 h-3.5" />
                                {tab.label}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-hidden">
                {activeTab === 'secrets' && (
                    <KeysPanel projectId={projectId} />
                )}
                {activeTab === 'databases' && (
                    <DatabasePanel projectId={projectId} />
                )}
                {activeTab === 'ai' && (
                    <AiProviderSettings projectId={projectId} />
                )}
                {activeTab === 'limits' && (
                    <OrchestrationSettingsPanel projectId={projectId} />
                )}
            </div>
        </div>
    );
};
