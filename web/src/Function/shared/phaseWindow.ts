// Phase window — the single place that decides what a Phase's start_date and
// end_date mean as a span of time, so "does this land by the end" and "how
// wide is the chart" agree because they read the same two dates the same way.
//
// end_date is inclusive: the last calendar day of a Phase is a working day
// inside it, not the divider after it. This was already true in the code —
// twice, in two different representations, in two different files — and never
// written down. That is exactly how el_QLT-010 could reopen a decision that
// had in fact already been made: PhaseBurnup added one day to `end_date` to
// give the final day chart width, and InitiativeSituation's forecast counted
// `end_date` itself as a business day. Neither was wrong; neither knew about
// the other. Collecting the assumption here means changing it is one edit,
// not a search for every place it was silently repeated.
//
// One consequence worth stating plainly: under this reading, a Phase whose
// start_date equals its end_date is not malformed. It is a one-day Phase.
// "Sprint 1" on this board (2026-08-30 – 2026-08-30) is degenerate in scope —
// twenty-seven Elements is not a one-day sprint's worth of work — but that is
// an assignment problem, not a date problem, and this module has no opinion
// on it.

const DAY_MS = 24 * 60 * 60 * 1000;

/** 'YYYY-MM-DD' → local Date at midnight (no timezone drift on bare dates). */
export function parseYMD(s: string): Date {
  const [y, m, d] = s.split('T')[0].split('-').map(Number);
  return new Date(y, m - 1, d);
}

export type PhaseDates = { start_date: string | null; end_date: string | null };

/**
 * The Phase's span in epoch ms, with the end pushed to the end of its last
 * day — so a chart drawing [t0, t1) gives the final day its own width instead
 * of collapsing it to a single instant at midnight.
 *
 * Returns null for a Phase missing either date, or one whose end precedes its
 * start. Under inclusive end_date a same-day Phase is a valid one-day window,
 * not a zero-length one — t1 is always t0 plus at least one day whenever
 * start_date and end_date parse, so null here means genuinely malformed data,
 * not merely short.
 */
export function phaseWindowMs(phase: PhaseDates): { t0: number; t1: number } | null {
  if (!phase.start_date || !phase.end_date) return null;
  const t0 = parseYMD(phase.start_date).getTime();
  const t1 = parseYMD(phase.end_date).getTime() + DAY_MS;
  return t1 > t0 ? { t0, t1 } : null;
}

/** Business days in [from, to], inclusive of both ends. */
export function businessDaysBetween(from: Date, to: Date): number {
  if (to < from) return 0;
  let days = 0;
  const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const last = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  while (cursor <= last) {
    const d = cursor.getDay();
    if (d !== 0 && d !== 6) days += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

/**
 * Business days elapsed since the Phase opened, and remaining before it
 * closes, as of `now`.
 *
 * `end_date` counts as a working day (see the module note), so `remaining`
 * excludes today once today falls inside the window — "remaining" means days
 * still to come, not days including today.
 *
 * Returns null before the Phase has opened. There is no rate to speak of
 * before day one, and returning `{ elapsed: 0, remaining: N }` here would let
 * a caller's zero-sample guard answer a question that isn't really the same
 * one — "too early to have a pace" and "hasn't started yet" are different
 * facts and deserve different words.
 */
export function phaseElapsedRemaining(phase: PhaseDates, now: Date): { elapsed: number; remaining: number } | null {
  if (!phase.start_date || !phase.end_date) return null;
  const start = parseYMD(phase.start_date);
  const end = parseYMD(phase.end_date);
  if (now < start) return null;
  const elapsed = businessDaysBetween(start, now > end ? end : now);
  const remaining = now >= end ? 0 : businessDaysBetween(now, end) - 1;
  return { elapsed, remaining };
}
