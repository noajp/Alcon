import { describe, expect, it } from 'vitest';
// Deno dependencies belong to the Edge runtime, not the web compiler graph.
const harness = await import(new URL('../../supabase/functions/_shared/harnessTools.ts', import.meta.url).pathname);
const catalog = await import(new URL('../../supabase/functions/_shared/catalog.ts', import.meta.url).pathname);
const { mcpTools } = await import(new URL('../../supabase/functions/clayware-mcp/tools.ts', import.meta.url).pathname);

const SPACE = '2c9f3b7b-7557-451b-92b0-9a4e7f396c27';
const HARNESS = '184df4d7-b91f-4c7c-9b6d-cc5130ae7346';
const GOOD = '# 目的\n問い合わせを、人がすぐ動ける仕事にする。\n\n# 止める条件\n- 返信は人が送る\n';
const NO_GOAL = '# 進め方\n1. 読む\n';

type Row = Record<string, unknown>;

/** definitions the caller can see and change; records every write. */
function definitionsDb(rows: Row[], opts: { canWrite?: boolean } = {}) {
  const writes: { op: string; row: Row }[] = [];
  const from = () => {
    const filters: ((r: Row) => boolean)[] = [];
    let pending: { op: string; row: Row } | null = null;
    const run = () => {
      if (pending?.op === 'insert') {
        const row = { id: 'new-id', ...pending.row };
        writes.push({ op: 'insert', row });
        return [row];
      }
      const hit = rows.filter((r) => filters.every((f) => f(r)));
      if (pending?.op === 'update') {
        if (opts.canWrite === false) return [];
        for (const r of hit) Object.assign(r, pending.row);
        writes.push({ op: 'update', row: pending.row });
      }
      return hit;
    };
    const q = {
      select: () => q,
      eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return q; },
      insert: (row: Row) => { pending = { op: 'insert', row }; return q; },
      update: (row: Row) => { pending = { op: 'update', row }; return q; },
      maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
      single: async () => ({ data: run()[0] ?? null, error: null }),
      then: (resolve: (v: { data: Row[]; error: null }) => unknown) => resolve({ data: run(), error: null }),
    };
    return q;
  };
  return { db: { from } as never, writes };
}

const actor = { agent: 'Claude (MCP · OAuth)', userId: 'user-1' };

describe('the save-time check', () => {
  it('refuses what the app editor refuses and reports the rest', () => {
    expect(harness.harnessSaveCheck(NO_GOAL).errors.map((d: { code: string }) => d.code)).toContain('H001');
    const ok = harness.harnessSaveCheck(GOOD);
    expect(ok.errors).toEqual([]);
    expect(ok.notes.every((d: { severity: string }) => d.severity !== 'error')).toBe(true);
  });
});

describe('createHarness', () => {
  it('saves a harness that passes the check, as the person', async () => {
    const { db, writes } = definitionsDb([]);
    const res = await harness.runHarnessTool(db, 'createHarness', { spaceId: SPACE, name: '問い合わせの受付', body: GOOD }, actor);
    expect(res).toMatchObject({ ok: true, data: { id: 'new-id', name: '問い合わせの受付' } });
    expect(writes).toHaveLength(1);
    expect(writes[0].row).toMatchObject({ activity_space_id: SPACE, name: '問い合わせの受付', body: GOOD, created_by: 'user-1' });
  });

  it('saves nothing when the check finds an error, and says how to fix it', async () => {
    const { db, writes } = definitionsDb([]);
    const res = await harness.runHarnessTool(db, 'createHarness', { spaceId: SPACE, name: 'x', body: NO_GOAL }, actor);
    expect(res.ok).toBe(false);
    expect(res.error).toContain('H001');
    expect(res.error).toContain('# 目的');
    expect(writes).toEqual([]);
  });
});

describe('updateHarness', () => {
  it('renames without touching the body', async () => {
    const rows = [{ id: HARNESS, name: '古い名前', body: GOOD }];
    const { db, writes } = definitionsDb(rows);
    const res = await harness.runHarnessTool(db, 'updateHarness', { id: HARNESS, name: '新しい名前' }, actor);
    expect(res).toMatchObject({ ok: true, data: { name: '新しい名前', previousName: '古い名前' } });
    expect(writes[0].row).toMatchObject({ name: '新しい名前' });
    expect(writes[0].row).not.toHaveProperty('body');
  });

  it('refuses a body that fails the check', async () => {
    const { db, writes } = definitionsDb([{ id: HARNESS, name: 'n', body: GOOD }]);
    const res = await harness.runHarnessTool(db, 'updateHarness', { id: HARNESS, body: NO_GOAL }, actor);
    expect(res.ok).toBe(false);
    expect(writes).toEqual([]);
  });

  it('says so when the person may not change it', async () => {
    const { db } = definitionsDb([{ id: HARNESS, name: 'n', body: GOOD }], { canWrite: false });
    expect(await harness.runHarnessTool(db, 'updateHarness', { id: HARNESS, name: 'x' }, actor)).toMatchObject({ ok: false, error: 'このハーネスを書き換える権限がありません' });
  });
});

describe('who may write a harness', () => {
  const d = (entry: string, name: string) => catalog.decideCall(entry, catalog.catalogTool(name), {});
  it('runs from the AI panel and an outside AI, waits for approval in an Element run, and is not a Strategy conversation’s', () => {
    for (const n of ['createHarness', 'updateHarness']) {
      expect(d('panel', n), n).toBe('allow');
      expect(d('external', n), n).toBe('allow');
      expect(d('element', n), n).toBe('approve');
      expect(d('conversation', n), n).toBe('deny');
    }
  });

  it('is offered over MCP, with an update marked as an overwrite', () => {
    const by = new Map(mcpTools().map((t: { name: string; annotations: { destructiveHint: boolean } }) => [t.name, t]));
    expect(by.get('createHarness')).toBeDefined();
    expect((by.get('updateHarness') as { annotations: { destructiveHint: boolean } }).annotations.destructiveHint).toBe(true);
  });
});
