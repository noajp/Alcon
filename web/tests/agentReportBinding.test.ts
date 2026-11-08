import { describe, expect, it } from 'vitest';

// Write-back binding: a run's report acts on agent_runs.element_id,
// bound by the driver — never on a fresh string resolution under the
// tool session's RLS view. The regression pair from the design:
//   H1 — the session's view of elements is empty (the run was started
//        from another context; every resolve returns null) while the
//        write policies still address rows by id: unbound, the report
//        fails "Element not found"; bound, it lands.
//   H2 — the model supplied an identifier that was never the Element's:
//        a disagreeing UUID is an error the model can correct, and an
//        unbound failure records { idArg, stage, user } for audit.

const report = await import(new URL('../../supabase/functions/_shared/agentReportTools.ts', import.meta.url).pathname) as unknown as {
  runAgentReportTool: (db: unknown, name: string, input: Record<string, unknown>, actor: { agent: string; userId: string }, notify?: unknown, binding?: { elementId?: string | null; onResolveFailure?: (f: { idArg: string; stage: string; userId: string | null }) => void }) => Promise<{ ok: boolean; error?: string; data?: Record<string, unknown> }>;
};
const board = await import(new URL('../../supabase/functions/_shared/boardTools.ts', import.meta.url).pathname) as unknown as {
  resolveElementIdTraced: (db: unknown, idArg: string) => Promise<{ id: string | null; stage: string }>;
};

const EL = '93fb2fb0-a7a1-434e-9211-af4db709a247';
const OTHER = '11111111-2222-4333-8444-555555555555';
const USER = '1a2b3c4d-0000-0000-0000-000000000000';
const actor = { agent: 'Athena', userId: USER };

type Row = Record<string, unknown>;

/**
 * A session with a split view, as H1 describes: `visible` gates what
 * elements SELECTs can see (the resolver reads through it); writes by
 * exact id and comment inserts still land — the write policies are not
 * the read view, which is exactly why binding the id is the fix.
 */
function fakeDb(opts: { visible: Set<string> }) {
  const elements: Row[] = [{ id: EL, display_id: 'ELE_SO-001', status: 'in_progress', title: 'Smoke', claimed_by: null, claim_expires_at: null, branch: null }];
  const comments: Row[] = [];
  const activity: Row[] = [];
  function from(table: string) {
    const filters: ((r: Row) => boolean)[] = [];
    let pending: { op: 'insert' | 'update'; row: Row } | null = null;
    const source = table === 'elements' ? elements : table === 'element_comments' ? comments : activity;
    const gated = table === 'elements' ? source.filter((r) => opts.visible.has(String(r.id))) : source;
    const run = () => {
      if (pending?.op === 'insert') {
        const row = { id: `new-${comments.length + activity.length}`, ...pending.row };
        source.push(row);
        return [row];
      }
      const hit = gated.filter((r) => filters.every((f) => f(r)));
      if (pending?.op === 'update') {
        // A write addresses its row by id directly, view or no view.
        const target = source.filter((r) => filters.every((f) => f(r)));
        for (const r of target) Object.assign(r, pending.row);
        return target;
      }
      return hit;
    };
    const q: Record<string, unknown> = {
      select: () => q,
      insert: (row: Row) => { pending = { op: 'insert', row }; return q; },
      update: (row: Row) => { pending = { op: 'update', row }; return q; },
      eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return q; },
      in: (k: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[k])); return q; },
      ilike: (k: string, pat: string) => {
        const suffix = pat.replace(/^%/, '');
        filters.push((r) => String(r[k] ?? '').endsWith(suffix));
        return q;
      },
      limit: () => q,
      maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
      single: async () => {
        const [row] = run();
        return row ? { data: row, error: null } : { data: null, error: { message: 'no row' } };
      },
      then: (resolve: (v: { data: Row[]; error: null }) => unknown) => resolve({ data: run(), error: null }),
    };
    return q;
  }
  async function rpc(fn: string, args: Row) {
    const el = elements.find((r) => r.id === args.p_element_id);
    if (!el) return { data: false, error: null };
    if (fn === 'claim_element') { el.claimed_by = args.p_holder; return { data: true, error: null }; }
    if (fn === 'release_element') { el.claimed_by = null; return { data: true, error: null }; }
    return { data: null, error: { message: `unknown rpc ${fn}` } };
  }
  return { db: { from, rpc } as never, elements, comments };
}

const blind = () => fakeDb({ visible: new Set<string>() });
const seeing = () => fakeDb({ visible: new Set([EL]) });

describe('the bound report path (H1: a session that cannot see the Element)', () => {
  it('reportOutcome lands its status move and comment on the bound id', async () => {
    const f = blind();
    const r = await report.runAgentReportTool(f.db, 'reportOutcome',
      { elementId: EL, outcome: 'completed', summary: 'できた', message: 'PR を作りました' },
      actor, undefined, { elementId: EL });
    expect(r.ok).toBe(true);
    expect(f.elements[0].status).toBe('review');
    expect(f.comments).toHaveLength(1);
    expect(f.comments[0].element_id).toBe(EL);
    expect(String(f.comments[0].content)).toContain('できた');
  });

  it('logProgress lands on the bound id without resolving anything', async () => {
    const f = blind();
    const r = await report.runAgentReportTool(f.db, 'logProgress',
      { elementId: 'ELE_SO-001', title: '途中経過' }, actor, undefined, { elementId: EL });
    expect(r.ok).toBe(true);
    expect(f.comments[0].element_id).toBe(EL);
  });

  it('the same calls unbound fail exactly as the smoke run did — and now say why, to audit', async () => {
    const f = blind();
    const failures: { idArg: string; stage: string; userId: string | null }[] = [];
    const r = await report.runAgentReportTool(f.db, 'reportOutcome',
      { elementId: EL, outcome: 'completed', summary: 'できた', message: 'PR を作りました' },
      actor, undefined, { onResolveFailure: (x) => { failures.push(x); } });
    expect(r).toEqual({ ok: false, error: 'Element not found' });
    expect(failures).toEqual([{ idArg: EL, stage: 'uuid', userId: USER }]);
    expect(f.comments).toHaveLength(0);
  });
});

describe('a model-supplied identifier that disagrees with the binding (H2)', () => {
  it('a different UUID is a correctable error, and nothing is written', async () => {
    const f = seeing();
    const r = await report.runAgentReportTool(f.db, 'logProgress',
      { elementId: OTHER, title: '途中経過' }, actor, undefined, { elementId: EL });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('bound');
    expect(f.comments).toHaveLength(0);
  });

  it('a garbage non-UUID string never reaches the resolver: the bound id wins', async () => {
    const f = blind();
    const r = await report.runAgentReportTool(f.db, 'logProgress',
      { elementId: 'run-id-not-an-element', title: '途中経過' }, actor, undefined, { elementId: EL });
    expect(r.ok).toBe(true);
    expect(f.comments[0].element_id).toBe(EL);
  });
});

describe('the unbound path still resolves strings (conversational callers)', () => {
  it('a display id resolves and the report lands', async () => {
    const f = seeing();
    const r = await report.runAgentReportTool(f.db, 'logProgress',
      { elementId: 'ELE_SO-001', title: '途中経過' }, actor);
    expect(r.ok).toBe(true);
    expect(f.comments[0].element_id).toBe(EL);
  });
});

describe('resolveElementIdTraced — the stage a resolution reached', () => {
  it('uuid: a well-formed id the session cannot see dies at stage uuid', async () => {
    const f = blind();
    expect(await board.resolveElementIdTraced(f.db, EL)).toEqual({ id: null, stage: 'uuid' });
  });

  it('display: the stored spelling answers at stage display', async () => {
    const f = seeing();
    expect(await board.resolveElementIdTraced(f.db, 'ELE_SO-001')).toEqual({ id: EL, stage: 'display' });
  });

  it('display: an unknown display string dies at display (no sequence to try)', async () => {
    const f = seeing();
    expect(await board.resolveElementIdTraced(f.db, 'ELE_XX-999')).toEqual({ id: null, stage: 'display' });
  });

  it('sequence: a bare number falls through display to the sequence stage', async () => {
    const f = seeing();
    expect(await board.resolveElementIdTraced(f.db, '001')).toEqual({ id: EL, stage: 'sequence' });
    expect(await board.resolveElementIdTraced(f.db, '999')).toEqual({ id: null, stage: 'sequence' });
  });

  it('empty: no argument at all', async () => {
    const f = seeing();
    expect(await board.resolveElementIdTraced(f.db, '  ')).toEqual({ id: null, stage: 'empty' });
  });
});
