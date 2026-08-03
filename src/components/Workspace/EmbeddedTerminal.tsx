import React, { useEffect, useRef, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { listen } from '@tauri-apps/api/event';
import { invokeCommand } from '../../lib/tauri';
import '@xterm/xterm/css/xterm.css';

interface EmbeddedTerminalProps {
    sessionId: string;
    onExit?: () => void;
}

export const EmbeddedTerminal: React.FC<EmbeddedTerminalProps> = ({ sessionId, onExit }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const terminalRef = useRef<Terminal | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);

    const sendInput = useCallback(async (data: string) => {
        try {
            await invokeCommand('write_to_embedded_session', { sessionId, data });
        } catch {
            // session may have ended
        }
    }, [sessionId]);

    useEffect(() => {
        if (!containerRef.current) return;

        const term = new Terminal({
            cursorBlink: true,
            fontSize: 13,
            fontFamily: 'Menlo, Monaco, "Courier New", monospace',
            theme: {
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
            },
            allowProposedApi: true,
        });

        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        term.open(containerRef.current);
        fitAddon.fit();

        terminalRef.current = term;
        fitAddonRef.current = fitAddon;

        term.onData((data) => {
            sendInput(data);
        });

        const resizeObserver = new ResizeObserver(() => {
            try {
                fitAddon.fit();
                const dims = fitAddon.proposeDimensions();
                if (dims) {
                    invokeCommand('resize_embedded_session', {
                        sessionId,
                        rows: dims.rows,
                        cols: dims.cols,
                    }).catch(() => {});
                }
            } catch {
                // ignore fit errors during unmount
            }
        });
        resizeObserver.observe(containerRef.current);

        const unlistenOutput = listen<string>(`agent-output-${sessionId}`, (event) => {
            term.write(event.payload);
        });

        const unlistenExit = listen(`agent-exit-${sessionId}`, () => {
            term.write('\r\n\x1b[90m--- session ended ---\x1b[0m\r\n');
            onExit?.();
        });

        return () => {
            resizeObserver.disconnect();
            unlistenOutput.then(fn => fn());
            unlistenExit.then(fn => fn());
            term.dispose();
            terminalRef.current = null;
            fitAddonRef.current = null;
        };
    }, [sessionId, sendInput, onExit]);

    return (
        <div
            ref={containerRef}
            className="w-full h-full"
            style={{ minHeight: 200 }}
        />
    );
};
