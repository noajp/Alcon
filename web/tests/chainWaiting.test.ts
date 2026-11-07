import { describe, expect, it } from 'vitest';
import { waitingReason, waitingReasonsByElement, waitsOnPerson } from '@/ActivitySpace/execution/chain/waiting';
import { buildFleet, type ActionState, type MissionRunRow } from '@/ActivitySpace/strategy/initiative/mission/missionModel';
import type { ElementAction } from '@/Function/shared/elementActionKinds';
import type { ProposedReading } from '@/Function/audit/auditModel';

const el = (status: string | null, action: string | null = null) => ({ status, action }) as never;

describe('waitsOnPerson', () => {
  it('marks what only a person can carry', () => {
    for (const verb of ['judge', 'decide', 'approve', 'answer']) expect(waitsOnPerson(el('todo', verb), null), verb).toBe(true);
    for (const verb of ['research', 'create', 'execute', 'verify']) expect(waitsOnPerson(el('todo', verb), null), verb).toBe(false);
  });

  it('marks a blocked Element and an AI run that stopped to ask', () => {
    expect(waitsOnPerson(el('blocked'), null)).toBe(true);
    expect(waitsOnPerson(el('in_progress', 'create'), 'awaiting_approval')).toBe(true);
    expect(waitsOnPerson(el('in_progress', 'research'), 'awaiting_input')).toBe(true);
    expect(waitsOnPerson(el('in_progress', 'research'), 'running')).toBe(false);
    expect(waitsOnPerson(el('todo'), null)).toBe(false);
  });

  it('leaves closed work alone', () => {
    expect(waitsOnPerson(el('done', 'approve'), 'awaiting_approval')).toBe(false);
    expect(waitsOnPerson(el('cancelled', 'decide'), null)).toBe(false);
  });
});

const elem = (status: string | null, action: ElementAction | null = null) => ({ status, action });
const runRow = (status: MissionRunRow['status'], extra: Partial<MissionRunRow> = {}): MissionRunRow => ({
  id: 'run-1', element_id: 'e1', status, input_tokens: 0, output_tokens: 0, cost_usd: 0,
  summary: null, error: null, created_at: '2026-11-07T00:00:00Z', verdict: null, proposed_readings: null, ...extra,
});
const blocker = (state: ActionState) => ({ state });
const reading = (extra: Partial<ProposedReading> = {}): ProposedReading => ({
  measureId: 'm1', value: 3, applied: false, appliedAt: null, appliedBy: null, heldReason: 'awaiting-acceptance', ...extra,
});

describe('waitingReason', () => {
  it('names the act only a person can do, before the state of the work', () => {
    // Approval outranks even a person's verb: the run is asking now.
    expect(waitingReason({ element: elem('in_progress', 'approve'), latestRun: runRow('awaiting_approval', { summary: 'Send it?' }), blockers: [] }))
      .toMatchObject({ kind: 'approval', needsPerson: true, runId: 'run-1', detail: 'Send it?' });
    expect(waitingReason({ element: elem('in_progress'), latestRun: runRow('awaiting_input', { summary: 'Which region?' }), blockers: [] }))
      .toMatchObject({ kind: 'answer', needsPerson: true, detail: 'Which region?' });
    expect(waitingReason({ element: elem('todo', 'judge'), latestRun: null, blockers: [] }))
      .toMatchObject({ kind: 'verb', needsPerson: true });
  });

  it('counts held readings — and they outrank plain review', () => {
    const run = runRow('awaiting_review', {
      proposed_readings: [
        reading(),
        reading({ measureId: 'm2' }),
        reading({ measureId: 'm3', applied: true, appliedAt: '2026-11-07T01:00:00Z', heldReason: null }),
        reading({ measureId: 'm4', heldReason: 'verdict-not-pass' }),
      ],
    });
    expect(waitingReason({ element: elem('review'), latestRun: run, blockers: [] }))
      .toMatchObject({ kind: 'readings', needsPerson: true, heldReadings: 2 });
    // With nothing held, the same run is plain review.
    expect(waitingReason({ element: elem('in_progress'), latestRun: runRow('awaiting_review'), blockers: [] }))
      .toMatchObject({ kind: 'review', needsPerson: true, runId: 'run-1' });
    expect(waitingReason({ element: elem('review'), latestRun: null, blockers: [] }))
      .toMatchObject({ kind: 'review', needsPerson: true, runId: null });
  });

  it('keeps blocked blocked, and a paused run outranks its dependencies', () => {
    expect(waitingReason({ element: elem('blocked'), latestRun: null, blockers: [blocker('running')] }))
      .toMatchObject({ kind: 'blocked', needsPerson: true });
    expect(waitingReason({ element: elem('todo'), latestRun: runRow('paused', { error: 'Session expired' }), blockers: [blocker('todo')] }))
      .toMatchObject({ kind: 'paused', needsPerson: true, detail: 'Session expired' });
  });

  it('waits on work, not a person, when only predecessors are open', () => {
    expect(waitingReason({ element: elem('todo'), latestRun: null, blockers: [blocker('todo'), blocker('running')] }))
      .toMatchObject({ kind: 'dependency', needsPerson: false });
    expect(waitingReason({ element: elem('todo'), latestRun: runRow('running'), blockers: [] })).toBeNull();
    expect(waitingReason({ element: elem('in_progress', 'create'), latestRun: null, blockers: [] })).toBeNull();
  });

  it('leaves closed work alone, whatever its run says', () => {
    expect(waitingReason({ element: elem('done', 'approve'), latestRun: runRow('awaiting_approval'), blockers: [] })).toBeNull();
    expect(waitingReason({ element: elem('cancelled'), latestRun: null, blockers: [blocker('todo')] })).toBeNull();
  });

  it('agrees with waitsOnPerson on the run that waits for an answer', () => {
    expect(waitsOnPerson(el('in_progress', 'research'), 'awaiting_input')).toBe(true);
    expect(waitingReason({ element: elem('in_progress', 'research'), latestRun: runRow('awaiting_input'), blockers: [] })?.needsPerson).toBe(true);
  });
});

describe('waitingReasonsByElement', () => {
  it('reads the fleet the cards are drawn from', () => {
    const runs = [runRow('awaiting_input', { id: 'run-c', element_id: 'c', summary: 'Which tone?' })];
    const fleet = buildFleet({
      objects: [{ id: 'o1', name: 'Site', domain_id: null }],
      elements: [
        { id: 'a', title: 'Sign off', status: 'todo', display_id: null, object_id: 'o1', action: 'approve', assignee: 'human' },
        { id: 'b', title: 'Write', status: 'todo', display_id: null, object_id: 'o1', assignee: 'ai' },
        { id: 'c', title: 'Ask', status: 'in_progress', display_id: null, object_id: 'o1', assignee: 'ai' },
      ],
      measures: [], bindings: [],
      edges: [{ from_element: 'a', to_element: 'b' }],
      runs,
    });
    const reasons = waitingReasonsByElement(fleet, runs);
    expect(reasons.get('a')).toMatchObject({ kind: 'verb', needsPerson: true });
    expect(reasons.get('b')).toMatchObject({ kind: 'dependency', needsPerson: false });
    expect(reasons.get('c')).toMatchObject({ kind: 'answer', needsPerson: true, detail: 'Which tone?' });
    expect([...reasons.values()].filter((r) => r?.needsPerson).length).toBe(2);
  });
});
