//
// The return leg — decisions and assumptions read from the Execution side.
//
// What is pinned: the shaping rules that decide what a person sees when they
// open an Element. Each one is a way a plausible implementation would show
// the wrong thing while tsc stays green:
//
//   - a decision bound to an Object AND to one of its Elements is one row,
//     and "via" is dropped because the direct binding is the stronger claim
//   - the root Intent and measures never appear — the root is scope, not
//     intent, and a measure is the Campaign's own number
//   - a binding on something outside the scope is not ours, even when its
//     intent is
//   - a review that is due floats above everything, including an off-track
//     decision, because it is the only thing that needs somebody today
//   - assumptions carry no review chip, whatever their horizon column says

import { describe, expect, it } from 'vitest';
import { intentTrailRows, type TrailScope } from '@/alcon/widget/widgets/intentTrailModel';
import type { Intent, IntentBinding } from '@/types/database';

const NOW = new Date(2026, 8, 2); // 2026-09-02, local

function intent(over: Partial<Intent> & { id: string; kind: Intent['kind'] }): Intent {
  return {
    strategy_id: 'cmp-1',
    parent_intent_id: 'root',
    target_value: null,
    actual_value: null,
    unit: null,
    measured_at: null,
    direction: null,
    slug: null,
    title: over.id,
    subtitle: null,
    captured_dimensions: [],
    uncaptured_dimensions: [],
    abandoned: null,
    horizon: null,
    status: 'on_track',
    decided_by_name: null,
    decided_by_role: null,
    decided_at: null,
    order_index: 0,
    created_by: 'u',
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
    ...over,
  } as Intent;
}

function binding(over: Partial<IntentBinding> & { intent_id: string; target_id: string }): IntentBinding {
  return {
    id: `b-${over.intent_id}-${over.target_id}`,
    target_type: 'element',
    relationship_type: 'delivers',
    note: null,
    created_at: '2026-08-01T00:00:00Z',
    ...over,
  };
}

const names = new Map([['cmp-1', 'MERIDIAN']]);

const objectScope: TrailScope = {
  subject: { type: 'object', id: 'obj-1' },
  contained: new Map([
    ['el-1', { type: 'element', label: 'Price survey' }],
    ['el-2', { type: 'element', label: 'Pilot' }],
  ]),
};

describe('intentTrailRows', () => {
  it('folds every edge that reaches one intent into one row', () => {
    const rows = intentTrailRows(
      [
        binding({ intent_id: 'd1', target_id: 'el-1', relationship_type: 'delivers' }),
        binding({ intent_id: 'd1', target_id: 'el-2', relationship_type: 'reschedules' }),
      ],
      [intent({ id: 'd1', kind: 'decision' })],
      objectScope,
      names,
      NOW,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].via).toBe('Price survey +1');
    expect(rows[0].relationships).toEqual(['delivers', 'reschedules']);
    expect(rows[0].campaignName).toBe('MERIDIAN');
  });

  it('drops "via" once the intent is bound to the subject itself', () => {
    const rows = intentTrailRows(
      [
        binding({ intent_id: 'd1', target_id: 'el-1' }),
        binding({ intent_id: 'd1', target_id: 'obj-1', target_type: 'object' }),
      ],
      [intent({ id: 'd1', kind: 'decision' })],
      objectScope,
      names,
      NOW,
    );
    expect(rows[0].via).toBeNull();
  });

  it('never lists the root or a measure', () => {
    const rows = intentTrailRows(
      [
        binding({ intent_id: 'root', target_id: 'obj-1', target_type: 'object' }),
        binding({ intent_id: 'm1', target_id: 'el-1', relationship_type: 'measures' }),
        binding({ intent_id: 'a1', target_id: 'el-1', relationship_type: 'tests' }),
      ],
      [
        intent({ id: 'root', kind: 'master', parent_intent_id: null }),
        intent({ id: 'm1', kind: 'measure' }),
        intent({ id: 'a1', kind: 'assumption' }),
      ],
      objectScope,
      names,
      NOW,
    );
    expect(rows.map((r) => r.intentId)).toEqual(['a1']);
  });

  it('ignores an edge that lands outside the scope, even for an intent it knows', () => {
    const rows = intentTrailRows(
      [
        binding({ intent_id: 'd1', target_id: 'el-elsewhere' }),
        // Same id as a contained Element but the wrong target type.
        binding({ intent_id: 'd1', target_id: 'el-1', target_type: 'phase' }),
      ],
      [intent({ id: 'd1', kind: 'decision' })],
      objectScope,
      names,
      NOW,
    );
    expect(rows).toHaveLength(0);
  });

  it('treats a review answered on time as answered, not overdue', () => {
    const rows = intentTrailRows(
      [binding({ intent_id: 'd1', target_id: 'el-1' })],
      [intent({ id: 'd1', kind: 'decision', horizon: '2026-08-30' })],
      objectScope,
      names,
      NOW,
      new Map([['d1', '2026-08-31T09:00:00Z']]),
    );
    expect(rows[0].review).toEqual({ state: 'reviewed', label: 'Reviewed', due: false });
  });

  it('gives a closed decision no review chip, however overdue its horizon', () => {
    const rows = intentTrailRows(
      [
        binding({ intent_id: 'closed', target_id: 'el-1' }),
        binding({ intent_id: 'live', target_id: 'el-1' }),
      ],
      [
        intent({ id: 'closed', kind: 'decision', status: 'done', horizon: '2026-08-01', order_index: 0 }),
        intent({ id: 'live', kind: 'decision', order_index: 1 }),
      ],
      objectScope,
      names,
      NOW,
    );
    expect(rows.find((r) => r.intentId === 'closed')!.review).toBeNull();
    // …and it does not float over a decision still in force.
    expect(rows.map((r) => r.intentId)).toEqual(['live', 'closed']);
  });

  it('groups by Campaign before falling back to a per-Campaign order_index', () => {
    const rows = intentTrailRows(
      [
        binding({ intent_id: 'b0', target_id: 'el-1' }),
        binding({ intent_id: 'a1', target_id: 'el-1' }),
        binding({ intent_id: 'a0', target_id: 'el-1' }),
      ],
      [
        intent({ id: 'a0', kind: 'decision', strategy_id: 'cmp-a', order_index: 0 }),
        intent({ id: 'a1', kind: 'decision', strategy_id: 'cmp-a', order_index: 1 }),
        intent({ id: 'b0', kind: 'decision', strategy_id: 'cmp-b', order_index: 0 }),
      ],
      objectScope,
      new Map([['cmp-a', 'ALPHA'], ['cmp-b', 'BRAVO']]),
      NOW,
    );
    expect(rows.map((r) => r.intentId)).toEqual(['a0', 'a1', 'b0']);
  });

  it('puts a review that is due above an off-track decision', () => {
    const rows = intentTrailRows(
      [
        binding({ intent_id: 'late', target_id: 'el-1' }),
        binding({ intent_id: 'off', target_id: 'el-1' }),
        binding({ intent_id: 'fine', target_id: 'el-1' }),
      ],
      [
        intent({ id: 'fine', kind: 'decision', order_index: 0 }),
        intent({ id: 'off', kind: 'decision', status: 'off_track', order_index: 1 }),
        intent({ id: 'late', kind: 'decision', horizon: '2026-08-30', order_index: 2 }),
      ],
      objectScope,
      names,
      NOW,
    );
    expect(rows.map((r) => r.intentId)).toEqual(['late', 'off', 'fine']);
    expect(rows[0].review).toEqual({ state: 'overdue', label: 'Review 3d overdue', due: true });
    expect(rows[1].statusLabel).toBe('Off track');
  });

  it('gives an assumption no review chip, whatever its horizon says', () => {
    const rows = intentTrailRows(
      [binding({ intent_id: 'a1', target_id: 'el-1', relationship_type: 'tests' })],
      [intent({ id: 'a1', kind: 'assumption', horizon: '2026-08-01' })],
      objectScope,
      names,
      NOW,
    );
    expect(rows[0].kind).toBe('assumption');
    expect(rows[0].review).toBeNull();
  });

  it('reads an Element as the subject with nothing contained', () => {
    const rows = intentTrailRows(
      [binding({ intent_id: 'd1', target_id: 'el-1' })],
      [intent({ id: 'd1', kind: 'decision', title: 'Ship the pilot' })],
      { subject: { type: 'element', id: 'el-1' }, contained: new Map() },
      new Map(),
      NOW,
    );
    expect(rows).toEqual([
      expect.objectContaining({ title: 'Ship the pilot', via: null, campaignName: null }),
    ]);
  });
});
