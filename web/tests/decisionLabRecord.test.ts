import { describe, expect, it } from 'vitest';
import type { ElementWithDetails, Worker } from '@/types/database';
import { compareDecisionLab, type DecisionLabInput } from '@/alcon/element/actions/decisionLabModel';
import { decisionLabRecord } from '@/alcon/element/actions/decisionLabRecord';

function element(id: string, extra: Partial<ElementWithDetails> = {}): ElementWithDetails {
  return {
    id, title: `${id} delivery`, display_id: `ELE_${id}`, object_id: 'object',
    description: null, type: null, labels: [], owner_id: null, seq_number: null,
    status: 'todo', priority: 'medium', start_date: null, start_time: null,
    due_date: '2026-09-07', due_time: null, color: null, estimated_hours: 8,
    actual_hours: null, progress: null, direction: null, order_index: null,
    is_approval: null, approval_state: null, note_id: null, phase_id: null,
    carried_over_count: 0, created_at: null, updated_at: null,
    assignees: [{ id: `assignment-${id}`, element_id: id, worker_id: 'worker', role: 'assignee', assigned_at: null }],
    ...extra,
  };
}

const worker: Worker = {
  id: 'worker', name: 'Rin', type: 'human', status: 'active', capacity_hours_per_day: 8,
  object_id: null, user_id: null, display_id: null, seq_number: null, role: null,
  email: null, avatar_url: null, ai_model: null, ai_config: null, created_at: null, updated_at: null,
};

function plan(): DecisionLabInput {
  return {
    elements: [element('outside', { priority: 'urgent' }), element('launch', { priority: 'low' }), element('unknown', { estimated_hours: null })],
    workers: [worker], availability: [], edges: [], scopeElementIds: ['launch', 'unknown'], today: '2026-09-07',
  };
}

describe('Decision Lab durable decision record', () => {
  it('preserves why the plan was adopted, its target, and the cost to work outside the Initiative', () => {
    const input = plan();
    const scenario = { focusElementId: 'launch' };
    const record = decisionLabRecord(input, compareDecisionLab(input, scenario), scenario, 'Focus first', '  Meet the customer launch commitment.  ');
    expect(record.title).toBe('Focus first: launch delivery');
    expect(record.targetId).toBe('launch');
    expect(record.subtitle).toContain('Why: Meet the customer launch commitment.');
    expect(record.subtitle).toContain('Plan: Focus first');
    expect(record.subtitle).toContain('ELE_launch · launch delivery: 2026-09-08 → 2026-09-07');
    expect(record.subtitle).toContain('ELE_outside · outside delivery: 2026-09-07 → 2026-09-08 [outside Initiative]');
    expect(record.abandoned).toContain('ELE_outside · outside delivery: 2026-09-07 → 2026-09-08 [outside Initiative]');
    expect(record.subtitle).toContain('Other work late Elements: 0 → 1');
  });

  it('keeps unestimated work and all forecast assumptions in the saved body', () => {
    const input = plan();
    const scenario = { focusElementId: 'launch' };
    const comparison = compareDecisionLab(input, scenario);
    const record = decisionLabRecord(input, comparison, scenario, 'Focus first', 'Protect launch.');
    expect(record.subtitle).toContain('Initiative unestimated Elements: 1 → 1');
    expect(record.subtitle).toContain('ELE_unknown · unknown delivery: Unestimated → Unestimated (missing_estimate)');
    expect(record.subtitle).toContain('Other work unestimated Elements: 0 → 0');
    expect(record.subtitle).toContain('Assumptions:');
    for (const assumption of comparison.scenario.assumptions) expect(record.subtitle).toContain(assumption);
    expect(record.subtitle).toContain('Hidden work, skill suitability and outcome attainment are not measured.');
  });

  it('states that recording a proposal does not change execution dates or assignees', () => {
    const input = plan();
    const original = structuredClone(input);
    const scenario = { reassignElementId: 'launch', workerId: 'worker' };
    const record = decisionLabRecord(input, compareDecisionLab(input, scenario), scenario, 'Reassign', 'Use the available specialist.');
    expect(record.subtitle).toContain('Execution: proposal recorded.');
    expect(record.subtitle).toContain('dates and assignees have not been changed.');
    expect(record.subtitle).toContain('Open the linked Elements to put the decision into action');
    expect(record.subtitle).toContain('Plan: Reassign · Rin');
    expect(input).toEqual(original);
  });

  it('does not equate no calculated sacrifice with no possible harm', () => {
    const input = { ...plan(), elements: [element('launch')] , scopeElementIds: ['launch'] };
    const scenario = { focusElementId: 'launch' };
    const record = decisionLabRecord(input, compareDecisionLab(input, scenario), scenario, 'Focus first', 'Keep the plan.');
    expect(record.subtitle).toContain('No calculated finish dates changed.');
    expect(record.abandoned).toContain('No later finish identified among the calculated Elements.');
    expect(record.abandoned).toContain('Unestimated and invisible work may still be affected.');
  });
});
