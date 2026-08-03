import React, { useRef, useEffect } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import * as tm from '../../lib/terminalManager';

interface GridSession {
    id: string;
    display_name: string;
    agent_type: string;
    status: string;
}

interface TerminalGridProps {
    sessionIds: string[];
    sessions: GridSession[];
    focusedId: string | null;
    onFocus: (id: string) => void;
    onUnfocus: () => void;
}

function getGridCols(count: number): number {
    if (count <= 1) return 1;
    if (count <= 2) return 2;
    if (count <= 4) return 2;
    return 3;
}

export const TerminalGrid: React.FC<TerminalGridProps> = ({
    sessionIds, sessions, focusedId, onFocus, onUnfocus,
}) => {
    const visibleIds = focusedId ? [focusedId] : sessionIds;
    const cols = focusedId ? 1 : getGridCols(sessionIds.length);

    return (
        <div
            className="flex-1 min-h-0 grid gap-1 p-1"
            style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
        >
            {visibleIds.map(id => {
                const session = sessions.find(s => s.id === id);
                return (
                    <TerminalCell
                        key={id}
                        sessionId={id}
                        displayName={session?.display_name ?? 'Agent'}
                        status={session?.status ?? 'running'}
                        isFocused={focusedId === id}
                        onFocus={() => onFocus(id)}
                        onUnfocus={onUnfocus}
                    />
                );
            })}
        </div>
    );
};

interface TerminalCellProps {
    sessionId: string;
    displayName: string;
    status: string;
    isFocused: boolean;
    onFocus: () => void;
    onUnfocus: () => void;
}

const TerminalCell: React.FC<TerminalCellProps> = ({
    sessionId, displayName, status, isFocused, onFocus, onUnfocus,
}) => {
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!containerRef.current) return;
        tm.attach(sessionId, containerRef.current);

        const observer = new ResizeObserver(() => {
            requestAnimationFrame(() => tm.fit(sessionId));
        });
        observer.observe(containerRef.current);

        return () => {
            observer.disconnect();
            tm.detach(sessionId);
        };
    }, [sessionId]);

    const borderColor = status === 'running'
        ? 'border-emerald-500/40'
        : 'border-zinc-600/30';

    return (
        <div className={`flex flex-col rounded-lg border ${borderColor} overflow-hidden bg-[#0a0a0a] min-h-0`}>
            <div className="flex items-center justify-between px-2 py-1 bg-zinc-900/80 border-b border-zinc-800 shrink-0">
                <div className="flex items-center gap-1.5 min-w-0">
                    {status === 'running' && (
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                    )}
                    {status === 'stopped' && (
                        <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 shrink-0" />
                    )}
                    <span className="text-[10px] text-zinc-400 truncate">{displayName}</span>
                </div>
                <button
                    onClick={isFocused ? onUnfocus : onFocus}
                    className="p-0.5 rounded text-zinc-500 hover:text-zinc-300 transition-colors shrink-0"
                    title={isFocused ? 'Back to grid' : 'Focus'}
                >
                    {isFocused ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
                </button>
            </div>
            <div ref={containerRef} className="flex-1 min-h-0" />
        </div>
    );
};
