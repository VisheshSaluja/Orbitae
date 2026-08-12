import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { listen } from '@tauri-apps/api/event';
import { invokeCommand } from './tauri';
import '@xterm/xterm/css/xterm.css';

const THEME = {
    background: '#0a0a0a',
    foreground: '#e4e4e7',
    cursor: '#e4e4e7',
    selectionBackground: '#ffffff30',
    black: '#09090b',
    red: '#ef4444',
    green: '#22c55e',
    yellow: '#eab308',
    blue: '#3b82f6',
    magenta: '#a855f7',
    cyan: '#06b6d4',
    white: '#e4e4e7',
    brightBlack: '#52525b',
    brightRed: '#f87171',
    brightGreen: '#4ade80',
    brightYellow: '#facc15',
    brightBlue: '#60a5fa',
    brightMagenta: '#c084fc',
    brightCyan: '#22d3ee',
    brightWhite: '#fafafa',
};

interface ManagedTerminal {
    terminal: Terminal;
    fitAddon: FitAddon;
    hostDiv: HTMLDivElement;
    opened: boolean;
    status: 'running' | 'stopped';
    cleanups: Array<() => void>;
    onStatusChange?: (status: 'running' | 'stopped') => void;
}

const instances = new Map<string, ManagedTerminal>();

export async function create(
    sessionId: string,
    onStatusChange?: (status: 'running' | 'stopped') => void,
): Promise<void> {
    if (instances.has(sessionId)) return;

    const terminal = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: 'Menlo, Monaco, "Courier New", monospace',
        theme: THEME,
        allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    const hostDiv = document.createElement('div');
    hostDiv.style.width = '100%';
    hostDiv.style.height = '100%';

    terminal.onData((data) => {
        invokeCommand('write_to_embedded_session', { sessionId, data }).catch(() => {});
    });

    const managed: ManagedTerminal = {
        terminal, fitAddon, hostDiv,
        opened: false,
        status: 'running',
        cleanups: [],
        onStatusChange,
    };

    const outputUnlisten = await listen<string>(`agent-output-${sessionId}`, (event) => {
        terminal.write(event.payload);
    });
    managed.cleanups.push(outputUnlisten);

    const exitUnlisten = await listen(`agent-exit-${sessionId}`, () => {
        terminal.write('\r\n\x1b[90m--- session ended ---\x1b[0m\r\n');
        managed.status = 'stopped';
        managed.onStatusChange?.('stopped');
    });
    managed.cleanups.push(exitUnlisten);

    instances.set(sessionId, managed);
}

export function attach(sessionId: string, container: HTMLElement): void {
    const m = instances.get(sessionId);
    if (!m) return;

    if (!m.opened) {
        container.appendChild(m.hostDiv);
        m.terminal.open(m.hostDiv);
        m.opened = true;
    } else {
        container.appendChild(m.hostDiv);
    }

    requestAnimationFrame(() => fit(sessionId));
}

export function detach(sessionId: string): void {
    instances.get(sessionId)?.hostDiv.remove();
}

export function fit(sessionId: string): void {
    const m = instances.get(sessionId);
    if (!m?.opened || !m.hostDiv.parentElement) return;
    try {
        m.fitAddon.fit();
        const dims = m.fitAddon.proposeDimensions();
        if (dims) {
            invokeCommand('resize_embedded_session', {
                sessionId, rows: dims.rows, cols: dims.cols,
            }).catch(() => {});
        }
    } catch { /* container may not have dimensions yet */ }
}

export function getStatus(sessionId: string): 'running' | 'stopped' | undefined {
    return instances.get(sessionId)?.status;
}

export function has(sessionId: string): boolean {
    return instances.has(sessionId);
}

export function dispose(sessionId: string): void {
    const m = instances.get(sessionId);
    if (!m) return;
    m.cleanups.forEach(fn => fn());
    m.terminal.dispose();
    m.hostDiv.remove();
    instances.delete(sessionId);
}
