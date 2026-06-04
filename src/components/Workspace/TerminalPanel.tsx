import React, { useRef, useEffect, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { listen } from '@tauri-apps/api/event';
import { invokeCommand } from '../../lib/tauri';
import '@xterm/xterm/css/xterm.css';

interface TerminalPanelProps {
    projectId: string;
    initialCommand?: string;
    onSessionReady?: (sessionId: string) => void;
}

export const TerminalPanel: React.FC<TerminalPanelProps> = ({ projectId, initialCommand, onSessionReady }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const termRef = useRef<Terminal | null>(null);
    const fitRef = useRef<FitAddon | null>(null);
    const sessionRef = useRef<string | null>(null);
    const initedRef = useRef(false);

    const doFit = useCallback(() => {
        const fit = fitRef.current;
        const term = termRef.current;
        if (!fit || !term) return;
        try {
            fit.fit();
            if (sessionRef.current) {
                invokeCommand('resize_shell', {
                    sessionId: sessionRef.current,
                    cols: term.cols,
                    rows: term.rows,
                }).catch(() => {});
            }
        } catch {
            // fit can throw if container not visible
        }
    }, []);

    useEffect(() => {
        const el = containerRef.current;
        if (!el || initedRef.current) return;

        // Wait until the container has real dimensions before initializing xterm
        const rect = el.getBoundingClientRect();
        if (rect.width < 50 || rect.height < 50) {
            const observer = new ResizeObserver((entries) => {
                const entry = entries[0];
                if (entry && entry.contentRect.width >= 50 && entry.contentRect.height >= 50) {
                    observer.disconnect();
                    initTerminal(el);
                }
            });
            observer.observe(el);
            return () => observer.disconnect();
        }

        return initTerminal(el);
    }, [projectId]);

    function initTerminal(el: HTMLDivElement) {
        if (initedRef.current) return;
        initedRef.current = true;

        const isDark = document.documentElement.classList.contains('dark');

        const term = new Terminal({
            cursorBlink: true,
            cursorStyle: 'bar',
            fontFamily: '"SF Mono", "JetBrains Mono", "Fira Code", Menlo, Consolas, monospace',
            fontSize: 13,
            lineHeight: 1.3,
            scrollback: 5000,
            theme: {
                background: isDark ? '#12141a' : '#fafafa',
                foreground: isDark ? '#d4d4d8' : '#18181b',
                cursor: isDark ? '#60a5fa' : '#2563eb',
                selectionBackground: isDark ? 'rgba(96, 165, 250, 0.3)' : 'rgba(37, 99, 235, 0.2)',
                black: isDark ? '#27272a' : '#e4e4e7',
                red: '#ef4444',
                green: '#22c55e',
                yellow: '#eab308',
                blue: '#3b82f6',
                magenta: '#a855f7',
                cyan: '#06b6d4',
                white: isDark ? '#e4e4e7' : '#27272a',
                brightBlack: isDark ? '#52525b' : '#a1a1aa',
                brightRed: '#f87171',
                brightGreen: '#4ade80',
                brightYellow: '#facc15',
                brightBlue: '#60a5fa',
                brightMagenta: '#c084fc',
                brightCyan: '#22d3ee',
                brightWhite: isDark ? '#fafafa' : '#09090b',
            },
            allowProposedApi: true,
        });

        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);

        term.open(el);
        termRef.current = term;
        fitRef.current = fitAddon;

        // Fit after a short delay to let the DOM settle
        requestAnimationFrame(() => {
            fitAddon.fit();
            term.focus();
        });

        // Handle keyboard input → write to backend shell
        const dataDisposable = term.onData((data) => {
            if (sessionRef.current) {
                invokeCommand('write_to_shell', {
                    sessionId: sessionRef.current,
                    data,
                }).catch(() => {});
            }
        });

        // Resize observer for responsive sizing
        const resizeObserver = new ResizeObserver(() => {
            requestAnimationFrame(() => doFit());
        });
        resizeObserver.observe(el);

        // Connect to backend shell
        let unlistenFn: (() => void) | undefined;

        const connect = async () => {
            try {
                const sessionId = await invokeCommand<string>('spawn_shell', {
                    projectId,
                    initialCommand,
                });
                sessionRef.current = sessionId;
                onSessionReady?.(sessionId);

                // Fit again now that the shell is connected
                doFit();

                unlistenFn = await listen<{ session_id: string; data: string }>(
                    'terminal_data',
                    (event) => {
                        if (event.payload.session_id === sessionId) {
                            term.write(event.payload.data);
                        }
                    },
                );
            } catch (err) {
                term.writeln(`\r\n\x1b[31mFailed to connect: ${err}\x1b[0m`);
            }
        };

        connect();

        return () => {
            resizeObserver.disconnect();
            dataDisposable.dispose();
            unlistenFn?.();
            term.dispose();
            termRef.current = null;
            fitRef.current = null;
            initedRef.current = false;
        };
    }

    return (
        <div
            ref={containerRef}
            className="w-full h-full overflow-hidden"
            style={{ padding: 4 }}
        />
    );
};
