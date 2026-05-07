import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { AgentEngine } from '../../lib/agent/AgentEngine';
import type { AgentMessage } from '../../lib/agent/AgentEngine';
import { invokeCommand } from '../../lib/tauri';
import { logger } from '../../lib/logger';
import { Send, Bot, User, Plus, Settings, MessageSquare, Trash2, Brain, Wrench, ChevronDown, Check, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type {
    Project, AiProviderInfo, AiProviderConfig, Conversation,
    ConversationMessage, KnowledgeNode, ProjectScript,
} from '../../types';

interface AgentPanelProps {
    projectId: string;
    project: Project;
}

type PanelView = 'chat' | 'settings' | 'knowledge';

interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
    toolCalls?: string[];
    isStreaming?: boolean;
}

export const AgentPanel: React.FC<AgentPanelProps> = ({ project }) => {
    const [view, setView] = useState<PanelView>('chat');
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [isThinking, setIsThinking] = useState(false);

    // Provider state
    const [providers, setProviders] = useState<AiProviderInfo[]>([]);
    const [configs, setConfigs] = useState<AiProviderConfig[]>([]);
    const [activeConfig, setActiveConfig] = useState<AiProviderConfig | null>(null);

    // Conversation state
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);
    const [showConversationList, setShowConversationList] = useState(false);

    // Knowledge state
    const [knowledgeNodes, setKnowledgeNodes] = useState<KnowledgeNode[]>([]);

    // Setup config state
    const [setupProvider, setSetupProvider] = useState('openai');
    const [setupModel, setSetupModel] = useState('gpt-4o-mini');
    const [setupApiKey, setSetupApiKey] = useState('');
    const [setupSaving, setSetupSaving] = useState(false);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const agentEngine = useMemo(() => new AgentEngine(), []);

    const scrollToBottom = useCallback(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, []);

    useEffect(() => {
        scrollToBottom();
    }, [messages, isThinking, scrollToBottom]);

    // Load providers catalog and existing configs
    useEffect(() => {
        const load = async () => {
            try {
                const [providerList, configList, convList] = await Promise.all([
                    invokeCommand<AiProviderInfo[]>('get_ai_providers'),
                    invokeCommand<AiProviderConfig[]>('get_ai_provider_configs', { projectId: project.id }),
                    invokeCommand<Conversation[]>('get_project_conversations', { projectId: project.id }),
                ]);
                setProviders(providerList);
                setConfigs(configList);
                setConversations(convList);

                const defaultConfig = configList.find(c => c.is_default === 1) || configList[0];
                if (defaultConfig) {
                    setActiveConfig(defaultConfig);
                    await configureEngine(defaultConfig);
                }
            } catch (err) {
                logger.error('Failed to load AI config:', err);
            }
        };
        load();
    }, [project.id]);

    const configureEngine = useCallback(async (config: AiProviderConfig) => {
        try {
            let apiKey: string | null = null;
            if (config.key_reference) {
                apiKey = await invokeCommand<string | null>('get_ai_api_key', { configId: config.id });
            }
            await agentEngine.configure(config, apiKey);
        } catch (err) {
            logger.error('Failed to configure agent engine:', err);
        }
    }, [agentEngine]);

    const loadKnowledgeNodes = useCallback(async () => {
        try {
            const nodes = await invokeCommand<KnowledgeNode[]>('get_project_knowledge_nodes', { projectId: project.id });
            setKnowledgeNodes(nodes);
        } catch (err) {
            logger.error('Failed to load knowledge nodes:', err);
        }
    }, [project.id]);

    useEffect(() => {
        if (view === 'knowledge') {
            // Auto-ingest project docs on first knowledge view, then load nodes
            const ingestAndLoad = async () => {
                try {
                    await invokeCommand('auto_ingest_project_docs', { projectId: project.id, projectPath: project.path });
                } catch {
                    // Non-critical — may fail if docs don't exist
                }
                await loadKnowledgeNodes();
            };
            ingestAndLoad();
        }
    }, [view, loadKnowledgeNodes, project.id, project.path]);

    const handleSaveConfig = async () => {
        setSetupSaving(true);
        try {
            const selectedProvider = providers.find(p => p.id === setupProvider);
            const needsKey = selectedProvider?.requires_api_key && setupApiKey.trim();

            const config = await invokeCommand<AiProviderConfig>('save_ai_provider_config', {
                projectId: project.id,
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
            await configureEngine(config);
            setSetupApiKey('');
            setView('chat');
            toast.success('AI provider configured');
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            toast.error(`Failed to save config: ${message}`);
        } finally {
            setSetupSaving(false);
        }
    };

    const startNewConversation = async () => {
        if (!activeConfig) {
            setView('settings');
            return;
        }
        try {
            const conv = await invokeCommand<Conversation>('create_conversation', {
                projectId: project.id,
                title: null,
                provider: activeConfig.provider,
                model: activeConfig.model,
            });
            setConversations(prev => [conv, ...prev]);
            setActiveConversation(conv);
            setMessages([]);
            setShowConversationList(false);
        } catch (err) {
            logger.error('Failed to create conversation:', err);
        }
    };

    const loadConversation = async (conv: Conversation) => {
        setActiveConversation(conv);
        setShowConversationList(false);
        try {
            const msgs = await invokeCommand<ConversationMessage[]>('get_conversation_messages', {
                conversationId: conv.id,
            });
            setMessages(msgs.map(m => ({
                role: m.role as 'user' | 'assistant',
                content: m.content,
                toolCalls: m.tool_calls ? JSON.parse(m.tool_calls) : undefined,
            })));
        } catch (err) {
            logger.error('Failed to load messages:', err);
        }
    };

    const deleteConversation = async (convId: string) => {
        try {
            await invokeCommand('delete_conversation', { id: convId });
            setConversations(prev => prev.filter(c => c.id !== convId));
            if (activeConversation?.id === convId) {
                setActiveConversation(null);
                setMessages([]);
            }
            toast.success('Conversation deleted');
        } catch (err) {
            logger.error('Failed to delete conversation:', err);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim() || isThinking) return;

        if (!agentEngine.isConfigured()) {
            setView('settings');
            toast.error('Please configure an AI provider first');
            return;
        }

        // Auto-create conversation if none active
        if (!activeConversation) {
            await startNewConversation();
        }

        const userMsg = input.trim();
        setInput('');
        setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
        setIsThinking(true);

        // Build context from knowledge graph
        const knowledgeContext = await agentEngine.buildContext(project.id, userMsg);

        let scripts: ProjectScript[] = [];
        try {
            scripts = await invokeCommand<ProjectScript[]>('get_project_scripts', { path: project.path });
        } catch {
            // non-critical
        }

        const projectContext = {
            projectId: project.id,
            name: project.name,
            path: project.path,
            scripts,
            knowledgeNodes: knowledgeContext,
        };

        const history: AgentMessage[] = messages.map(m => ({
            role: m.role === 'user' ? 'user' as const : 'assistant' as const,
            content: m.content,
        }));

        // Add streaming placeholder
        setMessages(prev => [...prev, { role: 'assistant', content: '', isStreaming: true }]);

        const toolCalls: string[] = [];

        try {
            const fullText = await agentEngine.chatStream(
                userMsg,
                projectContext,
                history,
                (chunk) => {
                    setMessages(prev => {
                        const updated = [...prev];
                        const last = updated[updated.length - 1];
                        if (last.role === 'assistant') {
                            last.content += chunk;
                        }
                        return updated;
                    });
                },
                (toolName) => {
                    toolCalls.push(toolName);
                    setMessages(prev => {
                        const updated = [...prev];
                        const last = updated[updated.length - 1];
                        if (last.role === 'assistant') {
                            last.toolCalls = [...toolCalls];
                        }
                        return updated;
                    });
                },
                (toolName) => {
                    logger.debug(`Tool completed: ${toolName}`);
                },
            );

            // Finalize message
            setMessages(prev => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last.role === 'assistant') {
                    last.isStreaming = false;
                    last.content = fullText;
                }
                return updated;
            });

            // Persist messages
            if (activeConversation) {
                await invokeCommand('add_conversation_message', {
                    conversationId: activeConversation.id,
                    role: 'user',
                    content: userMsg,
                    toolCalls: null,
                    toolResults: null,
                });
                await invokeCommand('add_conversation_message', {
                    conversationId: activeConversation.id,
                    role: 'assistant',
                    content: fullText,
                    toolCalls: toolCalls.length > 0 ? JSON.stringify(toolCalls) : null,
                    toolResults: null,
                });

                // Auto-title from first user message
                if (messages.length === 0) {
                    const title = userMsg.substring(0, 60) + (userMsg.length > 60 ? '...' : '');
                    await invokeCommand('update_conversation_title', { id: activeConversation.id, title });
                    setConversations(prev => prev.map(c =>
                        c.id === activeConversation.id ? { ...c, title } : c
                    ));
                    setActiveConversation(prev => prev ? { ...prev, title } : prev);
                }
            }
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            setMessages(prev => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last.role === 'assistant') {
                    last.content = `Error: ${message}`;
                    last.isStreaming = false;
                }
                return updated;
            });
        } finally {
            setIsThinking(false);
        }
    };

    const deleteKnowledgeNode = async (nodeId: string) => {
        try {
            await invokeCommand('delete_knowledge_node', { id: nodeId });
            setKnowledgeNodes(prev => prev.filter(n => n.id !== nodeId));
            toast.success('Knowledge node deleted');
        } catch (err) {
            logger.error('Failed to delete knowledge node:', err);
        }
    };

    const selectedProviderModels = providers.find(p => p.id === setupProvider)?.models || [];

    // --- Settings View ---
    if (view === 'settings') {
        return (
            <div className="flex flex-col h-full bg-background">
                <div className="p-4 border-b border-border/40 flex items-center justify-between">
                    <h3 className="text-sm font-medium flex items-center gap-2">
                        <Settings className="w-4 h-4 text-primary" />
                        AI Provider Setup
                    </h3>
                    <button onClick={() => setView('chat')} className="text-xs text-muted-foreground hover:text-foreground">
                        Back to Chat
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                    {configs.length > 0 && (
                        <div className="space-y-2">
                            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Existing Configurations</label>
                            {configs.map(config => (
                                <div key={config.id} className={`flex items-center justify-between p-3 rounded-lg border ${config.id === activeConfig?.id ? 'border-primary bg-primary/5' : 'border-border'}`}>
                                    <div>
                                        <span className="text-sm font-medium">{config.provider}/{config.model}</span>
                                        {config.is_default === 1 && <span className="ml-2 text-xs text-primary">(default)</span>}
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {config.id !== activeConfig?.id && (
                                            <button onClick={async () => {
                                                setActiveConfig(config);
                                                await configureEngine(config);
                                                toast.success('Switched provider');
                                            }} className="text-xs text-primary hover:underline">Use</button>
                                        )}
                                        <button onClick={async () => {
                                            await invokeCommand('delete_ai_provider_config', { id: config.id });
                                            setConfigs(prev => prev.filter(c => c.id !== config.id));
                                            if (activeConfig?.id === config.id) setActiveConfig(null);
                                        }} className="text-xs text-destructive hover:underline">Delete</button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    <div className="space-y-4">
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Add New Provider</label>

                        <div className="space-y-2">
                            <label className="text-xs text-muted-foreground">Provider</label>
                            <div className="grid grid-cols-2 gap-2">
                                {providers.map(p => (
                                    <button
                                        key={p.id}
                                        onClick={() => {
                                            setSetupProvider(p.id);
                                            setSetupModel(p.models[0]?.id || '');
                                        }}
                                        className={`p-3 rounded-lg border text-sm text-left transition-colors ${
                                            setupProvider === p.id ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground/50'
                                        }`}
                                    >
                                        <div className="font-medium">{p.name}</div>
                                        <div className="text-xs text-muted-foreground mt-1">
                                            {p.models.length} models{!p.requires_api_key && ' (no key needed)'}
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs text-muted-foreground">Model</label>
                            <select
                                value={setupModel}
                                onChange={e => setSetupModel(e.target.value)}
                                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                            >
                                {selectedProviderModels.map(m => (
                                    <option key={m.id} value={m.id}>{m.name} ({Math.round(m.context_window / 1000)}K ctx)</option>
                                ))}
                            </select>
                        </div>

                        {providers.find(p => p.id === setupProvider)?.requires_api_key && (
                            <div className="space-y-2">
                                <label className="text-xs text-muted-foreground">API Key</label>
                                <input
                                    type="password"
                                    value={setupApiKey}
                                    onChange={e => setSetupApiKey(e.target.value)}
                                    placeholder="sk-..."
                                    className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                                />
                                <p className="text-xs text-muted-foreground">Stored securely in your system keychain via Vault.</p>
                            </div>
                        )}

                        <button
                            onClick={handleSaveConfig}
                            disabled={setupSaving || (providers.find(p => p.id === setupProvider)?.requires_api_key && !setupApiKey.trim())}
                            className="w-full bg-primary text-primary-foreground rounded-lg px-4 py-2.5 text-sm font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                            {setupSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                            Save & Activate
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // --- Knowledge View ---
    if (view === 'knowledge') {
        return (
            <div className="flex flex-col h-full bg-background">
                <div className="p-4 border-b border-border/40 flex items-center justify-between">
                    <h3 className="text-sm font-medium flex items-center gap-2">
                        <Brain className="w-4 h-4 text-primary" />
                        Knowledge Graph
                        <span className="text-xs text-muted-foreground">({knowledgeNodes.length} nodes)</span>
                    </h3>
                    <button onClick={() => setView('chat')} className="text-xs text-muted-foreground hover:text-foreground">
                        Back to Chat
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {knowledgeNodes.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground space-y-3">
                            <Brain className="w-10 h-10 text-muted-foreground/30" />
                            <p className="text-sm">No knowledge nodes yet.</p>
                            <p className="text-xs max-w-xs">Chat with the AI agent, and it will automatically save important insights to the knowledge graph.</p>
                        </div>
                    ) : (
                        knowledgeNodes.map(node => (
                            <div key={node.id} className="p-3 rounded-lg border border-border hover:border-muted-foreground/30 transition-colors">
                                <div className="flex items-start justify-between gap-2">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium uppercase tracking-wide ${
                                                node.kind === 'architecture' ? 'bg-blue-500/10 text-blue-400' :
                                                node.kind === 'convention' ? 'bg-green-500/10 text-green-400' :
                                                node.kind === 'decision' ? 'bg-purple-500/10 text-purple-400' :
                                                node.kind === 'runbook' ? 'bg-orange-500/10 text-orange-400' :
                                                node.kind === 'debug_log' ? 'bg-red-500/10 text-red-400' :
                                                'bg-muted text-muted-foreground'
                                            }`}>{node.kind}</span>
                                            <span className="text-[10px] text-muted-foreground">{node.source}</span>
                                        </div>
                                        <h4 className="text-sm font-medium mt-1">{node.title}</h4>
                                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{node.content}</p>
                                    </div>
                                    <button
                                        onClick={() => deleteKnowledgeNode(node.id)}
                                        className="text-muted-foreground hover:text-destructive p-1 shrink-0"
                                    >
                                        <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        );
    }

    // --- Chat View ---
    return (
        <div className="flex flex-col h-full bg-background">
            {/* Header */}
            <div className="p-3 border-b border-border/40 flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                    <Bot className="w-4 h-4 text-primary shrink-0" />
                    <div className="relative">
                        <button
                            onClick={() => setShowConversationList(!showConversationList)}
                            className="text-sm font-medium flex items-center gap-1 hover:text-primary transition-colors truncate max-w-[200px]"
                        >
                            {activeConversation?.title || 'New Conversation'}
                            <ChevronDown className="w-3 h-3 shrink-0" />
                        </button>

                        {showConversationList && (
                            <div className="absolute top-8 left-0 z-50 w-72 bg-background border border-border rounded-lg shadow-xl overflow-hidden">
                                <div className="p-2 border-b border-border">
                                    <button
                                        onClick={startNewConversation}
                                        className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-muted transition-colors"
                                    >
                                        <Plus className="w-3.5 h-3.5" /> New Conversation
                                    </button>
                                </div>
                                <div className="max-h-60 overflow-y-auto">
                                    {conversations.map(conv => (
                                        <div
                                            key={conv.id}
                                            className={`flex items-center justify-between px-3 py-2 text-sm hover:bg-muted cursor-pointer ${
                                                conv.id === activeConversation?.id ? 'bg-primary/5' : ''
                                            }`}
                                        >
                                            <button onClick={() => loadConversation(conv)} className="flex-1 text-left truncate flex items-center gap-2">
                                                <MessageSquare className="w-3 h-3 shrink-0 text-muted-foreground" />
                                                {conv.title}
                                            </button>
                                            <button onClick={(e) => { e.stopPropagation(); deleteConversation(conv.id); }} className="text-muted-foreground hover:text-destructive p-1 shrink-0">
                                                <Trash2 className="w-3 h-3" />
                                            </button>
                                        </div>
                                    ))}
                                    {conversations.length === 0 && (
                                        <p className="text-xs text-muted-foreground p-3 text-center">No conversations yet</p>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    {activeConfig && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
                            {activeConfig.provider}/{activeConfig.model}
                        </span>
                    )}
                </div>

                <div className="flex items-center gap-1">
                    <button onClick={() => setView('knowledge')} className="p-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-muted/80 transition-colors" title="Knowledge Graph">
                        <Brain className="w-4 h-4" />
                    </button>
                    <button onClick={() => setView('settings')} className="p-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-muted/80 transition-colors" title="Provider Settings">
                        <Settings className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4" onClick={() => setShowConversationList(false)}>
                {messages.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground space-y-4">
                        <div className="p-4 rounded-full bg-primary/10">
                            <Bot className="w-8 h-8 text-primary" />
                        </div>
                        <div className="space-y-2">
                            <p className="text-sm font-medium text-foreground">Orbitae Agent</p>
                            <p className="text-xs max-w-xs">
                                {agentEngine.isConfigured()
                                    ? 'Ask me to manage processes, query databases, search your knowledge graph, or orchestrate your dev environment.'
                                    : 'Set up an AI provider to get started.'}
                            </p>
                        </div>
                        {!agentEngine.isConfigured() && (
                            <button
                                onClick={() => setView('settings')}
                                className="text-xs bg-primary text-primary-foreground px-4 py-2 rounded-lg hover:bg-primary/90"
                            >
                                Configure AI Provider
                            </button>
                        )}
                    </div>
                )}
                {messages.map((msg, idx) => (
                    <div key={idx} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        {msg.role === 'assistant' && (
                            <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center shrink-0 mt-0.5">
                                <Bot className="w-3.5 h-3.5 text-primary" />
                            </div>
                        )}
                        <div className="max-w-[80%] space-y-1">
                            {msg.toolCalls && msg.toolCalls.length > 0 && (
                                <div className="flex flex-wrap gap-1 mb-1">
                                    {msg.toolCalls.map((tool, i) => (
                                        <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground flex items-center gap-1">
                                            <Wrench className="w-2.5 h-2.5" /> {tool}
                                        </span>
                                    ))}
                                </div>
                            )}
                            <div className={`px-3.5 py-2.5 rounded-lg text-sm whitespace-pre-wrap ${
                                msg.role === 'user'
                                    ? 'bg-primary text-primary-foreground'
                                    : 'bg-muted/50 border border-border'
                            }`}>
                                {msg.content || (msg.isStreaming ? '' : '(no response)')}
                                {msg.isStreaming && <span className="inline-block w-1.5 h-4 bg-primary/50 animate-pulse ml-0.5 align-text-bottom" />}
                            </div>
                        </div>
                        {msg.role === 'user' && (
                            <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center shrink-0 mt-0.5">
                                <User className="w-3.5 h-3.5" />
                            </div>
                        )}
                    </div>
                ))}
                <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="p-3 border-t border-border/40 bg-background/50">
                <form onSubmit={handleSubmit} className="relative flex items-center">
                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder={agentEngine.isConfigured() ? 'Ask the agent...' : 'Configure AI provider first...'}
                        className="w-full bg-muted border border-border rounded-lg pl-4 pr-12 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                        disabled={isThinking || !agentEngine.isConfigured()}
                    />
                    <button
                        type="submit"
                        disabled={!input.trim() || isThinking || !agentEngine.isConfigured()}
                        className="absolute right-2 p-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-muted/80 disabled:opacity-50 transition-colors"
                    >
                        {isThinking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    </button>
                </form>
            </div>
        </div>
    );
};
