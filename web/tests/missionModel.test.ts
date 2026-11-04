import { describe, expect, it } from 'vitest';
import {
  actionState, buildMissionGraph, draftGraph, latestRuns, missionBarriers, missionSummary, normalizePlan,
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

describe('buildMissionGraph', () => {
  it('hangs actions off the measures they deliver, and the rest off the Strategy', () => {
    const g = buildMissionGraph({
      initiativeName: 'Win', measures: [measure('m1', 12)], elements: [el('a'), el('b')],
      bindings: [{ intent_id: 'm1', target_type: 'element', target_id: 'a', relationship_type: 'delivers' }],
      edges: [{ from_element: 'a', to_element: 'b' }, { from_element: 'a', to_element: 'outside' }],
      runs: [], artifacts: [{ id: 'x', element_id: 'a', title: 'Report' }, { id: 'y', element_id: 'gone', title: 'Lost' }],
    });
    expect(g.nodes.map((n) => n.id)).toEqual(['initiative', 'm:m1', 'e:a', 'e:b', 'a:x']);
    expect(g.nodes.find((n) => n.id === 'm:m1')?.state).toBe('met');
    expect(g.edges).toContainEqual({ from: 'm:m1', to: 'e:a', kind: 'serves' });
    expect(g.edges).toContainEqual({ from: 'initiative', to: 'e:b', kind: 'serves' });
    expect(g.edges).toContainEqual({ from: 'e:a', to: 'e:b', kind: 'depends' });
    expect(g.edges.some((e) => e.to === 'e:outside')).toBe(false);
    expect(g.edges).toContainEqual({ from: 'e:a', to: 'a:x', kind: 'produces' });
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
    expect(plan.objectives).toEqual([{ key: 'o1', title: 'Grow', measureId: 'm1' }, { key: 'o2', title: 'New', measureId: null }]);
    expect(plan.tasks.map((t) => [t.key, t.objective, t.dependsOn, t.assignee])).toEqual([
      ['t1', 'o1', [], 'ai'], ['t2', null, ['t1'], 'human'], ['t3', null, [], 'ai'],
    ]);
  });

  it('survives a malformed answer', () => {
    expect(normalizePlan(null, new Set())).toEqual({ summary: '', objectives: [], tasks: [] });
  });

  it('draws the draft with its new nodes marked', () => {
    const draft = normalizePlan({
      objectives: [{ key: 'o1', title: 'Grow', measureId: 'm1' }, { key: 'o2', title: 'New' }],
      tasks: [{ key: 't1', title: 'A', objective: 'o2' }, { key: 't2', title: 'B', dependsOn: ['t1'] }],
    }, new Set(['m1']));
    const g = draftGraph('Win', [measure('m1', null)], draft);
    expect(g.nodes.find((n) => n.id === 'm:m1')?.draft).toBe(false);
    expect(g.nodes.find((n) => n.id === 'o:o2')?.draft).toBe(true);
    expect(g.edges).toContainEqual({ from: 'o:o2', to: 't:t1', kind: 'serves', draft: true });
    expect(g.edges).toContainEqual({ from: 'initiative', to: 't:t2', kind: 'serves', draft: true });
    expect(g.edges).toContainEqual({ from: 't:t1', to: 't:t2', kind: 'depends', draft: true });
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
