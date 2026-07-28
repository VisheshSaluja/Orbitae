import { invokeCommand } from '../tauri';
import { z } from 'zod';
import type { ProjectPlaybook, GitStatus, QueryResult, ProjectConnection, AgentSession } from '../../types';

export const agentTools = {
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
        description: 'Execute a SQL query against a project database connection.',
        parameters: z.object({
            projectId: z.string(),
            connectionName: z.string().describe('Name of the database connection'),
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
                connectionId: conn.id,
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
    savePlaybook: {
        description: 'Save steps as a runbook for re-execution.',
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
    },
    launchAgentTerminals: {
        description: 'Launch AI coding agent sessions in external terminal windows.',
        parameters: z.object({
            agentType: z.enum(['claude', 'codex', 'custom']),
            count: z.number().min(1).max(6),
            projectId: z.string(),
            projectPath: z.string(),
        }),
        execute: async ({ agentType, count, projectId, projectPath }: { agentType: string; count: number; projectId: string; projectPath: string }) => {
            return await invokeCommand<AgentSession[]>('launch_agent_sessions', {
                agentType,
                count,
                projectId,
                projectPath,
                instructions: null,
            });
        },
    },
};
