'use client';

import { useEffect, useRef, useState } from 'react';
import { Trash2, Copy, ArrowRight, Link2, X } from 'lucide-react';
import type { AlconObjectWithChildren } from '@/hooks/useSupabase';
import { ObjectIcon } from '@/shell/icons';

interface BulkActionBarProps {
  count: number;
  /** Objects offered in the move / multi-home picker (current Domain). */
  pickerObjects: AlconObjectWithChildren[];
  /** Optionally exclude an Object from the picker (the current Object). */
  excludeObjectId?: string | null;
  onDelete: () => void | Promise<void>;
  onDuplicate: () => void | Promise<void>;
  onMove: (targetObjectId: string) => void | Promise<void>;
  /** Multi-home: link selected Elements to an additional Object without
   *  changing their primary home. */
  onAddToObject: (targetObjectId: string) => void | Promise<void>;
  onClear: () => void;
}

type PickerMode = 'move' | 'add' | null;

/**
 * Linear-style floating bulk-action bar. Renders fixed at the bottom-
 * center of the viewport whenever count > 0. Coexists with the
 * QuickAddElementPopup at the same Y position; only one shows at a time
 * because the bar appears only with active selection.
 */
export function BulkActionBar({
  count,
  pickerObjects,
  excludeObjectId,
  onDelete,
  onDuplicate,
  onMove,
  onAddToObject,
  onClear,
}: BulkActionBarProps) {
  const [picker, setPicker] = useState<PickerMode>(null);
  const [busy, setBusy] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  // Close picker on Esc or outside click.
  useEffect(() => {
    if (!picker) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPicker(null); };
    const onDoc = (e: MouseEvent) => {
      if (!popoverRef.current) return;
      if (!popoverRef.current.contains(e.target as Node)) setPicker(null);
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDoc);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDoc);
    };
  }, [picker]);

  const wrap = (fn: () => void | Promise<void>) => async () => {
    if (busy) return;
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  };

  const choose = async (objectId: string) => {
    if (!picker || busy) return;
    setBusy(true);
    try {
      if (picker === 'move') await onMove(objectId);
      else await onAddToObject(objectId);
      setPicker(null);
    } finally {
      setBusy(false);
    }
  };

  const visibleObjects = pickerObjects.filter(o => o.id !== excludeObjectId);

  if (count === 0) return null;

  return (
    <div className="fixed inset-x-0 bottom-6 z-40 flex justify-center px-4 pointer-events-none">
      <div className="pointer-events-auto relative">
        <div className="flex items-center gap-1 rounded-full bg-popover/95 backdrop-blur-md shadow-2xl ring-1 ring-border/40 px-2 py-1.5">
          <span className="px-2 py-0.5 text-[12px] font-medium text-foreground tabular-nums">
            {count} selected
          </span>
          <span className="w-px h-5 bg-border/60 mx-1" />

          <button
            type="button"
            onClick={wrap(onDuplicate)}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] text-foreground/80 hover:text-foreground hover:bg-muted/40 transition-colors disabled:opacity-40"
            title="Duplicate"
          >
            <Copy size={12} />
            Duplicate
          </button>

          <button
            type="button"
            onClick={() => setPicker(picker === 'move' ? null : 'move')}
            disabled={busy}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] hover:text-foreground hover:bg-muted/40 transition-colors disabled:opacity-40 ${
              picker === 'move' ? 'bg-muted/40 text-foreground' : 'text-foreground/80'
            }`}
            title="Move to another Object"
          >
            <ArrowRight size={12} />
            Move to…
          </button>

          <button
            type="button"
            onClick={() => setPicker(picker === 'add' ? null : 'add')}
            disabled={busy}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] hover:text-foreground hover:bg-muted/40 transition-colors disabled:opacity-40 ${
              picker === 'add' ? 'bg-muted/40 text-foreground' : 'text-foreground/80'
            }`}
            title="Also add to another Object (multi-home)"
          >
            <Link2 size={12} />
            Add to…
          </button>

          <button
            type="button"
            onClick={wrap(onDelete)}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] text-red-500 hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-40"
            title="Delete"
          >
            <Trash2 size={12} />
            Delete
          </button>

          <span className="w-px h-5 bg-border/60 mx-1" />
          <button
            type="button"
            onClick={onClear}
            className="p-1 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
            aria-label="Clear selection"
          >
            <X size={13} />
          </button>
        </div>

        {/* Object picker popover — opens above the bar */}
        {picker && (
          <div
            ref={popoverRef}
            className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 w-[280px] max-h-[320px] overflow-y-auto rounded-xl bg-popover shadow-2xl ring-1 ring-border/40 py-1"
          >
            <div className="px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {picker === 'move' ? 'Move to Object' : 'Add to Object (multi-home)'}
            </div>
            {visibleObjects.length === 0 ? (
              <div className="px-3 py-3 text-[12px] text-muted-foreground/70">
                No other Objects in this Domain
              </div>
            ) : (
              visibleObjects.map(o => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => choose(o.id)}
                  disabled={busy}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[13px] text-foreground hover:bg-muted/40 transition-colors disabled:opacity-50"
                >
                  <span className="w-4 h-4 flex items-center justify-center text-muted-foreground/70 shrink-0">
                    <ObjectIcon size={14} />
                  </span>
                  <span className="truncate">{o.name}</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
