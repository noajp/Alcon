'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/ui/button';
import { ArrowRight, Calendar, X } from '@/ui/icons';
import { Switch } from '@/Function/settings/SettingsControls';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { appDialog } from '@/Function/shared/appDialogStore';
import { ElementIcon } from '@/Function/shared/conceptIcons';
import { FIELD, QUICK_CREATE } from '@/shared/designTokens';
import { useEscapeLayer } from '@/Function/shared/keyboard';
import { DateField } from '@/Function/shared/date/DateControl';
import type { CalendarEvent } from '@/hooks/calendarEventData';
import { draftMinutes, draftProblem, durationLabel, type EventDraft } from './eventDraft';

// Making or changing one Calendar event, in the same lifted card as a new
// Element: a title; a start and an end (days and times, or days when all
// day), with how long it runs; and — if it is about any — the Elements
// it concerns. Nothing else is asked.

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
  useEscapeLayer(true, onClose);
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

  const minutes = draftMinutes(draft);

  const chipClass = 'inline-flex h-7 min-w-0 max-w-full items-center gap-1 rounded-full border border-border/40 bg-muted/30 px-2.5 text-[12px] text-foreground';
  const timeClass = `${FIELD.base} h-7 rounded-full bg-muted/30 px-2.5 text-[12px] tabular-nums text-foreground`;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
      <div className={QUICK_CREATE.panel} role="dialog" aria-label={event ? t('Edit event') : t('New event')}>
        <div className={QUICK_CREATE.header}>
          <span className={QUICK_CREATE.context}>
            <Calendar size={12} />
            <span>{event ? t('Edit event') : t('New event')}</span>
          </span>
          <div className="flex-1" />
          <button type="button" onClick={onClose} aria-label={t('Close')}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground">
            <X size={14} />
          </button>
        </div>

        <input autoFocus value={draft.title} onChange={(e) => set({ title: e.target.value })}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); void save(); } }}
          placeholder={t('Add title')} aria-label={t('Event title')} className={QUICK_CREATE.title} />

        {/* When: start → end, how long, all day — one row of pills. */}
        <div className={QUICK_CREATE.properties}>
          <DateField value={draft.startDate} variant="secondary" clearable={false} aria-label="Date"
            onChange={(next) => { if (next) set({ startDate: next, endDate: draft.endDate < next ? next : draft.endDate }); }} />
          {!draft.allDay && (
            <input type="time" step={900} value={draft.startTime} aria-label={t('Start time')}
              onChange={(e) => set({ startTime: e.target.value })} className={timeClass} />
          )}
          <ArrowRight size={13} className="text-muted-foreground" />
          <DateField value={draft.endDate} variant="secondary" clearable={false} aria-label="End date"
            onChange={(next) => { if (next) set({ endDate: next }); }} />
          {!draft.allDay && (
            <input type="time" step={900} value={draft.endTime} aria-label={t('End time')}
              onChange={(e) => set({ endTime: e.target.value })} className={timeClass} />
          )}
          {minutes !== null && <span className="text-[12px] tabular-nums text-muted-foreground">{durationLabel(minutes)}</span>}
          <span className="ml-1 flex items-center gap-2 text-[12px] text-foreground">
            <Switch value={draft.allDay} onChange={(allDay) => set({ allDay })} label={t('All day')} />
            {t('All day')}
          </span>
        </div>
        {problemText && <p className="mt-1.5 text-[12px] text-[var(--status-danger)]">{problemText}</p>}

        {/* The Elements it concerns, as pills, and a field to name more. */}
        <div className={QUICK_CREATE.properties}>
          {draft.elementIds.map((id) => {
            const el = byId.get(id);
            return (
              <span key={id} className={chipClass}>
                <ElementIcon size={11} className="shrink-0 text-muted-foreground" />
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
          <span className={`${chipClass} w-56`}>
            <ElementIcon size={11} className="shrink-0 text-muted-foreground" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('Add related Elements')}
              aria-label={t('Related Elements')} className="min-w-0 flex-1 bg-transparent text-[12px] text-foreground placeholder:text-muted-foreground" />
          </span>
        </div>
        {matches.length > 0 && (
          <div className="mt-1.5 max-h-48 overflow-y-auto rounded-md border border-border/60 py-1">
            {matches.map((e) => (
              <button key={e.id} type="button"
                onClick={() => { set({ elementIds: [...draft.elementIds, e.id] }); setQuery(''); }}
                className="flex w-full min-w-0 items-center gap-2 px-2.5 py-1.5 text-left text-[13px] hover:bg-muted/50">
                <ElementIcon size={12} className="shrink-0" />
                {e.display_id && <span className="shrink-0 text-[11px] text-muted-foreground">{e.display_id}</span>}
                <span className="min-w-0 truncate">{e.title}</span>
              </button>
            ))}
          </div>
        )}

        {error && <p role="alert" className="mt-2 text-[12px] text-[var(--status-danger)]">{error}</p>}

        <div className={QUICK_CREATE.footer}>
          {onDelete && (
            <Button variant="ghost" size="sm" className="mr-auto text-[var(--status-danger)]" onClick={() => void remove()} disabled={busy}>
              {t('Delete')}
            </Button>
          )}
          <Button variant="primary" onClick={() => void save()} disabled={busy || problem !== null}>
            {event ? t('Save') : t('Create')}
          </Button>
        </div>
      </div>
    </div>
  );
}
