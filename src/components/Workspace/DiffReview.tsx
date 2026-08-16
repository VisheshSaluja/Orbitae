import React, { useMemo, useRef, useState } from 'react';
import {
    ShieldCheck, Check, XCircle, AlertTriangle, RotateCcw, Loader2,
    CheckCircle2, MessageCircleQuestion, FileDiff, ChevronRight, ChevronDown,
    MessageSquarePlus, Trash2, Sparkles,
} from 'lucide-react';
import type { ValidationReport, Finding, RiskLevel, ReviewComment } from '../../lib/orchestrator';
import { AnnotationOverlay } from './AnnotationOverlay';

// ---- unified-diff parsing --------------------------------------------------

type RowKind = 'context' | 'add' | 'del' | 'hunk';

interface DiffRow {
    kind: RowKind;
    text: string;
    newLine: number | null;
}

interface DiffFile {
    path: string;
    rows: DiffRow[];
    adds: number;
    dels: number;
}

/** A human comment pinned to diff content, pending application. */
interface UserComment {
    id: string;
    file: string;
    code: string;
    comment: string;
}

function stripPrefix(p: string): string {
    return p.replace(/^[ab]\//, '');
}

function parseDiff(diff: string): DiffFile[] {
    const files: DiffFile[] = [];
    let cur: DiffFile | null = null;
    let newLine = 0;

    for (const line of diff.split('\n')) {
        if (line.startsWith('diff --git')) {
            const m = line.match(/ b\/(.+)$/);
            cur = { path: m ? m[1] : 'file', rows: [], adds: 0, dels: 0 };
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
        if (
            line.startsWith('index ') || line.startsWith('new file') ||
            line.startsWith('deleted file') || line.startsWith('similarity') ||
            line.startsWith('rename ') || line.startsWith('old mode') ||
            line.startsWith('new mode') || line.startsWith('Binary files')
        ) continue;

        if (line.startsWith('+')) {
            cur.rows.push({ kind: 'add', text: line.slice(1), newLine });
            cur.adds++;
            newLine++;
        } else if (line.startsWith('-')) {
            cur.rows.push({ kind: 'del', text: line.slice(1), newLine: null });
            cur.dels++;
        } else if (line.startsWith(' ')) {
            cur.rows.push({ kind: 'context', text: line.slice(1), newLine });
            newLine++;
        }
    }
    return files;
}

function fileMatches(findingFile: string, diffPath: string): boolean {
    const a = findingFile.replace(/^[ab]\//, '');
    return diffPath === a || diffPath.endsWith(a) || a.endsWith(diffPath);
}

function anchorRow(file: DiffFile, anchor: string | null): number {
    if (!anchor) return -1;
    const needle = anchor.trim();
    if (!needle) return -1;
    return file.rows.findIndex((r) => r.kind !== 'hunk' && r.text.includes(needle));
}

/** First non-blank line of a (possibly multi-line) selection — used to pin a
 *  comment back to a diff row. */
function firstLine(s: string): string {
    return s.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? s.trim();
}

const AUTO_COLLAPSE_ROWS = 40;

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
    onAsk?: (finding: Finding) => void;
    onApplyComments?: (comments: ReviewComment[]) => void;
    applying?: boolean;
}

export const DiffReview: React.FC<DiffReviewProps> = ({ report, onRerun, busy, onAsk, onApplyComments, applying }) => {
    const [hideWarnings, setHideWarnings] = useState(false);
    const [expanded, setExpanded] = useState<Record<number, boolean>>({});
    const [comments, setComments] = useState<UserComment[]>([]);
    const idc = useRef(0);
    const diffRef = useRef<HTMLDivElement>(null);
    const files = useMemo(() => parseDiff(report.diff || ''), [report.diff]);

    const escalations = report.findings.filter((f) => f.action === 'escalate');
    const visible = hideWarnings ? escalations.filter((f) => f.severity === 'error') : escalations;
    const warningCount = escalations.filter((f) => f.severity === 'warning').length;
    const errorCount = escalations.filter((f) => f.severity === 'error').length;

    const idOf = useMemo(() => {
        const m = new Map<Finding, string>();
        visible.forEach((f, i) => m.set(f, `orb-finding-${i}`));
        return m;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visible]);

    // Findings: pin to a file+row, a file header, or a general list.
    const general: Finding[] = [];
    const rowPin = new Map<string, Finding[]>();
    const fileFindings = new Map<number, Finding[]>();
    for (const f of visible) {
        const fi = f.file ? files.findIndex((df) => fileMatches(f.file!, df.path)) : -1;
        if (fi < 0) { general.push(f); continue; }
        const ri = anchorRow(files[fi], f.anchor);
        rowPin.set(`${fi}:${ri}`, [...(rowPin.get(`${fi}:${ri}`) ?? []), f]);
        fileFindings.set(fi, [...(fileFindings.get(fi) ?? []), f]);
    }

    // Pending user comments, matched back to the row they were pinned on.
    const commentsByRow = new Map<string, UserComment[]>();
    const commentsByFile = new Map<number, UserComment[]>();
    for (const c of comments) {
        const fi = files.findIndex((df) => df.path === c.file);
        if (fi < 0) continue;
        const needle = firstLine(c.code);
        const ri = files[fi].rows.findIndex((r) => r.kind !== 'hunk' && r.text.includes(needle));
        commentsByRow.set(`${fi}:${ri}`, [...(commentsByRow.get(`${fi}:${ri}`) ?? []), c]);
        commentsByFile.set(fi, [...(commentsByFile.get(fi) ?? []), c]);
    }
    const removeComment = (id: string) => setComments((cs) => cs.filter((c) => c.id !== id));

    const jump = (f: Finding) => {
        document.getElementById(idOf.get(f) ?? '')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };

    const risk = RISK_STYLES[report.risk_level];
    const clean = escalations.length === 0 && report.checks.every((c) => c.passed);

    return (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
            {onApplyComments && (
                <AnnotationOverlay containerRef={diffRef} scopeAttr="data-annot-file"
                    onSubmit={({ quote, target, comment }) => {
                        const file = target?.getAttribute('data-annot-file') ?? files[0]?.path ?? '';
                        setComments((cs) => [...cs, { id: `c${idc.current++}`, file, code: quote, comment }]);
                    }} />
            )}

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

                {/* Findings summary — surface the important few at the TOP. */}
                {visible.length > 0 && (
                    <div className="rounded-lg border border-border/60 bg-muted/20 p-2.5 space-y-1.5">
                        <div className="text-[11px] font-medium text-muted-foreground">
                            {errorCount > 0 && <span className="text-red-400">{errorCount} error{errorCount > 1 ? 's' : ''}</span>}
                            {errorCount > 0 && warningCount > 0 && !hideWarnings && <span className="text-muted-foreground/50"> · </span>}
                            {!hideWarnings && warningCount > 0 && <span className="text-amber-400">{warningCount} warning{warningCount > 1 ? 's' : ''}</span>}
                            {' to review'}
                        </div>
                        {visible.map((f) => (
                            <button key={idOf.get(f)} onClick={() => jump(f)}
                                className="flex items-start gap-1.5 text-left w-full group">
                                {f.severity === 'error'
                                    ? <XCircle className="w-3 h-3 text-red-400 mt-0.5 shrink-0" />
                                    : <AlertTriangle className="w-3 h-3 text-amber-400 mt-0.5 shrink-0" />}
                                <span className="text-[11px] text-foreground/80 group-hover:text-foreground group-hover:underline flex-1 min-w-0">{f.title}</span>
                                {f.file && <span className="text-[10px] font-mono text-muted-foreground/50 shrink-0 truncate max-w-[40%]">{f.file.split('/').pop()}</span>}
                            </button>
                        ))}
                    </div>
                )}

                {general.length > 0 && (
                    <div className="space-y-1.5">
                        {general.map((f) => <FindingCard key={idOf.get(f)} id={idOf.get(f)} f={f} onAsk={onAsk} />)}
                    </div>
                )}

                {files.length === 0 ? (
                    <div className="text-[11px] text-muted-foreground/50 flex items-center gap-1.5">
                        <FileDiff className="w-3.5 h-3.5" /> No diff to show.
                    </div>
                ) : (
                    <div ref={diffRef} className="space-y-3">
                        {onApplyComments && (
                            <p className="text-[10px] text-muted-foreground/50">Highlight any code below to comment on it.</p>
                        )}
                        {files.map((file, fi) => (
                            <FileBlock key={fi} file={file} fileIndex={fi}
                                rowPin={rowPin} fileFindings={fileFindings.get(fi) ?? []} idOf={idOf}
                                commentsByRow={commentsByRow} fileComments={commentsByFile.get(fi) ?? []} onRemoveComment={removeComment}
                                open={expanded[fi] ?? file.rows.length <= AUTO_COLLAPSE_ROWS}
                                onToggle={() => setExpanded((e) => ({ ...e, [fi]: !(e[fi] ?? file.rows.length <= AUTO_COLLAPSE_ROWS) }))}
                                onAsk={onAsk} />
                        ))}
                    </div>
                )}

                {/* Apply the developer's pinned comments as a batch. */}
                {onApplyComments && comments.length > 0 && (
                    <button onClick={() => { onApplyComments(comments.map(({ file, code, comment }) => ({ file, code, comment }))); setComments([]); }}
                        disabled={applying}
                        className="w-full flex items-center justify-center gap-2 rounded-lg bg-sky-500/90 text-white px-4 py-2.5 text-[12px] font-medium hover:bg-sky-500 transition-colors disabled:opacity-50">
                        {applying
                            ? <><Loader2 className="w-4 h-4 animate-spin" /> Applying comments…</>
                            : <><Sparkles className="w-4 h-4" /> Apply {comments.length} comment{comments.length > 1 ? 's' : ''} & re-review</>}
                    </button>
                )}

                {clean && comments.length === 0 && (
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
    fileFindings: Finding[];
    idOf: Map<Finding, string>;
    commentsByRow: Map<string, UserComment[]>;
    fileComments: UserComment[];
    onRemoveComment: (id: string) => void;
    open: boolean;
    onToggle: () => void;
    onAsk?: (f: Finding) => void;
}> = ({ file, fileIndex, rowPin, fileFindings, idOf, commentsByRow, fileComments, onRemoveComment, open, onToggle, onAsk }) => {
    const headerFindings = rowPin.get(`${fileIndex}:-1`) ?? [];
    const headerComments = commentsByRow.get(`${fileIndex}:-1`) ?? [];
    return (
        <div data-annot-file={file.path} className="rounded-lg border border-border/60 overflow-hidden">
            <button onClick={onToggle}
                className="w-full flex items-center gap-2 px-3 py-1.5 bg-muted/30 border-b border-border/50 hover:bg-muted/40 text-left">
                {open ? <ChevronDown className="w-3 h-3 text-muted-foreground/60 shrink-0" /> : <ChevronRight className="w-3 h-3 text-muted-foreground/60 shrink-0" />}
                <FileDiff className="w-3 h-3 text-muted-foreground/60 shrink-0" />
                <span className="text-[11px] font-mono text-foreground/80 truncate flex-1">{file.path}</span>
                {fileComments.length > 0 && (
                    <span className="text-[10px] text-sky-400 shrink-0">{fileComments.length} comment{fileComments.length > 1 ? 's' : ''}</span>
                )}
                {fileFindings.length > 0 && (
                    <span className="text-[10px] text-muted-foreground/70 shrink-0">{fileFindings.length} finding{fileFindings.length > 1 ? 's' : ''}</span>
                )}
                <span className="text-[10px] font-mono shrink-0"><span className="text-emerald-400/70">+{file.adds}</span> <span className="text-red-400/70">−{file.dels}</span></span>
            </button>

            {(headerFindings.length > 0 || headerComments.length > 0) && (
                <div className="px-2 py-1.5 space-y-1.5 bg-card">
                    {headerFindings.map((f) => <FindingCard key={idOf.get(f)} id={idOf.get(f)} f={f} onAsk={onAsk} />)}
                    {headerComments.map((c) => <UserCommentCard key={c.id} c={c} onRemove={() => onRemoveComment(c.id)} />)}
                </div>
            )}

            {open ? (
                <div className="overflow-x-auto">
                    <table className="w-full border-collapse font-mono text-[11px] leading-relaxed">
                        <tbody>
                            {file.rows.map((row, ri) => {
                                const key = `${fileIndex}:${ri}`;
                                const findings = rowPin.get(key) ?? [];
                                const rowComments = commentsByRow.get(key) ?? [];
                                return (
                                    <React.Fragment key={ri}>
                                        <DiffRowView row={row} />
                                        {(findings.length > 0 || rowComments.length > 0) && (
                                            <tr>
                                                <td colSpan={2} className="p-0">
                                                    <div className="px-2 py-1.5 space-y-1.5 bg-card border-y border-border/40">
                                                        {findings.map((f) => <FindingCard key={idOf.get(f)} id={idOf.get(f)} f={f} onAsk={onAsk} />)}
                                                        {rowComments.map((c) => <UserCommentCard key={c.id} c={c} onRemove={() => onRemoveComment(c.id)} />)}
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
            ) : (
                <>
                    {fileFindings.filter((f) => !headerFindings.includes(f)).length > 0 && (
                        <div className="px-2 py-1.5 space-y-1.5 bg-card">
                            {fileFindings.filter((f) => !headerFindings.includes(f)).map((f) => (
                                <FindingCard key={idOf.get(f)} id={idOf.get(f)} f={f} onAsk={onAsk} />
                            ))}
                        </div>
                    )}
                    <button onClick={onToggle} className="w-full text-[10px] text-muted-foreground/60 hover:text-foreground py-1.5 bg-card">
                        show {file.rows.length} lines
                    </button>
                </>
            )}
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
                {row.text}
            </td>
        </tr>
    );
};

const UserCommentCard: React.FC<{ c: UserComment; onRemove: () => void }> = ({ c, onRemove }) => (
    <div className="rounded-md border border-sky-500/25 bg-sky-500/5 p-2.5 font-sans">
        <div className="flex items-start gap-1.5">
            <MessageSquarePlus className="w-3 h-3 text-sky-400 mt-0.5 shrink-0" />
            <span className="text-[11px] text-foreground/85 flex-1 min-w-0">{c.comment}</span>
            <button onClick={onRemove} className="text-muted-foreground/50 hover:text-red-400 shrink-0"><Trash2 className="w-3 h-3" /></button>
        </div>
    </div>
);

const FindingCard: React.FC<{ f: Finding; id?: string; onAsk?: (f: Finding) => void }> = ({ f, id, onAsk }) => {
    const isError = f.severity === 'error';
    return (
        <div id={id} className={`scroll-mt-4 rounded-md border p-2.5 ${isError ? 'border-red-500/25 bg-red-500/5' : 'border-amber-500/20 bg-amber-500/5'}`}>
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
