// The colour a Timeline bar takes on while its work is unfinished. A bar is
// clear where it starts and, along its length toward the date it is measured
// against — the soonest of its deadline and its Object's milestones — takes
// on a pale blue when the work looks likely to make it and a pale red when it
// does not, the deeper the surer. What lies beyond that date is red. Only the
// colour of the bar changes; its place and size are the schedule's.

const BLUE = 'var(--accent-default)';
const RED = 'var(--status-danger)';

/**
 * How far ahead or behind the schedule the work stands, in points of progress,
 * that counts as certain: ahead by this much reads as fully blue, behind by it
 * as fully red.
 */
const CERTAIN = 0.3;

/**
 * Pure. How likely the work is to make its date, from -1 (surely not) through
 * 0 (cannot tell) to +1 (surely): its progress (0–100) against the share of
 * its span that has gone by, (progress − elapsed) / CERTAIN, held to -1…1.
 * Before it starts nothing is expected, so progress alone reads ahead; with no
 * start and due to measure a span by it cannot be judged, and reads 0.
 * `start`, `due` and `today` are 'YYYY-MM-DD'.
 */
export function outlook(progress: number, start: string | null | undefined, due: string | null | undefined, today: string): number {
  if (!start || !due) return 0;
  const day = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86_400_000;
  const total = Math.round(day(due) - day(start)) + 1;
  if (!(total > 0)) return 0;
  const elapsed = Math.max(0, Math.min(total, Math.round(day(today) - day(start)) + 1)) / total;
  return Math.max(-1, Math.min(1, (Math.max(0, Math.min(100, progress)) / 100 - elapsed) / CERTAIN));
}

/** Pure. A finished or set-aside bar is not painted. */
export function warnsAboutTime(status: string | null | undefined): boolean {
  return status !== 'done' && status !== 'cancelled';
}

/** Pure. The date a bar is measured against: the soonest of those given.
 *  Null when it has none. Dates are 'YYYY-MM-DD', so they order as text. */
export function firstDeadline(dates: readonly (string | null | undefined)[]): string | null {
  const set = dates.filter((d): d is string => !!d).sort();
  return set[0] ?? null;
}

/** Share of red held beyond the date. */
const BEYOND = 45;

/**
 * Pure. The CSS gradient for a bar `width` px wide whose date falls `at` px
 * from its left edge, for an `outlook` of -1…1. Clear at the start, it deepens
 * smoothly toward the date in blue (outlook above 0) or red (below), the wash
 * at the date following how sure the outlook is; the ramp is eased, so the
 * start of the bar stays clear a good while. At `at` the red steps up and
 * holds to the bar's end; when `at` is the bar's end there is no beyond, only
 * the ramp.
 */
export function warmthGradient(at: number, width: number, outlookValue = 0): string {
  const x = Math.max(0, Math.min(width, at));
  const tone = outlookValue >= 0 ? BLUE : RED;
  const k = Math.abs(Math.max(-1, Math.min(1, outlookValue)));
  const strongest = 8 + 27 * k; // wash at the date: faint when unsure, 35% when sure
  const STEPS = 8;
  const stops = Array.from({ length: STEPS + 1 }, (_, i) => {
    const f = i / STEPS;
    const alpha = strongest * Math.pow(f, 2.2);
    return `color-mix(in oklab, ${tone} ${alpha.toFixed(1)}%, transparent) ${(x * f).toFixed(1)}px`;
  });
  if (x < width) stops.push(`color-mix(in oklab, ${RED} ${BEYOND}%, transparent) ${x.toFixed(1)}px`);
  return `linear-gradient(to right, ${stops.join(', ')})`;
}
