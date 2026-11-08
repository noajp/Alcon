import { describe, expect, it } from 'vitest';

// The one budget formula every Athena driver judges by (run-agent/
// budget.ts), exercised against a fake service-role client: the Space's
// budget for a Space run, the person's own for a personal one, and the
// month's spend counted in the same scope, the run itself aside.
const budgetMod = await import(new URL('../../supabase/functions/run-agent/budget.ts', import.meta.url).pathname);

type Call = [string, ...unknown[]];

/** A chainable fake for the two reads loadRunBudget makes. Filter calls
 *  are recorded per table, so the scope it counted in can be asserted. */
function fakeAdmin(opts: { spaceBudget?: number | string | null; spent: { cost_usd: number | string }[] }) {
  const calls: Record<string, Call[]> = {};
  const chain = (table: string) => {
    const record = (name: string) => (...args: unknown[]) => {
      (calls[table] ??= []).push([name, ...args] as Call);
      return c;
    };
    const c: Record<string, unknown> = {
      select: record('select'), gte: record('gte'), neq: record('neq'),
      eq: record('eq'), is: record('is'),
      maybeSingle: async () => ({ data: table === 'activity_spaces' ? { ai_monthly_budget_usd: opts.spaceBudget ?? null } : null }),
      then: (resolve: (v: { data: unknown }) => void) => resolve({ data: table === 'agent_runs' ? opts.spent : null }),
    };
    return c;
  };
  return { admin: { from: (table: string) => chain(table) }, calls };
}

describe('loadRunBudget', () => {
  it('a Space run is judged by its Space’s budget and its Space’s month', async () => {
    const { admin, calls } = fakeAdmin({ spaceBudget: 50, spent: [{ cost_usd: 3 }, { cost_usd: '2.5' }, { cost_usd: 0 }] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await budgetMod.loadRunBudget(admin as any, { id: 'run-1', activity_space_id: 'space-1' }, 'user-1');
    expect(out).toEqual({ budget: 50, spentBefore: 5.5 });
    expect(calls.agent_runs).toContainEqual(['eq', 'activity_space_id', 'space-1']);
    expect(calls.agent_runs).toContainEqual(['neq', 'id', 'run-1']);
  });

  it('a Space that set no budget gets the standing default', async () => {
    const { admin } = fakeAdmin({ spaceBudget: null, spent: [] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await budgetMod.loadRunBudget(admin as any, { id: 'run-1', activity_space_id: 'space-1' }, 'user-1');
    expect(out.budget).toBe(20);
  });

  it('a personal run is judged by its starter’s own budget and month', async () => {
    const { admin, calls } = fakeAdmin({ spent: [{ cost_usd: 7 }] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await budgetMod.loadRunBudget(admin as any, { id: 'run-1', activity_space_id: null }, 'user-1');
    expect(out).toEqual({ budget: 20, spentBefore: 7 });
    expect(calls.agent_runs).toContainEqual(['is', 'activity_space_id', null]);
    expect(calls.agent_runs).toContainEqual(['eq', 'triggered_by', 'user-1']);
    expect(calls.activity_spaces).toBeUndefined();
  });
});
