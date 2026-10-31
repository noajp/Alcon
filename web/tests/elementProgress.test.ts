import { describe, expect, it } from 'vitest';
import { getElementProgress } from '@/Function/shared/ElementProgressMark';

const el = (over: Record<string, unknown>) => ({ id: 'e', status: 'in_progress', progress: null, subelements: [], ...over }) as never;
const subs = (...done: boolean[]) => done.map((is_completed, i) => ({ id: String(i), is_completed }));

describe('Element progress', () => {
  it('is the share of SubElements checked off when there are any', () => {
    expect(getElementProgress(el({ subelements: subs(true, false, false, false) }))).toBe(25);
  });

  it('follows the SubElements over a % typed earlier', () => {
    expect(getElementProgress(el({ progress: 80, subelements: subs(true, false) }))).toBe(50);
  });

  it('uses the typed % without SubElements, and Done is always 100', () => {
    expect(getElementProgress(el({ progress: 40 }))).toBe(40);
    expect(getElementProgress(el({ status: 'done', subelements: subs(false) }))).toBe(100);
  });
});
