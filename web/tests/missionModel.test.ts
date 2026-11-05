import { describe, expect, it } from 'vitest';
import {
  actionState, buildFleet, draftFleet, latestRuns, moveDraftTask, startableTasks, UNPLACED, missionBarriers, missionSummary, normalizePlan,
  type MissionElementRow, type MissionMeasureRow, type MissionRunRow, handOverLabels, isHandedOver
} from '@/ActivitySpace/strategy/initiative/mission/missionModel';

const el = (id: string, status: string | null = 'todo'): MissionElementRow => ({ id, title: `Task ${id}`, status, display_id: null, object_id: 'o1' });
const run = (element_id: string, status: MissionRunRow['status'], created_at: string, extra: Partial<MissionRunRow> = {}): MissionRunRow => ({
  element_id, status, input_tokens: 100, output_tokens: 50, cost_usd: '0.10', summary: null, error: null, created_at, ...extra,
});
const measure = (id: string, actual: number | null, target: number | null = 10): MissionMeasureRow => ({
  id, title: `Measure ${id}`, target_value: target, actual_value: actual, unit: null, direction: 'at_least',
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

  it('survives a malformed answer', () => {
    expect(normalizePlan(null, new Set())).toEqual({ summary: '', objectives: [], objects: [], tasks: [], harness: null });
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

describe('your turn', () => {
  it('lists what waits on a person, most pressing first, and a person\'s Element only once it is unblocked', async () => {
    const { yourTurn } = await import('@/ActivitySpace/strategy/initiative/mission/missionModel');
    const card = (id: string, over: Record<string, unknown> = {}) => ({
      key: id, elementId: id, title: id, state: 'todo', draft: false, assignee: 'ai', assigneeName: null, assigneeWorker: null,
      status: 'todo', dueDate: null, serves: [], waitsOn: [], ready: false, handable: false, model: null, costUsd: 0, ...over,
    });
    const fleet = [{
      key: 'o', objectId: 'o', name: 'O', domainId: null, draft: false, state: 'todo', costUsd: 0,
      tally: { total: 0, done: 0, running: 0, waiting: 0, stopped: 0 },
      elements: [
        card('human-ready', { assignee: 'human' }),
        card('human-waiting', { assignee: 'human', waitsOn: ['x'] }),
        card('reviewed'),
        card('blocked'),
        card('approval'),
        card('done', { assignee: 'human' }),
        card('draft', { draft: true, elementId: null }),
      ],
    }];
    const row = (id: string, status: string) => ({ id, title: id, status } as never);
    const run = (element_id: string, status: string, summary: string) =>
      ({ element_id, status, summary, error: null, model: null, input_tokens: 0, output_tokens: 0, cost_usd: 0, created_at: '2026-11-04T00:00:00Z' } as never);
    const turns = yourTurn({
      fleet: fleet as never,
      elements: [row('human-ready', 'todo'), row('human-waiting', 'todo'), row('reviewed', 'review'), row('blocked', 'blocked'), row('approval', 'in_progress'), row('done', 'done')],
      runs: [run('reviewed', 'awaiting_review', '条件メモを作成'), run('blocked', 'completed', '賃料の上限を教えて'), run('approval', 'awaiting_approval', 'x')],
      actions: [{ element_id: 'approval', summary: 'Gmail · 送信', status: 'pending' }],
    });
    expect(turns.map((x) => [x.kind, x.elementId, x.detail])).toEqual([
      ['approve', 'approval', 'Gmail · 送信'],
      ['answer', 'blocked', '賃料の上限を教えて'],
      ['review', 'reviewed', '条件メモを作成'],
      ['do', 'human-ready', null],
    ]);
  });
});
