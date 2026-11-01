'use client';

import { useMemo, useState } from 'react';
import { Check, ChevronLeft, ChevronRight } from '@/ui/icons';
import { Button } from '@/ui/button';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { WorkerAvatar } from '@/Function/shared/WorkerAvatar';
import { parseDateOnly, toDateOnlyString } from '@/Function/shared/dateUtils';
import { getCachedWeekStartsOn, usePreference } from '@/Function/settings/preferencesStore';
import { useWorkersByIds } from '@/hooks/teamData';
import { miniMonthDays, monthOf, shiftMonth } from './schedule';
import {
  setCalendarDay, setCalendarWorkerHidden, showAllCalendarWorkers,
  useCalendarDay, useCalendarWorkerIds, useHiddenCalendarWorkers,
} from './calendarStore';

/** The Calendar's sidebar: today at a glance, a mini month that moves the
 *  main grid, and the people whose Elements it shows. */
export function CalendarSidebar() {
  const { t, locale } = useI18n();
  const day = useCalendarDay();
  const hidden = useHiddenCalendarWorkers();
  const weekStartsOn = usePreference(getCachedWeekStartsOn);
  const today = toDateOnlyString(new Date());
  // The mini month follows the day the grid is on; paging it only browses
  // until a day is picked, so it is derived here rather than kept in an effect.
  const [browsed, setBrowsed] = useState<{ month: string; forDay: string } | null>(null);
  const month = browsed && browsed.forDay === day ? browsed.month : monthOf(day);
  const days = useMemo(() => miniMonthDays(month, weekStartsOn), [month, weekStartsOn]);
  const weekdayLabels = useMemo(() => Array.from({ length: 7 }, (_, i) =>
    new Date(2023, 0, 1 + ((weekStartsOn + i) % 7)).toLocaleDateString(locale, { weekday: 'narrow' })), [locale, weekStartsOn]);
  const todayDate = parseDateOnly(today)!;
  const monthDate = parseDateOnly(`${month}-01`)!;

  const onCalendar = useCalendarWorkerIds();
  // People put on the calendar are read by id, so a pick from outside the
  // active Space's roster still shows.
  const workers = useWorkersByIds(onCalendar);
  const people = useMemo(() => workers.filter(worker => onCalendar.includes(worker.id)).sort((a, b) =>
    (a.type === 'human' ? 0 : 1) - (b.type === 'human' ? 0 : 1) || a.name.localeCompare(b.name)), [workers, onCalendar]);

  return (
    <div className="mt-2 px-1">
      <button type="button" onClick={() => setCalendarDay(today)} title={t('Today')}
        className="flex w-full items-baseline gap-2 rounded-lg px-2 py-1 text-left transition-colors hover:bg-sidebar-accent/50">
        <span className="text-[28px] font-semibold leading-none tabular-nums text-foreground">{todayDate.getDate()}</span>
        <span className="min-w-0 truncate text-[12px] text-muted-foreground">
          {todayDate.toLocaleDateString(locale, { weekday: 'long', month: 'long', year: 'numeric' })}
        </span>
      </button>

      <div className="mt-2 flex items-center gap-0.5 px-1">
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground">
          {monthDate.toLocaleDateString(locale, { month: 'long', year: 'numeric' })}
        </span>
        <Button size="icon-xs" variant="ghost" aria-label={t('Previous month')} onClick={() => setBrowsed({ month: shiftMonth(month, -1), forDay: day })}><ChevronLeft size={14} /></Button>
        <Button size="icon-xs" variant="ghost" aria-label={t('Next month')} onClick={() => setBrowsed({ month: shiftMonth(month, 1), forDay: day })}><ChevronRight size={14} /></Button>
      </div>
      <div aria-label={monthDate.toLocaleDateString(locale, { month: 'long', year: 'numeric' })} className="mt-1 grid grid-cols-7 gap-y-0.5 px-1">
        {weekdayLabels.map((label, i) => (
          <span key={i} aria-hidden="true" className="text-center text-[10px] font-medium text-muted-foreground/70">{label}</span>
        ))}
        {days.map(value => {
          const inMonth = monthOf(value) === month;
          const isToday = value === today;
          const selected = value === day;
          return (
            <button key={value} type="button" aria-pressed={selected} aria-current={isToday ? 'date' : undefined}
              aria-label={parseDateOnly(value)!.toLocaleDateString(locale, { month: 'long', day: 'numeric' })}
              onClick={() => setCalendarDay(value)}
              className={`mx-auto flex h-6 w-6 items-center justify-center rounded-full pt-0.5 text-[11px] leading-none tabular-nums transition-colors ${
                isToday ? 'bg-[var(--accent-default)] font-semibold text-primary-foreground'
                : selected ? 'bg-sidebar-accent font-medium text-foreground'
                : inMonth ? 'text-foreground hover:bg-sidebar-accent/50'
                : 'text-muted-foreground/40 hover:bg-sidebar-accent/50'
              }`}>
              {parseDateOnly(value)!.getDate()}
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex h-6 items-center gap-1 px-2">
        <h2 className="flex-1 text-[12px] font-medium text-muted-foreground/80">{t('People')}</h2>
        {people.some(worker => hidden.includes(worker.id)) && <Button size="xs" variant="ghost" onClick={showAllCalendarWorkers}>{t('Show all')}</Button>}
      </div>
      {people.length === 0 && <p className="px-2 py-1 text-[12px] text-muted-foreground">{t('No one is scheduled here.')}</p>}
      <ul className="mt-1 space-y-0.5">
        {people.map(worker => {
          const shown = !hidden.includes(worker.id);
          return (
            <li key={worker.id}>
              <button type="button" role="switch" aria-checked={shown} onClick={() => setCalendarWorkerHidden(worker.id, shown)}
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] transition-colors hover:bg-sidebar-accent/50 ${shown ? 'text-foreground' : 'text-muted-foreground'}`}>
                <WorkerAvatar worker={worker} size={18} className={shown ? undefined : 'opacity-50'} />
                <span className="min-w-0 flex-1 truncate">{worker.name}</span>
                <span className={`flex h-4 w-4 items-center justify-center rounded border ${shown ? 'border-[var(--accent-default)] bg-[var(--accent-default)] text-primary-foreground' : 'border-border'}`} aria-hidden="true">
                  {shown && <Check size={11} />}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
