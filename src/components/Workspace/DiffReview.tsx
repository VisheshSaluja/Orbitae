import React, { useMemo, useState } from 'react';
import {
    ShieldCheck, Check, XCircle, AlertTriangle, RotateCcw, Loader2,
    CheckCircle2, MessageCircleQuestion, FileDiff,
} from 'lucide-react';
import type { ValidationReport, Finding, RiskLevel } from '../../lib/orchestrator';

// ---- unified-diff parsing --------------------------------------------------

type RowKind = 'context' | 'add' | 'del' | 'hunk';

interface DiffRow {
    kind: RowKind;
    /** Content without the +/-/space prefix (for `hunk`, the @@ header text). */
    text: string;
    /** Line number in the new file (add/context only). */
    newLine: number | null;
}

interface DiffFile {
    path: string;
    rows: DiffRow[];
}

/** Strip a leading `a/` or `b/` git path prefix. */
function stripPrefix(p: string): string {
    return p.replace(/^[ab]\//, '');
}

/** Parse a unified git diff into files → rows. Minimal but handles adds,
 *  deletes, renames, and new/deleted files. Unknown lines are ignored. */
function parseDiff(diff: string): DiffFile[] {
    const files: DiffFile[] = [];
    let cur: DiffFile | null = null;
    let newLine = 0;

    for (const line of diff.split('\n')) {
        if (line.startsWith('diff --git')) {
            // `diff --git a/x b/y` — seed the path from `b/y`, refined by +++.
            const m = line.match(/ b\/(.+)$/);
            cur = { path: m ? m[1] : 'file', rows: [] };
            files.push(cur);
            continue;
        }
        if (!cur) continue;
        if (line.startsWith('+++ ')) {
            const p = line.slice(4).trim();
            if (p !== '/dev/null') cur.path = stripPrefix(p);
            continue;
        }
        if (line.startsWith('--- ')) {
            const p = line.slice(4).trim();
            if (p !== '/dev/null' && cur.path === 'file') cur.path = stripPrefix(p);
            continue;
        }
        if (line.startsWith('@@')) {
            const m = line.match(/\+(\d+)/);
            newLine = m ? parseInt(m[1], 10) : 0;
            cur.rows.push({ kind: 'hunk', text: line, newLine: null });
            continue;
        }
        // Skip the extended header lines between the git line and the hunks.
        if (
            line.startsWith('index ') || line.startsWith('new file') ||
            line.startsWith('deleted file') || line.startsWith('similarity') ||
            line.startsWith('rename ') || line.startsWith('old mode') ||
            line.startsWith('new mode') || line.startsWith('Binary files')
        ) continue;

        if (line.startsWith('+')) {
            cur.rows.push({ kind: 'add', text: line.slice(1), newLine });
            newLine++;
        } else if (line.startsWith('-')) {
            cur.rows.push({ kind: 'del', text: line.slice(1), newLine: null });
        } else if (line.startsWith(' ')) {
            cur.rows.push({ kind: 'context', text: line.slice(1), newLine });
            newLine++;
        } else if (line === '\\ No newline at end of file') {
            // ignore
        }
    }
    return files;
}

/** Does a finding's declared file refer to this diff file? Tolerant of
 *  basename-only or partial paths the reviewer may return. */
function fileMatches(findingFile: string, diffPath: string): boolean {
    const a = findingFile.replace(/^[ab]\//, '');
    return diffPath === a || diffPath.endsWith(a) || a.endsWith(diffPath);
}

/** Row index in a file to pin a finding after: the first row whose text
 *  contains the anchor snippet. -1 → pin at the file header. */
function anchorRow(file: DiffFile, anchor: string | null): number {
    if (!anchor) return -1;
    const needle = anchor.trim();
    if (!needle) return -1;
    return file.rows.findIndex((r) => r.kind !== 'hunk' && r.text.includes(needle));
}

// ---- rendering -------------------------------------------------------------

const RISK_STYLES: Record<RiskLevel, { label: string; cls: string }> = {
    low: { label: 'Low risk — evidence is clean', cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' },
    medium: { label: 'Medium risk — worth a look', cls: 'bg-amber-500/10 text-amber-400 border-amber-500/30' },
    high: { label: 'High risk — review the findings', cls: 'bg-red-500/10 text-red-400 border-red-500/30' },
};

interface DiffReviewProps {
    report: ValidationReport;
    onRerun: () => void;
    busy: boolean;
    /** Ask the agent about a specific finding, in context. */
    onAsk?: (finding: Finding) => void;
}

export const DiffReview: React.FC<DiffReviewProps> = ({ report, onRerun, busy, onAsk }) => {
    const [hideWarnings, setHideWarnings] = useState(false);
    const files = useMemo(() => parseDiff(report.diff || ''), [report.diff]);

    // Only escalations are the user's to judge; auto-fixed are already applied.
    const escalations = report.findings.filter((f) => f.action === 'escalate');
    const visible = hideWarnings ? escalations.filter((f) => f.severity === 'error') : escalations;
    const warningCount = escalations.filter((f) => f.severity === 'warning').length;

    // Partition findings: those we can pin to a file vs. general ones.
    const pinned = new Map<number, Finding[]>(); // fileIndex → findings (with rowIndex baked via order)
    const general: Finding[] = [];
    const rowPin = new Map<string, Finding[]>(); // `${fileIdx}:${rowIdx}` → findings
    for (const f of visible) {
        const fi = f.file ? files.findIndex((df) => fileMatches(f.file!, df.path)) : -1;
        if (fi < 0) { general.push(f); continue; }
        const ri = anchorRow(files[fi], f.anchor);
        const key = `${fi}:${ri}`;
        const list = rowPin.get(key) ?? [];
        list.push(f);
        rowPin.set(key, list);
        pinned.set(fi, [...(pinned.get(fi) ?? []), f]);
    }

    const risk = RISK_STYLES[report.risk_level];

    return (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
            {/* Evidence header — the primary trust signal, first. */}
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/50">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-[12px] font-semibold text-foreground">Review</span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${risk.cls}`}
                    title={report.risk_reasons.join(' · ')}>
                    {risk.label}
                </span>
                <div className="flex-1" />
                {warningCount > 0 && (
                    <button onClick={() => setHideWarnings((v) => !v)}
                        className="text-[10px] text-muted-foreground/60 hover:text-foreground px-1.5 py-0.5 rounded">
                        {hideWarnings ? `show ${warningCount} warning${warningCount > 1 ? 's' : ''}` : 'errors only'}
                    </button>
                )}
                <button onClick={onRerun} disabled={busy}
                    className="p-1 rounded text-muted-foreground/40 hover:text-foreground hover:bg-foreground/6 disabled:opacity-40"
                    title="Re-run review">
                    {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                </button>
            </div>

            <div className="px-4 py-3 space-y-3">
                {/* Deterministic checks — the evidence it works. */}
                <div className="space-y-1">
                    {report.checks.map((c) => (
                        <div key={c.name} className="flex items-start gap-2 text-[12px]">
                            {c.passed
                                ? <Check className="w-3.5 h-3.5 text-emerald-400 mt-0.5 shrink-0" />
                                : <XCircle className="w-3.5 h-3.5 text-red-400 mt-0.5 shrink-0" />}
                            <span className="font-medium text-foreground/90 w-20 shrink-0">{c.name}</span>
                            <span className={c.passed ? 'text-emerald-400/70' : 'text-red-400/80 font-mono text-[11px] whitespace-pre-wrap break-words'}>
                                {c.passed ? 'passed' : (c.output || 'failed')}
                            </span>
                        </div>
                    ))}
                    {report.checks.length === 0 && (
                        <span className="text-[11px] text-muted-foreground/50">No deterministic checks for this project — review rests on the findings below.</span>
                    )}
                </div>

                {report.auto_fixed.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                        <span className="font-medium text-emerald-400/80">{report.auto_fixed.length} auto-fixed:</span>
                        {report.auto_fixed.map((t, i) => (
                            <span key={i} className="inline-flex items-center gap-1"><Check className="w-3 h-3 text-emerald-400" />{t}</span>
                        ))}
                    </div>
                )}

                {/* General findings not tied to a specific line. */}
                {general.length > 0 && (
                    <div className="space-y-1.5">
                        {general.map((f, i) => <FindingCard key={i} f={f} onAsk={onAsk} />)}
                    </div>
                )}

                {/* The diff, with findings pinned inline. */}
                {files.length === 0 ? (
                    <div className="text-[11px] text-muted-foreground/50 flex items-center gap-1.5">
                        <FileDiff className="w-3.5 h-3.5" /> No diff to show.
                    </div>
                ) : (
                    <div className="space-y-3">
                        {files.map((file, fi) => (
                            <FileBlock key={fi} file={file} fileIndex={fi} rowPin={rowPin} onAsk={onAsk} />
                        ))}
                    </div>
                )}

                {escalations.length === 0 && report.checks.every((c) => c.passed) && (
                    <div className="text-[12px] text-emerald-400 flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Nothing flagged — clean.
                    </div>
                )}
            </div>
        </div>
    );
};

const FileBlock: React.FC<{
    file: DiffFile;
    fileIndex: number;
    rowPin: Map<string, Finding[]>;
    onAsk?: (f: Finding) => void;
}> = ({ file, fileIndex, rowPin, onAsk }) => {
    const headerFindings = rowPin.get(`${fileIndex}:-1`) ?? [];
    return (
        <div className="rounded-lg border border-border/60 overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/30 border-b border-border/50">
                <FileDiff className="w-3 h-3 text-muted-foreground/60 shrink-0" />
                <span className="text-[11px] font-mono text-foreground/80 truncate">{file.path}</span>
            </div>
            {headerFindings.length > 0 && (
                <div className="px-2 py-1.5 space-y-1.5 bg-card">
                    {headerFindings.map((f, i) => <FindingCard key={i} f={f} onAsk={onAsk} />)}
                </div>
            )}
            <div className="overflow-x-auto">
                <table className="w-full border-collapse font-mono text-[11px] leading-relaxed">
                    <tbody>
                        {file.rows.map((row, ri) => {
                            const findings = rowPin.get(`${fileIndex}:${ri}`) ?? [];
                            return (
                                <React.Fragment key={ri}>
                                    <DiffRowView row={row} />
                                    {findings.length > 0 && (
                                        <tr>
                                            <td colSpan={2} className="p-0">
                                                <div className="px-2 py-1.5 space-y-1.5 bg-card border-y border-border/40">
                                                    {findings.map((f, i) => <FindingCard key={i} f={f} onAsk={onAsk} />)}
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                </React.Fragment>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

const ROW_STYLES: Record<RowKind, string> = {
    add: 'bg-emerald-500/10 text-emerald-300',
    del: 'bg-red-500/10 text-red-300/90',
    context: 'text-foreground/60',
    hunk: 'bg-sky-500/5 text-sky-400/70 select-none',
};

const DiffRowView: React.FC<{ row: DiffRow }> = ({ row }) => {
    const prefix = row.kind === 'add' ? '+' : row.kind === 'del' ? '-' : row.kind === 'hunk' ? '' : ' ';
    return (
        <tr className={ROW_STYLES[row.kind]}>
            <td className="w-10 text-right pr-2 select-none text-muted-foreground/30 align-top tabular-nums">
                {row.newLine ?? ''}
            </td>
            <td className="pr-3 whitespace-pre-wrap break-all align-top">
                <span className="select-none text-muted-foreground/40">{prefix}</span>
                {row.kind === 'hunk' ? row.text : row.text}
            </td>
        </tr>
    );
};

const FindingCard: React.FC<{ f: Finding; onAsk?: (f: Finding) => void }> = ({ f, onAsk }) => {
    const isError = f.severity === 'error';
    return (
        <div className={`rounded-md border p-2.5 ${isError ? 'border-red-500/25 bg-red-500/5' : 'border-amber-500/20 bg-amber-500/5'}`}>
            <div className="flex items-center gap-1.5 text-[12px] font-medium text-foreground">
                {isError
                    ? <XCircle className="w-3 h-3 text-red-400 shrink-0" />
                    : <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />}
                <span className="flex-1 min-w-0">{f.title}</span>
                <span className={`text-[9px] px-1 py-0.5 rounded uppercase font-semibold shrink-0 ${isError ? 'bg-red-500/15 text-red-400' : 'bg-amber-500/15 text-amber-400'}`}>{f.severity}</span>
            </div>
            <div className="text-[11px] text-muted-foreground mt-1 font-sans leading-relaxed">{f.detail}</div>
            {onAsk && (
                <button onClick={() => onAsk(f)}
                    className="mt-1.5 inline-flex items-center gap-1 text-[10px] text-muted-foreground/70 hover:text-foreground">
                    <MessageCircleQuestion className="w-3 h-3" /> Ask about this
                </button>
            )}
        </div>
    );
};
