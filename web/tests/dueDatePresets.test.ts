// The relative date ranges behind the due-date filter.
//
// These replaced two raw `<input type="date">`s that could only express a
// closed absolute interval. The arithmetic is worth pinning because every one
// of these ranges is a boundary case that is easy to get off by one day, and
// because the round trip matters: a range written by a preset must be
// recognised as that preset when the panel reopens, or the checkmark lies.

import { describe, expect, it } from 'vitest';

import {
  DUE_DATE_PRESETS,
  dueDateRangeFor,
  matchDueDatePreset,
} from '@/alcon/shared/date/dueDatePresets';

// A Wednesday, mid-month, in a 31-day month.
const WED = new Date(2026, 7, 12); // 2026-08-12

describe('dueDateRangeFor', () => {
  it('makes Overdue open-ended on the left and stop before today', () => {
    // Not `to: today` — an Element due today is not yet overdue.
    expect(dueDateRangeFor('overdue', WED)).toEqual({ from: null, to: '2026-08-11' });
  });

  it('makes Today a single day, not an open interval', () => {
    expect(dueDateRangeFor('today', WED)).toEqual({ from: '2026-08-12', to: '2026-08-12' });
  });

  it('starts the week on Monday regardless of where the browser thinks it is', () => {
    // Locale-derived week starts would give two people filtering the same board
    // different rows.
    expect(dueDateRangeFor('this_week', WED)).toEqual({ from: '2026-08-10', to: '2026-08-16' });
  });

  it('treats Sunday as the end of the week it closes, not the start of the next', () => {
    const sun = new Date(2026, 7, 16);
    expect(dueDateRangeFor('this_week', sun)).toEqual({ from: '2026-08-10', to: '2026-08-16' });
  });

  it('counts "next 7 days" inclusive of today', () => {
    // 7 days total, today through the 18th — not today plus 7 more.
    expect(dueDateRangeFor('next_7', WED)).toEqual({ from: '2026-08-12', to: '2026-08-18' });
  });

  it('rolls "next 30 days" across the month boundary', () => {
    expect(dueDateRangeFor('next_30', WED)).toEqual({ from: '2026-08-12', to: '2026-09-10' });
  });

  it('ends "this month" on the real last day of the month', () => {
    expect(dueDateRangeFor('this_month', WED)).toEqual({ from: '2026-08-01', to: '2026-08-31' });
    const feb = new Date(2028, 1, 3); // leap year
    expect(dueDateRangeFor('this_month', feb)).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });

  it('builds date-only strings in local time', () => {
    // `new Date('2026-08-12')` parses as UTC midnight, so west of Greenwich a
    // naive round trip lands on the 11th. Every range here is a calendar day.
    for (const { id } of DUE_DATE_PRESETS) {
      const { from, to } = dueDateRangeFor(id, WED);
      for (const v of [from, to]) {
        if (v !== null) expect(v).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });
});

describe('matchDueDatePreset', () => {
  it('recognises every preset it produced', () => {
    for (const { id } of DUE_DATE_PRESETS) {
      expect(matchDueDatePreset(dueDateRangeFor(id, WED), WED)).toBe(id);
    }
  });

  it('calls an unrecognised range custom rather than guessing', () => {
    expect(matchDueDatePreset({ from: '2026-08-03', to: '2026-08-27' }, WED)).toBeNull();
  });

  it('treats an empty range as no filter, not as a preset', () => {
    expect(matchDueDatePreset({ from: null, to: null }, WED)).toBeNull();
  });

  it('does not mistake a half-open range for Overdue', () => {
    // `to` alone with the wrong day is a custom range, and the panel must keep
    // its custom fields open rather than silently ticking a preset.
    expect(matchDueDatePreset({ from: null, to: '2026-08-12' }, WED)).toBeNull();
  });
});
