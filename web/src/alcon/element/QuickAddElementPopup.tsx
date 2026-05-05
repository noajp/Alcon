'use client';

import { useEffect, useRef, useState } from 'react';
import { X, ArrowUp, Sparkles } from 'lucide-react';
import { AtomIcon } from '@/alcon/shared/AtomIcon';

interface QuickAddElementPopupProps {
  open: boolean;
  /** Context label shown next to the title — e.g. an Object name. */
  contextLabel?: string;
  /** Hint shown under the textarea. Default: paste-multiple hint. */
  hint?: string;
  onClose: () => void;
  /** Receives an array of titles. One per non-empty line; multi-paste
   *  yields N titles → caller creates N Elements. */
  onSubmit: (titles: string[]) => void | Promise<void>;
}

/**
 * Floating bottom-center popup for quickly adding one or many Elements.
 *
 * Design (Linear-inspired): rounded card lifted on a shadow at the bottom
 * of the viewport, no dimmer behind. Single textarea accepts multi-line
 * paste — each non-empty line becomes its own Element on submit. Enter
 * submits, Shift+Enter inserts a newline, Esc closes.
 */
export function QuickAddElementPopup({
  open,
  contextLabel,
  hint = 'Tip: paste multiple lines to create several Elements at once',
  onClose,
  onSubmit,
}: QuickAddElementPopupProps) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  // Focus and reset on open. Close on Esc.
  useEffect(() => {
    if (!open) return;
    setText('');
    const t = setTimeout(() => taRef.current?.focus(), 10);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { clearTimeout(t); window.removeEventListener('keydown', onKey); };
  }, [open, onClose]);

  // Auto-grow the textarea up to a max height.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 240)}px`;
  }, [text]);

  if (!open) return null;

  const titles = text.split('\n').map(s => s.trim()).filter(Boolean);
  const canSubmit = titles.length > 0 && !busy;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    try {
      await onSubmit(titles);
      setText('');
      onClose();
    } catch (e) {
      console.error('QuickAdd submit failed:', e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-x-0 bottom-6 z-50 flex justify-center px-4 pointer-events-none">
      <div
        className="pointer-events-auto w-full max-w-[640px] rounded-2xl bg-popover/95 backdrop-blur-md shadow-2xl ring-1 ring-border/40 p-3"
        role="dialog"
        aria-label="Quick add Element"
      >
        {/* Header — context chip + close */}
        <div className="flex items-center gap-2 px-1 mb-2">
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-muted/40 text-[12px] text-muted-foreground">
            <AtomIcon size={12} />
            <span className="truncate max-w-[200px]">{contextLabel ?? 'New Element'}</span>
          </span>
          {titles.length > 1 && (
            <span className="text-[11px] text-muted-foreground">
              {titles.length} Elements
            </span>
          )}
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        {/* Textarea — multi-line paste creates multiple Elements */}
        <textarea
          ref={taRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              handleSubmit();
            }
          }}
          placeholder="Element title… (Enter to create, Shift+Enter for newline)"
          rows={1}
          className="w-full bg-transparent px-2 py-1.5 text-[15px] text-foreground placeholder:text-muted-foreground/60 resize-none"
        />

        {/* Footer — hint + submit */}
        <div className="flex items-center justify-between gap-2 px-1 pt-2">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/80 min-w-0 truncate">
            <Sparkles size={11} />
            <span className="truncate">{hint}</span>
          </div>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium bg-foreground text-background hover:bg-foreground/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <ArrowUp size={13} />
            {titles.length > 1 ? `Create ${titles.length}` : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
