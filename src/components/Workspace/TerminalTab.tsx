import React, { useState, useCallback } from 'react';
import { TerminalPanel } from './TerminalPanel';
import { Plus, X, Columns2, Square } from 'lucide-react';

interface TerminalTabProps {
    projectId: string;
    projectPath: string;
}

interface TerminalInstance {
    id: string;
    label: string;
}

let termCounter = 0;

function createTerminal(): TerminalInstance {
    termCounter += 1;
    return { id: crypto.randomUUID(), label: `Terminal ${termCounter}` };
}

export const TerminalTab: React.FC<TerminalTabProps> = ({ projectId }) => {
    const [terminals, setTerminals] = useState<TerminalInstance[]>(() => {
        termCounter = 0;
        return [createTerminal()];
    });
    const [activeId, setActiveId] = useState(terminals[0].id);
    const [split, setSplit] = useState(false);

    const addTerminal = useCallback(() => {
        if (terminals.length >= 4) return;
        const t = createTerminal();
        setTerminals(prev => [...prev, t]);
        setActiveId(t.id);
    }, [terminals.length]);

    const removeTerminal = useCallback((id: string) => {
        setTerminals(prev => {
            const next = prev.filter(t => t.id !== id);
            if (next.length === 0) {
                termCounter = 0;
                const fresh = createTerminal();
                setActiveId(fresh.id);
                return [fresh];
            }
            if (activeId === id) setActiveId(next[0].id);
            return next;
        });
    }, [activeId]);

    const visible = split ? terminals : terminals.filter(t => t.id === activeId);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
            {/* Tab bar */}
            <div className="shrink-0 flex items-center justify-between border-b border-border/40 bg-muted/5 px-2"
                 style={{ minHeight: 36 }}>
                <div className="flex items-center gap-0.5 overflow-x-auto py-1">
                    {terminals.map(t => (
                        <button
                            key={t.id}
                            onClick={() => setActiveId(t.id)}
                            className={`group flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                                activeId === t.id
                                    ? 'bg-background text-foreground shadow-sm'
                                    : 'text-muted-foreground hover:text-foreground'
                            }`}
                        >
                            {t.label}
                            {terminals.length > 1 && (
                                <X
                                    className="w-3 h-3 opacity-0 group-hover:opacity-100 hover:text-destructive transition-opacity"
                                    onClick={(e) => { e.stopPropagation(); removeTerminal(t.id); }}
                                />
                            )}
                        </button>
                    ))}
                    {terminals.length < 4 && (
                        <button
                            onClick={addTerminal}
                            className="p-1.5 rounded-md text-muted-foreground/50 hover:text-foreground hover:bg-muted/50 transition-colors"
                            title="New terminal (max 4)"
                        >
                            <Plus className="w-3.5 h-3.5" />
                        </button>
                    )}
                </div>
                <button
                    onClick={() => setSplit(s => !s)}
                    className={`p-1.5 rounded-md text-muted-foreground hover:text-foreground transition-colors ${split ? 'bg-muted text-foreground' : ''}`}
                    title={split ? 'Single view' : 'Split view'}
                >
                    {split ? <Square className="w-3.5 h-3.5" /> : <Columns2 className="w-3.5 h-3.5" />}
                </button>
            </div>

            {/* Terminal panes — use inline styles for bulletproof sizing */}
            <div style={{
                flex: 1,
                display: split ? 'grid' : 'flex',
                gridTemplateColumns: split ? `repeat(${Math.min(visible.length, 2)}, 1fr)` : undefined,
                gap: split ? 1 : 0,
                minHeight: 0,
                overflow: 'hidden',
            }}>
                {visible.map(t => (
                    <div key={t.id} style={{ flex: 1, minHeight: 0, minWidth: 0, overflow: 'hidden' }}>
                        <TerminalPanel projectId={projectId} />
                    </div>
                ))}
            </div>
        </div>
    );
};
