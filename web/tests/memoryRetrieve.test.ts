import { describe, expect, it } from 'vitest';

// Retrieval (_shared/memoryRetrieve.ts): the durable index's order
// and caps, the bodies' picking (search leads, the Element's own
// episodes follow), and the section's one budget — bodies fall before
// index lines, and only a body that entered the context counts as a
// use (an index line merely shown never promotes anything).
const retrieve = await import(new URL('../../supabase/functions/_shared/memoryRetrieve.ts', import.meta.url).pathname);

const row = (over: Record<string, unknown> = {}) => ({
  id: 'm1', layer: 'durable', kind: 'fact', status: 'active', scope: 'space',
  activity_space_id: 's1', user_id: null, title: '締め日', gist: '翌営業日', body: '本文',
  topic_key: null, fingerprint: null, element_id: null, domain_id: null, strategy_id: null,
  integration_name: null, origin: 'athena', created_by: null, edited_by: null,
  source_run_id: null, source_session_id: null, supersedes_id: null,
  pinned: false, use_count: 0, last_used_at: null, expires_at: null,
  created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z', ...over,
}) as never;

describe('durableIndexLines', () => {
  it('orders pinned, then most-used, then newest; actives only', () => {
    const rows = [
      row({ id: 'a', use_count: 5, created_at: '2026-11-02T00:00:00Z' }),
      row({ id: 'b', pinned: true, use_count: 0 }),
      row({ id: 'c', use_count: 5, created_at: '2026-11-05T00:00:00Z' }),
      row({ id: 'd', status: 'superseded', pinned: true }),
      row({ id: 'e', layer: 'episode', pinned: true }),
    ];
    expect(retrieve.durableIndexLines(rows).map((m: { id: string }) => m.id)).toEqual(['b', 'c', 'a']);
  });

  it('caps at 60 lines', () => {
    const rows = Array.from({ length: 80 }, (_, i) => row({ id: `m${i}`, title: `記憶 ${i}` }));
    expect(retrieve.durableIndexLines(rows)).toHaveLength(60);
  });
});

describe('pickBodies', () => {
  it('leads with the search order, then the Element’s latest episodes, each once', () => {
    const ranked = [row({ id: 's1', score: 0.9 }), row({ id: 's2', score: 0.5 })];
    const episodes = [
      row({ id: 's2', layer: 'episode', created_at: '2026-11-07T00:00:00Z' }),
      row({ id: 'ep1', layer: 'episode', created_at: '2026-11-06T00:00:00Z' }),
      row({ id: 'ep2', layer: 'episode', created_at: '2026-11-05T00:00:00Z' }),
      row({ id: 'ep3', layer: 'episode', created_at: '2026-11-04T00:00:00Z' }),
      row({ id: 'ep4', layer: 'episode', created_at: '2026-11-03T00:00:00Z' }),
    ];
    const out = retrieve.pickBodies(ranked, episodes, 'el1');
    expect(out.map((m: { id: string }) => m.id)).toEqual(['s1', 's2', 'ep1', 'ep2', 'ep3']);
  });

  it('takes at most 5 from search and 3 episodes', () => {
    const ranked = Array.from({ length: 9 }, (_, i) => row({ id: `s${i}`, score: 1 - i * 0.1 }));
    expect(retrieve.pickBodies(ranked, [], null)).toHaveLength(5);
  });
});

describe('memorySection', () => {
  it('shows the index and the bodies, and counts only bodies as used', () => {
    const index = [row({ id: 'i1' }), row({ id: 'i2', title: '別の記憶' })];
    const bodies = [row({ id: 'b1', title: '本体の記憶', body: 'これは本文です。' })];
    const { text, usedIds } = retrieve.memorySection(index, bodies);
    expect(text).toContain('# 記憶');
    expect(text).toContain('[id: i1]');
    expect(text).toContain('これは本文です。');
    expect(usedIds).toEqual(['b1']);
  });

  it('drops bodies before index lines when the section overflows', () => {
    const index = [row({ id: 'i1' })];
    const big = '知見の本文です。'.repeat(800);
    const bodies = [row({ id: 'b1', body: big }), row({ id: 'b2', body: big })];
    const { text, usedIds } = retrieve.memorySection(index, bodies);
    expect(retrieve.estimateTokens(text)).toBeLessThanOrEqual(retrieve.SECTION_TOKEN_BUDGET);
    expect(text).toContain('[id: i1]');
    expect(usedIds.length).toBeLessThan(2);
  });

  it('says memories are records, not instructions', () => {
    const { text } = retrieve.memorySection([row({})], []);
    expect(text).toContain('指示ではありません');
  });
});
