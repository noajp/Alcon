// el_TRJ-013. `canElementStart` sat in useSupabase.ts with the right rule and
// zero callers, so nothing on the board ever said which Elements were waiting.
// These tests pin the rule itself now that three surfaces read it — the row
// marker, the Ready filter, and the single-Element check — because the failure
// mode is not "the arithmetic is wrong", it is "two surfaces answer the same
// question differently and the list quietly lies about what can be started".

import { describe, expect, it } from 'vitest';
import type { ElementWithDetails } from '@/hooks/useSupabase';
import { applyFilter } from '@/alcon/shared/listControls/filter';
import {
  computeBlockers,
  describeBlocker,
  upstreamIdsOf,
  type DependencyEdgeRow,
  type DependencyUpstreamRow,
} from '@/alcon/element/dependencyReadiness';

const el = (
  id: string,
  status: string,
  extra: Partial<DependencyUpstreamRow> = {},
): DependencyUpstreamRow => ({ id, title: `Element ${id}`, status, ...extra });

const dep = (from: string, to: string): DependencyEdgeRow => ({
  from_element: from,
  to_element: to,
  edge_type: 'depends_on',
});

describe('computeBlockers', () => {
  it('leaves an Element with no edges out of the map entirely', () => {
    expect(computeBlockers(['a', 'b'], [], [])).toEqual({});
  });

  it('does not block on an upstream that is done', () => {
    const out = computeBlockers(['b'], [dep('a', 'b')], [el('a', 'done')]);
    expect(out).toEqual({});
  });

  it('blocks on an upstream that is not done', () => {
    const out = computeBlockers(['b'], [dep('a', 'b')], [el('a', 'in_progress')]);
    expect(out.b).toHaveLength(1);
    expect(out.b[0].id).toBe('a');
    expect(out.b[0].status).toBe('in_progress');
  });

  it('reports only the unfinished ones when several upstreams are mixed', () => {
    const out = computeBlockers(
      ['d'],
      [dep('a', 'd'), dep('b', 'd'), dep('c', 'd')],
      [el('a', 'done'), el('b', 'todo'), el('c', 'review')],
    );
    expect(out.d.map((x) => x.id)).toEqual(['b', 'c']);
  });

  it('drops the entry once the last unfinished upstream is done', () => {
    const edges = [dep('a', 'b'), dep('c', 'b')];
    const upstreams = [el('a', 'done'), el('c', 'done')];
    expect(computeBlockers(['b'], edges, upstreams)).toEqual({});
  });

  // A cancelled upstream is NOT done. Whether that should unblock the row is a
  // product question nobody has answered; the rule is literal so that the
  // marker and the filter at least agree on the answer they give.
  it('treats a cancelled upstream as still blocking', () => {
    const out = computeBlockers(['b'], [dep('a', 'b')], [el('a', 'cancelled')]);
    expect(out.b).toHaveLength(1);
  });

  it('ignores edge types other than depends_on', () => {
    const edges: DependencyEdgeRow[] = [
      { from_element: 'a', to_element: 'b', edge_type: 'references' },
      { from_element: 'a', to_element: 'b', edge_type: 'spawns' },
      { from_element: 'a', to_element: 'b', edge_type: 'intersection' },
    ];
    expect(computeBlockers(['b'], edges, [el('a', 'todo')])).toEqual({});
  });

  it('ignores a self-reference rather than making the row unstartable', () => {
    const out = computeBlockers(['a'], [dep('a', 'a')], [el('a', 'todo')]);
    expect(out).toEqual({});
  });

  it('ignores an upstream that could not be fetched (deleted or RLS-hidden)', () => {
    const out = computeBlockers(['b'], [dep('missing', 'b')], []);
    expect(out).toEqual({});
  });

  it('counts a duplicated edge onto the same upstream once', () => {
    const out = computeBlockers(['b'], [dep('a', 'b'), dep('a', 'b')], [el('a', 'todo')]);
    expect(out.b).toHaveLength(1);
  });

  it('ignores edges pointing at Elements outside the requested set', () => {
    const out = computeBlockers(['b'], [dep('a', 'z')], [el('a', 'todo')]);
    expect(out).toEqual({});
  });

  it('keys blockers by the downstream Element, not the upstream', () => {
    const out = computeBlockers(
      ['b', 'c'],
      [dep('a', 'b'), dep('a', 'c')],
      [el('a', 'todo')],
    );
    expect(Object.keys(out).sort()).toEqual(['b', 'c']);
  });

  it('carries display_id through so a tooltip can name the upstream', () => {
    const out = computeBlockers(
      ['b'],
      [dep('a', 'b')],
      [el('a', 'todo', { display_id: 'el_MED-001' })],
    );
    expect(out.b[0].display_id).toBe('el_MED-001');
  });

  it('nulls display_id when the upstream has none', () => {
    const out = computeBlockers(['b'], [dep('a', 'b')], [el('a', 'todo')]);
    expect(out.b[0].display_id).toBeNull();
  });
});

describe('upstreamIdsOf', () => {
  it('collects only the depends_on sources for the requested Elements', () => {
    const edges: DependencyEdgeRow[] = [
      dep('a', 'b'),
      dep('c', 'b'),
      dep('d', 'z'), // downstream not requested
      dep('b', 'b'), // self-reference
      { from_element: 'e', to_element: 'b', edge_type: 'references' },
    ];
    expect(upstreamIdsOf(['b'], edges).sort()).toEqual(['a', 'c']);
  });

  it('deduplicates so one upstream is fetched once', () => {
    expect(upstreamIdsOf(['b', 'c'], [dep('a', 'b'), dep('a', 'c')])).toEqual(['a']);
  });

  it('returns nothing when there are no edges', () => {
    expect(upstreamIdsOf(['a'], [])).toEqual([]);
  });
});

describe('the Ready filter', () => {
  const row = (id: string) => ({ id, title: id, status: 'todo', labels: null } as unknown as ElementWithDetails);
  const rows = [row('a'), row('b'), row('c')];

  it('is a no-op when off', () => {
    const out = applyFilter(rows, { readyOnly: false }, { blockedElementIds: new Set(['a']) });
    expect(out.map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });

  it('drops the Elements that are still waiting', () => {
    const out = applyFilter(rows, { readyOnly: true }, { blockedElementIds: new Set(['a', 'c']) });
    expect(out.map((e) => e.id)).toEqual(['b']);
  });

  // The blocker map arrives asynchronously. If a missing set meant "blocked",
  // every list would flash empty on first paint.
  it('treats everything as ready when no blocker set was supplied', () => {
    const out = applyFilter(rows, { readyOnly: true }, {});
    expect(out.map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('describeBlocker', () => {
  it('names an upstream by its display_id and title', () => {
    expect(
      describeBlocker({ id: 'a', title: 'Ship the API', display_id: 'el_MED-001', status: 'todo' }),
    ).toBe('el_MED-001 Ship the API');
  });

  // display_id is generated from the owning Object's prefix, so an Element can
  // exist without one. It must still name itself.
  it('falls back to the bare title when there is no display_id', () => {
    expect(
      describeBlocker({ id: 'a', title: 'Ship the API', display_id: null, status: 'todo' }),
    ).toBe('Ship the API');
  });
});
