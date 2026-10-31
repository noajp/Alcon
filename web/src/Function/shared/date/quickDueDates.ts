import { addDays, startOfDay, toDateOnlyString } from '@/Function/shared/dateUtils';

// The days a due date is usually set to, one click each above the calendar:
// today, tomorrow, the start of next week, two weeks out.

export interface QuickDate {
  key: 'today' | 'tomorrow' | 'nextWeek' | 'twoWeeks';
  /** English source string for t(). */
  label: string;
  /** `yyyy-MM-dd`. */
  value: string;
}

/** Pure. The quick picks as of `now`; "next week" is the first day of the
 *  following week, by the viewer's week start (0 = Sunday, 1 = Monday …). */
export function quickDates(now: Date, weekStartsOn: number): QuickDate[] {
  const today = startOfDay(now);
  const untilNextWeek = ((weekStartsOn - today.getDay() + 7) % 7) || 7;
  return [
    { key: 'today', label: 'Today', value: toDateOnlyString(today) },
    { key: 'tomorrow', label: 'Tomorrow', value: toDateOnlyString(addDays(today, 1)) },
    { key: 'nextWeek', label: 'Next week', value: toDateOnlyString(addDays(today, untilNextWeek)) },
    { key: 'twoWeeks', label: 'In 2 weeks', value: toDateOnlyString(addDays(today, 14)) },
  ];
}
