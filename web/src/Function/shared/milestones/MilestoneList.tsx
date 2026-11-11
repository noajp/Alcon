'use client';

import { useState } from 'react';
import { Diamond, MoreHorizontal } from '@/ui/icons';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { DropdownMenu, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import { MenuShell } from '@/Function/shared/menu';
import { DateField } from '@/Function/shared/date';
import { daysUntil, parseDateOnly, toDateOnlyString } from '@/Function/shared/dateUtils';
import { useI18n } from '@/Function/i18n/I18nProvider';
import {
  createObjectMilestone,
  deleteObjectMilestone,
  updateObjectMilestone,
  useObjectMilestones,
} from '@/hooks/useSupabase';
import type { ObjectMilestone } from '@/types/database';

/**
 * Milestones = `object_milestones` rows — the same ◇ the Gantt draws — by
 * month. With `objectId` they are that Object's own: added (the caller's `+`
 * sets `adding`), renamed, moved and deleted here. Without it they are read
 * across `objectIds`, each with its Object's name.
 */
export function MilestoneList({ objectIds, objectId, names, adding, onAddingChange }: {
  objectIds: string[];
  /** The Object whose milestones are edited here; null reads only. */
  objectId: string | null;
  /** Object names, shown beside a milestone read across Objects. */
  names?: Map<string, string>;
  adding: boolean;
  onAddingChange: (adding: boolean) => void;
}) {
  const { t, locale } = useI18n();
  const { data: milestones, loading, error: loadError } = useObjectMilestones(objectIds);
  const editable = !!objectId;
  const setAdding = onAddingChange;
  const empty = !loading && !loadError && milestones.length === 0;

  const [renaming, setRenaming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = (write: () => Promise<unknown>) => {
    setError(null);
    write().catch((e: unknown) => setError(e instanceof Error ? e.message : t('Could not save the milestone.')));
  };

  const grouped = milestones.reduce<Array<[string, ObjectMilestone[]]>>((acc, m) => {
    const key = (parseDateOnly(m.date) ?? new Date()).toLocaleDateString(locale, { month: 'long', year: 'numeric' });
    const last = acc[acc.length - 1];
    if (last && last[0] === key) last[1].push(m);
    else acc.push([key, [m]]);
    return acc;
  }, []);

  return (
    <div className="space-y-4">
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      {loadError && <p role="alert" className="text-xs text-destructive">{t('Could not load milestones.')}</p>}
      {adding && objectId && (
        <MilestoneComposer
          onCancel={() => setAdding(false)}
          onSubmit={(label, date) => {
            setAdding(false);
            run(() => createObjectMilestone({ object_id: objectId, label, date }));
          }}
        />
      )}
      {editable && !adding && empty && (
        <p className="text-[12px] text-muted-foreground">{t('No milestones yet.')}</p>
      )}
      {grouped.map(([month, items]) => (
        <div key={month}>
          <div className="text-[12px] text-muted-foreground pb-1">{month}</div>
          {items.map((m) => {
            const days = daysUntil(m.date);
            const label = m.label?.trim() || t('Untitled');
            return (
              <div key={m.id} className="group py-1.5">
                <div className="flex items-center gap-2">
                  <Diamond size={12} className="shrink-0 text-[var(--status-danger)]" />
                  {renaming === m.id ? (
                    <Input
                      autoFocus
                      defaultValue={m.label ?? ''}
                      aria-label={t('Milestone name')}
                      className="h-7 text-[13px]"
                      onBlur={(e) => {
                        setRenaming(null);
                        const next = e.currentTarget.value.trim() || null;
                        if (next !== (m.label ?? null)) run(() => updateObjectMilestone(m, { label: next }));
                      }}
                      onKeyDown={(e) => {
                        // Enter and Escape both save and close: this is the
                        // milestone's own name, written in place.
                        if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur();
                      }}
                    />
                  ) : editable ? (
                    <button
                      type="button"
                      className="min-w-0 flex-1 truncate text-left text-[13px] font-medium text-foreground"
                      onClick={() => setRenaming(m.id)}
                    >
                      {label}
                    </button>
                  ) : (
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">{label}</span>
                  )}
                  {editable && renaming !== m.id && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-xs" aria-label={t('Milestone actions')} className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100">
                          <MoreHorizontal size={14} />
                        </Button>
                      </DropdownMenuTrigger>
                      <MenuShell as="dropdown" align="end">
                        <DropdownMenuItem onSelect={() => setRenaming(m.id)}>{t('Rename')}</DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => run(() => deleteObjectMilestone(m))}>{t('Delete')}</DropdownMenuItem>
                      </MenuShell>
                    </DropdownMenu>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-0.5 pl-5 text-[12px] text-muted-foreground">
                  {editable ? (
                    <DateField
                      size="xs"
                      value={m.date}
                      clearable={false}
                      aria-label={t('Milestone date')}
                      onChange={(next) => { if (next && next !== m.date) run(() => updateObjectMilestone(m, { date: next })); }}
                    />
                  ) : (
                    <span>{(parseDateOnly(m.date) ?? new Date()).toLocaleDateString(locale, { month: 'short', day: 'numeric' })}</span>
                  )}
                  {/* Only a milestone already passed asks for attention, so only it is red. */}
                  <span className={days < 0 ? 'text-[var(--status-danger)]' : undefined}>
                    {days < 0 ? t('{n}d ago', { n: Math.abs(days) }) : days === 0 ? t('Today') : t('in {n}d', { n: days })}
                  </span>
                  {!objectId && names?.get(m.object_id) && <span className="truncate">{names?.get(m.object_id)}</span>}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** A new milestone: a name and a day. Escape abandons it. */
function MilestoneComposer({ onSubmit, onCancel }: { onSubmit: (label: string | null, date: string) => void; onCancel: () => void }) {
  const { t } = useI18n();
  const [label, setLabel] = useState('');
  const [date, setDate] = useState(() => toDateOnlyString(new Date()));
  const submit = () => onSubmit(label.trim() || null, date);
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => { e.preventDefault(); submit(); }}
      onKeyDown={(e) => {
        // The date picker renders in a portal, but React still bubbles its
        // keys here: its Escape closes the picker, not the new milestone.
        if (!e.currentTarget.contains(e.target as Node)) return;
        if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
      }}
    >
      <Diamond size={12} className="shrink-0 text-[var(--status-danger)]" />
      <Input
        autoFocus
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder={t('Milestone name')}
        aria-label={t('Milestone name')}
        className="h-7 flex-1 text-[13px]"
      />
      <DateField size="xs" value={date} clearable={false} aria-label={t('Milestone date')} onChange={(next) => { if (next) setDate(next); }} />
      <Button type="submit" size="xs">{t('Add')}</Button>
      <Button type="button" variant="ghost" size="xs" onClick={onCancel}>{t('Cancel')}</Button>
    </form>
  );
}
