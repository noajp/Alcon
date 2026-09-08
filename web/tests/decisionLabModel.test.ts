import { describe, expect, it } from 'vitest';
import type { ElementEdge, ElementWithDetails, Worker, WorkerAvailability } from '@/types/database';
import {
  compareDecisionLab,
  decisionLabFingerprint,
  simulateDecisionLab,
  type DecisionLabInput,
} from '@/ActivitySpace/strategy/initiative/decisionLabModel';

const TODAY = '2026-09-07'; // Monday

function worker(id = 'w', extra: Partial<Worker> = {}): Worker {
  return {
    id, name: id, type: 'human', status: 'active', capacity_hours_per_day: 8,
    object_id: null, user_id: null, display_id: null, seq_number: null, role: null,
    email: null, avatar_url: null, ai_model: null, ai_config: null, created_at: null,
    updated_at: null, ...extra,
  };
}

function element(id: string, extra: Partial<ElementWithDetails> = {}): ElementWithDetails {
  return {
    id, title: id, object_id: 'object', description: null, type: null, labels: [],
    owner_id: null, display_id: null, seq_number: null, status: 'todo', priority: 'medium',
    start_date: null, start_time: null, due_date: TODAY, due_time: null, color: null,
    estimated_hours: 8, actual_hours: null, progress: null, direction: null, order_index: null,
    is_approval: null, approval_state: null, note_id: null, phase_id: null,
    carried_over_count: 0, claimed_by: null, claim_expires_at: null, branch: null,
    created_at: null, updated_at: null,
    assignees: [{ id: `as-${id}`, element_id: id, worker_id: 'w', role: 'assignee', assigned_at: null }],
    ...extra,
  };
}

function edge(from: string, to: string): ElementEdge {
  return { id: `${from}-${to}`, from_element: from, to_element: to, edge_type: 'depends_on',
    attributes: {}, created_at: null, created_by: null };
}

function absence(extra: Partial<WorkerAvailability> = {}): WorkerAvailability {
  return { id: 'away', worker_id: 'w', start_date: TODAY, end_date: '2026-09-08',
    kind: 'leave', capacity_hours_per_day: 0, note: null, created_at: '', updated_at: '', ...extra };
}

function input(elements: ElementWithDetails[], extra: Partial<DecisionLabInput> = {}): DecisionLabInput {
  return { elements, workers: [worker()], availability: [], edges: [],
    scopeElementIds: elements.map((row) => row.id), today: TODAY, ...extra };
}

describe('Decision Lab shared capacity', () => {
  it('reserves one shared day once, with priority then due date then id as tie breakers', () => {
    const schedule = simulateDecisionLab(input([
      element('low', { priority: 'low' }),
      element('urgent', { priority: 'urgent', due_date: '2026-09-30' }),
      element('b'), element('a'),
      element('later', { due_date: '2026-09-08' }),
    ]));
    expect(schedule.byId.urgent.finish).toBe('2026-09-07');
    expect(schedule.byId.a.finish).toBe('2026-09-08');
    expect(schedule.byId.b.finish).toBe('2026-09-09');
    expect(schedule.byId.later.finish).toBe('2026-09-10');
    expect(schedule.byId.low.finish).toBe('2026-09-11');
  });

  it('uses a day’s remaining hours and does not let unreleased work reserve them', () => {
    const schedule = simulateDecisionLab(input([
      element('future', { priority: 'urgent', start_date: '2026-09-09' }),
      element('a', { estimated_hours: 4 }), element('b', { estimated_hours: 12 }),
    ]));
    expect(schedule.byId.a.finish).toBe(TODAY);
    expect(schedule.byId.b.start).toBe(TODAY);
    expect(schedule.byId.b.finish).toBe('2026-09-08');
    expect(schedule.byId.future.start).toBe('2026-09-09');
  });

  it('counts a multi-homed Element and duplicate assignee once', () => {
    const one = element('a', { objectIds: ['o1', 'o2'] });
    const duplicate = { ...one, object_id: 'o2', assignees: [...one.assignees!, ...one.assignees!] };
    const schedule = simulateDecisionLab(input([one, duplicate, element('b')]));
    expect(schedule.elements).toHaveLength(2);
    expect(schedule.scope.remainingHours).toBe(16);
    expect(schedule.byId.b.finish).toBe('2026-09-08');
  });

  it('reserves full effort for every assignee using their shared available window', () => {
    const joint = element('a');
    joint.assignees!.push({ id: 'as-x', element_id: 'a', worker_id: 'x', role: 'collaborator', assigned_at: null });
    const other = element('b', { assignees: [{ id: 'as-b', element_id: 'b', worker_id: 'x', role: 'assignee', assigned_at: null }] });
    const schedule = simulateDecisionLab(input([joint, other], { workers: [worker(), worker('x', { capacity_hours_per_day: 4 })] }));
    expect(schedule.byId.a.finish).toBe('2026-09-08');
    expect(schedule.byId.b.finish).toBe('2026-09-10');
  });

  it('uses estimate and progress, while actual hours do not manufacture remaining effort', () => {
    const schedule = simulateDecisionLab(input([
      element('a', { estimated_hours: 16, actual_hours: 100, progress: 50 }),
      element('b', { estimated_hours: null, actual_hours: 8 }),
    ]));
    expect(schedule.byId.a.remainingHours).toBe(8);
    expect(schedule.byId.a.finish).toBe(TODAY);
    expect(schedule.byId.b).toMatchObject({ reason: 'missing_estimate', finish: null, remainingHours: null });
    expect(schedule.scope.finish).toBeNull();
    expect(schedule.scope.unknown).toBe(1);
  });
});

describe('Decision Lab calendars and availability', () => {
  it('uses weekdays for humans by default, every day for AI and robots, and honors explicit capacities', () => {
    const elements = ['human', 'ai', 'robot'].map((id) => element(id, {
      estimated_hours: 16,
      assignees: [{ id: `as-${id}`, element_id: id, worker_id: id, role: 'assignee', assigned_at: null }],
    }));
    const args = input(elements, { today: '2026-09-11', workers: [
      worker('human', { capacity_hours_per_day: null }),
      worker('ai', { type: 'ai_agent', capacity_hours_per_day: null }),
      worker('robot', { type: 'robot', capacity_hours_per_day: null }),
    ] });
    const schedule = simulateDecisionLab(args);
    expect(schedule.byId.human.finish).toBe('2026-09-14');
    expect(schedule.byId.ai.finish).toBe('2026-09-11');
    expect(schedule.byId.robot.finish).toBe('2026-09-12');
    expect(simulateDecisionLab({ ...args, workweek: 'everyday' }).byId.human.finish).toBe('2026-09-12');
    expect(simulateDecisionLab({ ...args, workers: args.workers.map((w) => ({ ...w, capacity_hours_per_day: 4 })) }).byId.ai.finish).toBe('2026-09-14');
  });

  it('includes both absence boundary dates and takes the smallest overlapping capacity', () => {
    const schedule = simulateDecisionLab(input([element('a')], { availability: [
      absence(),
      absence({ id: 'rotation', start_date: '2026-09-08', end_date: '2026-09-09', capacity_hours_per_day: 4 }),
    ] }));
    expect(schedule.byId.a.start).toBe('2026-09-09');
    expect(schedule.byId.a.finish).toBe('2026-09-10');
  });

  it('does not assign capacity to inactive Workers', () => {
    const schedule = simulateDecisionLab(input([element('a')], { workers: [worker('w', { status: 'inactive' })] }));
    expect(schedule.byId.a).toMatchObject({ start: null, finish: null, reason: 'inactive_worker' });
  });

  it('treats zero-capacity and beyond-horizon work as unknown within a bounded horizon', () => {
    const schedule = simulateDecisionLab(input([element('a')], {
      workers: [worker('w', { capacity_hours_per_day: 0 })], horizonDays: Number.POSITIVE_INFINITY,
    }));
    expect(schedule.horizonEnd).toBe('2026-12-05');
    expect(schedule.byId.a).toMatchObject({ finish: null, reason: 'horizon' });
    expect(simulateDecisionLab(input([element('a', { start_date: '2099-01-01' })], { horizonDays: 1e8 })).horizonEnd).toBe('2027-03-05');
  });

  it('walks leap-day, year, and DST boundaries as calendar dates', () => {
    const leap = simulateDecisionLab(input([element('a', { estimated_hours: 24, due_date: '2024-03-01' })], { today: '2024-02-28' }));
    expect(leap.byId.a.finish).toBe('2024-03-01');
    expect(leap.byId.a.lateDays).toBe(0);
    const year = simulateDecisionLab(input([element('a', { estimated_hours: 16 })], { today: '2026-12-31' }));
    expect(year.byId.a.finish).toBe('2027-01-01');
    const dst = simulateDecisionLab(input([element('a', { estimated_hours: 24 })], { today: '2026-03-07', workweek: 'everyday' }));
    expect(dst.byId.a.finish).toBe('2026-03-09');
  });

  it('keeps the horizon inside valid four-digit calendar dates', () => {
    const schedule = simulateDecisionLab(input([element('a', { estimated_hours: 24, due_date: null })], { today: '9999-12-31' }));
    expect(schedule.horizonEnd).toBe('9999-12-31');
    expect(schedule.byId.a).toMatchObject({ finish: null, reason: 'horizon' });
  });
});

describe('Decision Lab uncertainty and dependencies', () => {
  it('excludes closed and backlog work, while preserving the backlog count', () => {
    const schedule = simulateDecisionLab(input([
      element('done', { status: 'done', estimated_hours: null }),
      element('cancelled', { status: 'cancelled' }),
      element('backlog', { status: 'backlog', priority: 'urgent' }), element('a'),
    ]));
    expect(schedule.byId.a.finish).toBe(TODAY);
    expect(schedule.excludedBacklogCount).toBe(1);
    expect(schedule.scope).toMatchObject({ scheduled: 1, excluded: 3, unknown: 0, remainingHours: 8 });
  });

  it('starts dependents the next day, with done upstream satisfied and cancelled upstream unknown', () => {
    const schedule = simulateDecisionLab(input([
      element('a', { estimated_hours: 1 }), element('b', { estimated_hours: 1, priority: 'urgent' }),
      element('done', { status: 'done' }), element('c', { estimated_hours: 1 }),
      element('cancelled', { status: 'cancelled' }), element('d'),
    ], { edges: [edge('a', 'b'), edge('done', 'c'), edge('cancelled', 'd')] }));
    expect(schedule.byId.a.finish).toBe(TODAY);
    expect(schedule.byId.b.start).toBe('2026-09-08');
    expect(schedule.byId.c.start).toBe(TODAY);
    expect(schedule.byId.d).toMatchObject({ reason: 'unresolved_dependency', finish: null });
  });

  it('never manufactures a date for invisible prerequisites, cycles, or their dependents', () => {
    const schedule = simulateDecisionLab(input([
      element('a'), element('b'), element('c'), element('hidden'), element('self'), element('safe'),
    ], { edges: [edge('a', 'b'), edge('b', 'a'), edge('b', 'c'), edge('invisible', 'hidden'), edge('self', 'self')] }));
    expect(schedule.byId.a.reason).toBe('dependency_cycle');
    expect(schedule.byId.b.reason).toBe('dependency_cycle');
    expect(schedule.byId.c.reason).toBe('unresolved_dependency');
    expect(schedule.byId.hidden.reason).toBe('unknown_dependency');
    expect(schedule.byId.self.reason).toBe('dependency_cycle');
    for (const id of ['a', 'b', 'c', 'hidden', 'self']) expect(schedule.byId[id].finish).toBeNull();
    expect(schedule.byId.safe.finish).toBe(TODAY);
    expect(schedule.scope.finish).toBeNull();
  });

  it('recognizes every member of overlapping cycles and keeps descendants separate', () => {
    const schedule = simulateDecisionLab(input(['a', 'b', 'c', 'd', 'e'].map((id) => element(id)), {
      edges: [edge('a', 'b'), edge('b', 'c'), edge('c', 'a'), edge('a', 'd'), edge('d', 'c'), edge('d', 'e')],
    }));
    for (const id of ['a', 'b', 'c', 'd']) expect(schedule.byId[id].reason).toBe('dependency_cycle');
    expect(schedule.byId.e.reason).toBe('unresolved_dependency');
  });

  it('does not turn a completed predecessor’s historical dependency into a live cycle', () => {
    const schedule = simulateDecisionLab(input([
      element('done', { status: 'done' }), element('pending'),
    ], { edges: [edge('done', 'pending'), edge('pending', 'done')] }));
    expect(schedule.byId.pending).toMatchObject({ start: TODAY, finish: TODAY, reason: null });
  });

  it('leaves blocked, unassigned, malformed, and missing scope rows explicitly unknown', () => {
    const schedule = simulateDecisionLab(input([
      element('blocked', { status: 'blocked' }), element('unassigned', { assignees: [] }),
      element('negative', { estimated_hours: -1 }), element('nan', { estimated_hours: NaN }),
      element('badProgress', { progress: 101 }), element('badDate', { start_date: '2026-02-30' }),
      element('badDue', { due_date: '2026-9-7' }),
      element('missingWorker', { assignees: [{ id: 'missing', element_id: 'missingWorker', worker_id: 'missing', role: null, assigned_at: null }] }),
    ], { scopeElementIds: ['blocked', 'unassigned', 'negative', 'nan', 'badProgress', 'badDate', 'badDue', 'missingWorker', 'missingElement'] }));
    expect(schedule.byId.blocked.reason).toBe('blocked');
    expect(schedule.byId.unassigned.reason).toBe('unassigned');
    expect(schedule.byId.negative.reason).toBe('invalid_estimate');
    expect(schedule.byId.nan.reason).toBe('invalid_estimate');
    expect(schedule.byId.badProgress.reason).toBe('invalid_progress');
    expect(schedule.byId.badDate.reason).toBe('invalid_date');
    expect(schedule.byId.badDue.reason).toBe('invalid_date');
    expect(schedule.byId.missingWorker.reason).toBe('missing_worker');
    expect(schedule.byId.missingElement.reason).toBe('missing_element');
    expect(schedule.scope.scheduled).toBe(0);
    expect(schedule.scope.unknown).toBe(9);
  });

  it('fails safely for invalid current dates, capacity and absence data', () => {
    expect(simulateDecisionLab(input([element('a')], { today: 'not a date' })).byId.a.reason).toBe('invalid_date');
    expect(simulateDecisionLab(input([element('a')], { workers: [worker('w', { capacity_hours_per_day: NaN })] })).byId.a.reason).toBe('invalid_capacity');
    expect(simulateDecisionLab(input([element('a')], { availability: [absence({ capacity_hours_per_day: -1 })] })).byId.a.reason).toBe('invalid_capacity');
    expect(simulateDecisionLab(input([element('a')], { availability: [absence({ start_date: '2030-01-01' })] })).byId.a.reason).toBe('invalid_capacity');
  });

  it('keeps a zero-effort milestone without inventing an assignee or consuming capacity', () => {
    const schedule = simulateDecisionLab(input([
      element('a', { estimated_hours: 0, assignees: [] }),
      element('b', { estimated_hours: 8, progress: 100, assignees: [] }), element('c'),
    ], { edges: [edge('a', 'b')] }));
    expect(schedule.byId.a).toMatchObject({ start: TODAY, finish: TODAY, remainingHours: 0, reason: null });
    expect(schedule.byId.b.finish).toBe('2026-09-08');
    expect(schedule.byId.c.finish).toBe(TODAY);
  });
});

describe('Decision Lab experiment comparison', () => {
  it('promotes the focus dependency chain and exposes delayed outside work', () => {
    const args = input([
      element('outside', { priority: 'urgent' }), element('upstream', { priority: 'low' }),
      element('focus', { priority: 'low', due_date: '2026-09-08' }),
    ], { edges: [edge('upstream', 'focus')], scopeElementIds: ['focus'] });
    const comparison = compareDecisionLab(args, { focusElementId: 'focus' });
    expect(comparison.baseline.byId.focus.finish).toBe('2026-09-09');
    expect(comparison.scenario.byId.focus.finish).toBe('2026-09-08');
    expect(comparison.scopeChanges[0]).toMatchObject({ change: 'improved', days: 1, recovered: true });
    expect(comparison.outsideEffects.find((change) => change.elementId === 'outside')).toMatchObject({ change: 'worsened', days: -2, newlyLate: true });
  });

  it('stops promoting prerequisites at an already completed predecessor', () => {
    const args = input([
      element('outside', { priority: 'urgent' }), element('ancestor', { priority: 'low' }),
      element('done', { status: 'done' }), element('focus', { priority: 'low' }),
    ], { edges: [edge('ancestor', 'done'), edge('done', 'focus')], scopeElementIds: ['focus'] });
    const comparison = compareDecisionLab(args, { focusElementId: 'focus' });
    expect(comparison.scenario.byId.focus.finish).toBe(TODAY);
    expect(comparison.scenario.byId.outside.finish).toBe('2026-09-08');
    expect(comparison.scenario.byId.ancestor.finish).toBe('2026-09-09');
  });

  it('shows the cost of reassignment to another Worker’s existing commitments', () => {
    const args = input([
      element('focus', { priority: 'urgent', estimated_hours: 16 }),
      element('outside', { assignees: [{ id: 'other-as', element_id: 'outside', worker_id: 'x', role: 'assignee', assigned_at: null }] }),
    ], { scopeElementIds: ['focus'], workers: [worker('w', { capacity_hours_per_day: 4 }), worker('x')] });
    const comparison = compareDecisionLab(args, { reassignElementId: 'focus', workerId: 'x' });
    expect(comparison.scopeChanges[0]).toMatchObject({ change: 'improved', days: 2 });
    expect(comparison.outsideEffects[0]).toMatchObject({ elementId: 'outside', change: 'worsened', days: -2, newlyLate: true });
    expect(comparison.scenario.byId.focus.workerIds).toEqual(['x']);
  });

  it('defers seven calendar days without changing due dates or mutating inputs', () => {
    const args = input([element('a'), element('b')]);
    const saved = structuredClone(args);
    const comparison = compareDecisionLab(args, { deferElementId: 'a', deferDays: 7 });
    expect(comparison.scenario.byId.a.start).toBe('2026-09-14');
    expect(comparison.scenario.byId.a.lateDays).toBe(7);
    expect(args).toEqual(saved);
  });

  it('does not label unknown dates as improvement, lateness recovery, or on time', () => {
    const comparison = compareDecisionLab(input([element('a', { estimated_hours: null })]), { focusElementId: 'a' });
    expect(comparison.scopeChanges[0]).toMatchObject({ change: 'unknown', days: null, recovered: false, newlyLate: false });
    expect(comparison.scenario.byId.a.lateDays).toBeNull();
  });

  it('keeps the snapshot stable across fetch order and changes it when a planning fact changes', () => {
    const args = input([element('a'), element('b')], { edges: [edge('a', 'b')] });
    expect(decisionLabFingerprint(args)).toBe(decisionLabFingerprint({ ...args, elements: [...args.elements].reverse(), scopeElementIds: [...args.scopeElementIds].reverse() }));
    expect(decisionLabFingerprint(args)).not.toBe(decisionLabFingerprint({ ...args, workers: [worker('w', { capacity_hours_per_day: 4 })] }));
    expect(decisionLabFingerprint(args)).not.toBe(decisionLabFingerprint({ ...args, elements: [element('a', { progress: 50 }), element('b')] }));
    expect(decisionLabFingerprint(args)).not.toBe(decisionLabFingerprint({ ...args, edges: [] }));
    expect(compareDecisionLab(args, { focusElementId: 'a' }).fingerprint).not.toBe(compareDecisionLab(args, { focusElementId: 'b' }).fingerprint);
  });
});
