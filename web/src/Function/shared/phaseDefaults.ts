import type { DomainPhaseDefaults } from '@/types/database';
import { shiftDateOnly, toDateOnlyString } from '@/Function/shared/dateUtils';

// How a Domain's phase_defaults seed a new Phase's dates. Pure, so the
// rule is testable: `length_days` spans the Phase with its end_date
// inclusive — the same reading of end_date as Function/shared/phaseWindow.ts
// (a 14-day Phase starting on the 1st ends on the 14th); `start` is today or
// the day after the Domain's last dated Phase. Without length_days nothing
// is seeded and the dialog starts empty, as before.

const PHASE_DEFAULTS_MAX = { length_days: 3650 } as const;

export function seedPhaseDates(
  defaults: DomainPhaseDefaults | null | undefined,
  lastPhaseEnd: string | null,
  today: string,
): { start: string; end: string } {
  const length = defaults?.length_days;
  if (!length || !Number.isInteger(length) || length < 1 || length > PHASE_DEFAULTS_MAX.length_days) {
    return { start: '', end: '' };
  }
  const start = defaults?.start === 'after_last' && lastPhaseEnd && lastPhaseEnd >= today
    ? shiftDateOnly(lastPhaseEnd, 1)
    : today;
  return { start, end: shiftDateOnly(start, length - 1) };
}

/** The latest end_date among the Domain's Phases, or null when none is dated. */
export function lastPhaseEndOf(phases: { end_date: string | null }[]): string | null {
  let last: string | null = null;
  for (const p of phases) if (p.end_date && (!last || p.end_date > last)) last = p.end_date;
  return last;
}

/** Today as a local date-only key ('YYYY-MM-DD'). */
export function todayKey(now = new Date()): string {
  return toDateOnlyString(now);
}
