import { generateText, streamText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { agentTools } from './tools';
import { invokeCommand } from '../tauri';
import { logger } from '../logger';
import type { ProjectContext, AiProviderConfig, KnowledgeNode } from '../../types';

interface ProviderInstance {
    provider: ReturnType<typeof createOpenAI>;
    model: string;
}

export interface AgentMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
}

export class AgentEngine {
    private providerInstance: ProviderInstance | null = null;

    async configure(config: AiProviderConfig, apiKey: string | null): Promise<void> {
        const baseURLMap: Record<string, string> = {
            openai: 'https://api.openai.com/v1',
            anthropic: 'https://api.anthropic.com/v1',
            groq: 'https://api.groq.com/openai/v1',
            ollama: 'http://127.0.0.1:11434/v1',
        };

        const baseURL = config.base_url || baseURLMap[config.provider] || baseURLMap.openai;
        const key = apiKey || 'ollama';

        this.providerInstance = {
            provider: createOpenAI({
                apiKey: key,
                baseURL,
                compatibility: config.provider === 'anthropic' ? 'compatible' : 'strict',
            }),
            model: config.model,
        };

        logger.info(`Agent configured: ${config.provider}/${config.model}`);
    }

    private async buildSystemPrompt(projectContext: ProjectContext): Promise<string> {
        let knowledgeSection = '';

        if (projectContext.knowledgeNodes && projectContext.knowledgeNodes.length > 0) {
            const nodesSummary = projectContext.knowledgeNodes
                .map(n => `- [${n.kind}] ${n.title}: ${n.content.substring(0, 200)}`)
                .join('\n');
            knowledgeSection = `\n\nProject Knowledge Graph (${projectContext.knowledgeNodes.length} relevant nodes):\n${nodesSummary}`;
        }

        return `You are Orbitae Agent, an AI assistant integrated into the Orbitae developer command center.
You have access to the project's infrastructure: terminals, processes, databases, secrets, and knowledge graph.
Use the available tools to help the developer manage their project efficiently.

When you discover important information (architecture decisions, conventions, debugging insights), save it to the knowledge graph using the createKnowledgeNode tool so it compounds over time.

Project Context:
Name: ${projectContext.name}
Path: ${projectContext.path}
Known Scripts: ${JSON.stringify(projectContext.scripts || [])}${knowledgeSection}

Available node kinds for knowledge graph: architecture, convention, decision, runbook, dependency, debug_log, api_doc, onboarding, auto_insight
Available edge relations: depends_on, related_to, contradicts, supersedes, implements, documents`;
    }

    async buildContext(projectId: string, userPrompt: string): Promise<KnowledgeNode[]> {
        try {
            const nodes = await invokeCommand<KnowledgeNode[]>('build_knowledge_context', {
                projectId,
                query: userPrompt,
                maxNodes: 10,
            });
            return nodes;
        } catch {
            logger.warn('Failed to build knowledge context, continuing without it');
            return [];
        }
    }

    async chat(
        prompt: string,
        projectContext: ProjectContext,
        history: AgentMessage[],
        onUpdate: (msg: string) => void,
    ): Promise<string> {
        if (!this.providerInstance) {
            throw new Error('Agent not configured. Please set up an AI provider first.');
        }

        const systemPrompt = await this.buildSystemPrompt(projectContext);

        const messages = [
            ...history.map(m => ({ role: m.role as 'user' | 'assistant' | 'system', content: m.content })),
            { role: 'user' as const, content: prompt },
        ];

        try {
            const result = await generateText({
                model: this.providerInstance.provider.chat(this.providerInstance.model),
                system: systemPrompt,
                messages,
                tools: agentTools as Record<string, unknown>,
                maxSteps: 10,
                onStepFinish: ({ toolCalls, toolResults }) => {
                    if (toolCalls && toolCalls.length > 0) {
                        for (const call of toolCalls) {
                            onUpdate(`[tool] ${call.toolName}`);
                        }
                    }
                    if (toolResults && toolResults.length > 0) {
                        for (const res of toolResults) {
                            onUpdate(`[done] ${res.toolName}`);
                        }
                    }
                },
            });

            return result.text;
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            logger.error('Agent chat error:', err);
            throw new Error(`Agent error: ${message}`);
        }
    }

    async chatStream(
        prompt: string,
        projectContext: ProjectContext,
        history: AgentMessage[],
        onTextChunk: (chunk: string) => void,
        onToolCall: (toolName: string) => void,
        onToolResult: (toolName: string) => void,
    ): Promise<string> {
        if (!this.providerInstance) {
            throw new Error('Agent not configured. Please set up an AI provider first.');
        }

        const systemPrompt = await this.buildSystemPrompt(projectContext);

        const messages = [
            ...history.map(m => ({ role: m.role as 'user' | 'assistant' | 'system', content: m.content })),
            { role: 'user' as const, content: prompt },
        ];

        try {
            const result = streamText({
                model: this.providerInstance.provider.chat(this.providerInstance.model),
                system: systemPrompt,
                messages,
                tools: agentTools as Record<string, unknown>,
                maxSteps: 10,
                onStepFinish: ({ toolCalls, toolResults }) => {
                    if (toolCalls && toolCalls.length > 0) {
                        for (const call of toolCalls) {
                            onToolCall(call.toolName);
                        }
                    }
                    if (toolResults && toolResults.length > 0) {
                        for (const res of toolResults) {
                            onToolResult(res.toolName);
                        }
                    }
                },
            });

            let fullText = '';
            for await (const chunk of result.textStream) {
                fullText += chunk;
                onTextChunk(chunk);
            }

            return fullText;
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            logger.error('Agent stream error:', err);
            throw new Error(`Agent error: ${message}`);
        }
    }

    isConfigured(): boolean {
        return this.providerInstance !== null;
    }
}
