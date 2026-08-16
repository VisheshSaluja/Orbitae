import React, { useEffect, useRef, useState } from 'react';
import { MessageSquarePlus, Send } from 'lucide-react';

/** A live text selection resolved to a commentable target. */
interface Pending {
    quote: string;
    target: HTMLElement | null;
    top: number;
    left: number;
}

interface AnnotationOverlayProps {
    /** The scroll container whose text is annotatable. */
    containerRef: React.RefObject<HTMLElement | null>;
    /** Only offer to comment when the selection sits inside an element carrying
     *  this data attribute (e.g. `data-annot-step`). Scopes the overlay and lets
     *  two overlays (plan + diff) coexist without fighting over one selection. */
    scopeAttr: string;
    /** Called when the developer submits a comment on a highlighted phrase. */
    onSubmit: (a: { quote: string; target: HTMLElement | null; comment: string }) => void;
}

/**
 * Google-Docs-style annotation: highlight any text inside the container and a
 * floating "Comment" bubble appears at the selection; clicking it opens a
 * composer pinned there. No editing of the underlying markdown — you comment on
 * the rendered document, exactly where you're looking.
 */
export const AnnotationOverlay: React.FC<AnnotationOverlayProps> = ({ containerRef, scopeAttr, onSubmit }) => {
    const [pending, setPending] = useState<Pending | null>(null);
    const [composing, setComposing] = useState<Pending | null>(null);
    const [text, setText] = useState('');
    const composerRef = useRef<HTMLDivElement>(null);

    // Track the live selection and, when it lands inside a scoped element, show
    // the floating bubble at the selection's rectangle.
    useEffect(() => {
        const onSel = () => {
            if (composing) return; // don't fight the open composer
            const sel = window.getSelection();
            if (!sel || sel.isCollapsed || !sel.rangeCount) { setPending(null); return; }
            const quote = sel.toString().trim();
            if (!quote) { setPending(null); return; }

            const anchor = sel.anchorNode;
            const container = containerRef.current;
            if (!anchor || !container || !container.contains(anchor)) { setPending(null); return; }

            const start = anchor.nodeType === Node.ELEMENT_NODE
                ? (anchor as HTMLElement)
                : anchor.parentElement;
            const scoped = start?.closest(`[${scopeAttr}]`) as HTMLElement | null;
            if (!scoped) { setPending(null); return; }

            const rect = sel.getRangeAt(0).getBoundingClientRect();
            setPending({ quote, target: scoped, top: rect.top, left: rect.left + rect.width / 2 });
        };
        document.addEventListener('selectionchange', onSel);
        return () => document.removeEventListener('selectionchange', onSel);
    }, [containerRef, scopeAttr, composing]);

    // A fixed-positioned bubble goes stale on scroll — hide it.
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const hide = () => setPending(null);
        el.addEventListener('scroll', hide, { passive: true });
        return () => el.removeEventListener('scroll', hide);
    }, [containerRef]);

    const openComposer = () => {
        if (!pending) return;
        setComposing(pending); // quote already captured — safe if selection clears
        setText('');
        setPending(null);
        window.getSelection()?.removeAllRanges();
    };

    const submit = () => {
        if (!composing || !text.trim()) return;
        onSubmit({ quote: composing.quote, target: composing.target, comment: text.trim() });
        setComposing(null);
        setText('');
    };

    return (
        <>
            {pending && (
                <button
                    // mousedown+preventDefault keeps the selection from clearing.
                    onMouseDown={(e) => { e.preventDefault(); openComposer(); }}
                    style={{ position: 'fixed', top: pending.top - 34, left: pending.left, transform: 'translateX(-50%)', zIndex: 60 }}
                    className="flex items-center gap-1 px-2 py-1 rounded-md bg-sky-500 text-white text-[11px] font-medium shadow-lg hover:bg-sky-400">
                    <MessageSquarePlus className="w-3 h-3" /> Comment
                </button>
            )}
            {composing && (
                <div ref={composerRef}
                    style={{
                        position: 'fixed',
                        top: Math.min(composing.top + 10, window.innerHeight - 170),
                        left: Math.min(Math.max(composing.left, 160), window.innerWidth - 160),
                        transform: 'translateX(-50%)', zIndex: 60, width: 300,
                    }}
                    className="rounded-lg border border-sky-500/40 bg-card shadow-xl p-2.5 space-y-1.5">
                    <div className="text-[10px] text-muted-foreground/70 border-l-2 border-sky-500/40 pl-2 italic line-clamp-2">“{composing.quote}”</div>
                    <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} rows={3}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
                            if (e.key === 'Escape') { setComposing(null); setText(''); }
                        }}
                        placeholder="What should change here?"
                        className="w-full bg-background/60 rounded px-2 py-1.5 text-[12px] outline-none border border-border focus:border-sky-500/40 resize-y" />
                    <div className="flex gap-2">
                        <button onClick={submit} disabled={!text.trim()}
                            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-sky-500 text-white hover:bg-sky-500/90 disabled:opacity-40">
                            <Send className="w-3 h-3" /> Comment
                        </button>
                        <button onClick={() => { setComposing(null); setText(''); }}
                            className="px-2 py-1 rounded text-[11px] text-muted-foreground hover:text-foreground">Cancel</button>
                    </div>
                </div>
            )}
        </>
    );
};
