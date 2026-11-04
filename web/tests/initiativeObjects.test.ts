import { describe, expect, it } from 'vitest';
import { assembleStrategies } from '@/hooks/initiativeObjects';
import type { Strategy, StrategyChild, StrategyObject } from '@/types/database';

// assembleStrategies is the one path that turns rows into a Strategy's
// Object set (ADR 0017). The contract: objectIds comes from the
// strategy_objects junction and from nothing else. Rows written before the
// junction became the single source may still carry `object_ids` inside the
// scope jsonb; the DB keeps them (forward-only, no migration), and this test
// pins that they are ignored even when they disagree with the junction.

function strategy(id: string, scope: Record<string, unknown> = {}): Strategy {
  return {
    id,
    name: id,
    description: null,
    status: 'active',
    // The jsonb column is untyped at the wire; a stray key rides in as-is.
    scope: scope as Strategy['scope'],
    delegation: 'manual',
    definition_id: null,
    color: null,
    icon: null,
    activity_space_id: null,
    created_by: null,
    created_at: '2026-08-31T00:00:00Z',
    updated_at: '2026-08-31T00:00:00Z',
  };
}

function link(strategy_id: string, object_id: string): StrategyObject {
  return { id: `${strategy_id}:${object_id}`, strategy_id, object_id, created_at: '2026-08-31T00:00:00Z' };
}

function edge(parent_strategy_id: string, child_strategy_id: string): StrategyChild {
  return { parent_strategy_id, child_strategy_id, order_index: 0, created_at: '2026-08-31T00:00:00Z' };
}

describe('assembleStrategies', () => {
  it('derives objectIds from the junction only, in junction order', () => {
    const out = assembleStrategies(
      [strategy('s1'), strategy('s2')],
      [link('s1', 'o2'), link('s1', 'o1'), link('s2', 'o3')],
      [],
    );
    expect(out.map((s) => [s.id, s.objectIds])).toEqual([
      ['s1', ['o2', 'o1']],
      ['s2', ['o3']],
    ]);
  });

  it('ignores a stale scope.object_ids even when it disagrees with the junction', () => {
    const out = assembleStrategies(
      [strategy('s1', { domain_ids: ['d1'], object_ids: ['o-stale', 'o1'] })],
      [link('s1', 'o1')],
      [],
    );
    expect(out[0].objectIds).toEqual(['o1']);
    // The rest of scope rides through untouched — domain_ids is a separate
    // concern, and the stale key is neither read nor scrubbed here.
    expect(out[0].scope).toEqual({ domain_ids: ['d1'], object_ids: ['o-stale', 'o1'] });
  });

  it('gives a Strategy with no links an empty set, not one read from scope', () => {
    const out = assembleStrategies([strategy('s1', { object_ids: ['o1'] })], [], []);
    expect(out[0].objectIds).toEqual([]);
  });

  it('derives parentIds from strategy_children, multi-parent allowed', () => {
    const out = assembleStrategies(
      [strategy('root'), strategy('child')],
      [],
      [edge('root', 'child'), edge('other', 'child')],
    );
    expect(out.find((s) => s.id === 'root')?.parentIds).toEqual([]);
    expect(out.find((s) => s.id === 'child')?.parentIds).toEqual(['root', 'other']);
  });
});
