import { describe, expect, it } from 'vitest';

const dr = await import(new URL('../../supabase/functions/_shared/definitionResolution.ts', import.meta.url).pathname);

const on = (id: string, name = id) => ({ id, name, enabled: true });
const off = (id: string, name = id) => ({ id, name, enabled: false });

describe('resolveDefinition', () => {
  it('the first enabled candidate wins', () => {
    expect(dr.resolveDefinition([on('a'), on('b')])).toEqual({ id: 'a', skippedDisabled: [] });
  });

  it('disabled candidates before the winner are reported by name; later ones are not', () => {
    expect(dr.resolveDefinition([off('a', 'Alpha'), null, off('b', 'Beta'), on('c'), off('d', 'Delta')]))
      .toEqual({ id: 'c', skippedDisabled: ['Alpha', 'Beta'] });
  });

  it('an all-disabled chain resolves to nothing, with every skip named', () => {
    expect(dr.resolveDefinition([off('a', 'Alpha'), off('b', 'Beta')]))
      .toEqual({ id: null, skippedDisabled: ['Alpha', 'Beta'] });
  });

  it('empty slots are skipped silently', () => {
    expect(dr.resolveDefinition([null, undefined, on('b')])).toEqual({ id: 'b', skippedDisabled: [] });
    expect(dr.resolveDefinition([])).toEqual({ id: null, skippedDisabled: [] });
    expect(dr.resolveDefinition([null, undefined])).toEqual({ id: null, skippedDisabled: [] });
  });
});

describe('usableDefinition', () => {
  it('passes an enabled row through', () => {
    const row = { id: 'a', enabled: true };
    expect(dr.usableDefinition(row)).toBe(row);
  });

  it('rejects a disabled row and a missing one', () => {
    expect(dr.usableDefinition({ id: 'a', enabled: false })).toBeNull();
    expect(dr.usableDefinition(null)).toBeNull();
  });
});
