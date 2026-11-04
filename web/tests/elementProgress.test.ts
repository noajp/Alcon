import { describe, expect, it } from 'vitest';
import { getElementProgress } from '@/Function/shared/ElementProgressMark';

const el = (over: Record<string, unknown>) => ({ id: 'e', status: 'in_progress', progress: null, ...over }) as never;

describe('Element progress', () => {
  it('uses the typed %, and Done is always 100', () => {
    expect(getElementProgress(el({ progress: 40 }))).toBe(40);
    expect(getElementProgress(el({ status: 'done', progress: 10 }))).toBe(100);
  });

  it('is 0 with no % typed', () => {
    expect(getElementProgress(el({}))).toBe(0);
  });
});
