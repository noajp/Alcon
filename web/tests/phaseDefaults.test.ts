import { describe, expect, it } from 'vitest';
import { seedPhaseDates, lastPhaseEndOf } from '@/Function/shared/phaseDefaults';

describe('seedPhaseDates', () => {
  it('leaves the dates empty without a default length', () => {
    expect(seedPhaseDates({}, '2026-09-30', '2026-09-17')).toEqual({ start: '', end: '' });
    expect(seedPhaseDates(undefined, null, '2026-09-17')).toEqual({ start: '', end: '' });
    expect(seedPhaseDates({ length_days: 0 }, null, '2026-09-17')).toEqual({ start: '', end: '' });
    expect(seedPhaseDates({ length_days: 99999 }, null, '2026-09-17')).toEqual({ start: '', end: '' });
  });

  it('spans length_days with the end date inclusive, starting today', () => {
    expect(seedPhaseDates({ length_days: 14 }, null, '2026-09-01')).toEqual({ start: '2026-09-01', end: '2026-09-14' });
    expect(seedPhaseDates({ length_days: 1 }, null, '2026-09-17')).toEqual({ start: '2026-09-17', end: '2026-09-17' });
  });

  it('starts the day after the last Phase when asked and it is not in the past', () => {
    expect(seedPhaseDates({ length_days: 7, start: 'after_last' }, '2026-09-30', '2026-09-17'))
      .toEqual({ start: '2026-10-01', end: '2026-10-07' });
    // A last Phase that already ended is no anchor — fall back to today.
    expect(seedPhaseDates({ length_days: 7, start: 'after_last' }, '2026-09-10', '2026-09-17'))
      .toEqual({ start: '2026-09-17', end: '2026-09-23' });
    expect(seedPhaseDates({ length_days: 7, start: 'after_last' }, null, '2026-09-17'))
      .toEqual({ start: '2026-09-17', end: '2026-09-23' });
  });

  it('crosses month and year ends by the calendar', () => {
    expect(seedPhaseDates({ length_days: 10 }, null, '2026-12-28')).toEqual({ start: '2026-12-28', end: '2027-01-06' });
  });
});

describe('lastPhaseEndOf', () => {
  it('picks the latest dated end and ignores undated Phases', () => {
    expect(lastPhaseEndOf([{ end_date: '2026-03-31' }, { end_date: null }, { end_date: '2026-06-30' }])).toBe('2026-06-30');
    expect(lastPhaseEndOf([{ end_date: null }])).toBeNull();
    expect(lastPhaseEndOf([])).toBeNull();
  });
});
