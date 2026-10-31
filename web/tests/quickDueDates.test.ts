import { describe, expect, it } from 'vitest';
import { quickDates } from '@/Function/shared/date/quickDueDates';

describe('quick due dates', () => {
  // Wednesday 2026-11-04, local time.
  const wed = new Date(2026, 10, 4, 15, 30);
  const values = (weekStartsOn: number) => Object.fromEntries(quickDates(wed, weekStartsOn).map((q) => [q.key, q.value]));

  it('offers today, tomorrow, next week and two weeks out as calendar days', () => {
    expect(values(1)).toEqual({ today: '2026-11-04', tomorrow: '2026-11-05', nextWeek: '2026-11-09', twoWeeks: '2026-11-18' });
  });

  it('starts next week on the viewer’s first day, and on the same weekday goes a full week ahead', () => {
    expect(values(0).nextWeek).toBe('2026-11-08');
    expect(values(3).nextWeek).toBe('2026-11-11');
  });
});
