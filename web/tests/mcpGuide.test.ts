import { describe, expect, it } from 'vitest';
// Deno dependencies belong to the Edge runtime, not the web compiler graph.
const guide = await import(new URL('../../supabase/functions/_shared/claywareGuide.ts', import.meta.url).pathname);
const board = await import(new URL('../../supabase/functions/_shared/boardTools.ts', import.meta.url).pathname);
const { mcpTools, mcpHost } = await import(new URL('../../supabase/functions/clayware-mcp/tools.ts', import.meta.url).pathname);
const { INSTRUCTIONS } = await import(new URL('../../supabase/functions/clayware-mcp/protocol.ts', import.meta.url).pathname);
const kinds = await import('../src/Function/shared/elementActionKinds');

const JUDGE = '93fb2fb0-a7a1-434e-9211-af4db709a247';
const WORK = '85c79ab0-fb76-4bf3-8a75-c5635880cb4f';

type Row = Record<string, unknown>;

/** Elements the caller can see; records whether any update reached the table. */
function elementsDb(rows: Row[]) {
  const updates: Row[] = [];
  const from = (table: string) => {
    const filters: ((r: Row) => boolean)[] = [];
    let pending: Row | null = null;
    const hit = () => (table === 'elements' ? rows : []).filter((r) => filters.every((f) => f(r)));
    const q = {
      select: () => q,
      eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return q; },
      in: (k: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[k])); return q; },
      limit: () => q,
      order: () => q,
      update: (row: Row) => { pending = row; return q; },
      maybeSingle: async () => ({ data: hit()[0] ?? null, error: null }),
      single: async () => {
        if (pending) updates.push(pending);
        return { data: hit()[0] ?? null, error: null };
      },
      then: (resolve: (v: { data: Row[]; error: null }) => unknown) => resolve({ data: hit(), error: null }),
    };
    return q;
  };
  return { db: { from } as never, updates };
}

const ROWS = () => [
  { id: JUDGE, title: '価格案を A と B から選ぶ', action: 'judge' },
  { id: WORK, title: '競合の価格を調べる', action: 'research' },
];

describe('the guide', () => {
  it('reaches every client at connect and points to getClaywareGuide', () => {
    expect(INSTRUCTIONS).toContain(guide.GUIDE_SUMMARY);
    expect(INSTRUCTIONS).toContain('getClaywareGuide');
  });

  it('is the first tool listed, and a read', () => {
    const [first] = mcpTools();
    expect(first.name).toBe('getClaywareGuide');
    expect(first.annotations.readOnlyHint).toBe(true);
    expect(mcpTools('read').map((t: { name: string }) => t.name)).toContain('getClaywareGuide');
  });

  it('returns the principles with the caller’s top Strategies and harnesses', async () => {
    const tables: Record<string, Row[]> = {
      strategies: [{ id: 's1', name: '国内で一番選ばれる', description: null, status: 'active' }, { id: 's2', name: '代理店を増やす', description: null, status: 'active' }],
      strategy_children: [{ parent_strategy_id: 's1', child_strategy_id: 's2' }],
      definitions: [{ id: 'h1', name: '営業の進め方', body: '## 目的\n- 商談を前に進める', activity_space_id: null, enabled: true }],
    };
    const from = (table: string) => {
      const filters: ((r: Row) => boolean)[] = [];
      const q = {
        select: () => q, order: () => q, limit: () => q,
        eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return q; },
        in: (k: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[k])); return q; },
        then: (resolve: (v: { data: Row[]; error: null }) => unknown) => resolve({ data: (tables[table] ?? []).filter((r) => filters.every((f) => f(r))), error: null }),
      };
      return q;
    };
    const res = await guide.runGuideTool({ from } as never, {});
    expect(res.ok).toBe(true);
    expect(res.data.principles).toContain('人と AI の分担');
    expect(res.data.topStrategies).toEqual([{ id: 's1', name: '国内で一番選ばれる', description: null }]);
    expect(res.data.harnesses.map((h: { name: string }) => h.name)).toEqual(['営業の進め方']);
  });
});

describe('steering', () => {
  it('knows the same person-only verbs as the app', () => {
    expect([...board.HUMAN_ELEMENT_ACTIONS]).toEqual([...kinds.ELEMENT_ACTIONS].filter((a) => kinds.isHumanAction(a)));
    expect([...board.ELEMENT_ACTIONS]).toEqual([...kinds.ELEMENT_ACTIONS]);
  });

  it('finds the Elements a call would close', () => {
    expect(guide.closingTargets('updateElement', { id: 'x', status: 'done' })).toEqual(['x']);
    expect(guide.closingTargets('updateElement', { id: 'x', status: 'in_progress' })).toEqual([]);
    expect(guide.closingTargets('bulkUpdateElements', { ids: ['a', 'b'], status: 'review' })).toEqual(['a', 'b']);
    expect(guide.closingTargets('toggleSubelementComplete', { id: 'x' })).toEqual(['x']);
    expect(guide.closingTargets('toggleSubelementComplete', { id: 'x', isCompleted: false })).toEqual([]);
    expect(guide.closingTargets('updateSubelement', { id: 'x', title: 't' })).toEqual([]);
    expect(guide.closingTargets('reportOutcome', { elementId: 'x', outcome: 'completed' })).toEqual(['x']);
    expect(guide.closingTargets('reportOutcome', { elementId: 'x', outcome: 'blocked' })).toEqual([]);
  });

  it('refuses to close a person’s Element, says why and what to do, and writes nothing', async () => {
    const { db, updates } = elementsDb(ROWS());
    const host = mcpHost(db, { agent: 'Claude (MCP · OAuth)', userId: 'u' });
    const res = await host.call('updateElement', { id: JUDGE, status: 'done' });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('人が判断する仕事');
    expect(res.error).toContain('reportOutcome の blocked');
    expect(updates).toEqual([]);
  });

  it('refuses to take a person’s verb off, so it cannot be closed in two steps', async () => {
    const { db, updates } = elementsDb(ROWS());
    const res = await mcpHost(db, { agent: 'Claude (MCP · OAuth)', userId: 'u' }).call('updateElement', { id: JUDGE, action: 'execute' });
    expect(res).toMatchObject({ ok: false });
    expect(res.error).toContain('動詞を外す');
    expect(updates).toEqual([]);
  });

  it('lets an AI close its own kind of work', async () => {
    const { db, updates } = elementsDb(ROWS());
    expect(await guide.steerRefusal(db, 'updateElement', { id: WORK, status: 'done' })).toBeNull();
    expect(await guide.steerRefusal(db, 'bulkUpdateElements', { ids: [WORK, JUDGE], status: 'done' })).toContain('価格案を A と B から選ぶ');
    expect(updates).toEqual([]);
  });

  it('adds the model to the descriptions of the tools most often misused', () => {
    const by = new Map(mcpTools().map((t: { name: string; description: string }) => [t.name, t.description]));
    expect(by.get('createObject')).toContain('tableData の行');
    expect(by.get('createElement')).toContain('judge / decide / answer');
  });
});

describe('the action field', () => {
  it('accepts the verbs and refuses anything else', () => {
    expect(board.actionOf('judge')).toEqual({ ok: true, value: 'judge' });
    expect(board.actionOf(null)).toEqual({ ok: true, value: null });
    expect(board.actionOf('think')).toMatchObject({ ok: false });
  });
});
