import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { invokeCommand } from '../tauri';
import type { AiProviderConfig, ProjectScript } from '../../types';

const PLAYBOOK_SYSTEM_PROMPT = `You are a DevOps automation expert. Generate a playbook YAML for automating a development environment setup.

Output ONLY valid YAML with no markdown fencing, no explanation, no extra text. The YAML must follow this exact schema:

name: "Playbook Name"
description: "What this playbook does"
steps:
  - name: "Step Name"
    type: "command"        # command | health_check | delay
    command: "npm run dev" # shell command, URL for health_check, or ms for delay
    expected_output: null  # "http" or "tcp" for health_check type
    on_failure: "abort"    # abort | skip | retry
    max_retries: 0
    retry_delay_ms: 1000
    depends_on: null       # comma-separated step IDs (leave null for now)

Guidelines:
- Start databases/infrastructure first, then backends, then frontends
- Add health_check steps after services that need warmup (type: "health_check", command: "http://localhost:PORT", expected_output: "http")
- Add short delay steps (type: "delay", command: "2000") between dependent services
- Use "skip" on_failure for non-critical steps, "abort" for critical ones
- Keep step names concise and descriptive`;

export async function generatePlaybookYaml(
    projectId: string,
    projectPath: string,
    projectName: string,
): Promise<string> {
    const config = await invokeCommand<AiProviderConfig | null>('get_default_ai_config', { projectId });
    if (!config) {
        throw new Error('No AI provider configured. Set one up in the Agent panel first.');
    }

    let apiKey: string | null = null;
    if (config.key_reference) {
        apiKey = await invokeCommand<string | null>('get_ai_api_key', { configId: config.id });
    }

    const baseURLMap: Record<string, string> = {
        openai: 'https://api.openai.com/v1',
        anthropic: 'https://api.anthropic.com/v1',
        groq: 'https://api.groq.com/openai/v1',
        ollama: 'http://127.0.0.1:11434/v1',
    };

    const baseURL = config.base_url || baseURLMap[config.provider] || baseURLMap.openai;

    const provider = createOpenAI({
        apiKey: apiKey || 'ollama',
        baseURL,
    } as Parameters<typeof createOpenAI>[0]);

    let scripts: ProjectScript[] = [];
    try {
        scripts = await invokeCommand<ProjectScript[]>('get_project_scripts', { path: projectPath });
    } catch {
        // no scripts found
    }

    const scriptsContext = scripts.length > 0
        ? `\nAvailable scripts:\n${scripts.map(s => `- ${s.name}: "${s.command}" (from ${s.source})`).join('\n')}`
        : '\nNo package scripts detected.';

    const userPrompt = `Generate a startup playbook for this project:
Project: ${projectName}
Path: ${projectPath}
${scriptsContext}

Create a practical playbook that starts the full development environment.`;

    const result = await generateText({
        model: provider.chat(config.model),
        system: PLAYBOOK_SYSTEM_PROMPT,
        prompt: userPrompt,
        temperature: 0.3,
    });

    let yaml = result.text.trim();
    if (yaml.startsWith('```')) {
        yaml = yaml.replace(/^```(?:ya?ml)?\n?/, '').replace(/\n?```$/, '');
    }

    return yaml;
}
