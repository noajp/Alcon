import { describe, expect, it, vi } from 'vitest';

// A failed run start, end to end at the data layer: the engine hand-off
// fails, the queued row is closed — and the failure's detail lands on
// the row's error column, readable, instead of being destroyed by a
// String() coercion into "[object Object]" (the smoke test's bug: the
// start failed and nobody could tell why, from any record).

interface FakeOpts { insertError?: unknown; invokeError?: unknown }

function makeFakeSupabase(opts: FakeOpts) {
  const updates: Record<string, unknown>[] = [];
  const row = {
    id: 'run-1', element_id: 'el-1', domain_id: null, worker_id: null, status: 'queued',
    created_at: new Date().toISOString(), triggered_by: 'user-1', verdict: null, proposed_readings: null,
  };
  const from = () => {
    let verb = '';
    // deno-lint-ignore no-explicit-any
    const b: any = {
      select: () => { if (!verb) verb = 'select'; return b; },
      insert: () => { verb = 'insert'; return b; },
      update: (payload: Record<string, unknown>) => { verb = 'update'; updates.push(payload); return b; },
      eq: () => b, in: () => b, order: () => b, limit: () => b,
      single: async () => (verb === 'insert'
        ? (opts.insertError ? { data: null, error: opts.insertError } : { data: row, error: null })
        : { data: row, error: null }),
      maybeSingle: async () => ({ data: null, error: null }),
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve(verb === 'select' ? { data: [], error: null } : { data: null, error: null }).then(onF, onR),
    };
    return b;
  };
  return {
    updates,
    supabase: {
      from,
      functions: { invoke: async () => ({ data: null, error: opts.invokeError ?? null }) },
    },
  };
}

let fake = makeFakeSupabase({});
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => (fake.supabase.from as (...a: unknown[]) => unknown)(...args),
    functions: { invoke: (...args: unknown[]) => fake.supabase.functions.invoke(...(args as [])) },
  },
  getCurrentUserId: async () => 'user-1',
}));

const { startElementRun } = await import('@/AIP/ai/agentData');

describe('startElementRun failure recording', () => {
  it('a failed hand-off closes the queued row with the engine’s message on it', async () => {
    fake = makeFakeSupabase({
      invokeError: {
        message: 'Edge Function returned a non-2xx status code',
        context: { json: async () => ({ error: 'GitHub は未接続です' }) },
      },
    });
    await expect(startElementRun('el-1')).resolves.toBe('failed');
    const closing = fake.updates.find((u) => u.status === 'cancelled');
    expect(closing).toBeDefined();
    expect(closing!.error).toBe('GitHub は未接続です');
    expect(String(closing!.error)).not.toContain('[object Object]');
  });

  it('an insert that throws a plain object still reads as a plain failure', async () => {
    fake = makeFakeSupabase({
      insertError: { message: 'row-level security', code: '42501', details: '', hint: '' },
    });
    await expect(startElementRun('el-1')).resolves.toBe('failed');
  });

  it('a clean hand-off starts', async () => {
    fake = makeFakeSupabase({});
    await expect(startElementRun('el-1')).resolves.toBe('started');
    expect(fake.updates.find((u) => u.status === 'cancelled')).toBeUndefined();
  });
});
