import React, { useRef, useEffect } from 'react';
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
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!terminalRef.current) return;
    if (xtermRef.current) return;

    // Helper to get CSS variable value
    const getCssVar = (name: string) => {
        const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        return value ? `hsl(${value})` : undefined;
    };

    // Initialize Xterm
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: '"JetBrains Mono", Menlo, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.2,
      theme: {
        background: getCssVar('--background') || '#09090b', 
        foreground: getCssVar('--foreground') || '#fafafa', 
        cursor: getCssVar('--primary') || '#3b82f6', 
        selectionBackground: 'rgba(59, 130, 246, 0.3)',
      },
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);
    
    // Fit after small delay
    setTimeout(() => {
         fitAddon.fit();
         term.focus();
    }, 50);

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    // Handle Input
    term.onData(async (data) => {
      if (sessionIdRef.current) {
        await invokeCommand('write_to_shell', {
          sessionId: sessionIdRef.current,
          data
        });
      }
    });

    // Resize Observer
    const resizeObserver = new ResizeObserver(() => {
        if (!xtermRef.current) return;
        try {
            fitAddon.fit();
            if (sessionIdRef.current) {
                const { cols, rows } = xtermRef.current;
                invokeCommand('resize_shell', { sessionId: sessionIdRef.current, cols, rows })
                    .catch(() => { /* resize failed — non-critical */ });
            }
        } catch { /* fit failed — non-critical */ }
    });
    resizeObserver.observe(terminalRef.current);

    // Connect to Backend
    const initTerminal = async () => {
        try {
            term.writeln('\x1b[38;5;75m⚡ Orbitae Terminal connecting...\x1b[0m\r\n');
            
            const sessionId = await invokeCommand<string>('spawn_shell', { 
                projectId,
                initialCommand
            });
            sessionIdRef.current = sessionId;
            onSessionReady?.(sessionId);

            const unlisten = await listen<{ session_id: string, data: string }>('terminal_data', (event) => {
                if (event.payload.session_id === sessionId) {
                    term.write(event.payload.data);
                }
            });
            return unlisten;
        } catch (err) {
            term.writeln(`\r\n\x1b[31mConnection failed: ${err}\x1b[0m`);
            return () => {};
        }
    };

    let cleanupListen: (() => void) | undefined;
    initTerminal().then(u => cleanupListen = u);

    return () => {
        resizeObserver.disconnect();
        cleanupListen?.();
        term.dispose();
        xtermRef.current = null;
    };
  }, [projectId]); // logic depends on projectId, initialCommand is generally stable but we can add it

  return (
    <div className="h-full w-full bg-[#18181b] p-1 relative rounded-md border border-zinc-800">
        <div ref={terminalRef} className="absolute inset-2" />
    </div>
  );
};
