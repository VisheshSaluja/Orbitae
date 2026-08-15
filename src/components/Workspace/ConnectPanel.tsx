import React, { useState, useEffect, useCallback } from 'react';
import { DatabasePanel } from './DatabasePanel';
import { OrchestrationSettingsPanel } from './OrchestrationSettingsPanel';
import { ErrorBoundary } from '../ui/error-boundary';
import { invokeCommand } from '../../lib/tauri';
import { toast } from 'sonner';
import type { ProjectEnv } from '../../types';
import {
    Database, Variable, Plus, Trash2, Save, SlidersHorizontal,
    type LucideIcon,
} from 'lucide-react';

interface ConnectPanelProps {
    projectId: string;
    projectPath: string;
}

type Section = 'databases' | 'envVars' | 'limits';

interface SubTab {
    id: Section;
    label: string;
    icon: LucideIcon;
}

const SUB_TABS: SubTab[] = [
    { id: 'databases', label: 'Databases', icon: Database },
    { id: 'envVars', label: 'Environment', icon: Variable },
    { id: 'limits', label: 'Limits & Budget', icon: SlidersHorizontal },
];

export const ConnectPanel: React.FC<ConnectPanelProps> = ({ projectId }) => {
    const [activeSection, setActiveSection] = useState<Section>('databases');

    const [envVars, setEnvVars] = useState<ProjectEnv[]>([]);
    const [newKey, setNewKey] = useState('');
    const [newValue, setNewValue] = useState('');
    const [isAdding, setIsAdding] = useState(false);

    const loadEnvVars = useCallback(async () => {
        try {
            const data = await invokeCommand<ProjectEnv[]>('get_project_envs', { projectId });
            setEnvVars(data);
        } catch {
            // non-critical
        }
    }, [projectId]);

    useEffect(() => { loadEnvVars(); }, [loadEnvVars]);

    const handleAddEnv = async () => {
        const trimmedKey = newKey.trim();
        if (!trimmedKey) return;
        try {
            await invokeCommand('set_project_env', { projectId, key: trimmedKey, value: newValue });
            setNewKey('');
            setNewValue('');
            setIsAdding(false);
            await loadEnvVars();
            toast.success('Variable saved');
        } catch {
            toast.error('Failed to save variable');
        }
    };

    const handleUpdateEnv = async (key: string, value: string) => {
        try {
            await invokeCommand('set_project_env', { projectId, key, value });
            await loadEnvVars();
        } catch {
            toast.error('Failed to update variable');
        }
    };

    return (
        <div className="h-full flex flex-col">
            {/* Sub-tab bar */}
            <div className="shrink-0 flex items-center gap-1 px-3 py-2 border-b border-border">
                {SUB_TABS.map(tab => {
                    const Icon = tab.icon;
                    const isActive = activeSection === tab.id;
                    return (
                        <button
                            key={tab.id}
                            onClick={() => setActiveSection(tab.id)}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium transition-all duration-100 ${
                                isActive
                                    ? 'bg-foreground/8 text-foreground'
                                    : 'text-muted-foreground hover:text-foreground hover:bg-foreground/4'
                            }`}
                        >
                            <Icon className="w-3.5 h-3.5" />
                            {tab.label}
                            {tab.id === 'envVars' && envVars.length > 0 && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-foreground/6 text-muted-foreground tabular-nums">{envVars.length}</span>
                            )}
                        </button>
                    );
                })}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-hidden">
                {activeSection === 'databases' && (
                    <ErrorBoundary>
                        <DatabasePanel projectId={projectId} />
                    </ErrorBoundary>
                )}

                {activeSection === 'limits' && (
                    <ErrorBoundary>
                        <OrchestrationSettingsPanel projectId={projectId} />
                    </ErrorBoundary>
                )}

                {activeSection === 'envVars' && (
                    <div className="h-full overflow-y-auto p-4">
                        <div className="flex items-center justify-between mb-4">
                            <div>
                                <h3 className="text-sm font-semibold text-foreground">Environment Variables</h3>
                                <p className="text-[11px] text-muted-foreground mt-0.5">Key-value pairs injected into agent sessions.</p>
                            </div>
                            <button
                                onClick={() => setIsAdding(true)}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-foreground text-background hover:bg-foreground/90 transition-colors"
                            >
                                <Plus className="w-3.5 h-3.5" />
                                Add Variable
                            </button>
                        </div>

                        {isAdding && (
                            <div className="flex items-center gap-2 mb-3 p-3 rounded-lg border border-border bg-card">
                                <input
                                    type="text"
                                    value={newKey}
                                    onChange={e => setNewKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))}
                                    placeholder="KEY_NAME"
                                    className="flex-1 bg-transparent text-[13px] font-mono text-foreground outline-none placeholder:text-muted-foreground/50 border-b border-border pb-1"
                                    autoFocus
                                />
                                <input
                                    type="text"
                                    value={newValue}
                                    onChange={e => setNewValue(e.target.value)}
                                    placeholder="value"
                                    className="flex-1 bg-transparent text-[13px] font-mono text-foreground outline-none placeholder:text-muted-foreground/50 border-b border-border pb-1"
                                />
                                <button
                                    onClick={handleAddEnv}
                                    disabled={!newKey.trim()}
                                    className="p-1.5 rounded-md text-emerald-400 hover:bg-emerald-500/10 transition-colors disabled:opacity-30"
                                >
                                    <Save className="w-3.5 h-3.5" />
                                </button>
                                <button
                                    onClick={() => { setIsAdding(false); setNewKey(''); setNewValue(''); }}
                                    className="p-1.5 rounded-md text-muted-foreground hover:text-foreground transition-colors"
                                >
                                    <Trash2 className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        )}

                        {envVars.length === 0 && !isAdding ? (
                            <div className="flex flex-col items-center justify-center py-16 text-center">
                                <div className="w-12 h-12 rounded-xl bg-foreground/[0.04] flex items-center justify-center mb-3">
                                    <Variable className="w-5 h-5 text-muted-foreground/40" />
                                </div>
                                <p className="text-[12px] text-muted-foreground">No environment variables</p>
                                <button onClick={() => setIsAdding(true)} className="text-[12px] text-muted-foreground hover:text-foreground mt-2 underline underline-offset-2">Add one</button>
                            </div>
                        ) : (
                            <div className="space-y-1">
                                {envVars.map(env => (
                                    <EnvVarRow key={env.id} env={env} onSave={handleUpdateEnv} />
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

interface EnvVarRowProps {
    env: ProjectEnv;
    onSave: (key: string, value: string) => Promise<void>;
}

const EnvVarRow: React.FC<EnvVarRowProps> = ({ env, onSave }) => {
    const [value, setValue] = useState(env.value);
    const [dirty, setDirty] = useState(false);

    const handleChange = (v: string) => {
        setValue(v);
        setDirty(v !== env.value);
    };

    const handleBlur = async () => {
        if (dirty) {
            await onSave(env.key, value);
            setDirty(false);
        }
    };

    return (
        <div className="flex items-center gap-2 p-2.5 rounded-lg border border-border hover:bg-foreground/[0.02] transition-colors group">
            <span className="text-[12px] font-mono font-medium text-muted-foreground w-40 shrink-0 truncate" title={env.key}>
                {env.key}
            </span>
            <input
                type="text"
                value={value}
                onChange={e => handleChange(e.target.value)}
                onBlur={handleBlur}
                onKeyDown={e => { if (e.key === 'Enter') handleBlur(); }}
                className="flex-1 bg-transparent text-[12px] font-mono text-foreground outline-none placeholder:text-muted-foreground/50"
            />
            {dirty && (
                <span className="text-[9px] text-amber-400 shrink-0">unsaved</span>
            )}
        </div>
    );
};
