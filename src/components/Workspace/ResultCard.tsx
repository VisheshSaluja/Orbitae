import React, { useState } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import type { ExecutionResult, ChangedFile } from '../../lib/orchestrator';

/**
 * The structured DONE state: outcome + one-line headline + the changed-files
 * delta + objective stats. Scannable in ~5 seconds, assembled from data — never
 * the agent's narration. (Research 2026-08-16: the strongest agentic tools all
 * converge on a structured summary anchored to the diff, not a prose dump.)
 */

const STATUS: Record<string, { cls: string }> = {
    A: { cls: 'text-emerald-400' },
    M: { cls: 'text-amber-400' },
    D: { cls: 'text-red-400' },
    R: { cls: 'text-violet-400' },
};

function fmtDuration(ms: number): string {
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m ${s % 60}s`;
}

const FILE_CAP = 8;

export const ResultCard: React.FC<{ result: ExecutionResult }> = ({ result }) => {
    const [showAll, setShowAll] = useState(false);
    const done = result.outcome === 'done';
    const files = showAll ? result.changed_files : result.changed_files.slice(0, FILE_CAP);
    const hidden = result.changed_files.length - files.length;
    const totalAdds = result.changed_files.reduce((a, f) => a + f.adds, 0);
    const totalDels = result.changed_files.reduce((a, f) => a + f.dels, 0);

    return (
        <div className={`rounded-xl border overflow-hidden ${done ? 'border-emerald-500/30 bg-emerald-500/[0.04]' : 'border-red-500/30 bg-red-500/[0.04]'}`}>
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/40">
                {done
                    ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    : <XCircle className="w-4 h-4 text-red-400 shrink-0" />}
                <span className="text-[13px] font-semibold text-foreground flex-1 min-w-0 truncate" title={result.headline}>{result.headline}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${done ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>
                    {done ? 'Done' : `Failed · step ${result.stats.failed_step ?? '?'}`}
                </span>
            </div>
            <div className="px-4 py-3 space-y-2">
                {result.changed_files.length > 0 ? (
                    <div className="space-y-0.5">
                        {files.map((f) => <ChangedFileRow key={f.path} f={f} />)}
                        {hidden > 0 && (
                            <button onClick={() => setShowAll(true)}
                                className="text-[11px] text-muted-foreground/60 hover:text-foreground pl-5">
                                +{hidden} more file{hidden > 1 ? 's' : ''}
                            </button>
                        )}
                    </div>
                ) : (
                    <p className="text-[11px] text-muted-foreground/60">No file changes detected.</p>
                )}
                <div className="flex items-center gap-3 text-[11px] text-muted-foreground/70 pt-2 border-t border-border/30">
                    <span>{result.stats.steps} step{result.stats.steps !== 1 ? 's' : ''}</span>
                    {result.changed_files.length > 0 && (
                        <span><span className="text-emerald-400/70">+{totalAdds}</span> <span className="text-red-400/70">−{totalDels}</span></span>
                    )}
                    <span>{fmtDuration(result.stats.duration_ms)}</span>
                    {result.stats.cost_usd > 0 && <span>${result.stats.cost_usd.toFixed(4)}</span>}
                </div>
            </div>
        </div>
    );
};

const ChangedFileRow: React.FC<{ f: ChangedFile }> = ({ f }) => {
    const st = STATUS[f.status] ?? STATUS.M;
    return (
        <div className="flex items-center gap-2 text-[12px] font-mono">
            <span className={`w-3 text-center font-semibold shrink-0 ${st.cls}`}>{f.status}</span>
            <span className="text-foreground/85 flex-1 min-w-0 truncate" title={f.path}>{f.path}</span>
            {(f.adds > 0 || f.dels > 0) && (
                <span className="text-[10px] shrink-0"><span className="text-emerald-400/70">+{f.adds}</span> <span className="text-red-400/70">−{f.dels}</span></span>
            )}
        </div>
    );
};
