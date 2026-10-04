import { describe, expect, it } from 'vitest';
import { partitionAssignable, withCurrentWorkers } from '@/Function/shared/assignableWorkers';

const w = (id: string, name = id) => ({ id, name });

describe('partitionAssignable', () => {
  it('keeps the ids the candidate list allows, in order, and reports the rest', () => {
    const r = partitionAssignable(['b', 'x', 'a', 'y'], [w('a'), w('b')]);
    expect(r).toEqual({ assignable: ['b', 'a'], skipped: ['x', 'y'] });
  });

  it('drops duplicates and blanks', () => {
    const r = partitionAssignable(['a', '', 'a', 'x', 'x'], [w('a')]);
    expect(r).toEqual({ assignable: ['a'], skipped: ['x'] });
  });

  it('skips everything when nothing is assignable', () => {
    expect(partitionAssignable(['a', 'b'], [])).toEqual({ assignable: [], skipped: ['a', 'b'] });
  });

  it('is empty for an empty request', () => {
    expect(partitionAssignable([], [w('a')])).toEqual({ assignable: [], skipped: [] });
  });
});

describe('withCurrentWorkers', () => {
  it('appends current Workers missing from the candidates, once each', () => {
    const out = withCurrentWorkers([w('a'), w('b')], [w('x'), null, w('a'), undefined, w('x')]);
    expect(out.map((x) => x.id)).toEqual(['a', 'b', 'x']);
  });

  it('returns a copy of the candidates when nothing is missing', () => {
    const candidates = [w('a')];
    const out = withCurrentWorkers(candidates, [w('a')]);
    expect(out).toEqual(candidates);
    expect(out).not.toBe(candidates);
  });

  it('keeps the candidate object when ids collide', () => {
    const out = withCurrentWorkers([w('a', 'from list')], [w('a', 'stale')]);
    expect(out[0].name).toBe('from list');
  });
});
