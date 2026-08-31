// el_QLT-010. This module exists because the same assumption — end_date is
// inclusive — was written twice, in two different representations, in two
// different files, and never stated anywhere a third reader could find it.
// That is exactly how a decision that had already been made got reopened as
// if it were still open. These tests pin the assumption itself, not just the
// arithmetic built on it — the case that matters most is the one measured on
// the real board: a Phase whose start_date equals its end_date is a valid
// one-day window, not a malformed zero-length one.

import { describe, expect, it } from 'vitest';
import { businessDaysBetween, phaseElapsedRemaining, phaseWindowMs } from '@/alcon/shared/phaseWindow';

describe('phaseWindowMs', () => {
  it('gives the final day width instead of collapsing it to midnight', () => {
    const w = phaseWindowMs({ start_date: '2026-08-31', end_date: '2026-09-01' });
    expect(w).not.toBeNull();
    // Two calendar days → 2 * 24h of span, not 1.
    expect(w!.t1 - w!.t0).toBe(2 * 24 * 60 * 60 * 1000);
  });

  it('treats a same-day Phase as a valid one-day window, not a zero-length one', () => {
    // Measured on the real board: "Sprint 1" has start_date === end_date ===
    // 2026-08-30. Under inclusive end_date this is one day, not nothing.
    const w = phaseWindowMs({ start_date: '2026-08-30', end_date: '2026-08-30' });
    expect(w).not.toBeNull();
    expect(w!.t1 - w!.t0).toBe(24 * 60 * 60 * 1000);
  });

  it('rejects a Phase whose end precedes its start', () => {
    expect(phaseWindowMs({ start_date: '2026-09-05', end_date: '2026-09-01' })).toBeNull();
  });

  it('rejects a Phase missing either date', () => {
    expect(phaseWindowMs({ start_date: null, end_date: '2026-09-01' })).toBeNull();
    expect(phaseWindowMs({ start_date: '2026-09-01', end_date: null })).toBeNull();
  });
});

describe('businessDaysBetween', () => {
  it('counts both ends', () => {
    // Mon 2026-08-31 → Fri 2026-09-04: 5 weekdays.
    expect(businessDaysBetween(new Date(2026, 7, 31), new Date(2026, 8, 4))).toBe(5);
  });

  it('excludes weekends inside the range', () => {
    // Fri 2026-08-28 → Mon 2026-08-31 spans a weekend: only Fri and Mon count.
    expect(businessDaysBetween(new Date(2026, 7, 28), new Date(2026, 7, 31))).toBe(2);
  });

  it('is zero for a range that starts after it ends', () => {
    expect(businessDaysBetween(new Date(2026, 8, 4), new Date(2026, 7, 31))).toBe(0);
  });
});

describe('phaseElapsedRemaining', () => {
  it('returns null before the Phase has opened', () => {
    // Distinguishes "hasn't started" from "started but too early to have a
    // pace" — a caller that collapsed these into one zero would say the wrong
    // thing about a Phase that has not begun.
    const r = phaseElapsedRemaining(
      { start_date: '2026-09-10', end_date: '2026-09-20' },
      new Date(2026, 8, 5),
    );
    expect(r).toBeNull();
  });

  it('counts a same-day weekday Phase as one elapsed business day on its own day', () => {
    // A one-day Phase on a Tuesday, asked about on that Tuesday.
    const r = phaseElapsedRemaining(
      { start_date: '2026-09-01', end_date: '2026-09-01' },
      new Date(2026, 8, 1),
    );
    expect(r).toEqual({ elapsed: 1, remaining: 0 });
  });

  it('counts a same-day weekend Phase as zero elapsed business days', () => {
    // Measured: "Sprint 1" is 2026-08-30 (a Sunday) on both ends. It is a
    // real one-day window in wall-clock time, but zero business days — which
    // is exactly why the section reports it as overdue with a shortfall
    // rather than fabricating a pace out of a day nobody could have worked.
    const r = phaseElapsedRemaining(
      { start_date: '2026-08-30', end_date: '2026-08-30' },
      new Date(2026, 8, 2),
    );
    expect(r).toEqual({ elapsed: 0, remaining: 0 });
  });

  it('excludes today from "remaining" once the Phase is under way', () => {
    // Mon 2026-08-31 → Fri 2026-09-11 (two weeks), asked about on the second
    // Monday (2026-09-07): 6 elapsed business days (8/31–9/4, 9/7), and the
    // days still to come are 9/8–9/11 — four, not five. "Remaining" means
    // days still ahead, not days including today.
    const r = phaseElapsedRemaining(
      { start_date: '2026-08-31', end_date: '2026-09-11' },
      new Date(2026, 8, 7),
    );
    expect(r).toEqual({ elapsed: 6, remaining: 4 });
  });

  it('reports zero remaining once the end date has passed', () => {
    const r = phaseElapsedRemaining(
      { start_date: '2026-08-17', end_date: '2026-08-28' },
      new Date(2026, 8, 15),
    );
    expect(r!.remaining).toBe(0);
  });
});
