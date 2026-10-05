// The rebalancing plan. What is pinned is what a person relies on when they
// press "Apply": that a proposal really clears the overload it claims to,
// that nobody is handed work on a day they are away, that the cheapest change
// is offered before the one that breaks a date, and that the same board
// always produces the same plan.

import { describe, expect, it } from 'vitest';
import {
  applyProposals,
  planHorizon,
  proposalPrerequisites,
  planRebalance,
  proposalWorkers,
  type PlanElement,
  type PlanWorker,
  type Proposal,
} from '@/ActivitySpace/sustainment/workload/workloadRebalance';

const TODAY = '2026-10-05'; // a Monday

const worker = (id: string, over: Partial<PlanWorker> = {}): PlanWorker => ({
  id, name: id, type: 'human', status: 'active', capacity_hours_per_day: 8, ...over,
});

let seq = 0;
const el = (over: Partial<PlanElement> & { holders?: string[] }): PlanElement => {
  const id = over.id ?? `e${++seq}`;
  const { holders = [], ...rest } = over;
  return {
    id, title: id, start_date: null, due_date: null, estimated_hours: 8, priority: 'medium', status: 'todo',
    object_id: 'obj', assignees: holders.map((w) => ({ id: `${id}:${w}`, worker_id: w })), ...rest,
  };
};

describe('planHorizon', () => {
  it('starts today and is inclusive', () => {
    const days = planHorizon(TODAY, 3);
    expect(days).toEqual(['2026-10-05', '2026-10-06', '2026-10-07']);
  });
});

describe('planRebalance — overload', () => {
  it('hands work to a colleague with room when nothing can start earlier', () => {
    const plan = planRebalance({
      today: TODAY,
      workers: [worker('a'), worker('b')],
      spans: {},
      elements: [
        el({ id: 'x', start_date: TODAY, due_date: TODAY, estimated_hours: 8, holders: ['a'] }),
        el({ id: 'y', start_date: TODAY, due_date: TODAY, estimated_hours: 6, holders: ['a'], priority: 'low' }),
      ],
    });
    expect(plan.overBefore).toBe(6);
    expect(plan.overAfter).toBe(0);
    expect(plan.proposals).toHaveLength(1);
    const p = plan.proposals[0];
    expect(p.kind).toBe('reassign');
    if (p.kind !== 'reassign') return;
    // Low-priority work moves first; the urgent-looking one stays with its owner.
    expect(p.elementId).toBe('y');
    expect(p.toWorkerId).toBe('b');
    expect(p.assigneeId).toBe('y:a');
    expect(p.overBefore).toBe(6);
    expect(p.overAfter).toBe(0);
  });

  it('prefers starting earlier over moving the owner, and keeps the due date', () => {
    const plan = planRebalance({
      today: TODAY,
      workers: [worker('a'), worker('b')],
      spans: {},
      elements: [
        el({ id: 'x', start_date: '2026-10-07', due_date: '2026-10-07', estimated_hours: 4, holders: ['a'] }),
        el({ id: 'y', start_date: '2026-10-07', due_date: '2026-10-07', estimated_hours: 8, holders: ['a'], priority: 'low' }),
      ],
    });
    expect(plan.overAfter).toBe(0);
    const p = plan.proposals[0];
    expect(p.kind).toBe('reschedule');
    if (p.kind !== 'reschedule') return;
    expect(p.mode).toBe('start-earlier');
    expect(p.to.due).toBe('2026-10-07');
    expect((p.to.start ?? '') < '2026-10-07').toBe(true);
  });

  it('postpones only when no one has room and nothing can start earlier', () => {
    const plan = planRebalance({
      today: TODAY,
      workers: [worker('a')],
      spans: {},
      elements: [
        el({ id: 'x', start_date: TODAY, due_date: TODAY, estimated_hours: 8, holders: ['a'], priority: 'urgent' }),
        el({ id: 'y', start_date: TODAY, due_date: TODAY, estimated_hours: 4, holders: ['a'] }),
      ],
    });
    const p = plan.proposals[0];
    expect(p.kind).toBe('reschedule');
    if (p.kind !== 'reschedule') return;
    expect(p.mode).toBe('postpone');
    expect(p.elementId).toBe('y');
    expect(p.to).toEqual({ start: '2026-10-06', due: '2026-10-06' });
    expect(plan.overAfter).toBe(0);
  });

  it('never postpones urgent work', () => {
    const plan = planRebalance({
      today: TODAY,
      workers: [worker('a')],
      spans: {},
      elements: [
        el({ id: 'x', start_date: TODAY, due_date: TODAY, estimated_hours: 12, holders: ['a'], priority: 'urgent' }),
      ],
    });
    expect(plan.proposals).toEqual([]);
    expect(plan.overAfter).toBe(4);
  });

  it('never targets a robot, an inactive Worker, or someone away on those days', () => {
    const plan = planRebalance({
      today: TODAY,
      workers: [worker('a'), worker('bot', { type: 'robot' }), worker('gone', { status: 'inactive' }), worker('away')],
      spans: { away: [{ start_date: TODAY, end_date: TODAY, capacity_hours_per_day: 0 }] },
      elements: [
        el({ id: 'x', start_date: TODAY, due_date: TODAY, estimated_hours: 8, holders: ['a'], priority: 'urgent' }),
        el({ id: 'y', start_date: TODAY, due_date: TODAY, estimated_hours: 4, holders: ['a'] }),
      ],
    });
    for (const p of plan.proposals) {
      if (p.kind === 'reassign' || p.kind === 'assign') expect(['bot', 'gone', 'away']).not.toContain(p.toWorkerId);
    }
  });

  it('does not hand two Elements to the same free day', () => {
    const plan = planRebalance({
      today: TODAY,
      workers: [worker('a'), worker('b')],
      spans: {},
      elements: [
        el({ id: 'x', start_date: TODAY, due_date: TODAY, estimated_hours: 8, holders: ['a'], priority: 'urgent' }),
        el({ id: 'y', start_date: TODAY, due_date: TODAY, estimated_hours: 6, holders: ['a'] }),
        el({ id: 'z', start_date: TODAY, due_date: TODAY, estimated_hours: 6, holders: ['a'] }),
      ],
    });
    const toB = plan.proposals.filter((p) => (p.kind === 'reassign' || p.kind === 'assign') && p.toWorkerId === 'b');
    expect(toB).toHaveLength(1);
  });

  it('leaves done work alone', () => {
    const plan = planRebalance({
      today: TODAY,
      workers: [worker('a'), worker('b')],
      spans: {},
      elements: [
        el({ id: 'x', start_date: TODAY, due_date: TODAY, estimated_hours: 20, holders: ['a'], status: 'done' }),
      ],
    });
    expect(plan.overBefore).toBe(0);
    expect(plan.proposals).toEqual([]);
  });

  it('prefers someone who already works in the same Object', () => {
    const plan = planRebalance({
      today: TODAY,
      workers: [worker('a'), worker('b'), worker('c')],
      spans: {},
      elements: [
        el({ id: 'x', start_date: TODAY, due_date: TODAY, estimated_hours: 8, holders: ['a'], priority: 'urgent' }),
        el({ id: 'y', start_date: TODAY, due_date: TODAY, estimated_hours: 4, holders: ['a'], object_id: 'ship' }),
        el({ id: 'known', start_date: '2026-10-20', due_date: '2026-10-20', estimated_hours: 1, holders: ['c'], object_id: 'ship' }),
      ],
    });
    const p = plan.proposals.find((x) => x.elementId === 'y');
    expect(p?.kind).toBe('reassign');
    if (p?.kind !== 'reassign') return;
    expect(p.toWorkerId).toBe('c');
    expect(p.target.familiarity).toBe(1);
  });
});

describe('planRebalance — working days', () => {
  it('never proposes a new start or due date on a weekend', () => {
    // Friday the 9th is full; postponing must skip Sat/Sun and land on Monday.
    const plan = planRebalance({
      today: TODAY,
      workers: [worker('a')],
      spans: {},
      elements: [
        el({ id: 'x', start_date: '2026-10-09', due_date: '2026-10-09', estimated_hours: 8, holders: ['a'], priority: 'urgent' }),
        el({ id: 'y', start_date: '2026-10-09', due_date: '2026-10-09', estimated_hours: 4, holders: ['a'] }),
      ],
    });
    for (const p of plan.proposals) {
      if (p.kind !== 'reschedule') continue;
      for (const d of [p.to.start, p.to.due]) expect([0, 6]).not.toContain(new Date(`${d}T00:00:00`).getDay());
    }
    const y = plan.proposals.find((p) => p.elementId === 'y');
    expect(y?.kind).toBe('reschedule');
  });
});

describe('planRebalance — due while away', () => {
  it('hands a deadline that lands in an absence to someone who is there', () => {
    const plan = planRebalance({
      today: TODAY,
      workers: [worker('a'), worker('b')],
      spans: { a: [{ start_date: '2026-10-08', end_date: '2026-10-09', capacity_hours_per_day: 0 }] },
      elements: [el({ id: 'x', start_date: '2026-10-08', due_date: '2026-10-08', estimated_hours: 2, holders: ['a'] })],
    });
    expect(plan.proposals).toHaveLength(1);
    const p = plan.proposals[0];
    expect(p.issue).toBe('away');
    expect(p.kind).toBe('reassign');
    if (p.kind === 'reassign') expect(p.toWorkerId).toBe('b');
  });

  it('pulls the deadline in before the absence when nobody can take it', () => {
    const plan = planRebalance({
      today: TODAY,
      workers: [worker('a')],
      spans: { a: [{ start_date: '2026-10-08', end_date: '2026-10-09', capacity_hours_per_day: 0 }] },
      elements: [el({ id: 'x', start_date: '2026-10-06', due_date: '2026-10-09', estimated_hours: 2, holders: ['a'] })],
    });
    const p = plan.proposals[0];
    expect(p.kind).toBe('reschedule');
    if (p.kind !== 'reschedule') return;
    expect(p.mode).toBe('pull-in');
    expect(p.to).toEqual({ start: '2026-10-06', due: '2026-10-07' });
  });
});

describe('planRebalance — unassigned', () => {
  it('assigns dated work nobody holds to whoever has the most room', () => {
    const plan = planRebalance({
      today: TODAY,
      workers: [worker('a'), worker('b')],
      spans: {},
      elements: [
        el({ id: 'busy', start_date: TODAY, due_date: TODAY, estimated_hours: 6, holders: ['a'], object_id: 'other' }),
        el({ id: 'orphan', start_date: TODAY, due_date: TODAY, estimated_hours: 2, object_id: 'misc' }),
        el({ id: 'undated', estimated_hours: 2 }),
      ],
    });
    expect(plan.proposals.map((p) => p.elementId)).toEqual(['orphan']);
    const p = plan.proposals[0];
    expect(p.kind).toBe('assign');
    if (p.kind === 'assign') expect(p.toWorkerId).toBe('b');
  });
});

describe('planRebalance — determinism', () => {
  it('yields the same plan for the same board regardless of input order', () => {
    const workers = [worker('a'), worker('b'), worker('c', { type: 'ai_agent', capacity_hours_per_day: null })];
    const elements = [
      el({ id: 'p', start_date: TODAY, due_date: '2026-10-06', estimated_hours: 20, holders: ['a'] }),
      el({ id: 'q', start_date: TODAY, due_date: TODAY, estimated_hours: 6, holders: ['a'] }),
      el({ id: 'r', start_date: '2026-10-07', due_date: '2026-10-07', estimated_hours: 3 }),
    ];
    const one = planRebalance({ today: TODAY, workers, spans: {}, elements });
    const two = planRebalance({ today: TODAY, workers: [...workers].reverse(), spans: {}, elements: [...elements].reverse() });
    expect(two.proposals.map((p) => p.id).sort()).toEqual(one.proposals.map((p) => p.id).sort());
    expect(two.overAfter).toBe(one.overAfter);
  });
});

describe('applyProposals', () => {
  const base = [
    el({ id: 'x', start_date: TODAY, due_date: TODAY, holders: ['a'] }),
    el({ id: 'z', start_date: TODAY, due_date: TODAY, holders: ['a'] }),
  ];

  it('swaps the assignee for a reassignment and leaves other Elements untouched', () => {
    const p: Proposal = {
      kind: 'reassign', id: 'r', elementId: 'x', issue: 'overload', workerId: 'a', fromWorkerId: 'a', assigneeId: 'x:a',
      toWorkerId: 'b', target: { peakAfter: 0.5, freeHours: 8, familiarity: 0 }, overBefore: 1, overAfter: 0,
    };
    const after = applyProposals(base, [p], (id) => ({ id }));
    expect(after[0].assignees?.map((a) => a.worker_id)).toEqual(['b']);
    expect(after[1]).toBe(base[1]);
    expect(proposalWorkers(p)).toEqual(['a', 'b']);
  });

  it('moves dates for a reschedule', () => {
    const p: Proposal = {
      kind: 'reschedule', mode: 'postpone', id: 's', elementId: 'x', issue: 'overload', workerId: 'a', holders: ['a'],
      from: { start: TODAY, due: TODAY }, to: { start: '2026-10-06', due: '2026-10-06' }, overBefore: 1, overAfter: 0,
    };
    const after = applyProposals(base, [p], () => null);
    expect(after[0].start_date).toBe('2026-10-06');
    expect(after[0].due_date).toBe('2026-10-06');
  });
});

describe('planRebalance — scale', () => {
  it('plans a large board quickly', () => {
    const workers = Array.from({ length: 40 }, (_, i) => worker(`w${i}`));
    const elements: PlanElement[] = [];
    for (let i = 0; i < 1500; i++) {
      const start = i % 30;
      const d = (n: number) => { const x = new Date(`${TODAY}T00:00:00`); x.setDate(x.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
      elements.push(el({ id: `big${i}`, start_date: d(start), due_date: d(start + (i % 4)), estimated_hours: 6 + (i % 7), holders: i % 9 === 0 ? [] : [`w${i % 12}`], object_id: `o${i % 20}` }));
    }
    const t0 = performance.now();
    const plan = planRebalance({ today: TODAY, workers, spans: {}, elements });
    const ms = performance.now() - t0;
    expect(plan.overAfter).toBeLessThan(plan.overBefore);
    expect(ms).toBeLessThan(2000);
  });
});

describe('planRebalance — review fixes', () => {
  it('starts earlier only as far as its own stretch needs, even with another overload elsewhere', () => {
    const plan = planRebalance({
      today: TODAY,
      workers: [worker('a')],
      spans: {},
      elements: [
        el({ id: 'far', start_date: '2026-11-12', due_date: '2026-11-12', estimated_hours: 12, holders: ['a'] }),
        el({ id: 'near', start_date: '2026-10-07', due_date: '2026-10-07', estimated_hours: 12, holders: ['a'], priority: 'urgent' }),
      ],
    });
    const far = plan.proposals.find((p) => p.elementId === 'far');
    expect(far?.kind).toBe('reschedule');
    if (far?.kind !== 'reschedule') return;
    expect(far.mode).toBe('start-earlier');
    expect(far.to).toEqual({ start: '2026-11-11', due: '2026-11-12' });
  });

  it('plans around a dismissed proposal instead of leaving its dependants standing on it', () => {
    const board = {
      today: TODAY,
      workers: [worker('a'), worker('b')],
      spans: {},
      elements: [
        el({ id: 'x', start_date: TODAY, due_date: TODAY, estimated_hours: 8, holders: ['a'], priority: 'urgent' }),
        el({ id: 'y', start_date: TODAY, due_date: TODAY, estimated_hours: 4, holders: ['a'] }),
      ],
    };
    const first = planRebalance(board).proposals[0];
    expect(first.kind).toBe('reassign');
    const again = planRebalance({ ...board, dismissed: new Set([first.id]) });
    expect(again.proposals.map((p) => p.id)).not.toContain(first.id);
    expect(again.proposals[0]?.kind).toBe('reschedule');
  });

  it('when focused, plans only changes involving that Worker', () => {
    const plan = planRebalance({
      today: TODAY,
      workers: [worker('a'), worker('b'), worker('c')],
      spans: {},
      elements: [
        el({ id: 'x1', start_date: TODAY, due_date: TODAY, estimated_hours: 6, holders: ['a'] }),
        el({ id: 'x2', start_date: TODAY, due_date: TODAY, estimated_hours: 6, holders: ['a'] }),
        el({ id: 'y1', start_date: TODAY, due_date: TODAY, estimated_hours: 6, holders: ['b'] }),
        el({ id: 'y2', start_date: TODAY, due_date: TODAY, estimated_hours: 6, holders: ['b'] }),
      ],
      focusWorkerId: 'b',
    });
    expect(plan.proposals.length).toBeGreaterThan(0);
    for (const p of plan.proposals) expect(proposalWorkers(p)).toContain('b');
  });

  it('does not invent a due date when postponing work that has only a start', () => {
    const plan = planRebalance({
      today: TODAY,
      workers: [worker('a')],
      spans: {},
      elements: [
        el({ id: 'x', start_date: '2026-10-08', due_date: '2026-10-08', estimated_hours: 8, holders: ['a'], priority: 'urgent' }),
        el({ id: 'y', start_date: '2026-10-08', due_date: null, estimated_hours: 4, holders: ['a'] }),
      ],
    });
    const y = plan.proposals.find((p) => p.elementId === 'y');
    expect(y?.kind).toBe('reschedule');
    if (y?.kind !== 'reschedule') return;
    expect(y.to.due).toBeNull();
  });

  it('decides absences the same way whatever order the Workers arrive in', () => {
    const workers = [worker('a'), worker('b'), worker('c')];
    const spans = {
      a: [{ start_date: '2026-10-08', end_date: '2026-10-08', capacity_hours_per_day: 0 }],
      b: [{ start_date: '2026-10-08', end_date: '2026-10-08', capacity_hours_per_day: 0 }],
    };
    const elements = [
      el({ id: 'xa', start_date: '2026-10-08', due_date: '2026-10-08', estimated_hours: 6, holders: ['a'] }),
      el({ id: 'xb', start_date: '2026-10-08', due_date: '2026-10-08', estimated_hours: 6, holders: ['b'] }),
    ];
    const one = planRebalance({ today: TODAY, workers, spans, elements });
    const two = planRebalance({ today: TODAY, workers: [...workers].reverse(), spans, elements: [...elements].reverse() });
    expect(two.proposals.map((p) => p.id)).toEqual(one.proposals.map((p) => p.id));
  });

  it('never hands over a reviewer', () => {
    const plan = planRebalance({
      today: TODAY,
      workers: [worker('a'), worker('b')],
      spans: {},
      elements: [{ ...el({ id: 'x', start_date: TODAY, due_date: TODAY, estimated_hours: 12, priority: 'urgent' }), assignees: [{ id: 'x:a', worker_id: 'a', role: 'reviewer' }] }],
    });
    expect(plan.proposals.filter((p) => p.kind === 'reassign')).toEqual([]);
  });
});

describe('proposalPrerequisites', () => {
  const r = (id: string, elementId: string, from: string, to: string): Proposal => ({
    kind: 'reassign', id, elementId, issue: 'overload', workerId: from, fromWorkerId: from, assigneeId: `${elementId}:${from}`,
    toWorkerId: to, target: { peakAfter: 0.5, freeHours: 4, familiarity: 0 }, overBefore: 1, overAfter: 0,
  });
  it('follows shared Workers back through the plan, and skips unrelated proposals', () => {
    const plan = [r('p1', 'e1', 'b', 'c'), r('p2', 'e2', 'x', 'y'), r('p3', 'e3', 'a', 'b')];
    expect(proposalPrerequisites(plan, 2).map((p) => p.id)).toEqual(['p1']);
    expect(proposalPrerequisites(plan, 1)).toEqual([]);
    expect(proposalPrerequisites(plan, 0)).toEqual([]);
  });
});

describe('planRebalance — second review', () => {
  it('does not drag a small Element weeks earlier when its day stays over because of other work', () => {
    const plan = planRebalance({
      today: TODAY,
      workers: [worker('a')],
      spans: {},
      elements: [
        el({ id: 'x', start_date: '2026-11-12', due_date: '2026-11-12', estimated_hours: 4, holders: ['a'] }),
        el({ id: 'y', start_date: '2026-11-12', due_date: '2026-11-12', estimated_hours: 12, holders: ['a'], status: 'in_progress' }),
      ],
    });
    for (const p of plan.proposals) {
      if (p.kind === 'reschedule' && p.mode === 'start-earlier') expect(p.to.start! >= '2026-11-02').toBe(true);
    }
    expect(plan.overAfter).toBe(0);
  });

  it('attributes a date change on a shared Element to every holder', () => {
    const plan = planRebalance({
      today: TODAY,
      workers: [worker('a'), worker('b')],
      spans: {},
      elements: [
        el({ id: 'shared', start_date: '2026-10-07', due_date: '2026-10-07', estimated_hours: 10, holders: ['a', 'b'] }),
      ],
    });
    const p = plan.proposals.find((x) => x.kind === 'reschedule');
    expect(p && proposalWorkers(p)).toEqual(['a', 'b']);
  });
});
