// How the % arrows move progress: coarse while there is a long way to go,
// finer near the end — 5% up to 80%, 2% from 80% to 90%, 1% from 90%. A
// value between steps lands on the next step in the arrow's direction.

/** Pure. The progress one step up (+1) or down (-1) from `pct`, within 0–100. */
export function stepProgress(pct: number, dir: 1 | -1): number {
  const p = Math.max(0, Math.min(100, Math.round(pct)));
  if (dir === 1) {
    if (p < 80) return Math.min(80, Math.floor(p / 5) * 5 + 5);
    if (p < 90) return Math.min(90, p + 2);
    return Math.min(100, p + 1);
  }
  if (p > 90) return p - 1;
  if (p > 80) return Math.max(80, p - 2);
  return Math.max(0, Math.ceil(p / 5) * 5 - 5);
}
