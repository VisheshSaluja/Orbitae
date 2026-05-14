import { generateText, streamText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { agentTools } from './tools';
import { invokeCommand } from '../tauri';
import { logger } from '../logger';
import type { ProjectContext, AiProviderConfig, KnowledgeNode } from '../../types';

interface ProviderInstance {
    provider: ReturnType<typeof createOpenAI>;
    model: string;
    supportsTools: boolean;
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

        const noToolModels = ['llama3.2:latest', 'llama3:latest'];
        const supportsTools = !noToolModels.includes(config.model);

        this.providerInstance = {
            provider: createOpenAI({
                apiKey: key,
                baseURL,
            } as Parameters<typeof createOpenAI>[0]),
            model: config.model,
            supportsTools,
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

IMPORTANT: When calling tools, use these exact values:
- projectId: "${projectContext.projectId}"
- path: "${projectContext.path}"

When you discover important information (architecture decisions, conventions, debugging insights), save it to the knowledge graph using the createKnowledgeNode tool so it compounds over time.

After using tools, ALWAYS respond with a natural language summary of what you found or did. Never leave the user without a text response.

Project Context:
Name: ${projectContext.name}
Project ID: ${projectContext.projectId}
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
            const useTools = this.providerInstance.supportsTools;

            const result = await generateText({
                model: this.providerInstance.provider.chat(this.providerInstance.model),
                system: systemPrompt,
                messages,
                ...(useTools ? { tools: agentTools as never, maxSteps: 10 } : {}),
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
            const collectedToolResults: Array<{ toolName: string; result: unknown }> = [];

            const useTools = this.providerInstance.supportsTools;

            const result = streamText({
                model: this.providerInstance.provider.chat(this.providerInstance.model),
                system: systemPrompt,
                messages,
                ...(useTools ? { tools: agentTools as never, maxSteps: 10 } : {}),
                onStepFinish: ({ toolCalls, toolResults }) => {
                    if (toolCalls && toolCalls.length > 0) {
                        for (const call of toolCalls) {
                            onToolCall(call.toolName);
                        }
                    }
                    if (toolResults && toolResults.length > 0) {
                        for (const res of toolResults) {
                            onToolResult(res.toolName);
                            collectedToolResults.push({ toolName: res.toolName, result: (res as Record<string, unknown>).result });
                        }
                    }
                },
            });

            let fullText = '';
            for await (const chunk of result.textStream) {
                fullText += chunk;
                onTextChunk(chunk);
            }

            // Strip leaked tool call JSON from text stream
            // Some models emit {"tool_call":...} or {"name":"toolName",...} as text
            fullText = fullText.replace(/\{"(?:tool_call|function_call|name|type)"\s*:[\s\S]*?\}\s*/g, '').trim();

            // If model called tools but produced no text, synthesize a readable summary
            if (!fullText.trim() && collectedToolResults.length > 0) {
                const summaryParts = collectedToolResults.map(tr => {
                    return this.formatToolResult(tr.toolName, tr.result);
                });
                fullText = summaryParts.join('\n\n');
                onTextChunk(fullText);
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

    private formatToolResult(toolName: string, result: unknown): string {
        if (result === null || result === undefined) {
            return `Done: **${toolName}** completed.`;
        }

        if (typeof result === 'string') {
            return result.length > 300 ? result.substring(0, 300) + '...' : result;
        }

        if (Array.isArray(result)) {
            if (result.length === 0) return `**${toolName}**: No results found.`;
            const items = result.slice(0, 5).map(item => {
                if (typeof item === 'object' && item !== null) {
                    const name = (item as Record<string, unknown>).name
                        || (item as Record<string, unknown>).title
                        || (item as Record<string, unknown>).id
                        || '';
                    const status = (item as Record<string, unknown>).status || '';
                    return `- ${name}${status ? ` (${status})` : ''}`;
                }
                return `- ${String(item)}`;
            });
            const suffix = result.length > 5 ? `\n- ...and ${result.length - 5} more` : '';
            return `**${toolName}** (${result.length} results):\n${items.join('\n')}${suffix}`;
        }

        if (typeof result === 'object') {
            const obj = result as Record<string, unknown>;
            if (obj.success !== undefined) {
                return obj.success ? `**${toolName}**: Success.` : `**${toolName}**: Failed.`;
            }
            if (obj.msg) return `**${toolName}**: ${obj.msg}`;
            const preview = JSON.stringify(result);
            if (preview.length > 300) return `**${toolName}**: Operation completed.`;
            return `**${toolName}**: ${preview}`;
        }

        return `**${toolName}**: ${String(result)}`;
    }
}
