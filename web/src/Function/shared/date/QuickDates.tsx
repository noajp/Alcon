'use client';

import { quickDates } from './quickDueDates';
import { useI18n } from '@/Function/i18n/I18nProvider';

// The quick due dates (quickDueDates.ts) as chips above a calendar. Picking a
// day from the grid is for everything else.

/** The quick picks as a row of chips; `current` is marked. */
export function QuickDates({ weekStartsOn, current, onPick }: {
  weekStartsOn: number;
  current?: string | null;
  onPick: (value: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap gap-1 border-b border-border/60 p-2">
      {quickDates(new Date(), weekStartsOn).map((q) => (
        <button key={q.key} type="button" onClick={() => onPick(q.value)}
          className={`h-6 rounded-md px-2 text-[12px] transition-colors hover:bg-muted/60 hover:text-foreground ${q.value === current ? 'bg-muted/60 text-foreground' : 'text-muted-foreground'}`}>
          {t(q.label)}
        </button>
      ))}
    </div>
  );
}
