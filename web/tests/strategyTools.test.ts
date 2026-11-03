import { describe, expect, it } from 'vitest';
// Deno dependencies belong to the Edge runtime, not the web compiler graph.
const { runStrategyTool } = await import(new URL('../../supabase/functions/alcon-copilot/strategyTools.ts', import.meta.url).pathname);
const id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

/** A delete chain whose final select answers with `rows`. */
function deletingDb(rows: unknown[] | null, tables: string[]) {
  const chain = { eq: () => chain, select: async () => ({ data: rows, error: null }) };
  return { from: (table: string) => { tables.push(table); return { delete: () => chain }; } };
}

describe('Copilot strategy tool', () => {
  it('deletes an Initiative from strategies — never objects', async () => {
    const tables: string[] = [];
    expect((await runStrategyTool(deletingDb([{ id }], tables) as never, { action: 'deleteInitiative', id })).ok).toBe(true);
    expect(tables).toEqual(['strategies']);
  });

  it('reports a delete RLS refused (no row removed) as a failure', async () => {
    const result = await runStrategyTool(deletingDb([], []) as never, { action: 'deleteInitiative', id });
    expect(result.ok).toBe(false);
  });

  it('rejects ids that are not UUIDs', async () => {
    await expect(runStrategyTool(deletingDb([], []) as never, { action: 'deleteInitiative', id: 'INI-1' })).rejects.toThrow('UUID');
  });
});
