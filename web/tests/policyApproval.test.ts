import { describe, expect, it } from 'vitest';

// A policy approval is what the Space's free mode leaves behind instead
// of a person's decision (_shared/policyApproval.ts): the same row shape
// an approval carries, marked as the policy's. These tests pin the
// shape, the settle, and the ask mode's one display rule — nothing is
// offered as rememberable when every write asks again anyway.

const pa = await import(new URL('../../supabase/functions/_shared/policyApproval.ts', import.meta.url).pathname);

const call = { id: 'c1', name: 'ext__send', input: { to: 'a@example.com' } };
const display = {
  id: 'c1', integration: 'Mail', operation: 'send', destination: 'a@example.com',
  detail: null, effect: 'write', critical: 'send', rememberable: false,
};

describe('policyApprovalInsert', () => {
  it("is a person's approval row in shape, marked as the policy's", () => {
    const row = pa.policyApprovalInsert({
      runId: 'r1', elementId: 'e1', call, display, inputHash: 'h1', mode: 'free',
      integrationId: 'i1', decidedAt: '2026-11-08T00:00:00.000Z',
    }) as Record<string, unknown>;
    expect(row.run_id).toBe('r1');
    expect(row.element_id).toBe('e1');
    expect(row.tool).toBe('ext__send');
    expect(row.tool_use_id).toBe('c1');
    expect(row.input).toEqual({ calls: [call], display: [display] });
    expect(row.input_hash).toBe('h1');
    expect(row.summary).toContain('Mail');
    expect(row.integration_id).toBe('i1');
    expect(row.status).toBe('approved');
    expect(row.decision_source).toBe('policy');
    expect(row.policy_mode).toBe('free');
    expect(row.decided_at).toBe('2026-11-08T00:00:00.000Z');
    // Nobody decided it: the decider columns stay empty, as a person's
    // row fills them.
    expect(row.decided_by).toBeUndefined();
  });

  it('allows no Element (a Copilot policy approval)', () => {
    const row = pa.policyApprovalInsert({
      runId: 'r1', elementId: null, call, display, inputHash: 'h1', mode: 'free',
      integrationId: null, decidedAt: '2026-11-08T00:00:00.000Z',
    }) as Record<string, unknown>;
    expect(row.element_id).toBeNull();
  });
});

// A chainable fake for agent_actions: insert answers a row id, updates
// are recorded with the filters they were scoped by.
function fakeAdmin() {
  const inserted: Record<string, unknown>[] = [];
  const updates: { patch: Record<string, unknown>; filters: [string, unknown][] }[] = [];
  const chain = () => {
    const filters: [string, unknown][] = [];
    const c: Record<string, unknown> = {
      insert: (row: Record<string, unknown>) => { inserted.push(row); return c; },
      update: (patch: Record<string, unknown>) => { updates.push({ patch, filters }); return c; },
      select: () => c,
      eq: (k: string, v: unknown) => { filters.push([k, v]); return c; },
      single: async () => ({ data: { id: 'a1' }, error: null }),
      then: (resolve: (v: { data: null; error: null }) => void) => resolve({ data: null, error: null }),
    };
    return c;
  };
  return { admin: { from: () => chain() }, inserted, updates };
}

describe('record and settle', () => {
  it('records as approved-by-policy, then settles to the outcome', async () => {
    const { admin, inserted, updates } = fakeAdmin();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const id = await pa.recordPolicyApproval(admin as any, {
      runId: 'r1', elementId: 'e1', call, display, mode: 'free', integrationId: 'i1',
    });
    expect(id).toBe('a1');
    expect(inserted).toHaveLength(1);
    expect(inserted[0].decision_source).toBe('policy');
    expect(typeof inserted[0].input_hash).toBe('string');
    expect((inserted[0].input_hash as string).length).toBe(64);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await pa.settlePolicyApproval(admin as any, 'a1', true);
    expect(updates[0].patch).toEqual({ status: 'executed', result: { failed: 0, total: 1 } });
    expect(updates[0].filters).toContainEqual(['status', 'approved']);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await pa.settlePolicyApproval(admin as any, 'a1', false);
    expect(updates[1].patch).toEqual({ status: 'failed', result: { failed: 1, total: 1 } });
  });
});

describe('displaysUnderMode', () => {
  it('the ask mode offers nothing as rememberable, without mutating the built displays', () => {
    const built = [{ ...display, rememberable: true }, { ...display, id: 'c2', rememberable: true }];
    const shown = pa.displaysUnderMode(built, 'ask');
    expect(shown.map((d: { rememberable: boolean }) => d.rememberable)).toEqual([false, false]);
    expect(built[0].rememberable).toBe(true);
  });

  it('auto and free keep the displays exactly as built', () => {
    const built = [{ ...display, rememberable: true }];
    expect(pa.displaysUnderMode(built, 'auto')).toBe(built);
    expect(pa.displaysUnderMode(built, 'free')).toBe(built);
  });
});
