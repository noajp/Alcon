import { describe, expect, it } from 'vitest';
import {
  actionState, buildFleet, chainCardMatches, draftFleet, latestRuns, measureOutcomes, moveDraftTask, startableTasks, UNPLACED, missionBarriers, missionSummary, normalizePlan, verdictTallyOf,
  type ChainFilter, type FleetElement, type MissionElementRow, type MissionMeasureRow, type MissionRunRow, handOverLabels, isHandedOver
} from '@/ActivitySpace/strategy/initiative/mission/missionModel';
import { waitingReasonsByElement, type WaitingReason } from '@/ActivitySpace/execution/chain/waiting';
import type { RunVerdict } from '@/Function/audit/auditModel';

const el = (id: string, status: string | null = 'todo'): MissionElementRow => ({ id, title: `Task ${id}`, status, display_id: null, object_id: 'o1' });
const run = (element_id: string, status: MissionRunRow['status'], created_at: string, extra: Partial<MissionRunRow> = {}): MissionRunRow => ({
  id: `run-${element_id}-${created_at}`, element_id, status, input_tokens: 100, output_tokens: 50, cost_usd: '0.10', summary: null, error: null, created_at,
  verdict: null, proposed_readings: null, ...extra,
});
const measure = (id: string, actual: number | null, target: number | null = 10): MissionMeasureRow => ({
  id, title: `Measure ${id}`, target_value: target, actual_value: actual, unit: null, direction: 'at_least', measured_at: null,
});
const verdict = (result: 'pass' | 'fail' | 'unchecked'): RunVerdict => ({
  v: 1, result, source: result === 'unchecked' ? 'none' : 'verifier', model: 'claude-test', gaps: [], revisions: 0,
  checkedAt: '2026-11-07T01:00:00Z', outcome: 'completed', reason: null, evidence: { verifyStepIdx: 3, artifactIds: [] },
});

describe('actionState', () => {
  it('reads the Element first, then its latest run', () => {
    expect(actionState(el('a', 'done'), run('a', 'running', '1'))).toBe('done');
    expect(actionState(el('a', 'blocked'), undefined)).toBe('blocked');
    expect(actionState(el('a'), run('a', 'queued', '1'))).toBe('running');
    expect(actionState(el('a'), run('a', 'awaiting_approval', '1'))).toBe('waiting');
    expect(actionState(el('a'), run('a', 'failed', '1'))).toBe('failed');
    expect(actionState(el('a', 'review'), undefined)).toBe('waiting');
    expect(actionState(el('a'), undefined)).toBe('todo');
  });

  it('takes the latest run per Element', () => {
    const latest = latestRuns([run('a', 'failed', '2026-11-01'), run('a', 'completed', '2026-11-02')]);
    expect(latest.get('a')?.status).toBe('completed');
  });
});

describe('buildFleet', () => {
  it('puts each Element under its Object with what it delivers, waits on, and whether an AI may start it', () => {
    const fleet = buildFleet({
      objects: [{ id: 'o1', name: 'Site', domain_id: 'd1' }, { id: 'o2', name: 'Empty', domain_id: null }],
      elements: [
        { ...el('a', 'done'), assignee: 'ai' },
        { ...el('b'), assignee: 'ai', assigneeName: 'Writer' },
        { ...el('c'), assignee: 'human' },
        { ...el('d'), claudeCode: true },
        el('e', 'cancelled'),
      ],
      measures: [measure('m1', 12)],
      bindings: [{ intent_id: 'm1', target_type: 'element', target_id: 'b', relationship_type: 'delivers' }],
      edges: [{ from_element: 'a', to_element: 'b' }, { from_element: 'b', to_element: 'c' }, { from_element: 'outside', to_element: 'c' }],
      runs: [run('b', 'failed', '1', { cost_usd: 0.25 }), run('b', 'completed', '0', { cost_usd: 0.1 })],
    });
    expect(fleet.map((o) => [o.key, o.elements.map((e) => e.key)])).toEqual([['o1', ['b', 'c', 'd', 'a', 'e']], ['o2', []]]);
    const [site] = fleet;
    const b = site.elements.find((e) => e.key === 'b')!;
    expect(b).toMatchObject({ state: 'failed', serves: ['Measure m1'], waitsOn: [], ready: true, assigneeName: 'Writer', costUsd: 0.35 });
    const c = site.elements.find((e) => e.key === 'c')!;
    expect(c).toMatchObject({ waitsOn: ['Task b'], ready: false });
    expect(site.elements.find((e) => e.key === 'd')).toMatchObject({ ready: false, handable: true });
    expect(site.tally).toEqual({ total: 4, done: 1, running: 0, waiting: 0, stopped: 1 });
    expect(site.state).toBe('failed');
    expect(fleet[1].state).toBe('todo');
  });
});

describe('missionSummary and missionBarriers', () => {
  const elements = [el('a', 'done'), el('b'), el('c', 'blocked'), el('d'), el('e', 'cancelled')];
  const runs = [run('b', 'running', '1'), run('d', 'failed', '1', { error: 'boom' }), run('a', 'completed', '1', { cost_usd: 0.3 })];

  it('counts actions without the cancelled ones, and every run\'s tokens and cost', () => {
    const s = missionSummary({ elements, measures: [measure('m1', 12), measure('m2', 3)], runs, artifacts: [] });
    expect(s).toMatchObject({ actions: 4, done: 1, running: 1, blocked: 1, failed: 1, progress: 25, measures: 2, measuresMet: 1 });
    expect(s.inputTokens).toBe(300);
    expect(s.costUsd).toBe(0.5);
  });

  it('lists blocked, then failed, then waiting work', () => {
    const b = missionBarriers([...elements, el('f', 'review')], runs);
    expect(b.map((x) => [x.elementId, x.kind])).toEqual([['c', 'blocked'], ['d', 'failed'], ['f', 'waiting']]);
    expect(b[1].detail).toBe('boom');
  });
});

describe('normalizePlan', () => {
  it('keeps only what points somewhere real, and dependencies only on earlier tasks', () => {
    const plan = normalizePlan({
      summary: ' Do it ',
      objectives: [{ key: 'o1', title: 'Grow', measureId: 'm1' }, { key: 'o2', title: 'New', measureId: 'not-ours' }, { key: 'o1', title: 'dup' }, { title: 'no key' }],
      tasks: [
        { key: 't1', title: 'First', description: 'd', objective: 'o1', assignee: 'ai', dependsOn: ['t2'] },
        { key: 't2', title: 'Second', objective: 'zz', assignee: 'human', dependsOn: ['t1', 't1', 'nope'] },
        { key: 't2', title: 'dup' },
        { key: 't3', title: 'Third', assignee: 'robot' },
      ],
    }, new Set(['m1']));
    expect(plan.summary).toBe('Do it');
    expect(plan.objects).toEqual([]);
    expect(plan.objectives).toEqual([{ key: 'o1', title: 'Grow', measureId: 'm1' }, { key: 'o2', title: 'New', measureId: null }]);
    expect(plan.tasks.map((t) => [t.key, t.objective, t.dependsOn, t.assignee])).toEqual([
      ['t1', 'o1', [], 'ai'], ['t2', null, ['t1'], 'human'], ['t3', null, [], 'ai'],
    ]);
  });

  it('keeps a person only on a person\'s task, and only one of the Space\'s people', () => {
    const plan = normalizePlan({
      tasks: [
        { key: 't1', title: 'Sign', assignee: 'human', assigneeWorkerId: 'w1' },
        { key: 't2', title: 'Review', assignee: 'human', assigneeWorkerId: 'made-up' },
        { key: 't3', title: 'Draft', assignee: 'ai', assigneeWorkerId: 'w1' },
        { key: 't4', title: 'Decide', assignee: 'human' },
        { key: 't5', title: 'Odd', assignee: 'human', assigneeWorkerId: 42 },
      ],
    }, new Set(), { workerIds: new Set(['w1', 'w2']) });
    expect(plan.tasks.map((t) => [t.key, t.assigneeWorkerId])).toEqual([
      ['t1', 'w1'], ['t2', null], ['t3', null], ['t4', null], ['t5', null],
    ]);
    // With no people known, no id is trusted.
    expect(normalizePlan({ tasks: [{ key: 't1', title: 'Sign', assignee: 'human', assigneeWorkerId: 'w1' }] }, new Set()).tasks[0].assigneeWorkerId).toBeNull();
  });

  it('names the chosen person on the draft card', () => {
    const draft = normalizePlan({
      tasks: [{ key: 't1', title: 'Sign', assignee: 'human', assigneeWorkerId: 'w1' }, { key: 't2', title: 'Decide', assignee: 'human' }],
    }, new Set(), { workerIds: new Set(['w1']) });
    const cards = draftFleet([], [], draft, new Map([['w1', 'Hanako']])).flatMap((o) => o.elements);
    expect(cards.map((c) => c.assigneeName)).toEqual(['Hanako', null]);
  });

  it('survives a malformed answer', () => {
    expect(normalizePlan(null, new Set())).toEqual({ summary: '', objectives: [], objects: [], tasks: [] });
  });

  it('places tasks in the Strategy\'s Objects or new ones, and only in Domains the Space has', () => {
    const plan = normalizePlan({
      objects: [
        { key: 'b1', objectId: 'o1', name: 'ignored' },
        { key: 'b2', objectId: 'o1' },
        { key: 'b3', objectId: 'not-ours', name: 'Guide', domainId: 'd1' },
        { key: 'b4', name: 'Kit', domainId: 'elsewhere' },
        { key: 'b5', name: 'Unused', domainId: 'd1' },
        { key: 'b6' },
      ],
      tasks: [
        { key: 't1', title: 'A', object: 'b1' }, { key: 't2', title: 'B', object: 'b2' },
        { key: 't3', title: 'C', object: 'b3' }, { key: 't4', title: 'D', object: 'b4' }, { key: 't5', title: 'E', object: 'b6' },
      ],
    }, new Set(), { objects: new Map([['o1', 'Site']]), domainIds: new Set(['d1']) });
    expect(plan.objects).toEqual([
      { key: 'b1', objectId: 'o1', name: 'Site', domainId: null },
      { key: 'b3', objectId: null, name: 'Guide', domainId: 'd1' },
      { key: 'b4', objectId: null, name: 'Kit', domainId: null },
    ]);
    expect(plan.tasks.map((t) => t.object)).toEqual(['b1', 'b1', 'b3', 'b4', null]);
  });

  it('lays the draft over the Objects: tasks join their Object, new Objects and unplaced work follow, dashed', () => {
    const current = buildFleet({
      objects: [{ id: 'o1', name: 'Site', domain_id: 'd1' }], elements: [el('a', 'done')],
      measures: [measure('m1', null)], bindings: [], edges: [], runs: [],
    });
    const draft = normalizePlan({
      objectives: [{ key: 'g1', title: 'Grow', measureId: 'm1' }],
      objects: [{ key: 'b1', objectId: 'o1' }, { key: 'b2', name: 'Guide', domainId: 'd1' }],
      tasks: [
        { key: 't1', title: 'Write', objective: 'g1', object: 'b2' },
        { key: 't2', title: 'Publish', object: 'b1', dependsOn: ['t1'], assignee: 'human' },
        { key: 't3', title: 'Loose' },
      ],
    }, new Set(['m1']), { objects: new Map([['o1', 'Site']]), domainIds: new Set(['d1']) });
    const fleet = draftFleet(current, [measure('m1', null)], draft);
    expect(fleet.map((o) => [o.key, o.draft, o.elements.map((e) => e.key)])).toEqual([
      ['o1', false, ['a', 't:t2']],
      ['b:b2', true, ['t:t1']],
      [UNPLACED, true, ['t:t3']],
    ]);
    expect(fleet[0].elements[1]).toMatchObject({ draft: true, waitsOn: ['Write'], assignee: 'human' });
    expect(fleet[1].elements[0]).toMatchObject({ serves: ['Measure m1'], ready: false });
    expect(startableTasks(draft)).toEqual(['t1', 't3']);
  });
});

describe('moveDraftTask', () => {
  const draft = normalizePlan({
    objects: [{ key: 'b1', objectId: 'o1' }, { key: 'b2', name: 'Guide', domainId: 'd1' }],
    tasks: [{ key: 't1', title: 'A', object: 'b1' }, { key: 't2', title: 'B', object: 'b2' }],
  }, new Set(), { objects: new Map([['o1', 'Site'], ['o2', 'Shop']]), domainIds: new Set(['d1']) });

  it('moves a task into one of the Strategy\'s Objects, adding it to the draft, and drops a new Object left empty', () => {
    const moved = moveDraftTask(draft, 't2', { objectId: 'o2', name: 'Shop', draftKey: null });
    expect(moved.objects.map((o) => [o.objectId, o.name])).toEqual([['o1', 'Site'], ['o2', 'Shop']]);
    expect(moved.tasks.find((t) => t.key === 't2')?.object).toBe(moved.objects[1].key);
  });

  it('moves a task into an Object the draft adds, or leaves it unplaced', () => {
    expect(moveDraftTask(draft, 't1', { objectId: null, draftKey: 'b2' }).tasks.map((t) => t.object)).toEqual(['b2', 'b2']);
    expect(moveDraftTask(draft, 't1', { objectId: null, draftKey: null }).tasks[0].object).toBeNull();
  });
});

describe('Claude Code work', () => {
  const el = (over: Partial<MissionElementRow> = {}): MissionElementRow => ({
    id: 'e1', title: 't', status: 'todo', display_id: null, object_id: 'o1', claudeCode: true, ...over,
  });

  it('reads a held lease as running and ignores run rows', () => {
    expect(actionState(el({ status: 'in_progress', leased: true }), undefined)).toBe('running');
    expect(actionState(el({ status: 'in_progress', leased: false }), undefined)).toBe('todo');
    expect(actionState(el({ status: 'review' }), undefined)).toBe('waiting');
    expect(actionState(el({ status: 'blocked' }), undefined)).toBe('blocked');
    expect(actionState(el({ status: 'done' }), undefined)).toBe('done');
  });

  it('hands over by adding the dispatch label once', () => {
    expect(isHandedOver(el({ labels: ['ui', 'dispatch'] }))).toBe(true);
    expect(isHandedOver(el({ labels: null }))).toBe(false);
    expect(handOverLabels(['ui'])).toEqual(['ui', 'dispatch']);
    expect(handOverLabels(['dispatch'])).toEqual(['dispatch']);
    expect(handOverLabels(null)).toEqual(['dispatch']);
  });
});

describe('Planner questions', () => {
  it('keeps at most five questions with unique keys and at most five distinct options', async () => {
    const { normalizeQuestions } = await import('@/ActivitySpace/strategy/initiative/mission/missionModel');
    const qs = normalizeQuestions([
      { key: 'q1', question: '購入か賃貸か', options: ['購入', '賃貸', '賃貸', ''] },
      { key: 'q1', question: '重複', options: [] },
      { key: 'q2', question: '', options: ['x'] },
      { question: 'エリアは', options: 'not a list' },
      ...Array.from({ length: 6 }, (_, i) => ({ key: `z${i}`, question: `問${i}`, options: ['a', 'b', 'c', 'd', 'e', 'f'] })),
    ]);
    expect(qs).toHaveLength(5);
    expect(qs[0]).toEqual({ key: 'q1', question: '購入か賃貸か', options: ['購入', '賃貸'] });
    expect(qs[1]).toEqual({ key: 'q2', question: 'エリアは', options: [] });
    expect(qs[2].options).toHaveLength(5);
    expect(normalizeQuestions(null)).toEqual([]);
  });

  it('passes on only the answered questions, in order', async () => {
    const { answeredQuestions } = await import('@/ActivitySpace/strategy/initiative/mission/missionModel');
    const qs = [{ key: 'a', question: 'A?', options: [] }, { key: 'b', question: 'B?', options: [] }, { key: 'c', question: 'C?', options: [] }];
    expect(answeredQuestions(qs, { c: ' 3 ', a: '1', b: '  ' })).toEqual([{ question: 'A?', answer: '1' }, { question: 'C?', answer: '3' }]);
  });
});

describe('verdictTallyOf', () => {
  it('counts the latest run per Element only — a passed re-run supersedes an older failure', () => {
    const tally = verdictTallyOf([
      run('a', 'completed', '2026-11-01', { verdict: verdict('fail') }),
      run('a', 'completed', '2026-11-02', { verdict: verdict('pass') }),
      run('b', 'completed', '2026-11-01', { verdict: verdict('fail') }),
      run('c', 'completed', '2026-11-01', { verdict: verdict('unchecked') }),
      run('d', 'completed', '2026-11-01'),
    ]);
    expect(tally).toEqual({ pass: 1, fail: 1, unchecked: 1, none: 1 });
  });
});

describe('buildFleet verdicts', () => {
  it('surfaces each Element’s latest verdict and the Object’s tally over them', () => {
    const fleet = buildFleet({
      objects: [{ id: 'o1', name: 'Site', domain_id: 'd1' }],
      elements: [el('a', 'done'), el('b'), el('c')],
      measures: [], bindings: [], edges: [],
      runs: [
        run('a', 'completed', '2026-11-01', { verdict: verdict('fail') }),
        run('a', 'completed', '2026-11-02', { verdict: verdict('pass') }),
        run('b', 'completed', '2026-11-01', { verdict: verdict('fail') }),
      ],
    });
    const [site] = fleet;
    expect(site.elements.find((e) => e.key === 'a')?.verdict?.result).toBe('pass');
    expect(site.elements.find((e) => e.key === 'b')?.verdict?.result).toBe('fail');
    expect(site.elements.find((e) => e.key === 'c')?.verdict).toBeNull();
    expect(site.verdicts).toEqual({ pass: 1, fail: 1, unchecked: 0, none: 1 });
  });
});

describe('measureOutcomes', () => {
  const NOW = new Date('2026-11-07T00:00:00Z');
  const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
  const base = { bindings: [], elements: [], runs: [], readings: [], now: NOW };

  it('buckets freshness at the 7 and 30 day boundaries, and never-measured as never', () => {
    const outcomes = measureOutcomes({
      ...base,
      measures: [
        { ...measure('fresh', 1), measured_at: daysAgo(7) },
        { ...measure('aging', 1), measured_at: daysAgo(7.5) },
        { ...measure('agingEdge', 1), measured_at: daysAgo(30) },
        { ...measure('stale', 1), measured_at: daysAgo(31) },
        { ...measure('never', null), measured_at: null },
      ],
    });
    expect(outcomes.map((o) => [o.measure.id, o.freshness])).toEqual([
      ['fresh', 'fresh'], ['aging', 'aging'], ['agingEdge', 'aging'], ['stale', 'stale'], ['never', 'never'],
    ]);
  });

  it('picks the latest history row as the last reading', () => {
    const [outcome] = measureOutcomes({
      ...base,
      measures: [measure('m1', 5)],
      readings: [
        { intent_id: 'm1', value: 3, measured_at: daysAgo(3), source: 'manual', recorded_by_name: 'Aya', recorded_at: daysAgo(3) },
        { intent_id: 'm1', value: 5, measured_at: daysAgo(1), source: 'agent', recorded_by_name: 'Takanori', recorded_at: daysAgo(1) },
        { intent_id: 'other', value: 9, measured_at: daysAgo(0), source: 'manual', recorded_by_name: null, recorded_at: daysAgo(0) },
      ],
    });
    expect(outcome.lastReading).toEqual({ value: 5, source: 'agent', recordedByName: 'Takanori', recordedAt: daysAgo(1) });
  });

  it('attributes only applied agent readings, newest first', () => {
    const applied = (value: number, appliedAt: string) => ({
      measureId: 'm1', value, applied: true, appliedAt, appliedBy: 'u1', heldReason: null as null,
    });
    const [outcome] = measureOutcomes({
      ...base,
      measures: [measure('m1', 5)],
      runs: [
        run('a', 'completed', '2026-11-05', { id: 'r1', proposed_readings: [applied(4, '2026-11-05T02:00:00Z')] }),
        run('b', 'completed', '2026-11-06', {
          id: 'r2',
          proposed_readings: [
            applied(5, '2026-11-06T02:00:00Z'),
            { measureId: 'm1', value: 99, applied: false, appliedAt: null, appliedBy: null, heldReason: 'awaiting-acceptance' as const },
            { measureId: 'm2', value: 7, applied: true, appliedAt: '2026-11-06T03:00:00Z', appliedBy: 'u1', heldReason: null },
          ],
        }),
      ],
    });
    expect(outcome.agentReadings).toEqual([
      { runId: 'r2', elementId: 'b', value: 5, appliedAt: '2026-11-06T02:00:00Z' },
      { runId: 'r1', elementId: 'a', value: 4, appliedAt: '2026-11-05T02:00:00Z' },
    ]);
  });

  it('joins the Elements that deliver the measure, with their latest verdicts and states', () => {
    const [outcome] = measureOutcomes({
      ...base,
      measures: [measure('m1', 5)],
      elements: [el('a', 'done'), el('b')],
      bindings: [
        { intent_id: 'm1', target_type: 'element', target_id: 'a', relationship_type: 'delivers' },
        { intent_id: 'm1', target_type: 'element', target_id: 'b', relationship_type: 'delivers' },
        { intent_id: 'm1', target_type: 'object', target_id: 'o1', relationship_type: 'delivers' },
      ],
      runs: [run('a', 'completed', '2026-11-01', { verdict: verdict('pass') })],
    });
    expect(outcome.serves).toEqual([
      { elementId: 'a', title: 'Task a', verdict: verdict('pass'), state: 'done' },
      { elementId: 'b', title: 'Task b', verdict: null, state: 'todo' },
    ]);
  });
});

describe('missionSummary verdicts and staleness', () => {
  const NOW = new Date('2026-11-07T00:00:00Z');
  it('adds verdicts (run-less Elements count as none) and stale-or-never unmet measures, leaving the rest unchanged', () => {
    const s = missionSummary({
      elements: [el('a', 'done'), el('b'), el('c')],
      measures: [
        { ...measure('met', 12), measured_at: '2026-09-01T00:00:00Z' },
        { ...measure('stale', 3), measured_at: '2026-09-01T00:00:00Z' },
        { ...measure('never', null), measured_at: null },
        { ...measure('fresh', 3), measured_at: '2026-11-06T00:00:00Z' },
      ],
      runs: [run('a', 'completed', '2026-11-01', { verdict: verdict('pass') }), run('b', 'completed', '2026-11-01', { verdict: verdict('fail') })],
      artifacts: [],
      now: NOW,
    });
    expect(s.verdicts).toEqual({ pass: 1, fail: 1, unchecked: 0, none: 1 });
    expect(s.measuresStale).toBe(2);
    expect(s).toMatchObject({ actions: 3, measures: 4, measuresMet: 1 });
  });
});

describe('actionState — a run waiting for an answer', () => {
  it('reads awaiting_input as waiting, like approval and paused', () => {
    expect(actionState(el('a'), run('a', 'awaiting_input', '1'))).toBe('waiting');
    expect(actionState(el('a', 'in_progress'), run('a', 'awaiting_input', '1'))).toBe('waiting');
    const s = missionSummary({ elements: [el('a')], measures: [], runs: [run('a', 'awaiting_input', '1')], artifacts: [] });
    expect(s.waiting).toBe(1);
  });
});

describe('buildFleet blockers', () => {
  it('carries each unmet predecessor with its id, title and state; done and cancelled are not blockers', () => {
    const fleet = buildFleet({
      objects: [{ id: 'o1', name: 'Site', domain_id: 'd1' }],
      elements: [el('a'), el('b'), el('c', 'done'), el('d', 'cancelled'), el('e')],
      measures: [], bindings: [],
      edges: [
        { from_element: 'a', to_element: 'b' },
        { from_element: 'c', to_element: 'b' },
        { from_element: 'd', to_element: 'b' },
        { from_element: 'e', to_element: 'b' },
      ],
      runs: [run('e', 'failed', '1')],
    });
    const b = fleet[0].elements.find((x) => x.key === 'b')!;
    expect(b.blockers).toEqual([
      { elementId: 'a', title: 'Task a', state: 'todo' },
      { elementId: 'e', title: 'Task e', state: 'failed' },
    ]);
    // The title-only list the draft overlay reads is the same set.
    expect(b.waitsOn).toEqual(['Task a', 'Task e']);
  });

  it('gives a draft task blockers that are not written yet', () => {
    const draft = normalizePlan({
      tasks: [
        { key: 't1', title: 'First' },
        { key: 't2', title: 'Second', dependsOn: ['t1'] },
      ],
    }, new Set());
    const cards = draftFleet([], [], draft).flatMap((o) => o.elements);
    const second = cards.find((c) => c.key === 't:t2')!;
    expect(second.blockers).toEqual([{ elementId: null, title: 'First', state: 'todo' }]);
    expect(second.waitsOn).toEqual(['First']);
  });
});

describe('chainCardMatches', () => {
  const card = (extra: Partial<FleetElement> = {}): FleetElement => ({
    key: 'x', elementId: 'x', title: 'Task x', state: 'todo', draft: false, assignee: 'ai', action: null,
    assigneeName: null, assigneeWorker: null, status: 'todo', verdict: null, dueDate: null,
    serves: [], waitsOn: [], blockers: [], ready: false, handable: false, model: null, costUsd: 0, ...extra,
  });
  const reason = (needsPerson: boolean): WaitingReason => ({
    kind: needsPerson ? 'verb' : 'dependency', needsPerson, runId: null, heldReadings: 0, detail: null,
  });

  it('admits everything under no filter, drafts included', () => {
    expect(chainCardMatches(card(), 'o1', null, null)).toBe(true);
    expect(chainCardMatches(card({ draft: true, elementId: null }), 'o1', null, null)).toBe(true);
  });

  it('reads each lens from the same fact the strip counts', () => {
    expect(chainCardMatches(card(), 'o1', reason(true), { kind: 'waiting' })).toBe(true);
    expect(chainCardMatches(card(), 'o1', reason(false), { kind: 'waiting' })).toBe(false);
    expect(chainCardMatches(card(), 'o1', null, { kind: 'waiting' })).toBe(false);
    expect(chainCardMatches(card({ state: 'blocked' }), 'o1', null, { kind: 'blocked' })).toBe(true);
    expect(chainCardMatches(card({ state: 'waiting' }), 'o1', null, { kind: 'blocked' })).toBe(false);
    expect(chainCardMatches(card({ state: 'failed' }), 'o1', null, { kind: 'failed' })).toBe(true);
    expect(chainCardMatches(card({ state: 'failed' }), 'o1', null, { kind: 'blocked' })).toBe(false);
    expect(chainCardMatches(card({ verdict: verdict('fail') }), 'o1', null, { kind: 'verdict-fail' })).toBe(true);
    expect(chainCardMatches(card({ verdict: verdict('unchecked') }), 'o1', null, { kind: 'verdict-fail' })).toBe(false);
    expect(chainCardMatches(card({ verdict: verdict('pass') }), 'o1', null, { kind: 'verdict-fail' })).toBe(false);
    expect(chainCardMatches(card(), 'o1', null, { kind: 'object', objectKey: 'o1' })).toBe(true);
    expect(chainCardMatches(card(), 'o1', null, { kind: 'object', objectKey: 'o2' })).toBe(false);
  });

  it('lets a draft card match only the Object lens', () => {
    const draft = card({ draft: true, elementId: null, state: 'blocked' });
    expect(chainCardMatches(draft, 'o1', reason(true), { kind: 'object', objectKey: 'o1' })).toBe(true);
    expect(chainCardMatches(draft, 'o1', reason(true), { kind: 'waiting' })).toBe(false);
    expect(chainCardMatches(draft, 'o1', reason(true), { kind: 'blocked' })).toBe(false);
    expect(chainCardMatches(draft, 'o1', reason(true), { kind: 'verdict-fail' })).toBe(false);
  });

  it('keeps every strip count equal to the cards its filter admits', () => {
    const elements: MissionElementRow[] = [
      { ...el('a'), action: 'approve', assignee: 'human' },
      el('b'),
      el('c', 'blocked'),
      el('d'),
      el('e'),
    ];
    const runs = [
      run('d', 'failed', '1'),
      run('e', 'completed', '1', { verdict: verdict('fail') }),
    ];
    const fleet = buildFleet({
      objects: [{ id: 'o1', name: 'Site', domain_id: null }],
      elements, measures: [], bindings: [],
      edges: [{ from_element: 'a', to_element: 'b' }],
      runs,
    });
    const reasons = waitingReasonsByElement(fleet, runs);
    const summary = missionSummary({ elements, measures: [], runs, artifacts: [] });
    const admitted = (filter: ChainFilter) => fleet.flatMap((o) => o.elements
      .filter((e) => chainCardMatches(e, o.key, e.elementId ? reasons.get(e.elementId) ?? null : null, filter))).length;
    const waitingCount = [...reasons.values()].filter((r) => r?.needsPerson).length;
    expect(waitingCount).toBe(2); // a's verb and c's blocked state both need a person
    expect(admitted({ kind: 'waiting' })).toBe(waitingCount);
    expect(admitted({ kind: 'blocked' })).toBe(summary.blocked);
    expect(admitted({ kind: 'failed' })).toBe(summary.failed);
    expect(admitted({ kind: 'verdict-fail' })).toBe(summary.verdicts.fail);
    expect(admitted({ kind: 'object', objectKey: 'o1' })).toBe(5);
    expect(admitted({ kind: 'object', objectKey: 'elsewhere' })).toBe(0);
    expect(admitted(null)).toBe(5);
  });
});
