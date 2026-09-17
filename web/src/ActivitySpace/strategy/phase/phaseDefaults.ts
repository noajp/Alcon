import type { DomainPhaseDefaults } from '@/types/database';

// How Settings > Strategy > Phase seeds a new Phase's dates. Pure, so the
// rule is testable: `length_days` spans the Phase with its end_date
// inclusive (a 14-day Phase starting on the 1st ends on the 14th); `start`
// is today or the day after the Domain's last dated Phase. Without
// length_days nothing is seeded and the dialog starts empty, as before.

export const PHASE_DEFAULTS_MAX = { length_days: 3650 } as const;

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
    ? addDays(lastPhaseEnd, 1)
    : today;
  return { start, end: addDays(start, length - 1) };
}

/** The latest end_date among the Domain's Phases, or null when none is dated. */
export function lastPhaseEndOf(phases: { end_date: string | null }[]): string | null {
  let last: string | null = null;
  for (const p of phases) if (p.end_date && (!last || p.end_date > last)) last = p.end_date;
  return last;
}

export function todayKey(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function addDays(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number);
  return todayKey(new Date(y, m - 1, d + days));
}
