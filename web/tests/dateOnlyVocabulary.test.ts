import { describe, expect, it } from 'vitest';
import { parseDateOnly, toDateOnlyString, fromDateOnlyString } from '@/alcon/shared/dateUtils';
import { STATUS, PRIORITY, STATUS_ORDER, PRIORITY_ORDER } from '@/shared/designTokens';
import { labelForStatus, labelForPriority, priorityWeight } from '@/alcon/shared/listControls/types';

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
    expect(STATUS_ORDER).toEqual(['backlog', 'todo', 'in_progress', 'review', 'done', 'blocked', 'cancelled']);
    expect(PRIORITY_ORDER).toEqual(['urgent', 'high', 'medium', 'low']);
    expect(PRIORITY_ORDER.map(priorityWeight)).toEqual([4, 3, 2, 1]);
    expect(priorityWeight(null)).toBe(0);
    expect(priorityWeight(undefined)).toBe(0);
  });

  it('makes list grouping labels agree with the canonical picker vocabulary', () => {
    expect(STATUS_ORDER.map(labelForStatus)).toEqual(['Backlog', 'To Do', 'In Progress', 'In Review', 'Done', 'Blocked', 'Cancelled']);
    expect(PRIORITY_ORDER.map(labelForPriority)).toEqual(['Urgent', 'High', 'Medium', 'Low']);
  });
});
