'use client';

import { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/ui/dialog';
import { Button } from '@/ui/button';
import { X } from '@/ui/icons';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { appDialog } from '@/Function/shared/appDialogStore';
import { ElementIcon } from '@/Function/shared/conceptIcons';
import { FIELD } from '@/shared/designTokens';
import { DateField } from '@/Function/shared/date/DateControl';
import type { CalendarEvent } from '@/hooks/calendarEventData';
import { draftProblem, type EventDraft } from './eventDraft';

// Making or changing one Calendar event: a title, a day (or days, all
// day) or a start and an end time, and — if it is about any — the
// Elements it concerns. Like a meeting in Teams: nothing else is asked.

const FIELD_CLASS = `${FIELD.base} h-8 bg-transparent px-2.5 text-[13px] text-foreground`;

export function CalendarEventPopup({ initial, event, elements, onSave, onDelete, onClose, onOpenElement }: {
  initial: EventDraft;
  /** The event being changed; absent when making a new one. */
  event?: CalendarEvent;
  /** The Elements that can be named. */
  elements: { id: string; title: string; display_id?: string | null }[];
  onSave: (draft: EventDraft) => Promise<void>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
  onOpenElement?: (elementId: string) => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(initial);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<EventDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const problem = draftProblem(draft);

  const byId = useMemo(() => new Map(elements.map((e) => [e.id, e])), [elements]);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return elements
      .filter((e) => !draft.elementIds.includes(e.id))
      .filter((e) => e.title.toLowerCase().includes(q) || (e.display_id ?? '').toLowerCase().includes(q))
      .slice(0, 8);
  }, [elements, draft.elementIds, query]);

  const save = async () => {
    if (problem || busy) return;
    setBusy(true); setError(null);
    try {
      await onSave(draft);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('Could not save the event.'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!onDelete || busy) return;
    if (!(await appDialog.confirm(t('Delete "{title}"? This can’t be undone.', { title: draft.title || initial.title })))) return;
    setBusy(true); setError(null);
    try {
      await onDelete();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('Could not delete the event.'));
      setBusy(false);
    }
  };

  const problemText = problem === 'times' ? t('The end time must be after the start time.')
    : problem === 'dates' ? t('The end date must not be before the start date.')
    : null;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md gap-0 p-5 sm:max-w-md">
        <DialogTitle className="sr-only">{event ? t('Edit event') : t('New event')}</DialogTitle>
        <input autoFocus value={draft.title} onChange={(e) => set({ title: e.target.value })}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); void save(); } }}
          placeholder={t('Event title')} aria-label={t('Event title')}
          className="w-full bg-transparent text-[17px] text-foreground outline-none placeholder:text-muted-foreground" />

        <div className="mt-4 space-y-2.5">
          <label className="flex items-center gap-2 text-[13px] text-foreground">
            <input type="checkbox" checked={draft.allDay} onChange={(e) => set({ allDay: e.target.checked })} />
            {t('All day')}
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <DateField value={draft.startDate} variant="secondary" clearable={false} aria-label="Date"
              onChange={(next) => { if (next) set({ startDate: next, endDate: draft.endDate < next ? next : draft.endDate }); }} />
            {draft.allDay ? (
              <>
                <span className="text-[12px] text-muted-foreground">–</span>
                <DateField value={draft.endDate} variant="secondary" clearable={false} aria-label="End date"
                  onChange={(next) => { if (next) set({ endDate: next }); }} />
              </>
            ) : (
              <>
                <input type="time" value={draft.startTime} aria-label={t('Start time')}
                  onChange={(e) => set({ startTime: e.target.value })} className={FIELD_CLASS} />
                <span className="text-[12px] text-muted-foreground">–</span>
                <input type="time" value={draft.endTime} aria-label={t('End time')}
                  onChange={(e) => set({ endTime: e.target.value })} className={FIELD_CLASS} />
              </>
            )}
          </div>
          {problemText && <p className="text-[12px] text-[var(--status-danger)]">{problemText}</p>}
        </div>

        <div className="mt-5">
          <div className="text-[12px] text-muted-foreground">{t('Related Elements')}</div>
          {draft.elementIds.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {draft.elementIds.map((id) => {
                const el = byId.get(id);
                return (
                  <span key={id} className="inline-flex max-w-full items-center gap-1 rounded-md border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[12px]">
                    <ElementIcon size={11} />
                    {onOpenElement && event ? (
                      <button type="button" className="min-w-0 truncate hover:underline" onClick={() => onOpenElement(id)}>{el?.title ?? t('An Element')}</button>
                    ) : <span className="min-w-0 truncate">{el?.title ?? t('An Element')}</span>}
                    <button type="button" aria-label={t('Remove')} className="text-muted-foreground hover:text-foreground"
                      onClick={() => set({ elementIds: draft.elementIds.filter((x) => x !== id) })}>
                      <X size={11} />
                    </button>
                  </span>
                );
              })}
            </div>
          )}
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('Search Elements…')}
            aria-label={t('Search Elements…')} className={`${FIELD_CLASS} mt-1.5 w-full`} />
          {matches.length > 0 && (
            <div className="mt-1 max-h-48 overflow-y-auto rounded-md border border-border/60 py-1">
              {matches.map((e) => (
                <button key={e.id} type="button"
                  onClick={() => { set({ elementIds: [...draft.elementIds, e.id] }); setQuery(''); }}
                  className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[13px] hover:bg-muted/50">
                  <ElementIcon size={12} />
                  {e.display_id && <span className="shrink-0 text-[11px] text-muted-foreground">{e.display_id}</span>}
                  <span className="truncate">{e.title}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {error && <p role="alert" className="mt-3 text-[12px] text-[var(--status-danger)]">{error}</p>}

        <div className="mt-5 flex items-center gap-2">
          {onDelete && (
            <Button variant="ghost" size="sm" className="text-[var(--status-danger)]" onClick={() => void remove()} disabled={busy}>
              {t('Delete')}
            </Button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>{t('Cancel')}</Button>
            <Button variant="primary" size="sm" onClick={() => void save()} disabled={busy || problem !== null}>
              {event ? t('Save') : t('Create')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
