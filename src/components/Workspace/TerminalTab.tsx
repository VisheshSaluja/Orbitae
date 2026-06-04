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

export const TerminalTab: React.FC<TerminalTabProps> = ({ projectId }) => {
    const [terminals, setTerminals] = useState<TerminalInstance[]>([
        { id: crypto.randomUUID(), label: 'Terminal 1' },
    ]);
    const [activeTerminalId, setActiveTerminalId] = useState(terminals[0].id);
    const [splitMode, setSplitMode] = useState<'single' | 'split'>('single');

    const addTerminal = useCallback(() => {
        if (terminals.length >= 4) return;
        const newTerm: TerminalInstance = {
            id: crypto.randomUUID(),
            label: `Terminal ${terminals.length + 1}`,
        };
        setTerminals(prev => [...prev, newTerm]);
        setActiveTerminalId(newTerm.id);
    }, [terminals.length]);

    const removeTerminal = useCallback((id: string) => {
        setTerminals(prev => {
            const next = prev.filter(t => t.id !== id);
            if (next.length === 0) {
                const fresh = { id: crypto.randomUUID(), label: 'Terminal 1' };
                setActiveTerminalId(fresh.id);
                return [fresh];
            }
            if (activeTerminalId === id) {
                setActiveTerminalId(next[0].id);
            }
            return next;
        });
    }, [activeTerminalId]);

    const visibleTerminals = splitMode === 'split' ? terminals : terminals.filter(t => t.id === activeTerminalId);

    return (
        <div className="h-full flex flex-col bg-background">
            {/* Terminal tab bar */}
            <div className="shrink-0 flex items-center justify-between border-b border-border/40 bg-muted/5 px-2">
                <div className="flex items-center gap-0.5 overflow-x-auto py-1">
                    {terminals.map(term => (
                        <button
                            key={term.id}
                            onClick={() => setActiveTerminalId(term.id)}
                            className={`group flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                                activeTerminalId === term.id
                                    ? 'bg-background text-foreground shadow-sm'
                                    : 'text-muted-foreground hover:text-foreground'
                            }`}
                        >
                            {term.label}
                            {terminals.length > 1 && (
                                <X
                                    className="w-3 h-3 opacity-0 group-hover:opacity-100 hover:text-destructive transition-opacity"
                                    onClick={(e) => { e.stopPropagation(); removeTerminal(term.id); }}
                                />
                            )}
                        </button>
                    ))}
                    {terminals.length < 4 && (
                        <button
                            onClick={addTerminal}
                            className="p-1.5 rounded-md text-muted-foreground/50 hover:text-foreground hover:bg-muted/50 transition-colors"
                            title="New terminal"
                        >
                            <Plus className="w-3.5 h-3.5" />
                        </button>
                    )}
                </div>
                <div className="flex items-center gap-1 pr-1">
                    <button
                        onClick={() => setSplitMode(splitMode === 'single' ? 'split' : 'single')}
                        className={`p-1.5 rounded-md text-muted-foreground hover:text-foreground transition-colors ${splitMode === 'split' ? 'bg-muted text-foreground' : ''}`}
                        title={splitMode === 'single' ? 'Split view' : 'Single view'}
                    >
                        {splitMode === 'single' ? <Columns2 className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
                    </button>
                </div>
            </div>

            {/* Terminal panes */}
            <div className={`flex-1 min-h-0 ${splitMode === 'split' ? 'grid grid-cols-2 gap-px bg-border/40' : 'flex'}`}>
                {visibleTerminals.map(term => (
                    <div key={term.id} className="min-h-0 min-w-0 bg-background">
                        <TerminalPanel projectId={projectId} />
                    </div>
                ))}
            </div>
        </div>
    );
};
