//
// Where the people are — the arithmetic behind the ribbons.
//
// A flow diagram is the kind of figure that looks right while being wrong:
// every ribbon has a width, so nothing on screen says the widths stopped
// adding up. The cases pinned here are the ones where a plausible
// implementation draws a confident lie:
//
//   - an Object feeding two Campaigns must not double the work it holds
//   - a node's ribbons must sum to the node, or the last one runs past its box
//   - the Campaign column must disappear when it separates nothing
//   - the tail is folded, not dropped, because "six Campaigns with one person
//     each" is the finding

import { describe, expect, it } from 'vitest';
import { effortFlow, isFoldedNode, type AssignmentInput } from '@/alcon/widget/widgets/effortFlowModel';

function assign(workerId: string, objectId: string, n = 1): AssignmentInput[] {
  return Array.from({ length: n }, (_, i) => ({
    elementId: `${workerId}-${objectId}-${i}`,
    workerId,
    workerName: workerId.toUpperCase(),
    objectId,
    objectName: objectId.toUpperCase(),
  }));
}

const oneCampaign = new Map([
  ['o1', [{ id: 'c1', name: 'ALPHA' }]],
  ['o2', [{ id: 'c1', name: 'ALPHA' }]],
]);

describe('effortFlow', () => {
  it('counts one row per person per Element, not per Element', () => {
    const flow = effortFlow(
      [...assign('w1', 'o1', 2), ...assign('w2', 'o1', 1)],
      oneCampaign,
    );
    expect(flow.total).toBe(3);
    expect(flow.nodes.find((n) => n.id === 'worker:w1')!.value).toBe(2);
    expect(flow.nodes.find((n) => n.id === 'object:o1')!.value).toBe(3);
  });

  it('drops the Campaign column when there is only one to point at', () => {
    const flow = effortFlow(assign('w1', 'o1', 2), oneCampaign);
    expect(flow.columns).toEqual(['worker', 'object']);
    expect(flow.nodes.some((n) => n.kind === 'campaign')).toBe(false);
  });

  it('splits an Object that feeds two Campaigns instead of counting it twice', () => {
    const shared = new Map([
      ['o1', [
        { id: 'c1', name: 'ALPHA' },
        { id: 'c2', name: 'BRAVO' },
      ]],
      ['o2', [{ id: 'c2', name: 'BRAVO' }]],
    ]);
    const flow = effortFlow([...assign('w1', 'o1', 4), ...assign('w2', 'o2', 2)], shared);
    expect(flow.columns).toEqual(['worker', 'object', 'campaign']);

    const objectToCampaign = flow.links.filter((l) => l.from.startsWith('object:'));
    const total = objectToCampaign.reduce((sum, l) => sum + l.value, 0);
    // Six assignments in, six out — not ten, which is what counting the shared
    // Object once per Campaign would produce.
    expect(total).toBeCloseTo(6);
    expect(objectToCampaign.find((l) => l.id === 'object:o1->campaign:c1')!.value).toBeCloseTo(2);
    expect(objectToCampaign.find((l) => l.id === 'object:o1->campaign:c2')!.value).toBeCloseTo(2);
  });

  it('makes each node’s ribbons sum to its own height', () => {
    const shared = new Map([
      ['o1', [{ id: 'c1', name: 'ALPHA' }, { id: 'c2', name: 'BRAVO' }]],
      ['o2', [{ id: 'c2', name: 'BRAVO' }]],
    ]);
    const flow = effortFlow(
      [...assign('w1', 'o1', 3), ...assign('w2', 'o1', 1), ...assign('w2', 'o2', 2)],
      shared,
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

  it('keeps every node inside its column and clear of the next', () => {
    const flow = effortFlow(
      [...assign('w1', 'o1', 3), ...assign('w2', 'o1', 2), ...assign('w3', 'o2', 1)],
      oneCampaign,
    );
    for (const node of flow.nodes) {
      expect(node.offset).toBeGreaterThanOrEqual(0);
      expect(node.offset + node.height).toBeLessThanOrEqual(1.000001);
    }
    const workers = flow.nodes.filter((n) => n.kind === 'worker');
    for (let i = 1; i < workers.length; i += 1) {
      expect(workers[i].offset).toBeGreaterThanOrEqual(
        workers[i - 1].offset + workers[i - 1].height,
      );
    }
  });

  it('folds the tail into one row rather than dropping it', () => {
    const many = Array.from({ length: 12 }, (_, i) => assign(`w${i}`, 'o1', 1)).flat();
    const flow = effortFlow(many, oneCampaign);
    const workers = flow.nodes.filter((n) => n.kind === 'worker');
    expect(workers).toHaveLength(8);
    const folded = workers.filter(isFoldedNode);
    expect(folded).toHaveLength(1);
    // Nothing lost: the folded row carries the five it stands for.
    expect(workers.reduce((s, n) => s + n.value, 0)).toBe(12);
    expect(folded[0].label).toBe('5 more');
  });

  it('returns an empty flow rather than a divide-by-zero', () => {
    expect(effortFlow([], oneCampaign)).toEqual({
      nodes: [],
      links: [],
      columns: [],
      total: 0,
    });
  });

  it('leaves an Object in no Campaign out of the third column without losing it', () => {
    const partial = new Map([['o1', [{ id: 'c1', name: 'ALPHA' }]], ['o2', [{ id: 'c2', name: 'BRAVO' }]]]);
    const flow = effortFlow([...assign('w1', 'o1', 2), ...assign('w1', 'o3', 3)], partial);
    // o3 is in no Campaign: it still holds its three assignments…
    expect(flow.nodes.find((n) => n.id === 'object:o3')!.value).toBe(3);
    // …and simply has no ribbon onward.
    expect(flow.links.some((l) => l.from === 'object:o3')).toBe(false);
  });
});
