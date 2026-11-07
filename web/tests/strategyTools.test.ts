import { describe, expect, it } from 'vitest';
// Deno dependencies belong to the Edge runtime, not the web compiler graph.
const { runStrategyWriteTool } = await import(new URL('../../supabase/functions/_shared/strategyTools.ts', import.meta.url).pathname);
const id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

/** A delete chain whose final select answers with `rows`. */
function deletingDb(rows: unknown[] | null, tables: string[]) {
  const chain = { eq: () => chain, select: async () => ({ data: rows, error: null }) };
  return { from: (table: string) => { tables.push(table); return { delete: () => chain }; } };
}

/** Records inserts; strategies answer with a new row, strategy_children with no error. */
function creatingDb(inserts: { table: string; row: Record<string, unknown> }[]) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
    from: (table: string) => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id, name: 'Parent', activity_space_id: 'space-1', definition_id: null }, error: null }) }) }),
      insert: (row: Record<string, unknown>) => {
        inserts.push({ table, row });
        const done = { data: { id: 'new-1', name: row.name }, error: null };
        return { select: () => ({ single: async () => done }), then: (r: (v: unknown) => void) => r({ error: null }) };
      },
    }),
  };
}

describe('Strategy writes', () => {
  it('deletes a Strategy from strategies — never objects', async () => {
    const tables: string[] = [];
    expect((await runStrategyWriteTool(deletingDb([{ id }], tables) as never, 'deleteInitiative', { id })).ok).toBe(true);
    expect(tables).toEqual(['strategies']);
  });

  it('reports a delete RLS refused (no row removed) as a failure', async () => {
    const result = await runStrategyWriteTool(deletingDb([], []) as never, 'deleteInitiative', { id });
    expect(result.ok).toBe(false);
  });

  it('rejects ids that are not UUIDs', async () => {
    const result = await runStrategyWriteTool(deletingDb([], []) as never, 'deleteInitiative', { id: 'INI-1' });
    expect(result).toMatchObject({ ok: false });
    expect(result.error).toContain('UUID');
  });

  it('creates a top-level Strategy in the Space named, with no parent link', async () => {
    const inserts: { table: string; row: Record<string, unknown> }[] = [];
    const spaceId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    const r = await runStrategyWriteTool(creatingDb(inserts) as never, 'createInitiative', { spaceId, name: 'AIP' });
    expect(r.ok).toBe(true);
    expect(inserts.map((i) => i.table)).toEqual(['strategies']);
    expect(inserts[0].row).toMatchObject({ name: 'AIP', activity_space_id: spaceId, created_by: 'user-1' });
  });

  it('creates a Sub Strategy in its parent\'s Space and links it under the parent', async () => {
    const inserts: { table: string; row: Record<string, unknown> }[] = [];
    const r = await runStrategyWriteTool(creatingDb(inserts) as never, 'createInitiative', { parentId: id, name: '基盤' });
    expect(r.ok).toBe(true);
    expect(inserts.map((i) => i.table)).toEqual(['strategies', 'strategy_children']);
    expect(inserts[0].row).toMatchObject({ activity_space_id: 'space-1' });
    expect(inserts[1].row).toEqual({ parent_strategy_id: id, child_strategy_id: 'new-1' });
  });

  it('refuses a Strategy with neither a parent nor a Space', async () => {
    const r = await runStrategyWriteTool(creatingDb([]) as never, 'createInitiative', { name: 'AIP' });
    expect(r.ok).toBe(false);
  });
});
