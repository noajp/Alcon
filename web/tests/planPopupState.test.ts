import { describe, expect, it } from 'vitest';
import { planCallsFromAction, planPopupState, procedureLines } from '@/ActivitySpace/execution/element/agent/planPopupState';
import type { AgentAction } from '@/types/database';

// The Execute popup's pure readings: every state in the chain from
// (open run, pending) pairs, the sealed plan's call list with its
// verdict fields lifted out, and the definition outline's parse.

const planAction = { tool: 'plan' };
const askAction = { tool: 'github__create_pull_request' };

describe('planPopupState', () => {
  it('no run reads as idle', () => {
    expect(planPopupState(null, null, true)).toEqual({ state: 'idle', readOnly: false });
    expect(planPopupState(undefined, null, false)).toEqual({ state: 'idle', readOnly: false });
  });

  it('an open plan run reads as planning, in every working status', () => {
    for (const status of ['queued', 'running', 'paused'] as const) {
      expect(planPopupState({ status, plan_mode: true }, null, true).state).toBe('planning');
    }
  });

  it('a run resting on its plan action reads as plan-ready', () => {
    expect(planPopupState({ status: 'awaiting_approval', plan_mode: true }, planAction, true))
      .toEqual({ state: 'plan-ready', readOnly: false });
  });

  it('an open non-plan run reads as applying', () => {
    expect(planPopupState({ status: 'running', plan_mode: false }, null, true).state).toBe('applying');
    expect(planPopupState({ status: 'queued', plan_mode: null }, null, true).state).toBe('applying');
  });

  it('a run resting on a non-plan approval reads as resting', () => {
    expect(planPopupState({ status: 'awaiting_approval', plan_mode: false }, askAction, true).state).toBe('resting');
  });

  it('a finished run reads as done, whoever started it', () => {
    for (const status of ['completed', 'failed', 'cancelled', 'awaiting_review'] as const) {
      expect(planPopupState({ status, plan_mode: true }, null, false)).toEqual({ state: 'done', readOnly: false });
    }
  });

  it("another person's open run is read-only in every state it can stand in", () => {
    expect(planPopupState({ status: 'running', plan_mode: true }, null, false))
      .toEqual({ state: 'planning', readOnly: true });
    expect(planPopupState({ status: 'awaiting_approval', plan_mode: true }, planAction, false))
      .toEqual({ state: 'plan-ready', readOnly: true });
    expect(planPopupState({ status: 'running', plan_mode: false }, null, false))
      .toEqual({ state: 'applying', readOnly: true });
    expect(planPopupState({ status: 'awaiting_approval', plan_mode: false }, askAction, false))
      .toEqual({ state: 'resting', readOnly: true });
  });
});

function sealedPlan(over: Partial<AgentAction> = {}): AgentAction {
  return {
    id: 'act-plan',
    run_id: 'run-1',
    element_id: 'el-1',
    tool: 'plan',
    input: {
      calls: [
        { id: 'a', name: 'github__create_pull_request', input: { owner: 'noajp', repo: 'Clayware', title: 'Add the rail' } },
        { id: 'b', name: 'github__delete_file', input: { path: 'old.md' } },
        { id: 'c', name: 'local__write_file', input: { path: 'new.md' } },
      ],
      display: [
        {
          id: 'a', integration: 'GitHub', operation: 'create_pull_request', destination: 'https://api.github.com',
          detail: null, effect: 'write', critical: null, rememberable: false,
          title: 'Create a pull request',
          fields: [
            { label: 'Repository', value: 'Clayware' },
            { label: '読み戻し確認', value: '「get_pull_request」で title を照合します' },
          ],
          preview: null, askReason: null,
        },
        {
          id: 'b', integration: 'GitHub', operation: 'delete_file', destination: 'https://api.github.com',
          detail: null, effect: 'write', critical: 'delete', rememberable: false,
          title: 'Delete a file',
          fields: [
            { label: 'Path', value: 'old.md' },
            { label: 'ポリシー', value: 'この引数では拒否されています。承認しても実行されません' },
          ],
          preview: null, askReason: null,
        },
        {
          id: 'c', integration: 'Clayware', operation: 'write_file', destination: 'Clayware',
          detail: null, effect: 'write', critical: null, rememberable: false,
          title: 'Write a file',
          fields: [
            { label: 'Path', value: 'new.md' },
            { label: '組み立て', value: '宛先が組み立てられませんでした' },
          ],
          preview: null, askReason: null,
        },
      ],
    } as AgentAction['input'],
    input_hash: 'plan-hash',
    summary: '計画: GitHub · create_pull_request',
    integration_id: null,
    status: 'pending',
    decided_by: null,
    decided_at: null,
    decision_note: null,
    result: null,
    expires_at: null,
    created_at: '2026-11-10T00:00:00Z',
    ...over,
  };
}

describe('planCallsFromAction', () => {
  it('keeps the sealed order and lifts the verdict fields out of the field list', () => {
    const calls = planCallsFromAction(sealedPlan());
    expect(calls.map((c) => c.id)).toEqual(['a', 'b', 'c']);

    expect(calls[0].title).toBe('Create a pull request');
    expect(calls[0].fields).toEqual([['Repository', 'Clayware']]);
    expect(calls[0].expectedNote).toBe('「get_pull_request」で title を照合します');
    expect(calls[0].deniedNote).toBeNull();
    expect(calls[0].problem).toBeNull();
    expect(calls[0].critical).toBeNull();
  });

  it('marks a denied call with its consequence and keeps its critical class', () => {
    const denied = planCallsFromAction(sealedPlan())[1];
    expect(denied.deniedNote).toBe('この引数では拒否されています。承認しても実行されません');
    expect(denied.critical).toBe('delete');
    expect(denied.fields).toEqual([['Path', 'old.md']]);
  });

  it('marks an unassemblable call with its reason, muted facts only', () => {
    const problem = planCallsFromAction(sealedPlan())[2];
    expect(problem.problem).toBe('宛先が組み立てられませんでした');
    expect(problem.deniedNote).toBeNull();
    expect(problem.fields).toEqual([['Path', 'new.md']]);
  });

  it('an empty plan reads as no calls', () => {
    const empty = sealedPlan({
      input: { calls: [], display: [] } as unknown as AgentAction['input'],
    });
    expect(planCallsFromAction(empty)).toEqual([]);
  });
});

describe('procedureLines', () => {
  it('reads the Procedure section’s lines through the definition parse', () => {
    const body = [
      '# 目的', 'テストのため', '',
      '# 進め方', '- まず読む', '1. 次に書く', 'ただの行', '',
      '# 止める条件', '- 完了したら',
    ].join('\n');
    expect(procedureLines(body)).toEqual(['まず読む', '次に書く', 'ただの行']);
  });

  it('a definition with no procedure declares no outline', () => {
    expect(procedureLines('# 目的\nテストのため')).toEqual([]);
    expect(procedureLines('')).toEqual([]);
  });
});
