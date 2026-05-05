import { invokeCommand } from '../tauri';
import { z } from 'zod';
import type { Process, ProjectPlaybook } from '../../types';

export const agentTools = {
    startProcess: {
        description: 'Start a process (like Docker, Backend, Frontend) for a specific project.',
        parameters: z.object({
            projectId: z.string(),
            command: z.string(),
            name: z.string(),
        }),
        execute: async ({ projectId, command, name }: { projectId: string; command: string; name: string }) => {
            const result = await invokeCommand<Process>('start_process', { projectId, cmd: command, name });
            return result;
        },
    },
    stopProcess: {
        description: 'Stop a running process.',
        parameters: z.object({
            processId: z.string(),
        }),
        execute: async ({ processId }: { processId: string }) => {
            const result = await invokeCommand<void>('stop_process', { id: processId });
            return result;
        },
    },
    getActiveProcesses: {
        description: 'Get a list of currently active processes for this project.',
        parameters: z.object({
            projectId: z.string(),
        }),
        execute: async ({ projectId }: { projectId: string }) => {
            const result = await invokeCommand<Process[]>('get_active_processes', { projectId });
            return result;
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

            for (let i = 0; i < steps.length; i++) {
                const step = steps[i];
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
