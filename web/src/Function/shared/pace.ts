// How the work stands against its schedule, and the two colours that say so:
// the key blue when it is likely to make its date and the danger red when it is
// not. Shared by the Timeline's bars and the progress belts.

// The key blue and the danger red, lifted and made a little more vivid: laid
// over the bar's dark ground at their own values they go muddy. They stay the
// theme's hues; only their lightness and chroma move.
const lift = (token: string) => `oklch(from ${token} calc(l + 0.12) calc(c * 1.25) h)`;
const BLUE = lift('var(--accent-default)');
const RED = lift('var(--status-danger)');

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
  const elapsed = elapsedShare(start, due, today);
  if (elapsed === null) return 0;
  return Math.max(-1, Math.min(1, (Math.max(0, Math.min(100, progress)) / 100 - elapsed) / CERTAIN));
}

/**
 * Pure. The share (0–1) of the span from `start` through `due` that has gone by
 * at the end of `today`; null when there is no span to measure. All three are
 * 'YYYY-MM-DD'.
 */
export function elapsedShare(start: string | null | undefined, due: string | null | undefined, today: string): number | null {
  if (!start || !due) return null;
  const day = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86_400_000;
  const total = Math.round(day(due) - day(start)) + 1;
  if (!(total > 0)) return null;
  return Math.max(0, Math.min(total, Math.round(day(today) - day(start)) + 1)) / total;
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

/** Share of red held once a milestone has gone by. */
const PAST_MILESTONE = 50;

/** Pure. Finished and set-aside work is not painted. */
export function warnsAboutTime(status: string | null | undefined): boolean {
  return status !== 'done' && status !== 'cancelled';
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
  const strongest = 20 + 32 * k; // wash at today: 20% when unsure, 52% when sure
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
