export interface AgentTemplate {
    id: string;
    name: string;
    description: string;
    prompt: string;
    icon: string;
}

export const AGENT_TEMPLATES: AgentTemplate[] = [
    {
        id: 'boot-env',
        name: 'Boot Dev Environment',
        description: 'Start all services needed for local development',
        prompt: 'Analyze this project and start the complete development environment. Look at the scripts, identify the correct startup order (databases first, then backends, then frontends), and use the appropriate commands. Wait for each service to be ready before starting dependent ones.',
        icon: 'Rocket',
    },
    {
        id: 'debug-error',
        name: 'Debug This Error',
        description: 'Help diagnose and fix an error',
        prompt: 'I need help debugging an issue. Check the git status, look at active processes, and query any relevant knowledge nodes about recent debugging. Help me identify the root cause and suggest a fix.',
        icon: 'Bug',
    },
    {
        id: 'explain-codebase',
        name: 'Explain This Codebase',
        description: 'Get an overview of the project structure',
        prompt: 'Search the knowledge graph for architecture and convention nodes. Based on the project scripts and any existing documentation, give me a concise overview of this codebase: what tech stack it uses, how it\'s structured, and how to get started. Save any new insights you discover as knowledge nodes.',
        icon: 'BookOpen',
    },
    {
        id: 'save-convention',
        name: 'Document a Convention',
        description: 'Save a development convention to the knowledge graph',
        prompt: 'I want to document a development convention for this project. Ask me what the convention is, then save it as a knowledge node with kind "convention" so the team\'s AI agents can reference it in future conversations.',
        icon: 'FileText',
    },
    {
        id: 'status-check',
        name: 'Project Status Check',
        description: 'Check the health of all running services',
        prompt: 'Give me a full status check of this project. Check git status, list all active processes, and search the knowledge graph for any recent issues or notes. Summarize the current state.',
        icon: 'Activity',
    },
    {
        id: 'create-playbook',
        name: 'Generate a Playbook',
        description: 'Create a reusable startup playbook from scripts',
        prompt: 'Analyze the project scripts and create a Playbook that automates the startup sequence. Identify the correct order, add appropriate delays between steps, and save it so I can one-click start this project in the future.',
        icon: 'Zap',
    },
];
