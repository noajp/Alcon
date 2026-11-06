import { describe, expect, it } from 'vitest';
// Deno dependencies belong to the Edge runtime, not the web compiler graph.
const { runBatchTool } = await import(new URL('../../supabase/functions/_shared/batchTools.ts', import.meta.url).pathname);
const objectId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const actor = { agent: 'alcon-copilot' };

/** Records each insert; an elements insert answers with the rows given ids. */
function recordingDb(inserts: { table: string; rows: Record<string, unknown>[] }[]) {
  return {
    from: (table: string) => ({
      insert: (rows: Record<string, unknown>[]) => {
        inserts.push({ table, rows });
        const data = rows.map((r, i) => ({ id: `e${i}`, display_id: `REF-${i + 1}`, title: r.title, status: r.status ?? 'todo', priority: r.priority ?? null }));
        return Object.assign(Promise.resolve({ error: null }), { select: async () => ({ data, error: null }) });
      },
    }),
  };
}

describe('Copilot createElements', () => {
  it('files every Element in one insert and audits them in one more', async () => {
    const inserts: { table: string; rows: Record<string, unknown>[] }[] = [];
    const result = await runBatchTool(recordingDb(inserts) as never, {
      objectId,
      elements: [{ title: 'A', priority: 'high' }, { title: 'B', status: 'done' }, { title: 'C', description: 'why' }],
    }, actor);
    expect(result.ok).toBe(true);
    expect(result.meta.rows).toBe(3);
    expect(inserts.map((i) => i.table)).toEqual(['elements', 'element_activity']);
    expect(inserts[0].rows.map((r) => r.object_id)).toEqual([objectId, objectId, objectId]);
    // A Done Element is filed at full progress, as createElement does.
    expect(inserts[0].rows[1].progress).toBe(100);
    expect(inserts[1].rows).toHaveLength(3);
  });

  it('refuses a missing title, an empty list and an oversized one without writing', async () => {
    const inserts: { table: string; rows: Record<string, unknown>[] }[] = [];
    const db = recordingDb(inserts) as never;
    expect((await runBatchTool(db, { objectId, elements: [{ title: ' ' }] }, actor)).ok).toBe(false);
    expect((await runBatchTool(db, { objectId, elements: [] }, actor)).ok).toBe(false);
    expect((await runBatchTool(db, { objectId, elements: Array.from({ length: 51 }, (_, i) => ({ title: String(i) })) }, actor)).ok).toBe(false);
    expect(inserts).toHaveLength(0);
  });
});
