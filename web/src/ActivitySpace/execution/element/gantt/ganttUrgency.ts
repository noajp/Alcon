// The colour an Object's bar on the Timeline takes on while its work is
// unfinished, worked out from the schedule as it actually stands. The bar is
// clear where it starts. Along the stretch that has really gone by — from its
// start to today — it takes on a pale blue when the work is keeping pace with
// the schedule and a pale red when it is falling behind, deepening toward
// today, the deeper the surer. From the first milestone on, what has gone by
// is red. What is still to come is left clear. Only the colour of the bar
// changes; its place and size are the schedule's.

import { BLUE, RED } from '@/Function/shared/pace';

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
