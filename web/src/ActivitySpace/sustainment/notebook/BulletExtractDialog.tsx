'use client';

import { useMemo, useState } from 'react';
import { Check, ChevronDown, Loader2, X } from '@/ui/icons';
import { useEscapeLayer } from '@/Function/shared/keyboard';
import { ObjectIcon } from '@/shell/icons';
import { ElementIcon } from '@/Function/shared/conceptIcons';
import { useObjects, createElement as createElementRow } from '@/hooks/useSupabase';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { Button } from '@/ui/button';

interface BulletExtractDialogProps {
  /** Bullet/check item texts the user selected. */
  texts: string[];
  /** Anchor position (right-click coordinates). */
  anchor: { x: number; y: number };
  /** Active Domain to scope Object choices to. */
  activeDomainId?: string | null;
  /** Object to pre-select as the Element creation target. PageView
   *  passes the Note's `linked_object_id` so a Note wired to an Object
   *  pre-fills the picker; null means "Domain 直下" (default). */
  defaultObjectId?: string | null;
  onClose: () => void;
  /** Reports the created Elements paired with the source bullet index
   *  (index into `texts`) so the host can stamp the link back. */
  onCreated: (created: { index: number; elementId: string }[]) => void;
}

/**
 * Note-style "→ Element 化" popover. Shows the selected bullet
 * lines as a checkbox list, lets the user pick a target Object (or
 * "Domain 直下"), and bulk-creates Elements via createElement.
 */
export function BulletExtractDialog({
  texts,
  anchor,
  activeDomainId,
  defaultObjectId,
  onClose,
  onCreated,
}: BulletExtractDialogProps) {
  const { t } = useI18n();
  const { data } = useObjects(activeDomainId ?? null);
  const objects = data.objects;

  // texts is captured at mount; the host unmounts/remounts the dialog on
  // each right-click, so we don't need to react to texts changing.
  const [picked, setPicked] = useState<boolean[]>(() => texts.map(() => true));
  const [editTexts, setEditTexts] = useState<string[]>(() => texts.slice());
  const [targetObjectId, setTargetObjectId] = useState<string | null>(defaultObjectId ?? null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>('');

  useEscapeLayer(true, onClose);

  const targetLabel = useMemo(() => {
    if (!targetObjectId) return t('Directly under the Domain');
    return objects.find((o) => o.id === targetObjectId)?.name ?? 'Object';
  }, [targetObjectId, objects, t]);

  const pickedCount = picked.filter(Boolean).length;

  const submit = async () => {
    if (pickedCount === 0) return;
    setSubmitting(true);
    setError('');
    try {
      // Keep each item's original index so the host can map the new
      // Element back to its source bullet <li> and stamp the link.
      const itemsToCreate = editTexts
        .map((text, i) => ({ title: text.trim(), index: i }))
        .filter((it) => picked[it.index] && it.title);
      const created: { index: number; elementId: string }[] = [];
      for (const item of itemsToCreate) {
        // New Elements start in Backlog — the bullet's ○ mirrors this.
        const row = await createElementRow({
          title: item.title,
          object_id: targetObjectId,
          status: 'backlog',
        });
        created.push({ index: item.index, elementId: row.id });
      }
      onCreated(created);
      onClose();
    } catch (e) {
      setError((e as Error).message || t('Could not create the Elements.'));
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
          <div className="text-[12px] font-medium">{t('Turn into Elements')}</div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('Close')}
            className="text-muted-foreground hover:text-foreground"
          >
            <X size={14} />
          </button>
        </div>

        <div className="px-3 py-2.5 border-b border-border/60">
          <div className="text-[10px] text-muted-foreground/80 mb-1.5">
            {t('Create in')}
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
              {t('No bullet lines in the selection.')}
            </div>
          )}
          {editTexts.map((text, i) => (
            <div
              key={i}
              className="flex items-center gap-1.5 px-2 py-1.5 rounded hover:bg-accent group min-h-[1.625rem]"
            >
              {/* Pick checkbox — matches the Done checkbox in Element List rows */}
              <button
                type="button"
                onClick={() => {
                  const next = picked.slice();
                  next[i] = !picked[i];
                  setPicked(next);
                }}
                aria-pressed={picked[i]}
                aria-label={picked[i] ? t('Deselect') : t('Select')}
                className={`w-4 h-4 shrink-0 rounded-[2px] flex items-center justify-center transition-colors ${
                  picked[i]
                    ? 'bg-[var(--status-success)] hover:opacity-90'
                    : 'border border-muted-foreground/40 hover:border-foreground/60'
                }`}
              >
                {picked[i] && <Check size={11} strokeWidth={3} className="text-white" />}
              </button>
              {/* Element marker — same atom icon used in List rows */}
              <ElementIcon className="size-3.5 shrink-0 text-muted-foreground/70" />
              {/* Editable line — matches the title cell typography in Element List */}
              <input
                type="text"
                value={text}
                onChange={(e) => {
                  const next = editTexts.slice();
                  next[i] = e.target.value;
                  setEditTexts(next);
                }}
                className={`no-focus-ring flex-1 min-w-0 bg-transparent border-0 p-0 text-[13px] font-medium ${
                  picked[i] ? 'text-foreground' : 'text-muted-foreground'
                }`}
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
            {t('{count} → {target}', { count: pickedCount, target: targetLabel })}
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={submit}
            disabled={pickedCount === 0 || submitting}
          >
            {submitting && <Loader2 size={12} className="animate-spin" />}
            {submitting ? t('Creating…') : t('Create Elements')}
          </Button>
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
  const { t } = useI18n();
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
            <span>{t('Directly under the Domain')}</span>
          </button>
          {objects.length === 0 && (
            <div className="px-2.5 py-2 text-[11px] text-muted-foreground/70">
              {t('No Objects in this Domain yet.')}
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
