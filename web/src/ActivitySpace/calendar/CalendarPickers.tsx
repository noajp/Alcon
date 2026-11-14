'use client';

import { useMemo, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, ChevronDown } from '@/ui/icons';
import { Button } from '@/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { WorkerAvatar } from '@/Function/shared/WorkerAvatar';
import { parseDateOnly, toDateOnlyString } from '@/Function/shared/dateUtils';
import { getCachedWeekStartsOn, usePreference } from '@/Function/settings/preferencesStore';
import { useWorkersByIds } from '@/hooks/teamData';
import { miniMonthDays, monthOf, shiftMonth } from './schedule';
import {
  setCalendarWorkerHidden, showAllCalendarWorkers,
  useCalendarWorkerIds, useHiddenCalendarWorkers,
} from './calendarStore';

// The Calendar's two choices, kept in its bars instead of a side panel so the
// grid has the width: whose Elements it shows (People, in the Calendar's own
// bar) and which day it is on (the month, opened from the period heading).

/** How many faces the People button shows before it counts the rest. */
const FACES = 3;

/** People on the Calendar, as faces in the bar; a press opens the list to
 *  show or hide each one's Elements. */
export function CalendarPeoplePicker() {
  const { t } = useI18n();
  const hidden = useHiddenCalendarWorkers();
  const onCalendar = useCalendarWorkerIds();
  // People put on the calendar are read by id, so a pick from outside the
  // active Space's roster still shows.
  const workers = useWorkersByIds(onCalendar);
  const people = useMemo(() => workers.filter(worker => onCalendar.includes(worker.id)).sort((a, b) =>
    (a.type === 'human' ? 0 : 1) - (b.type === 'human' ? 0 : 1) || a.name.localeCompare(b.name)), [workers, onCalendar]);
  const shown = people.filter(worker => !hidden.includes(worker.id));
  const label = people.length === 0
    ? t('People')
    : t('People: {shown} of {all} shown', { shown: shown.length, all: people.length });

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={label} title={shown.map(worker => worker.name).join(', ') || undefined}>
          {shown.length > 0 ? (
            <span className="flex items-center -space-x-1.5" aria-hidden="true">
              {shown.slice(0, FACES).map(worker => (
                <WorkerAvatar key={worker.id} worker={worker} size={18} className="ring-2 ring-card" />
              ))}
            </span>
          ) : null}
          <span>{t('People')}</span>
          {shown.length > FACES && <span className="tabular-nums text-muted-foreground">+{shown.length - FACES}</span>}
          {people.length > 0 && shown.length < people.length && (
            <span className="tabular-nums text-muted-foreground">{shown.length}/{people.length}</span>
          )}
          <ChevronDown size={12} />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" aria-label={t('People')} className="w-64 p-1">
        <div className="flex h-7 items-center gap-1 px-2">
          <span className="flex-1 text-[12px] font-medium text-muted-foreground">{t('People')}</span>
          {people.some(worker => hidden.includes(worker.id)) && (
            <Button size="xs" variant="ghost" onClick={showAllCalendarWorkers}>{t('Show all')}</Button>
          )}
        </div>
        {people.length === 0 && <p className="px-2 py-1.5 text-[12px] text-muted-foreground">{t('No one is scheduled here.')}</p>}
        <ul className="space-y-0.5">
          {people.map(worker => {
            const on = !hidden.includes(worker.id);
            return (
              <li key={worker.id}>
                <button type="button" role="switch" aria-checked={on} onClick={() => setCalendarWorkerHidden(worker.id, on)}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors hover:bg-foreground/[0.06] ${on ? 'text-foreground' : 'text-muted-foreground'}`}>
                  <WorkerAvatar worker={worker} size={18} className={on ? undefined : 'opacity-50'} />
                  <span className="min-w-0 flex-1 truncate">{worker.name}</span>
                  <span className={`flex h-4 w-4 items-center justify-center rounded border ${on ? 'border-[var(--accent-default)] bg-[var(--accent-default)] text-primary-foreground' : 'border-[var(--border-strong)]'}`}>
                    {on && <Check size={11} />}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

/** The period heading as a button: it opens a month to pick the day the grid
 *  moves to. `title` is the heading's own text. */
export function CalendarMonthPicker({ title, value, onPick }: {
  title: string;
  value: Date;
  onPick: (date: Date) => void;
}) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const weekStartsOn = usePreference(getCachedWeekStartsOn);
  const day = toDateOnlyString(value);
  const today = toDateOnlyString(new Date());
  // Paging the month only browses until a day is picked; opening it again
  // starts from the day the grid is on.
  const [browsed, setBrowsed] = useState<string | null>(null);
  const month = browsed ?? monthOf(day);
  const days = useMemo(() => miniMonthDays(month, weekStartsOn), [month, weekStartsOn]);
  const weekdayLabels = useMemo(() => Array.from({ length: 7 }, (_, i) =>
    new Date(2023, 0, 1 + ((weekStartsOn + i) % 7)).toLocaleDateString(locale, { weekday: 'narrow' })), [locale, weekStartsOn]);
  const monthLabel = parseDateOnly(`${month}-01`)!.toLocaleDateString(locale, { month: 'long', year: 'numeric' });

  return (
    <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) setBrowsed(null); }}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={t('Choose a date')} className="text-base font-semibold">
          {title}<ChevronDown size={12} className="opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" aria-label={t('Choose a date')} className="w-64 p-2">
        <div className="flex items-center gap-0.5 px-1">
          <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground">{monthLabel}</span>
          <Button size="icon-xs" variant="ghost" aria-label={t('Previous month')} onClick={() => setBrowsed(shiftMonth(month, -1))}><ChevronLeft size={14} /></Button>
          <Button size="icon-xs" variant="ghost" aria-label={t('Next month')} onClick={() => setBrowsed(shiftMonth(month, 1))}><ChevronRight size={14} /></Button>
        </div>
        <div aria-label={monthLabel} className="mt-1 grid grid-cols-7 gap-y-0.5">
          {weekdayLabels.map((label, i) => (
            <span key={i} aria-hidden="true" className="text-center text-[10px] font-medium text-muted-foreground">{label}</span>
          ))}
          {days.map(date => {
            const inMonth = monthOf(date) === month;
            const isToday = date === today;
            const selected = date === day;
            return (
              <button key={date} type="button" aria-pressed={selected} aria-current={isToday ? 'date' : undefined}
                aria-label={parseDateOnly(date)!.toLocaleDateString(locale, { month: 'long', day: 'numeric' })}
                onClick={() => { onPick(parseDateOnly(date)!); setOpen(false); setBrowsed(null); }}
                className={`mx-auto flex h-7 w-7 items-center justify-center rounded-full text-[12px] leading-none tabular-nums transition-colors ${
                  isToday ? 'bg-[var(--accent-default)] font-semibold text-primary-foreground'
                  : selected ? 'bg-foreground/[0.1] font-medium text-foreground'
                  : inMonth ? 'text-foreground hover:bg-foreground/[0.06]'
                  : 'text-muted-foreground hover:bg-foreground/[0.06]'
                }`}>
                {parseDateOnly(date)!.getDate()}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
