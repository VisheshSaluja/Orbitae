import React, { useState, useEffect } from 'react';
import { invokeCommand } from '../../lib/tauri';
import { logger } from '../../lib/logger';
import { toast } from 'sonner';
import { Settings, Loader2, Check, Trash2 } from 'lucide-react';
import type { AiProviderInfo, AiProviderConfig } from '../../types';

interface AiProviderSettingsProps {
    projectId: string;
}

export const AiProviderSettings: React.FC<AiProviderSettingsProps> = ({ projectId }) => {
    const [providers, setProviders] = useState<AiProviderInfo[]>([]);
    const [configs, setConfigs] = useState<AiProviderConfig[]>([]);
    const [activeConfig, setActiveConfig] = useState<AiProviderConfig | null>(null);

    const [setupProvider, setSetupProvider] = useState('openai');
    const [setupModel, setSetupModel] = useState('gpt-4o-mini');
    const [setupApiKey, setSetupApiKey] = useState('');
    const [setupSaving, setSetupSaving] = useState(false);

    useEffect(() => {
        const load = async () => {
            try {
                const [providerList, configList] = await Promise.all([
                    invokeCommand<AiProviderInfo[]>('get_ai_providers'),
                    invokeCommand<AiProviderConfig[]>('get_ai_provider_configs', { projectId }),
                ]);
                setProviders(providerList);
                setConfigs(configList);
                const defaultConfig = configList.find(c => c.is_default === 1) || configList[0];
                if (defaultConfig) setActiveConfig(defaultConfig);
            } catch (err) {
                logger.error('Failed to load AI config:', err);
            }
        };
        load();
    }, [projectId]);

    const handleSaveConfig = async () => {
        setSetupSaving(true);
        try {
            const selectedProvider = providers.find(p => p.id === setupProvider);
            const needsKey = selectedProvider?.requires_api_key && setupApiKey.trim();

            const config = await invokeCommand<AiProviderConfig>('save_ai_provider_config', {
                projectId,
                provider: setupProvider,
                model: setupModel,
                apiKey: needsKey ? setupApiKey : null,
                baseUrl: selectedProvider?.default_base_url || null,
                temperature: 0.7,
                maxTokens: 4096,
                isDefault: true,
            });

            setConfigs(prev => [...prev.map(c => ({ ...c, is_default: 0 })), config]);
            setActiveConfig(config);
            setSetupApiKey('');
            toast.success('AI provider configured');
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            toast.error(`Failed to save: ${message}`);
        } finally {
            setSetupSaving(false);
        }
    };

    const handleDeleteConfig = async (id: string) => {
        try {
            await invokeCommand('delete_ai_provider_config', { id });
            setConfigs(prev => prev.filter(c => c.id !== id));
            if (activeConfig?.id === id) setActiveConfig(null);
            toast.success('Config deleted');
        } catch {
            toast.error('Failed to delete');
        }
    };

    const handleSetActive = async (config: AiProviderConfig) => {
        setActiveConfig(config);
        toast.success(`Switched to ${config.provider}/${config.model}`);
    };

    const selectedProviderModels = providers.find(p => p.id === setupProvider)?.models || [];

    return (
        <div className="h-full overflow-y-auto p-6 scrollbar-thin">
            <div className="max-w-2xl mx-auto space-y-8">

                <div className="space-y-1">
                    <h2 className="text-lg font-semibold flex items-center gap-2">
                        <Settings className="w-5 h-5 text-primary" />
                        AI Provider Configuration
                    </h2>
                    <p className="text-sm text-muted-foreground">
                        Configure which AI model powers your agent.
                    </p>
                </div>

                {/* Existing configs */}
                {configs.length > 0 && (
                    <div className="space-y-3">
                        <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                            Active Configurations
                        </label>
                        <div className="space-y-2">
                            {configs.map(config => (
                                <div
                                    key={config.id}
                                    className={`flex items-center justify-between p-4 rounded-xl border transition-all ${
                                        config.id === activeConfig?.id
                                            ? 'border-primary/50 bg-primary/5'
                                            : 'border-border/40 bg-card/30 hover:border-border/60'
                                    }`}
                                >
                                    <div className="flex items-center gap-3">
                                        {config.id === activeConfig?.id && (
                                            <div className="w-2 h-2 rounded-full bg-primary" />
                                        )}
                                        <div>
                                            <span className="text-sm font-medium">{config.provider}/{config.model}</span>
                                            {config.is_default === 1 && (
                                                <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">Default</span>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {config.id !== activeConfig?.id && (
                                            <button
                                                onClick={() => handleSetActive(config)}
                                                className="text-xs text-primary hover:underline font-medium"
                                            >
                                                Use
                                            </button>
                                        )}
                                        <button
                                            onClick={() => handleDeleteConfig(config.id)}
                                            className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md transition-colors"
                                        >
                                            <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Add new */}
                <div className="space-y-5 pt-2">
                    <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                        {configs.length > 0 ? 'Add Another Provider' : 'Set Up AI Provider'}
                    </label>

                    <div className="space-y-2">
                        <label className="text-xs font-medium text-muted-foreground">Provider</label>
                        <div className="grid grid-cols-2 gap-2">
                            {providers.map(p => (
                                <button
                                    key={p.id}
                                    onClick={() => { setSetupProvider(p.id); setSetupModel(p.models[0]?.id || ''); }}
                                    className={`p-3.5 rounded-xl border text-sm text-left transition-all ${
                                        setupProvider === p.id
                                            ? 'border-primary bg-primary/5 shadow-sm shadow-primary/10'
                                            : 'border-border/40 hover:border-border/60 bg-card/30'
                                    }`}
                                >
                                    <div className="font-medium">{p.name}</div>
                                    <div className="text-[11px] text-muted-foreground mt-1">
                                        {p.models.length} models{!p.requires_api_key && ' · No key needed'}
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-xs font-medium text-muted-foreground">Model</label>
                        <select
                            value={setupModel}
                            onChange={e => setSetupModel(e.target.value)}
                            className="w-full bg-muted border border-border/40 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                        >
                            {selectedProviderModels.map(m => (
                                <option key={m.id} value={m.id}>{m.name} ({Math.round(m.context_window / 1000)}K ctx)</option>
                            ))}
                        </select>
                    </div>

                    {providers.find(p => p.id === setupProvider)?.requires_api_key && (
                        <div className="space-y-2">
                            <label className="text-xs font-medium text-muted-foreground">API Key</label>
                            <input
                                type="password"
                                value={setupApiKey}
                                onChange={e => setSetupApiKey(e.target.value)}
                                placeholder="sk-..."
                                className="w-full bg-muted border border-border/40 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                            />
                            <p className="text-[11px] text-muted-foreground/70">Stored securely in your system keychain via Vault.</p>
                        </div>
                    )}

                    <button
                        onClick={handleSaveConfig}
                        disabled={setupSaving || (providers.find(p => p.id === setupProvider)?.requires_api_key === true && !setupApiKey.trim())}
                        className="w-full bg-primary text-primary-foreground rounded-xl px-4 py-3 text-sm font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
                    >
                        {setupSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                        Save & Activate
                    </button>
                </div>

            </div>
        </div>
    );
};
