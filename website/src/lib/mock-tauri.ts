
import { EventEmitter } from 'events';

// Simple event emitter to simulate Tauri events
const eventEmitter = new EventEmitter();

// Mock file system
const fileSystem = {
    '/home/visitor/projects': ['orbitae-core', 'website', 'marketing'],
    '/home/visitor/projects/orbitae-core': ['src', 'Cargo.toml', 'README.md'],
    '~/projects/orbitae-core': ['src', 'Cargo.toml', 'README.md'], // Support both paths
    '/home/visitor/projects/website': ['src', 'package.json', 'next.config.js'],
};

// State
let currentPath = '~/projects/orbitae-core';
let lineBuffer = '';

// Helper to emit events
const emit = (event: string, payload: any) => {
    eventEmitter.emit(event, { payload });
};

// Command Processor
const processCommand = async (command: string, sessionId: string) => {
    const args = command.trim().split(' ');
    const cmd = args[0];
    let output = '';

    // Handle empty command
    if (!cmd) return '';

    switch (cmd) {
        case 'ls':
        case 'll':
            // Use current path to find files. 
            // In a real terminal, we'd use directory structure. 
            // Here we just map known paths.
            const p = currentPath.replace('~', '/home/visitor');
            const files = fileSystem[p as keyof typeof fileSystem] || fileSystem['~/projects/orbitae-core'];
            output = files.join('  ') + '\r\n';
            break;
        case 'pwd':
            output = currentPath + '\r\n';
            break;
        case 'whoami':
            output = 'visitor\r\n';
            break;
        case 'help':
            output = 'Available commands: ls, pwd, whoami, cd, clear, help\r\nTry "cargo build" for a simulation!\r\n';
            break;
        case 'cd':
            const target = args[1];
            if (!target) {
                currentPath = '~';
                output = '';
            } else if (target === '..') {
                // Simple parent logic
                if (currentPath === '~/projects/orbitae-core') currentPath = '~/projects';
                else if (currentPath === '~/projects') currentPath = '~';
                output = '';
            } else {
                // Allow fake cd into known folders
                output = '';
                currentPath = `${currentPath}/${target}`;
            }
            break;
        case 'cargo':
            if (args[1] === 'build') {
                output = 'Compiling orbitae-core v0.1.0...\r\n';
                setTimeout(() => {
                    emit('terminal_data', { session_id: sessionId, data: '   Compiling native-tls v0.2.11\r\n' });
                }, 500);
                setTimeout(() => {
                    emit('terminal_data', { session_id: sessionId, data: '   Compiling tokio v1.28.0\r\n' });
                }, 1000);
                setTimeout(() => {
                    emit('terminal_data', { session_id: sessionId, data: '    Finished release [optimized] target(s) in 2.45s\r\n' });
                    emit('terminal_data', { session_id: sessionId, data: `\x1b[32m➜\x1b[0m  \x1b[36m${currentPath.split('/').pop()}\x1b[0m ` });
                }, 2500);
            } else {
                output = 'cargo: usage: cargo build\r\n';
            }
            break;
        case 'clear':
            output = '\x1b[2J\x1b[H';
            break;
        default:
            output = `command not found: ${cmd}\r\n`;
    }

    return output;
};


export async function invokeCommand<T>(cmd: string, args: any = {}): Promise<T> {
    console.log(`[MockTauri] invoke: ${cmd}`, args);

    // --- Terminal Handlers ---
    if (cmd === 'spawn_shell') {
        const initialPrompt = `\r\n\x1b[32m➜\x1b[0m  \x1b[36morbitae-core\x1b[0m `;
        setTimeout(() => {
            emit('terminal_data', { session_id: 'mock-session-id', data: initialPrompt });
        }, 100);
        return 'mock-session-id' as unknown as T;
    }

    if (cmd === 'write_to_shell') {
        const { data, sessionId } = args;

        // Handle Enter
        if (data === '\r') {
            emit('terminal_data', { session_id: sessionId, data: '\r\n' });
            const output = await processCommand(lineBuffer, sessionId);
            if (output) {
                emit('terminal_data', { session_id: sessionId, data: output });
            }
            // If the command didn't handle the prompt asynchronously (like cargo build), print it now
            if (output.indexOf('cargo') === -1 && output.indexOf('[2J') === -1) {
                emit('terminal_data', {
                    session_id: sessionId,
                    data: `\x1b[32m➜\x1b[0m  \x1b[36m${currentPath.split('/').pop()}\x1b[0m `
                });
            }
            lineBuffer = '';
            return null as unknown as T;
        }

        // Handle Backspace
        if (data === '\u007F') {
            if (lineBuffer.length > 0) {
                lineBuffer = lineBuffer.slice(0, -1);
                emit('terminal_data', { session_id: sessionId, data: '\b \b' });
            }
            return null as unknown as T;
        }

        // Add to buffer and Echo
        lineBuffer += data;
        emit('terminal_data', { session_id: sessionId, data: data });
        return null as unknown as T;
    }

    if (cmd === 'resize_shell') {
        return null as unknown as T;
    }

    // --- Overview & Notes Handlers ---
    if (cmd === 'get_project_notes') {
        return [
            { id: '1', title: 'Refactor Auth', content: 'Switch to JWT based auth for better scalability.', color: 'blue', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), kind: 'text' },
            { id: '2', title: 'Database Optimization', content: 'Investigate slow queries in the reporting module.', color: 'red', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), kind: 'text' }
        ] as unknown as T;
    }

    if (cmd === 'create_project_note' || cmd === 'update_project_note' || cmd === 'delete_project_note') {
        // Just succeed
        return null as unknown as T;
    }

    // --- Git Handlers ---
    if (cmd === 'get_git_status') {
        return { branch: 'main', modified_count: 3, ahead: 2, behind: 0, remote_url: 'https://github.com/orbitae/core' } as unknown as T;
    }

    if (cmd === 'get_git_history') {
        return [
            { hash: 'a1b2c3d', message: 'feat: implement auth middleware', author: 'John Doe', date: '2 hours ago', parents: ['d4e5f6g'], refs: 'HEAD -> main' },
            { hash: 'd4e5f6g', message: 'fix: database connection timeout', author: 'Jane Doe', date: '5 hours ago', parents: ['h7i8j9k'], refs: '' },
            { hash: 'h7i8j9k', message: 'chore: update dependencies', author: 'Bot', date: '1 day ago', parents: [], refs: '' }
        ] as unknown as T;
    }

    // --- Process Handlers ---
    if (cmd === 'get_active_processes') {
        return [
            { id: '1', command: 'cargo run', pid: 1234, running: true },
            { id: '2', command: 'postgres', pid: 5432, running: true }
        ] as unknown as T;
    }

    // --- Database Handlers ---
    if (cmd === 'get_connections') {
        return [
            { id: '1', name: 'Production DB', kind: 'postgres', details: 'postgres@aws-rds:5432/prod' },
            { id: '2', name: 'Local Test', kind: 'sqlite', details: './test.db' }
        ] as unknown as T;
    }

    if (cmd === 'get_tables') {
        return [
            { name: 'users', schema: 'public' },
            { name: 'projects', schema: 'public' },
            { name: 'api_keys', schema: 'public' }
        ] as unknown as T;
    }

    if (cmd === 'execute_query') {
        return {
            columns: ['id', 'email', 'name', 'role'],
            rows: [
                [1, 'vishesh@example.com', 'Vishesh', 'admin'],
                [2, 'demo@orbitae.com', 'Demo User', 'viewer'],
                [3, 'bot@orbitae.com', 'CI Bot', 'service_account']
            ],
            affected_rows: 0
        } as unknown as T;
    }

    // --- Keys Handlers ---
    if (cmd === 'get_project_keys') {
        return [
            { id: '101', name: 'AWS_ACCESS_KEY', key_reference: 'ref_aws', created_at: new Date().toISOString() },
            { id: '102', name: 'STRIPE_SECRET_KEY', key_reference: 'ref_stripe', created_at: new Date().toISOString() }
        ] as unknown as T;
    }

    if (cmd === 'reveal_secret') {
        return "sk_test_mock_1234567890abcdef" as unknown as T;
    }

    if (cmd === 'add_project_key' || cmd === 'delete_project_key') {
        return null as unknown as T;
    }

    console.warn(`[MockTauri] Unknown command: ${cmd}`);
    return null as unknown as T;
}

export async function listen<T>(event: string, handler: (event: { payload: T }) => void) {
    eventEmitter.on(event, handler);
    return () => eventEmitter.off(event, handler);
}
