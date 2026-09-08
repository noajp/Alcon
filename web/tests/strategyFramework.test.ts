//
// Frameworks as lenses over rows the board already holds.
//
// The rules pinned here are the ones a plausible implementation gets wrong
// while tsc stays green — and the ones that decide whether these widgets are
// honest or merely decorative:
//
//   - an Objective with no key results is named as such, because that is the
//     one claim the Measures list cannot make about itself
//   - the cascade follows strategy_children and survives a cycle, which the
//     table permits and nothing prevents being written
//   - the Gap track is scaled per measure, never across measures, and a zero
//     target ("zero unclosed corrections") does not divide by nothing
//   - an `at_most` overshoot is drawn as an overshoot, not as a short bar

import { describe, expect, it } from 'vitest';
import {
  gapRows,
  objectiveTree,
  toMeasureInput,
  type ObjectiveInput,
} from '@/Function/widget/widgets/strategyFrameworkModel';
import type { MeasureInput } from '@/ActivitySpace/strategy/initiative/initiativeMeasureModel';

function measure(over: Partial<MeasureInput> & { id: string }): MeasureInput {
  return {
    title: over.id,
    target: null,
    actual: null,
    unit: null,
    direction: null,
    measuredAt: null,
    orderIndex: 0,
    ...over,
  };
}

const initiatives: ObjectiveInput[] = [
  { id: 'root', name: 'MERIDIAN', parentIds: [] },
  { id: 'child', name: 'GTM', parentIds: ['root'] },
  { id: 'grandchild', name: 'Pricing', parentIds: ['child'] },
  { id: 'unrelated', name: 'LANTERN', parentIds: [] },
];

describe('objectiveTree', () => {
  it('walks the cascade depth-first and leaves unrelated Initiatives out', () => {
    const tree = objectiveTree('root', initiatives, new Map());
    expect(tree.map((o) => [o.id, o.depth])).toEqual([
      ['root', 0],
      ['child', 1],
      ['grandchild', 2],
    ]);
  });

  it('names an Objective that states no key result', () => {
    const tree = objectiveTree(
      'root',
      initiatives,
      new Map([['child', [measure({ id: 'm1', target: 5, actual: 5, direction: 'at_least' })]]]),
    );
    expect(tree.find((o) => o.id === 'root')!.stated).toBe(false);
    expect(tree.find((o) => o.id === 'child')!.stated).toBe(true);
    expect(tree.find((o) => o.id === 'child')!.tally).toMatchObject({ met: 1, total: 1 });
  });

  it('terminates on a cycle rather than recursing forever', () => {
    // intent_bindings permits a DAG and nothing stops a loop being written.
    const looped: ObjectiveInput[] = [
      { id: 'a', name: 'A', parentIds: ['b'] },
      { id: 'b', name: 'B', parentIds: ['a'] },
    ];
    const tree = objectiveTree('a', looped, new Map());
    expect(tree.map((o) => o.id)).toEqual(['a', 'b']);
  });

  it('reports a Initiative that is not in the list as nothing, not as a crash', () => {
    expect(objectiveTree('missing', initiatives, new Map())).toEqual([]);
  });
});

describe('gapRows', () => {
  it('scales each track to its own numbers', () => {
    const [hygiene, corrections] = gapRows([
      measure({ id: 'h', title: 'Hand hygiene', target: 80, actual: 60, unit: '%', direction: 'at_least', orderIndex: 0 }),
      measure({ id: 'c', title: 'Corrections', target: 4, actual: 2, unit: '件', direction: 'at_most', orderIndex: 1 }),
    ]).sort((a, b) => a.orderIndex - b.orderIndex);

    // 60/80 and 2/4 — each against its own span, so the two bars are not on
    // one scale and never imply they are.
    expect(hygiene.actualFraction).toBeCloseTo(0.75);
    expect(hygiene.targetFraction).toBe(1);
    expect(corrections.actualFraction).toBeCloseTo(0.5);
    expect(corrections.targetFraction).toBe(1);
  });

  it('draws an at_most overshoot as an overshoot', () => {
    const [row] = gapRows([
      measure({ id: 'c', target: 0, actual: 3, unit: '件', direction: 'at_most' }),
    ]);
    // Zero target: the span comes from the reading, so nothing divides by zero
    // and the notch sits at the origin with the bar running past it.
    expect(row.targetFraction).toBe(0);
    expect(row.actualFraction).toBe(1);
    expect(row.distance).toBe(3);
    expect(row.state).toBe('missed');
  });

  it('draws no bar when a number is negative rather than a wrong length', () => {
    // "no worse than -5%" read as -3% is MET, and any bar short of full says
    // the opposite. A length has no sign, so the track says nothing and the
    // numbers beside it carry the answer.
    const [row] = gapRows([
      measure({ id: 'n', target: -5, actual: -3, unit: '%', direction: 'at_least' }),
    ]);
    expect(row.state).toBe('met');
    expect(row.actualFraction).toBeNull();
    expect(row.targetFraction).toBeNull();
    // The distance is still reported — it is a number, not a length.
    expect(row.distance).toBe(2);
  });

  it('leaves an unread condition without a bar rather than drawing a zero', () => {
    const [row] = gapRows([
      measure({ id: 'u', target: 5, actual: null, direction: 'at_least' }),
    ]);
    expect(row.actualFraction).toBeNull();
    expect(row.distance).toBeNull();
    expect(row.state).toBe('unmeasured');
  });

  it('maps an intents row onto the measure shape', () => {
    expect(
      toMeasureInput({
        id: 'i1',
        title: 'Pilots',
        target_value: 5,
        actual_value: 2,
        unit: '社',
        direction: 'at_least',
        measured_at: '2026-09-01T00:00:00Z',
        order_index: 3,
      }),
    ).toEqual({
      id: 'i1',
      title: 'Pilots',
      target: 5,
      actual: 2,
      unit: '社',
      direction: 'at_least',
      measuredAt: '2026-09-01T00:00:00Z',
      orderIndex: 3,
    });
  });
});
