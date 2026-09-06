import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  failures: new Set<string>(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from(table: string) {
      const filters: ((row: Record<string, unknown>) => boolean)[] = [];
      let start = 0;
      let end = 499;
      const query = {
        select: () => query,
        eq(column: string, value: unknown) { filters.push((row) => row[column] === value); return query; },
        in(column: string, values: unknown[]) { filters.push((row) => values.includes(row[column])); return query; },
        order: () => query,
        range(from: number, to: number) { start = from; end = to; return query; },
        abortSignal: () => query,
        async single() {
          const rows = (fixture.tables[table] ?? []).filter((row) => filters.every((filter) => filter(row)));
          return { data: rows[0] ?? null, error: rows.length === 1 ? null : { message: 'not visible' } };
        },
        then(resolve: (value: unknown) => unknown) {
          if (fixture.failures.has(table)) return Promise.resolve(resolve({ data: null, count: null, error: { message: 'read failed' } }));
          const rows = (fixture.tables[table] ?? []).filter((row) => filters.every((filter) => filter(row)));
          // Simulate a project whose server row limit is only two. Even an IN
          // containing one parent may have more children than a server page.
          return Promise.resolve(resolve({ data: rows.slice(start, Math.min(end + 1, start + 2)), count: rows.length, error: null }));
        },
      };
      return query;
    },
  },
}));

import { fetchDecisionLabData, readDecisionLabPages } from '@/hooks/useDecisionLab';

describe('complete Decision Lab reads', () => {
  it('advances by returned rows when the server cap is smaller than the requested page', async () => {
    const source = Array.from({ length: 1_101 }, (_, id) => ({ id: String(id) }));
    const rows = await readDecisionLabPages('Elements', async (from) => ({
      data: source.slice(from, from + 100), error: null, count: source.length,
    }), (row) => row.id);
    expect(rows).toEqual(source);
  });

  it('fails if a page is missing before the exact count is satisfied', async () => {
    await expect(readDecisionLabPages('Elements', async (from) => ({
      data: from === 0 ? [{ id: 'first' }] : [], error: null, count: 2,
    }), (row) => row.id)).rejects.toThrow('incomplete');
  });

  it('fails instead of silently assuming an unknown total is complete', async () => {
    await expect(readDecisionLabPages('Elements', async () => ({
      data: [{ id: 'first' }], error: null, count: null,
    }), (row) => row.id)).rejects.toThrow('verify the complete');
  });

  it('fails if membership changes between pages', async () => {
    await expect(readDecisionLabPages('Elements', async (from) => ({
      data: [{ id: String(from) }], error: null, count: from === 0 ? 3 : 4,
    }), (row) => row.id)).rejects.toThrow('changed while reading');
  });

  it('detects overlapping pages even if the count stays the same', async () => {
    await expect(readDecisionLabPages('Elements', async () => ({
      data: [{ id: 'repeated' }], error: null, count: 2,
    }), (row) => row.id)).rejects.toThrow('changed while reading');
  });

  it('propagates database errors', async () => {
    await expect(readDecisionLabPages('Availability', async () => ({
      data: null, error: { message: 'permission denied' }, count: null,
    }), () => '')).rejects.toThrow('Unable to read Availability: permission denied');
  });
});

describe('Space-scoped Decision Lab data', () => {
  beforeEach(() => {
    fixture.failures.clear();
    fixture.tables = {
      strategies: [{ id: 'initiative', name: 'Launch' }, { id: 'child', name: 'Delivery' }, { id: 'grandchild', name: 'Readiness' }],
      strategy_children: [
        { parent_strategy_id: 'initiative', child_strategy_id: 'child' },
        { parent_strategy_id: 'child', child_strategy_id: 'grandchild' },
        { parent_strategy_id: 'grandchild', child_strategy_id: 'initiative' },
      ],
      strategy_objects: [
        { id: 'scope-link', strategy_id: 'grandchild', object_id: 'scope' },
        { id: 'foreign-scope-link', strategy_id: 'initiative', object_id: 'foreign' },
      ],
      domains: [{ id: 'domain', activity_space_id: 'space' }, { id: 'other-domain', activity_space_id: 'other-space' }],
      objects: [
        { id: 'scope', name: 'Launch', domain_id: 'domain' },
        { id: 'shared', name: 'Other commitment', domain_id: null },
        { id: 'foreign', name: 'Foreign work', domain_id: 'other-domain' },
      ],
      object_domains: [{ object_id: 'shared', domain_id: 'domain' }],
      elements: [
        { id: 'first', object_id: 'scope', status: null, direction: null },
        { id: 'multi', object_id: 'scope', status: 'todo', direction: null },
        { id: 'junction-only', object_id: null, status: 'todo', direction: null },
        { id: 'commitment', object_id: 'shared', status: 'in_progress', direction: null },
        { id: 'foreign-element', object_id: 'foreign', status: 'todo', direction: null },
      ],
      element_objects: [
        { id: 'home1', element_id: 'multi', object_id: 'scope' },
        { id: 'home2', element_id: 'multi', object_id: 'shared' },
        { id: 'home3', element_id: 'junction-only', object_id: 'scope' },
      ],
      element_assignees: [
        { id: 'assign1', element_id: 'multi', worker_id: 'worker' },
        { id: 'assign2', element_id: 'multi', worker_id: 'agent' },
        { id: 'assign3', element_id: 'commitment', worker_id: 'worker' },
      ],
      element_edges: [
        { id: 'edge1', from_element: 'commitment', to_element: 'multi', edge_type: 'depends_on' },
        { id: 'edge2', from_element: 'unreadable', to_element: 'multi', edge_type: 'depends_on' },
        { id: 'edge3', from_element: 'multi', to_element: 'foreign-element', edge_type: 'depends_on' },
        { id: 'reference', from_element: 'commitment', to_element: 'multi', edge_type: 'references' },
      ],
      activity_space_members: [{ activity_space_id: 'space', user_id: 'person' }, { activity_space_id: 'space', user_id: 'idle-person' }],
      domain_members: [{ domain_id: 'domain', user_id: 'guest' }],
      workers: [
        { id: 'worker', object_id: null, user_id: 'person' },
        { id: 'idle', object_id: null, user_id: 'idle-person' },
        { id: 'guest-worker', object_id: null, user_id: 'guest' },
        { id: 'agent', object_id: null, user_id: null },
        { id: 'other-space-worker', object_id: 'foreign', user_id: 'person' },
        { id: 'unrelated-agent', object_id: null, user_id: null },
      ],
      worker_availability: [
        { id: 'leave1', worker_id: 'worker' }, { id: 'leave2', worker_id: 'worker' },
        { id: 'leave3', worker_id: 'worker' }, { id: 'private-leave', worker_id: 'other-space-worker' },
      ],
    };
  });

  it('hydrates recursive scope, shared workloads, all assignees and availability without multi-home duplication', async () => {
    const data = await fetchDecisionLabData('initiative', 'space');
    expect(data.initiativeName).toBe('Launch');
    expect(data.scopeElementIds.sort()).toEqual(['first', 'junction-only', 'multi']);
    expect(data.elements.map((row) => row.id).sort()).toEqual(['commitment', 'first', 'junction-only', 'multi']);
    expect(data.elements.find((row) => row.id === 'first')?.status).toBeNull();
    expect(data.elements.find((row) => row.id === 'first')?.assignees).toEqual([]);
    const multi = data.elements.find((row) => row.id === 'multi')!;
    expect(multi.objectIds?.sort()).toEqual(['scope', 'shared']);
    expect(multi.assignees?.map((row) => row.worker?.id).sort()).toEqual(['agent', 'worker']);
    expect(data.availability.map((row) => row.id).sort()).toEqual(['leave1', 'leave2', 'leave3']);
    expect(Number.isFinite(Date.parse(data.readAt))).toBe(true);
  });

  it('retains unknown dependency endpoints without hydrating another Space or unrelated Workers', async () => {
    const data = await fetchDecisionLabData('initiative', 'space');
    expect(data.edges.map((row) => row.id).sort()).toEqual(['edge1', 'edge2', 'edge3']);
    expect(data.objects.map((row) => row.id).sort()).toEqual(['scope', 'shared']);
    expect(data.workers.map((row) => row.id).sort()).toEqual(['agent', 'guest-worker', 'idle', 'worker']);
    expect(data.elements.some((row) => row.id === 'unreadable' || row.id === 'foreign-element')).toBe(false);
  });

  it('does not return a partial forecast if availability failed', async () => {
    fixture.failures.add('worker_availability');
    await expect(fetchDecisionLabData('initiative', 'space')).rejects.toThrow('Unable to read Worker availability');
  });

  it('rejects an Initiative belonging only to a different Space', async () => {
    fixture.tables.strategy_objects = [{ id: 'foreign-link', strategy_id: 'initiative', object_id: 'foreign' }];
    await expect(fetchDecisionLabData('initiative', 'space')).rejects.toThrow('no visible Objects in the current Space');
  });
});
