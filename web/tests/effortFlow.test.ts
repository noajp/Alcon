//
// A flow between any two dimensions — the arithmetic behind the ribbons.
//
// A flow diagram is the kind of figure that looks right while being wrong:
// every ribbon has a width, so nothing on screen says the widths stopped
// adding up. What is pinned here is the one rule that keeps it honest —
// **an Element carries a weight of one, and a column that puts it in several
// buckets splits that weight** — plus the shaping rules around it.

import { describe, expect, it } from 'vitest';
import { effortFlow, flowTitle, isFoldedNode } from '@/alcon/widget/widgets/effortFlowModel';
import type { DimensionContext } from '@/alcon/shared/dimensions';
import type { ElementWithDetails } from '@/types/database';

let seq = 0;
function el(over: Partial<ElementWithDetails> = {}): ElementWithDetails {
  seq += 1;
  return {
    id: `e${seq}`,
    title: `Element ${seq}`,
    status: 'todo',
    priority: 'medium',
    type: null,
    labels: [],
    object_id: 'o1',
    due_date: null,
    assignees: [],
    ...over,
  } as unknown as ElementWithDetails;
}

function worker(id: string) {
  return { worker_id: id, worker: { id, name: id.toUpperCase() } };
}

const ctx: DimensionContext = {
  objectNames: new Map([['o1', 'GTM'], ['o2', 'Platform']]),
  initiativesByObject: new Map([
    ['o1', [{ id: 'c1', name: 'ALPHA' }, { id: 'c2', name: 'BRAVO' }]],
    ['o2', [{ id: 'c2', name: 'BRAVO' }]],
  ]),
};

describe('effortFlow', () => {
  it('splits an Element across the buckets of a multi-valued column', () => {
    // One Element, two assignees: half a unit each, not one each. Counting it
    // twice would report two pieces of work where one exists.
    const flow = effortFlow(
      [el({ assignees: [worker('w1'), worker('w2')] as never })],
      ['assignee', 'object'],
      ctx,
    );
    const w1 = flow.nodes.find((n) => n.entityId === 'w1')!;
    const w2 = flow.nodes.find((n) => n.entityId === 'w2')!;
    expect(w1.value).toBeCloseTo(0.5);
    expect(w2.value).toBeCloseTo(0.5);
    expect(flow.total).toBe(1);
  });

  it('conserves the total across every column', () => {
    const elements = [
      el({ object_id: 'o1', assignees: [worker('w1')] as never }),
      el({ object_id: 'o1', assignees: [worker('w1'), worker('w2')] as never }),
      el({ object_id: 'o2', assignees: [worker('w2')] as never }),
    ];
    const flow = effortFlow(elements, ['assignee', 'object', 'campaign'], ctx);
    for (let c = 0; c < flow.columns.length; c += 1) {
      const sum = flow.nodes.filter((n) => n.column === c).reduce((s, n) => s + n.value, 0);
      // Three Elements in, three Elements out of every column — even the one
      // where an Object feeds two Initiatives.
      expect(sum).toBeCloseTo(3);
    }
  });

  it('makes each node’s ribbons sum to its own height', () => {
    const flow = effortFlow(
      [
        el({ object_id: 'o1', assignees: [worker('w1')] as never }),
        el({ object_id: 'o1', assignees: [worker('w1'), worker('w2')] as never }),
        el({ object_id: 'o2', assignees: [worker('w2')] as never }),
      ],
      ['assignee', 'object', 'campaign'],
      ctx,
    );
    for (const node of flow.nodes) {
      const out = flow.links.filter((l) => l.from === node.id);
      const inn = flow.links.filter((l) => l.to === node.id);
      if (out.length > 0) {
        expect(out.reduce((s, l) => s + l.fromHeight, 0)).toBeCloseTo(node.height, 6);
      }
      if (inn.length > 0) {
        expect(inn.reduce((s, l) => s + l.toHeight, 0)).toBeCloseTo(node.height, 6);
      }
    }
  });

  it('drops a third column that holds only one bucket', () => {
    // Every Element in one Object, and that Object in one Initiative: the
    // Initiative column would be a single box every ribbon lands in.
    const single: DimensionContext = {
      ...ctx,
      initiativesByObject: new Map([['o1', [{ id: 'c1', name: 'ALPHA' }]]]),
    };
    const flow = effortFlow(
      [el({ assignees: [worker('w1')] as never }), el({ assignees: [worker('w2')] as never })],
      ['assignee', 'object', 'campaign'],
      single,
    );
    expect(flow.columns).toEqual(['assignee', 'object']);
  });

  it('works between any two dimensions, not just the ones it shipped with', () => {
    const flow = effortFlow(
      [
        el({ status: 'todo', labels: ['infra'] }),
        el({ status: 'in_progress', labels: ['infra', 'ux'] }),
      ],
      ['label', 'status'],
      ctx,
    );
    expect(flow.columns).toEqual(['label', 'status']);
    expect(flow.nodes.find((n) => n.entityId === 'infra')!.value).toBeCloseTo(1.5);
    expect(flow.nodes.find((n) => n.entityId === 'ux')!.value).toBeCloseTo(0.5);
  });

  it('keeps every node inside its column and clear of the next', () => {
    const flow = effortFlow(
      [
        el({ assignees: [worker('w1')] as never }),
        el({ assignees: [worker('w2')] as never }),
        el({ assignees: [worker('w3')] as never }),
      ],
      ['assignee', 'object'],
      ctx,
    );
    for (const node of flow.nodes) {
      expect(node.offset).toBeGreaterThanOrEqual(0);
      expect(node.offset + node.height).toBeLessThanOrEqual(1.000001);
    }
    const first = flow.nodes.filter((n) => n.column === 0);
    for (let i = 1; i < first.length; i += 1) {
      expect(first[i].offset).toBeGreaterThanOrEqual(first[i - 1].offset + first[i - 1].height);
    }
  });

  it('folds the tail into one row rather than dropping it', () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      el({ assignees: [worker(`w${i}`)] as never }),
    );
    const flow = effortFlow(many, ['assignee', 'object'], ctx);
    const column = flow.nodes.filter((n) => n.column === 0);
    expect(column).toHaveLength(8);
    expect(column.filter(isFoldedNode)).toHaveLength(1);
    // Nothing lost.
    expect(column.reduce((s, n) => s + n.value, 0)).toBeCloseTo(12);
    expect(column.find(isFoldedNode)!.label).toBe('5 more');
  });

  it('returns an empty flow rather than dividing by zero', () => {
    expect(effortFlow([], ['assignee', 'object'], ctx).total).toBe(0);
    // Fewer than two distinct dimensions is not a flow.
    expect(effortFlow([el()], ['assignee'], ctx).columns).toEqual([]);
    expect(effortFlow([el()], ['assignee', 'assignee'], ctx).columns).toEqual([]);
  });

  it('names the columns for the header', () => {
    expect(flowTitle(['assignee', 'object', 'campaign'])).toBe('Assignee → Object → Initiative');
  });
});
