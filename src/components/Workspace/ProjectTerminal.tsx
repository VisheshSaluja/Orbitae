import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css'; // Ensure you have this configured or add to global css
import { invokeCommand } from '../../lib/tauri';
import { listen } from '@tauri-apps/api/event';

interface ProjectTerminalProps {
    processId: string;
    onExit?: () => void;
}

export const ProjectTerminal: React.FC<ProjectTerminalProps> = ({ processId, onExit }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const terminalRef = useRef<Terminal | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        if (!containerRef.current) return;

        // Initialize xterm
        const term = new Terminal({
            cursorBlink: true,
            fontSize: 14,
            fontFamily: 'Menlo, Monaco, "Courier New", monospace',
            theme: {
                background: '#09090b', // zinc-950
                foreground: '#f4f4f5', // zinc-100
                selectionBackground: '#3f3f46',
            },
            allowProposedApi: true
        });

        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);

        term.open(containerRef.current);
        
        // Defer fit to ensure container has dimensions and renderer is ready
        requestAnimationFrame(() => {
            try {
                fitAddon.fit();
            } catch {
                // Fit failed — container may not have dimensions yet
            }
        });

        terminalRef.current = term;
        fitAddonRef.current = fitAddon;

        // Fetch initial history
        invokeCommand<string>('get_process_history', { id: processId })
            .then(history => {
                if (history) term.write(history);
            })
            .catch(() => { /* Failed to load process history — non-critical */ });

        // Handle Input
        term.onData((data) => {
            invokeCommand('write_to_process', { id: processId, data }).catch(() => { /* write failed */ });
        });

        // Listen for output
        const unlistenOutput = listen<{ id: string, data: string }>('process_output', (event) => {
            if (event.payload.id === processId) {
                term.write(event.payload.data);
            }
        });

        // Listen for exit
        const unlistenExit = listen<{ id: string }>('process_exit', (event) => {
            if (event.payload.id === processId) {
                term.write('\r\n\x1b[31mProcess exited.\x1b[0m\r\n');
                if (onExit) onExit();
            }
        });

        // Handle Rezising
        const handleResize = () => {
            if (fitAddonRef.current && terminalRef.current) {
                fitAddonRef.current.fit();
                const { cols, rows } = terminalRef.current;
                invokeCommand('resize_process', { id: processId, cols, rows }).catch(() => { /* resize failed */ });
            }
        };

        window.addEventListener('resize', handleResize);
        
        // Initial resize sync
        setTimeout(handleResize, 100);

        setMounted(true);

        return () => {
            unlistenOutput.then(f => f());
            unlistenExit.then(f => f());
            term.dispose();
            window.removeEventListener('resize', handleResize);
        };
    }, [processId]); // Re-init if processId changes? Usually we mount a new component.

    // Effect to update size when container might have changed size (e.g. sidebar toggle)
    useEffect(() => {
        if (!mounted) return;
        const timer = setInterval(() => {
            if (fitAddonRef.current) fitAddonRef.current.fit();
        }, 1000);
        return () => clearInterval(timer);
    }, [mounted]);

    return (
        <div className="h-full w-full bg-zinc-950 p-2 overflow-hidden">
            <div ref={containerRef} className="h-full w-full" />
        </div>
    );
};
