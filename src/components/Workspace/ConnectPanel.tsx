import React, { useState, useEffect, useCallback } from 'react';
import { DatabasePanel } from './DatabasePanel';
import { ErrorBoundary } from '../ui/error-boundary';
import { invokeCommand } from '../../lib/tauri';
import { toast } from 'sonner';
import type { ProjectEnv } from '../../types';
import {
    Database, Variable, ChevronDown, ChevronRight, Plus, Trash2, Save,
} from 'lucide-react';

interface ConnectPanelProps {
    projectId: string;
    projectPath: string;
}

type Section = 'databases' | 'envVars';

export const ConnectPanel: React.FC<ConnectPanelProps> = ({ projectId }) => {
    const [expanded, setExpanded] = useState<Record<Section, boolean>>({
        databases: true,
        envVars: true,
    });

    const [envVars, setEnvVars] = useState<ProjectEnv[]>([]);
    const [newKey, setNewKey] = useState('');
    const [newValue, setNewValue] = useState('');
    const [isAdding, setIsAdding] = useState(false);

    const toggle = (section: Section) => {
        setExpanded(prev => ({ ...prev, [section]: !prev[section] }));
    };

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
        <div className="h-full overflow-y-auto">
            {/* Databases Section */}
            <SectionHeader
                icon={Database}
                label="Databases"
                expanded={expanded.databases}
                onToggle={() => toggle('databases')}
            />
            {expanded.databases && (
                <ErrorBoundary>
                    <DatabasePanel projectId={projectId} />
                </ErrorBoundary>
            )}

            {/* Env Vars Section */}
            <SectionHeader
                icon={Variable}
                label="Environment Variables"
                expanded={expanded.envVars}
                onToggle={() => toggle('envVars')}
                action={
                    <button
                        onClick={() => setIsAdding(true)}
                        className="p-1 rounded hover:bg-white/[0.06] text-[#71717a] hover:text-[#e4e4e7] transition-colors"
                    >
                        <Plus className="w-3.5 h-3.5" />
                    </button>
                }
            />
            {expanded.envVars && (
                <div className="px-4 pb-4">
                    {isAdding && (
                        <div className="flex items-center gap-2 mb-3 p-3 rounded-lg bg-[#141417] border border-white/[0.08]">
                            <input
                                type="text"
                                value={newKey}
                                onChange={e => setNewKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))}
                                placeholder="KEY_NAME"
                                className="flex-1 bg-transparent text-[13px] font-mono text-[#e4e4e7] outline-none placeholder:text-[#52525b] border-b border-white/[0.06] pb-1"
                                autoFocus
                            />
                            <input
                                type="text"
                                value={newValue}
                                onChange={e => setNewValue(e.target.value)}
                                placeholder="value"
                                className="flex-1 bg-transparent text-[13px] font-mono text-[#e4e4e7] outline-none placeholder:text-[#52525b] border-b border-white/[0.06] pb-1"
                            />
                            <button
                                onClick={handleAddEnv}
                                disabled={!newKey.trim()}
                                className="p-1.5 rounded-md text-green-400 hover:bg-green-500/10 transition-colors disabled:opacity-30"
                            >
                                <Save className="w-3.5 h-3.5" />
                            </button>
                            <button
                                onClick={() => { setIsAdding(false); setNewKey(''); setNewValue(''); }}
                                className="p-1.5 rounded-md text-[#71717a] hover:text-[#e4e4e7] transition-colors"
                            >
                                <Trash2 className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    )}

                    {envVars.length === 0 && !isAdding ? (
                        <div className="py-8 text-center text-[#71717a] border border-dashed border-white/[0.06] rounded-lg">
                            <Variable className="w-6 h-6 mx-auto mb-2 opacity-30" />
                            <p className="text-[12px]">No environment variables</p>
                            <button onClick={() => setIsAdding(true)} className="text-[12px] text-blue-400 hover:text-blue-300 mt-1">Add one</button>
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
        <div className="flex items-center gap-2 p-2.5 rounded-lg bg-[#141417] border border-white/[0.06] hover:border-white/[0.1] transition-colors group">
            <span className="text-[12px] font-mono font-medium text-[#a1a1aa] w-40 shrink-0 truncate" title={env.key}>
                {env.key}
            </span>
            <input
                type="text"
                value={value}
                onChange={e => handleChange(e.target.value)}
                onBlur={handleBlur}
                onKeyDown={e => { if (e.key === 'Enter') handleBlur(); }}
                className="flex-1 bg-transparent text-[12px] font-mono text-[#e4e4e7] outline-none placeholder:text-[#52525b]"
            />
            {dirty && (
                <span className="text-[9px] text-amber-400 shrink-0">unsaved</span>
            )}
        </div>
    );
};

interface SectionHeaderProps {
    icon: React.FC<{ className?: string }>;
    label: string;
    expanded: boolean;
    onToggle: () => void;
    action?: React.ReactNode;
}

const SectionHeader: React.FC<SectionHeaderProps> = ({ icon: Icon, label, expanded, onToggle, action }) => (
    <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-2.5 bg-[#0a0a0b]/95 backdrop-blur-sm border-b border-white/[0.04]">
        <button onClick={onToggle} className="flex items-center gap-2 text-[12px] font-semibold text-[#a1a1aa] uppercase tracking-wider hover:text-[#e4e4e7] transition-colors">
            {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            <Icon className="w-3.5 h-3.5" />
            {label}
        </button>
        {action}
    </div>
);
