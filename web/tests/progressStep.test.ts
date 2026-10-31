import { describe, expect, it } from 'vitest';
import { stepProgress } from '@/Function/shared/progressStep';

const walk = (from: number, dir: 1 | -1) => {
  const seen = [from];
  for (let p = from; ; ) { const n = stepProgress(p, dir); if (n === p) break; seen.push(n); p = n; }
  return seen;
};

describe('progress arrows', () => {
  it('step 5% to 80%, 2% to 90%, then 1% to 100%', () => {
    expect(walk(70, 1)).toEqual([70, 75, 80, 82, 84, 86, 88, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100]);
  });

  it('come back down the same steps', () => {
    expect(walk(93, -1)).toEqual([93, 92, 91, 90, 88, 86, 84, 82, 80, 75, 70, 65, 60, 55, 50, 45, 40, 35, 30, 25, 20, 15, 10, 5, 0]);
  });

  it('land a value between steps on the next step', () => {
    expect(stepProgress(33, 1)).toBe(35);
    expect(stepProgress(33, -1)).toBe(30);
    expect(stepProgress(83, 1)).toBe(85);
    expect(stepProgress(83, -1)).toBe(81);
  });
});
