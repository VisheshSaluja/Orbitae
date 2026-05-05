import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { agentTools } from './tools';
import type { ProjectContext } from '../../types';

export class AgentEngine {
    private openai;

    constructor(_apiKey: string) {
        // We use the OpenAI provider but point it to the local Ollama via the OpenAI compatibility route.
        this.openai = createOpenAI({
            apiKey: 'ollama', // Ollama ignores this but SDK requires it
            baseURL: 'http://127.0.0.1:11434/v1',
        });
    }

    createSystemPrompt(projectContext: ProjectContext) {
        return `
You are the Switchboard Agentic Orchestrator. 
Your primary job is to intelligently spin up local development environments based on the user's instructions.
You have access to a variety of tools. In many cases, starting an environment means starting multiple processes.
CRITICAL INSTRUCTION: If you need to wait for a database or docker container to spin up, use the \`delay\` tool or check health before proceeding to start the next process.
Often, order matters (e.g., Docker -> Database -> Backend -> Frontend).

Project Context provided by the user:
Name: ${projectContext?.name || 'Unknown'}
Path: ${projectContext?.path || 'Unknown'}
Known Scripts/Files: ${JSON.stringify(projectContext?.scripts || [])}
    `;
    }

    async runPlaybookGeneration(prompt: string, projectContext: ProjectContext, onUpdate: (msg: string) => void) {
        onUpdate("🤔 Analyzing your orchestration request...");

        try {
            // For a truly transparent stream, we use streamText, but to simply orchestrate with tool calls:
            const result = await generateText({
                model: this.openai.chat('llama3.2:1b'), // Using a tool-supported local model
                system: this.createSystemPrompt(projectContext),
                prompt: prompt,
                tools: agentTools as Record<string, unknown>,
                onStepFinish: ({ toolCalls, toolResults }) => {
                    if (toolCalls && toolCalls.length > 0) {
                        toolCalls.forEach(call => {
                            onUpdate(`⚙️ Executing: ${call.toolName}...`);
                        });
                    }
                    if (toolResults && toolResults.length > 0) {
                        toolResults.forEach(res => {
                            onUpdate(`✅ Finished: ${res.toolName}`);
                        });
                    }
                },
            });

            onUpdate("🎉 Orchestration Complete! " + result.text);
            return result;
        } catch (err: unknown) {
            console.error(err);
            const message = err instanceof Error ? err.message : String(err);
            onUpdate("❌ Error during orchestration: " + message);
            throw err;
        }
    }
}
