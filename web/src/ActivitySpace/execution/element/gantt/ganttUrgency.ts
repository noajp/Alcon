// The colour an Object's bar on the Timeline takes on while its work is
// unfinished, worked out from the schedule as it actually stands. The bar is
// clear where it starts. Along the stretch that has really gone by — from its
// start to today — it takes on a pale blue when the work is keeping pace with
// the schedule and a pale red when it is falling behind, deepening toward
// today, the deeper the surer. From the first milestone on, what has gone by
// is red. What is still to come is left clear. Only the colour of the bar
// changes; its place and size are the schedule's.

const BLUE = 'var(--accent-default)';
const RED = 'var(--status-danger)';

/**
 * How far ahead or behind the schedule the work stands, in points of progress,
 * that counts as certain: ahead by this much reads as fully blue, behind by it
 * as fully red.
 */
const CERTAIN = 0.3;

/** Share of red held once a milestone has gone by. */
const PAST_MILESTONE = 40;

/** Pure. Finished and set-aside work is not painted. */
export function warnsAboutTime(status: string | null | undefined): boolean {
  return status !== 'done' && status !== 'cancelled';
}

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
 * Pure. The CSS gradient for a bar `width` px wide, or null when there is
 * nothing to paint. `nowX` is how far along it today falls (px from its left
 * edge); `milestoneX` where its first milestone falls, if it has one inside
 * the bar. Clear at the start, it deepens smoothly (an eased ramp, so the
 * start stays clear a good while) to today in blue or red by `outlookValue`
 * (-1…1); once a milestone has gone by, the colour moves over to red from it
 * to today. Beyond today it fades back to clear.
 */
export function warmthGradient(width: number, nowX: number, outlookValue: number, milestoneX: number | null = null): string | null {
  const now = Math.max(0, Math.min(width, nowX));
  if (!(now > 0) || !(width > 0)) return null;
  const tone = outlookValue >= 0 ? BLUE : RED;
  const k = Math.abs(Math.max(-1, Math.min(1, outlookValue)));
  const strongest = 14 + 26 * k; // wash at today: 14% when unsure, 40% when sure
  const mix = (color: string, pct: number) => `color-mix(in oklab, ${color} ${pct.toFixed(1)}%, transparent)`;
  const px = (n: number) => `${n.toFixed(1)}px`;

  // The milestone counts once it has gone by: it falls before today.
  const passedAt = milestoneX !== null && milestoneX > 0 && milestoneX < now ? milestoneX : null;
  const rampEnd = passedAt ?? now;
  const STEPS = 8;
  const stops: string[] = [];
  for (let i = 0; i <= STEPS; i++) {
    const f = i / STEPS;
    stops.push(`${mix(tone, strongest * Math.pow(f, 2.2))} ${px(rampEnd * f)}`);
  }
  let last = mix(tone, strongest);
  if (passedAt !== null) {
    // Over to red across a short stretch past the milestone, held to today.
    const over = Math.min(now - passedAt, Math.max(24, width * 0.08));
    last = mix(RED, PAST_MILESTONE);
    stops.push(`${last} ${px(passedAt + over)}`, `${last} ${px(now)}`);
  }
  if (now < width) stops.push(`transparent ${px(Math.min(width, now + Math.max(20, width * 0.06)))}`);
  return `linear-gradient(in oklab to right, ${stops.join(', ')})`;
}
