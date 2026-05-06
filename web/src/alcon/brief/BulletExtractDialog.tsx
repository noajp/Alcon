'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Loader2, X } from 'lucide-react';
import { ObjectIcon } from '@/shell/icons';
import { AtomIcon } from '@/alcon/shared/AtomIcon';
import { useObjects, createElement as createElementRow } from '@/hooks/useSupabase';

interface BulletExtractDialogProps {
  /** Bullet/check item texts the user selected. */
  texts: string[];
  /** Anchor position (right-click coordinates). */
  anchor: { x: number; y: number };
  /** Active Domain to scope Object choices to. */
  activeDomainId?: string | null;
  onClose: () => void;
  onCreated: (count: number) => void;
}

/**
 * Apple-Notes-style "→ Element 化" popover. Shows the selected bullet
 * lines as a checkbox list, lets the user pick a target Object (or
 * "Domain 直下"), and bulk-creates Elements via createElement.
 */
export function BulletExtractDialog({
  texts,
  anchor,
  activeDomainId,
  onClose,
  onCreated,
}: BulletExtractDialogProps) {
  const { data } = useObjects(activeDomainId ?? null);
  const objects = data.objects;

  // texts is captured at mount; the host unmounts/remounts the dialog on
  // each right-click, so we don't need to react to texts changing.
  const [picked, setPicked] = useState<boolean[]>(() => texts.map(() => true));
  const [editTexts, setEditTexts] = useState<string[]>(() => texts.slice());
  const [targetObjectId, setTargetObjectId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const targetLabel = useMemo(() => {
    if (!targetObjectId) return 'Domain 直下';
    return objects.find((o) => o.id === targetObjectId)?.name ?? 'Object';
  }, [targetObjectId, objects]);

  const pickedCount = picked.filter(Boolean).length;

  const submit = async () => {
    if (pickedCount === 0) return;
    setSubmitting(true);
    setError('');
    try {
      const itemsToCreate = editTexts
        .map((t, i) => (picked[i] ? t.trim() : ''))
        .filter(Boolean);
      for (const title of itemsToCreate) {
        await createElementRow({
          title,
          object_id: targetObjectId,
        });
      }
      onCreated(itemsToCreate.length);
      onClose();
    } catch (e) {
      setError((e as Error).message || 'Element 作成に失敗しました');
      setSubmitting(false);
    }
  };

  // Position the popover near the right-click point but keep within viewport.
  const width = 360;
  const maxHeight = 460;
  const left = Math.max(8, Math.min(window.innerWidth - width - 8, anchor.x));
  const top = Math.max(8, Math.min(window.innerHeight - maxHeight - 8, anchor.y));

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="fixed z-50 bg-popover border border-border rounded-lg shadow-2xl overflow-hidden flex flex-col"
        style={{ left, top, width, maxHeight }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-3 py-2.5 flex items-center justify-between border-b border-border/60">
          <div className="text-[12px] font-medium">→ Element 化</div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            <X size={14} />
          </button>
        </div>

        <div className="px-3 py-2.5 border-b border-border/60">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground/80 mb-1.5">
            作成先
          </div>
          <ObjectScopeSelect
            objects={objects.map((o) => ({ id: o.id, name: o.name }))}
            value={targetObjectId}
            onChange={setTargetObjectId}
            label={targetLabel}
          />
        </div>

        <div className="flex-1 overflow-auto px-2 py-2">
          {editTexts.length === 0 && (
            <div className="text-[12px] text-muted-foreground/70 px-2 py-3 text-center">
              選択範囲に箇条書き行がありません
            </div>
          )}
          {editTexts.map((t, i) => (
            <div
              key={i}
              className="flex items-center gap-2 px-2 py-1 rounded hover:bg-accent group"
            >
              {/* Square checkbox — matches Element List row affordance */}
              <button
                type="button"
                onClick={() => {
                  const next = picked.slice();
                  next[i] = !picked[i];
                  setPicked(next);
                }}
                aria-pressed={picked[i]}
                aria-label={picked[i] ? 'Deselect' : 'Select'}
                className={[
                  'size-3.5 shrink-0 rounded-[3px] border flex items-center justify-center transition-colors',
                  picked[i]
                    ? 'bg-foreground border-foreground text-background'
                    : 'border-foreground/35 hover:border-foreground/60 bg-transparent',
                ].join(' ')}
              >
                {picked[i] && (
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
              {/* Element marker — same atom icon used in List rows */}
              <AtomIcon size={13} className="shrink-0 text-muted-foreground/70" />
              {/* Editable line */}
              <input
                type="text"
                value={t}
                onChange={(e) => {
                  const next = editTexts.slice();
                  next[i] = e.target.value;
                  setEditTexts(next);
                }}
                className={[
                  'no-focus-ring flex-1 min-w-0 bg-transparent border-0 p-0 text-[13px]',
                  picked[i] ? 'text-foreground' : 'text-muted-foreground/60',
                ].join(' ')}
              />
            </div>
          ))}
        </div>

        {error && (
          <div className="px-3 py-2 text-[11px] text-destructive border-t border-border/60">
            {error}
          </div>
        )}

        <div className="px-3 py-2.5 border-t border-border/60 flex items-center justify-between">
          <div className="text-[11px] text-muted-foreground">
            {pickedCount}件 → <span className="text-foreground/80">{targetLabel}</span>
          </div>
          <button
            type="button"
            onClick={submit}
            disabled={pickedCount === 0 || submitting}
            className="inline-flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 bg-foreground text-background rounded-md disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {submitting && <Loader2 size={12} className="animate-spin" />}
            {submitting ? '作成中…' : 'Element 化'}
          </button>
        </div>
      </div>
    </>
  );
}

function ObjectScopeSelect({
  objects,
  value,
  onChange,
  label,
}: {
  objects: { id: string; name: string }[];
  value: string | null;
  onChange: (id: string | null) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full inline-flex items-center justify-between gap-2 px-2.5 py-1.5 text-[13px] border border-border rounded-md hover:bg-accent text-foreground/90"
      >
        <span className="inline-flex items-center gap-1.5 truncate">
          <ObjectIcon size={12} />
          <span className="truncate">{label}</span>
        </span>
        <ChevronDown size={12} className="text-muted-foreground/70" />
      </button>
      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-popover border border-border rounded-md shadow-lg max-h-48 overflow-auto z-10">
          <button
            type="button"
            onClick={() => { onChange(null); setOpen(false); }}
            className={[
              'w-full flex items-center gap-1.5 px-2.5 py-1.5 text-left text-[12px] hover:bg-accent',
              value === null ? 'text-foreground' : 'text-foreground/80',
            ].join(' ')}
          >
            <ObjectIcon size={12} />
            <span>Domain 直下</span>
          </button>
          {objects.length === 0 && (
            <div className="px-2.5 py-2 text-[11px] text-muted-foreground/70">
              この Domain に Object はまだありません
            </div>
          )}
          {objects.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => { onChange(o.id); setOpen(false); }}
              className={[
                'w-full flex items-center gap-1.5 px-2.5 py-1.5 text-left text-[12px] hover:bg-accent',
                value === o.id ? 'text-foreground' : 'text-foreground/80',
              ].join(' ')}
            >
              <ObjectIcon size={12} />
              <span className="truncate">{o.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
