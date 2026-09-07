import { describe, it, expect } from 'vitest';
import { completionOf, isOpenStatus } from '../src/alcon/shared/completion';

const s = (...statuses: (string | null)[]) => statuses.map((status) => ({ status }));

describe('completionOf', () => {
  it('leaves cancelled out of the denominator — the case that split the list from the page', () => {
    expect(completionOf(s('done', 'done', 'cancelled', 'todo'))).toEqual({ done: 2, total: 3, pct: 67 });
  });
  it('is 0 with total 0 for nothing to measure, so callers can tell empty from 0%', () => {
    expect(completionOf([])).toEqual({ done: 0, total: 0, pct: 0 });
    expect(completionOf(s('cancelled'))).toEqual({ done: 0, total: 0, pct: 0 });
  });
  it('counts a null status as open work', () => {
    expect(completionOf(s(null, 'done'))).toEqual({ done: 1, total: 2, pct: 50 });
  });
  it('rounds to the nearest whole percent', () => {
    expect(completionOf(s('done', 'todo', 'todo')).pct).toBe(33);
  });
});

describe('isOpenStatus', () => {
  it('agrees with completionOf about what is off the plate', () => {
    for (const st of ['done', 'cancelled']) expect(isOpenStatus(st)).toBe(false);
    expect(isOpenStatus('in_progress')).toBe(true);
    expect(isOpenStatus(null)).toBe(true);
  });
});
