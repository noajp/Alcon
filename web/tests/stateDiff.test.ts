import { describe, expect, it } from 'vitest';

const sd = await import(new URL('../../supabase/functions/_shared/stateDiff.ts', import.meta.url).pathname);

// The diff primitive (B2): field equality between what a write intended
// and what a read-back found — the whole of the check, by design.

describe('diffExpect', () => {
  it('finds nothing when the read-back carries what was intended', () => {
    expect(sd.diffExpect({ title: 'A', n: 2 }, { title: 'A', n: 2, extra: 'ignored' })).toEqual([]);
  });

  it('names each field that disagrees, with intended and found', () => {
    expect(sd.diffExpect({ title: 'A', branch: 'feat' }, { title: 'B' })).toEqual([
      { field: 'title', expected: 'A', actual: 'B' },
      { field: 'branch', expected: 'feat', actual: undefined },
    ]);
  });

  it('compares nested values by content, not identity or key order', () => {
    expect(sd.diffExpect({ head: { ref: 'x', sha: '1' } }, { head: { sha: '1', ref: 'x' } })).toEqual([]);
    expect(sd.diffExpect({ tags: ['a', 'b'] }, { tags: ['a', 'c'] })).toEqual([
      { field: 'tags', expected: ['a', 'b'], actual: ['a', 'c'] },
    ]);
  });

  it('keeps a missing field distinct from a present null', () => {
    expect(sd.diffExpect({ a: null }, {})).toEqual([{ field: 'a', expected: null, actual: undefined }]);
    expect(sd.diffExpect({ a: null }, { a: null })).toEqual([]);
  });
});

describe('stateOfResult', () => {
  it('reads a JSON object as the state itself', () => {
    expect(sd.stateOfResult('{"number": 7, "state": "open"}')).toEqual({ number: 7, state: 'open' });
  });

  it('stands a bare payload as the content (a file read back raw)', () => {
    expect(sd.stateOfResult('# Hello\n')).toEqual({ content: '# Hello\n' });
  });

  it('carries no state for an empty or non-object answer', () => {
    expect(sd.stateOfResult('')).toEqual({});
    expect(sd.stateOfResult('[1,2]')).toEqual({ content: '[1,2]' });
  });
});
