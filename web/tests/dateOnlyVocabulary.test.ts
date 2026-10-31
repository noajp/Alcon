import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseDateOnly, toDateOnlyString, fromDateOnlyString, shiftDateOnly, dayNumberOf, dayNumberIfDate, dayIndexOf, dateOnlyFromDayIndex, isOverdue, daysUntil, daysOverdue } from '@/Function/shared/dateUtils';
import { STATUS, PRIORITY, STATUS_ORDER, PRIORITY_ORDER } from '@/shared/designTokens';
import { labelForStatus, labelForPriority, priorityWeight } from '@/Function/shared/listControls/types';

describe('date-only editor values', () => {
  it.each(['2026-03-08', '2026-11-01', '2024-02-29', '2026-12-31'])(
    'round trips %s as a local calendar day, including DST boundaries', (value) => {
      const date = parseDateOnly(value)!;
      expect(toDateOnlyString(date)).toBe(value);
      expect(date.getHours()).toBe(0);
      expect(date.getMinutes()).toBe(0);
    },
  );

  it.each([null, undefined, '', 'invalid', '2026-00-10', '2026-01-00'])(
    'preserves each caller’s empty sentinel for %s', (value) => {
      expect(parseDateOnly(value)).toBeUndefined();
      expect(parseDateOnly(value, null)).toBeNull();
    },
  );

  it('keeps the date portion of timestamp-backed values', () => {
    expect(toDateOnlyString(parseDateOnly('2026-09-05T23:50:00-07:00')!)).toBe('2026-09-05');
  });

  it('retains editor normalization and the stricter fixed-width reader contract', () => {
    expect(toDateOnlyString(parseDateOnly('2026-02-31')!)).toBe('2026-03-03');
    expect(toDateOnlyString(parseDateOnly('2026-2-3')!)).toBe('2026-02-03');
    expect(fromDateOnlyString('2026-2-3')).toBeNull();
  });
});

describe('Element vocabulary order and sorting weight', () => {
  it('includes every status and priority once so pickers cannot lose a value', () => {
    expect([...STATUS_ORDER].sort()).toEqual(Object.keys(STATUS).sort());
    expect([...PRIORITY_ORDER].sort()).toEqual(Object.keys(PRIORITY).sort());
  });

  it('retains lifecycle order and urgent-first priority options', () => {
    expect(STATUS_ORDER).toEqual(['backlog', 'todo', 'in_progress', 'review', 'done', 'cancelled', 'blocked']);
    expect(PRIORITY_ORDER).toEqual(['urgent', 'high', 'medium', 'low']);
    expect(PRIORITY_ORDER.map(priorityWeight)).toEqual([4, 3, 2, 1]);
    expect(priorityWeight(null)).toBe(0);
    expect(priorityWeight(undefined)).toBe(0);
  });

  it('makes list grouping labels agree with the canonical picker vocabulary', () => {
    expect(STATUS_ORDER.map(labelForStatus)).toEqual(['Backlog', 'To Do', 'In Progress', 'In Review', 'Done', 'Cancelled', 'Blocked']);
    expect(PRIORITY_ORDER.map(labelForPriority)).toEqual(['Urgent', 'High', 'Medium', 'Low']);
  });
});

describe('moving a calendar day', () => {
  it.each([
    ['2026-03-07', 1, '2026-03-08'],   // into DST, in every zone that shifts in March
    ['2026-11-01', -1, '2026-10-31'],  // out of it, and across a month end
    ['2026-12-31', 1, '2027-01-01'],   // across a year end
    ['2024-02-28', 1, '2024-02-29'],   // a leap day
    ['2026-09-08', 0, '2026-09-08'],   // no move is the same day
  ])('shifts %s by %i days to %s', (from, days, expected) => {
    expect(shiftDateOnly(from, days)).toBe(expected);
  });

  it('counts whole days between two calendar days, so a drag can be measured', () => {
    expect(dayNumberOf('2026-09-10') - dayNumberOf('2026-09-08')).toBe(2);
    expect(dayNumberOf('2026-03-09') - dayNumberOf('2026-03-07')).toBe(2);
    expect(dayNumberOf('2027-01-01') - dayNumberOf('2026-12-31')).toBe(1);
  });

  it('keeps the length of a range that is moved by both ends', () => {
    const start = '2026-09-01';
    const due = '2026-09-22';
    const shift = dayNumberOf('2026-09-15') - dayNumberOf('2026-09-08');
    const moved = { start: shiftDateOnly(start, shift), due: shiftDateOnly(due, shift) };
    expect(moved).toEqual({ start: '2026-09-08', due: '2026-09-29' });
    expect(dayNumberOf(moved.due) - dayNumberOf(moved.start)).toBe(dayNumberOf(due) - dayNumberOf(start));
  });
});

describe('due dates are calendar days', () => {
  afterEach(() => { vi.useRealTimers(); });
  // 2026-09-10 at 15:00 local — late enough that a UTC-midnight parse of the
  // due day would already lie in the past in any zone east of Greenwich.
  const now = () => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 8, 10, 15)); };

  it('is not overdue on the due day itself, and is the day after', () => {
    now();
    expect(isOverdue('2026-09-10')).toBe(false);
    expect(isOverdue('2026-09-09')).toBe(true);
    expect(isOverdue('2026-09-09', true)).toBe(false);
    expect(isOverdue(null)).toBe(false);
  });

  it('counts whole days either side of today', () => {
    now();
    expect(daysUntil('2026-09-10')).toBe(0);
    expect(daysUntil('2026-09-11')).toBe(1);
    expect(daysOverdue('2026-09-07')).toBe(3);
    expect(daysOverdue('2026-09-12')).toBe(0);
  });
});

describe('strict day indexes', () => {
  it('reads only real fixed-width days and round-trips them', () => {
    expect(dayIndexOf('2026-02-30')).toBeNull();
    expect(dayIndexOf('2026-2-3')).toBeNull();
    expect(dayIndexOf('2026-09-10T00:00:00Z')).toBeNull();
    expect(dayIndexOf(42)).toBeNull();
    const day = dayIndexOf('2024-02-29')!;
    expect(dateOnlyFromDayIndex(day + 1)).toBe('2024-03-01');
    expect(day).toBe(dayNumberOf('2024-02-29'));
  });

  it('reads the date part of a timestamp when asked to', () => {
    expect(dayNumberIfDate('2026-09-10T08:00:00Z')).toBe(dayNumberOf('2026-09-10'));
    expect(dayNumberIfDate('soon')).toBeNull();
  });
});
