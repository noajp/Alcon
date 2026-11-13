// How near a bar is to the date it is due by — the deadline, or the next
// milestone of its Object — as a number from 0 (far, or nothing set) to 1
// (due today or past). The Timeline tints a bar that is not finished with a
// faint red of that strength, so the work that is running out of time is
// seen without reading a date.

/** Days before a date at which a bar starts to warm. */
export const URGENCY_DAYS = 14;

/**
 * Pure. The strength of the warning for `daysLeft` whole days to go
 * (negative: already past). Nothing until `URGENCY_DAYS` out, then a
 * straight line up to 1 on the day itself.
 */
export function deadlineUrgency(daysLeft: number | null): number {
  if (daysLeft === null || !Number.isFinite(daysLeft)) return 0;
  if (daysLeft >= URGENCY_DAYS) return 0;
  if (daysLeft <= 0) return 1;
  return 1 - daysLeft / URGENCY_DAYS;
}

/**
 * Pure. Whole days to the date a bar is measured against: the soonest of its
 * deadline and its milestones that is today or later; when every date is past,
 * the latest of them (so a bar that has run out of road reads as late).
 * Null when it has no date at all. `today` and the dates are 'YYYY-MM-DD'.
 */
export function daysToNextDate(today: string, dates: readonly (string | null | undefined)[]): number | null {
  const days = dates
    .filter((d): d is string => !!d)
    .map((d) => Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000))
    .filter((n) => Number.isFinite(n));
  if (days.length === 0) return null;
  const upcoming = days.filter((n) => n >= 0);
  return upcoming.length > 0 ? Math.min(...upcoming) : Math.max(...days);
}

/** Pure. A finished or set-aside bar is not warned about. */
export function warnsAboutTime(status: string | null | undefined): boolean {
  return status !== 'done' && status !== 'cancelled';
}
