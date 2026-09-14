'use client';

import { useState } from 'react';
import { Trash2, CheckCircle2, Circle, X } from 'lucide-react';

interface SubelementBulkBarProps {
  count: number;
  onMarkDone: () => void | Promise<void>;
  onMarkTodo: () => void | Promise<void>;
  onDelete: () => void | Promise<void>;
  onClear: () => void;
}

/**
 * Floating bulk-action bar for multi-selected sub-elements — same chrome as
 * the Elements list's BulkActionBar, but with the actions a sub-element
 * actually has (complete / un-complete / delete). Renders fixed at the
 * bottom-center of the viewport whenever count > 0.
 */
export function SubelementBulkBar({
  count,
  onMarkDone,
  onMarkTodo,
  onDelete,
  onClear,
}: SubelementBulkBarProps) {
  const [busy, setBusy] = useState(false);

  const wrap = (fn: () => void | Promise<void>) => async () => {
    if (busy) return;
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  };

  if (count === 0) return null;

  return (
    <div className="fixed inset-x-0 bottom-6 z-40 flex justify-center px-4 pointer-events-none">
      <div className="pointer-events-auto relative">
        <div className="flex items-center gap-1 rounded-full bg-popover/95 backdrop-blur-md shadow-2xl ring-1 ring-border px-2 py-1.5">
          <span className="pl-2 pr-1 py-0.5 text-[12px] font-medium text-foreground tabular-nums">
            {count} selected
          </span>
          {/* Circled ✕ right next to the count — the obvious "deselect all". */}
          <button
            type="button"
            onClick={onClear}
            aria-label="Clear selection"
            title="Clear selection (Esc)"
            className="flex items-center justify-center size-5 rounded-full border border-border/70 text-muted-foreground hover:text-foreground hover:bg-muted/40 hover:border-border transition-colors"
          >
            <X size={11} />
          </button>
          <span className="w-px h-5 bg-border/60 mx-1" />

          <button
            type="button"
            onClick={wrap(onMarkDone)}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] text-foreground/80 hover:text-foreground hover:bg-muted/40 transition-colors disabled:opacity-40"
            title="Mark as done"
          >
            <CheckCircle2 size={12} />
            Done
          </button>

          <button
            type="button"
            onClick={wrap(onMarkTodo)}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] text-foreground/80 hover:text-foreground hover:bg-muted/40 transition-colors disabled:opacity-40"
            title="Mark as todo"
          >
            <Circle size={12} />
            Todo
          </button>

          <button
            type="button"
            onClick={wrap(onDelete)}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] text-[var(--status-danger)] hover:text-[var(--status-danger)] hover:bg-[var(--status-danger)]/10 transition-colors disabled:opacity-40"
            title="Delete"
          >
            <Trash2 size={12} />
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
