import { invokeCommand } from '../tauri';
import { z } from 'zod';
import type { Process, ProjectPlaybook, KnowledgeNode, GitStatus, QueryResult, ProjectConnection } from '../../types';

export const agentTools = {
    startProcess: {
        description: 'Start a process (like Docker, Backend, Frontend) for a project. The cwd should be the project path.',
        parameters: z.object({
            command: z.string().describe('Shell command to run'),
            cwd: z.string().describe('Working directory (use the project path)'),
        }),
        execute: async ({ command, cwd }: { command: string; cwd: string }) => {
            return await invokeCommand<Process>('start_process', { command, cwd });
        },
    },
    stopProcess: {
        description: 'Stop a running process by its ID.',
        parameters: z.object({
            id: z.string().describe('The process ID to stop'),
        }),
        execute: async ({ id }: { id: string }) => {
            return await invokeCommand<void>('stop_process', { id });
        },
    },
    getActiveProcesses: {
        description: 'Get a list of all currently active processes.',
        parameters: z.object({}),
        execute: async () => {
            return await invokeCommand<Process[]>('get_active_processes', {});
        },
    },
    delay: {
        description: 'Wait for a specified number of milliseconds (useful for waiting for a service to start).',
        parameters: z.object({
            ms: z.number().describe('Milliseconds to wait'),
        }),
        execute: async ({ ms }: { ms: number }) => {
            await new Promise<void>((resolve) => setTimeout(resolve, ms));
            return { msg: `Waited for ${ms}ms` };
        },
    },
    getGitStatus: {
        description: 'Get the current git status of the project (branch, modified files, ahead/behind).',
        parameters: z.object({
            path: z.string().describe('The project path'),
        }),
        execute: async ({ path }: { path: string }) => {
            return await invokeCommand<GitStatus | null>('get_git_status', { path });
        },
    },
    runDatabaseQuery: {
        description: 'Execute a read-only SQL query against a project database connection. First use listDatabaseConnections to find available connections.',
        parameters: z.object({
            projectId: z.string().describe('The project ID to look up connections'),
            connectionName: z.string().describe('Name of the database connection to query'),
            query: z.string().describe('SQL query to execute'),
        }),
        execute: async ({ projectId, connectionName, query }: { projectId: string; connectionName: string; query: string }) => {
            const connections = await invokeCommand<ProjectConnection[]>('get_connections', { projectId });
            const conn = connections.find(c => c.name === connectionName);
            if (!conn) {
                return { error: `Connection "${connectionName}" not found. Available: ${connections.map(c => c.name).join(', ')}` };
            }
            return await invokeCommand<QueryResult>('execute_query', {
                kind: conn.kind,
                details: conn.details,
                query,
                password: null,
            });
        },
    },
    listDatabaseConnections: {
        description: 'List all database connections configured for a project.',
        parameters: z.object({
            projectId: z.string(),
        }),
        execute: async ({ projectId }: { projectId: string }) => {
            return await invokeCommand<ProjectConnection[]>('get_connections', { projectId });
        },
    },
    searchKnowledge: {
        description: 'Search the project knowledge graph for relevant information. Use this to find architecture decisions, conventions, runbooks, and other project context.',
        parameters: z.object({
            projectId: z.string(),
            query: z.string().describe('Search query'),
            kind: z.string().optional().describe('Filter by node kind: architecture, convention, decision, runbook, dependency, debug_log, api_doc, onboarding, auto_insight'),
            limit: z.number().optional().describe('Max results to return'),
        }),
        execute: async ({ projectId, query, kind, limit }: { projectId: string; query: string; kind?: string; limit?: number }) => {
            return await invokeCommand<KnowledgeNode[]>('search_knowledge_nodes', {
                projectId,
                query,
                kind: kind ?? null,
                status: 'active',
                limit: limit ?? 10,
            });
        },
    },
    createKnowledgeNode: {
        description: 'Create a new knowledge node in the project graph. Use this to save insights, decisions, conventions, or important information discovered during conversation.',
        parameters: z.object({
            projectId: z.string(),
            title: z.string(),
            content: z.string(),
            kind: z.string().describe('Node kind: architecture, convention, decision, runbook, dependency, debug_log, api_doc, onboarding, auto_insight'),
            tags: z.array(z.string()).optional(),
        }),
        execute: async ({ projectId, title, content, kind, tags }: { projectId: string; title: string; content: string; kind: string; tags?: string[] }) => {
            const newNode = await invokeCommand<KnowledgeNode>('create_knowledge_node', {
                projectId,
                title,
                content,
                kind,
                source: 'ai_agent',
                tags: tags ?? [],
            });

            // Auto-link: find existing nodes with the same kind and link them
            try {
                const relatedNodes = await invokeCommand<KnowledgeNode[]>('search_knowledge_nodes', {
                    projectId,
                    query: null,
                    kind,
                    status: 'active',
                    limit: 10,
                });
                for (const existing of relatedNodes) {
                    if (existing.id !== newNode.id) {
                        await invokeCommand('create_knowledge_edge', {
                            fromNode: newNode.id,
                            toNode: existing.id,
                            relation: 'related_to',
                        });
                    }
                }
            } catch {
                // Auto-linking is best-effort; do not fail the node creation
            }

            return newNode;
        },
    },
    updateKnowledgeNode: {
        description: 'Update an existing knowledge node with new or corrected information.',
        parameters: z.object({
            id: z.string(),
            title: z.string().optional(),
            content: z.string().optional(),
            status: z.string().optional().describe('Node status: active, stale, archived'),
        }),
        execute: async ({ id, title, content, status }: { id: string; title?: string; content?: string; status?: string }) => {
            return await invokeCommand<KnowledgeNode>('update_knowledge_node', {
                id,
                title: title ?? null,
                content: content ?? null,
                kind: null,
                status: status ?? null,
                tags: null,
            });
        },
    },
    linkKnowledgeNodes: {
        description: 'Create a relationship between two knowledge nodes.',
        parameters: z.object({
            fromNode: z.string(),
            toNode: z.string(),
            relation: z.string().describe('Edge relation: depends_on, related_to, contradicts, supersedes, implements, documents'),
        }),
        execute: async ({ fromNode, toNode, relation }: { fromNode: string; toNode: string; relation: string }) => {
            return await invokeCommand('create_knowledge_edge', { fromNode, toNode, relation });
        },
    },
    savePlaybook: {
        description: 'Save the sequence of successful steps as a Playbook so it can be re-run later without AI orchestration.',
        parameters: z.object({
            projectId: z.string(),
            name: z.string(),
            description: z.string().optional(),
            steps: z.array(z.object({
                name: z.string(),
                type: z.string(),
                command: z.string().optional(),
                expected_output: z.string().optional()
            }))
        }),
        execute: async ({ projectId, name, description, steps }: {
            projectId: string, name: string, description?: string,
            steps: { name: string, type: string, command?: string, expected_output?: string }[]
        }) => {
            const playbook = await invokeCommand<ProjectPlaybook>('create_playbook', { projectId, name, description });

            for (const step of steps) {
                await invokeCommand('create_playbook_step', {
                    playbookId: playbook.id,
                    name: step.name,
                    type: step.type,
                    command: step.command,
                    dependsOn: undefined,
                    expectedOutput: step.expected_output
                });
            }
            return { success: true, playbookId: playbook.id };
        }
    }
};
