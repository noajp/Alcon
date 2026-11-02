import { describe, expect, it } from 'vitest';
import type { PostgrestError } from '@supabase/supabase-js';
import { throwOnFailedWrites } from '@/hooks/writeResults';

const fail = { message: 'denied', code: '42501', details: '', hint: '', name: 'PostgrestError' } as PostgrestError;

describe('a batch of writes fails when any one of them did not land', () => {
  it('passes when every write returned its row', () => {
    expect(() => throwOnFailedWrites([{ error: null, data: [{ id: 'a' }] }, { error: null, data: [{ id: 'b' }] }], 'x')).not.toThrow();
  });
  it('throws the error a write resolved with', () => {
    expect(() => throwOnFailedWrites([{ error: null, data: [{ id: 'a' }] }, { error: fail, data: null }], 'x')).toThrow('denied');
  });
  it('throws when RLS refused a write, which matches no rows', () => {
    expect(() => throwOnFailedWrites([{ error: null, data: [] }], 'reorder')).toThrow(/reorder/);
    expect(() => throwOnFailedWrites([{ error: null, data: null }], 'reorder')).toThrow(/reorder/);
  });
  it('passes an empty batch', () => {
    expect(() => throwOnFailedWrites([], 'x')).not.toThrow();
  });
});
