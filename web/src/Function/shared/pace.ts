// How the work stands against its schedule, and the two colours that say so:
// the key blue when it is likely to make its date and the danger red when it is
// not. Shared by the Timeline's bars and the progress belts.

// The key blue and the danger red, lifted and made a little more vivid: laid
// over the bar's dark ground at their own values they go muddy. They stay the
// theme's hues; only their lightness and chroma move.
const lift = (token: string) => `oklch(from ${token} calc(l + 0.12) calc(c * 1.25) h)`;
export const BLUE = lift('var(--accent-default)');
export const RED = lift('var(--status-danger)');

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


/**
 * Pure. A progress belt's fill as a CSS gradient across its own width: clear at
 * its start, deepening smoothly to its edge in the key blue when the work is
 * likely to make its date and in red when not, the deeper the surer. With no
 * schedule to judge by (`outlookValue` 0) it is blue.
 */
export function beltGradient(outlookValue: number): string {
  const tone = outlookValue >= 0 ? BLUE : RED;
  const k = Math.abs(Math.max(-1, Math.min(1, outlookValue)));
  const strongest = 50 + 35 * k;
  const STEPS = 8;
  const stops = Array.from({ length: STEPS + 1 }, (_, i) => {
    const f = i / STEPS;
    return `color-mix(in oklab, ${tone} ${(4 + (strongest - 4) * Math.pow(f, 1.6)).toFixed(1)}%, transparent) ${(f * 100).toFixed(1)}%`;
  });
  return `linear-gradient(in oklab to right, ${stops.join(', ')})`;
}
