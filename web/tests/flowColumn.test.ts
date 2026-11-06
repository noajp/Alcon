import { describe, expect, it } from 'vitest';
import type { AgentRunStatus, Element } from '@/types/database';
import { FLOW_COLUMNS, FLOW_COLUMN_LABEL, flowColumnOf, groupByFlowColumn } from '@/ActivitySpace/execution/domain/flow/flowColumn';
import { MESSAGES } from '@/Function/i18n/messages';

type Status = Element['status'];
const el = (status: Status, action: string | null = null) => ({ status, action });

describe('flowColumnOf', () => {
  it('puts an Element not started in To do', () => {
    expect(flowColumnOf(el('todo'), null)).toBe('todo');
    expect(flowColumnOf(el('backlog'), null)).toBe('todo');
    expect(flowColumnOf(el(null), null)).toBe('todo');
    expect(flowColumnOf(el('todo', 'research'), undefined)).toBe('todo');
  });

  it('puts an open Element with a person\'s verb in Waiting on you', () => {
    for (const action of ['judge', 'decide', 'approve', 'answer']) {
      expect(flowColumnOf(el('todo', action), null)).toBe('waiting');
      expect(flowColumnOf(el('backlog', action), null)).toBe('waiting');
      expect(flowColumnOf(el('review', action), null)).toBe('waiting');
    }
  });

  it('puts a blocked Element in Waiting on you', () => {
    expect(flowColumnOf(el('blocked'), null)).toBe('waiting');
    expect(flowColumnOf(el('blocked', 'execute'), 'running')).toBe('waiting');
  });

  it('puts an Element whose latest run asks a person in Waiting on you', () => {
    expect(flowColumnOf(el('todo'), 'awaiting_approval')).toBe('waiting');
    expect(flowColumnOf(el('in_progress'), 'awaiting_input')).toBe('waiting');
  });

  it('gives Waiting on you precedence over In progress', () => {
    expect(flowColumnOf(el('in_progress', 'judge'), null)).toBe('waiting');
    expect(flowColumnOf(el('in_progress', 'approve'), 'running')).toBe('waiting');
  });

  it('puts an Element in progress, or with a working run, in In progress', () => {
    expect(flowColumnOf(el('in_progress'), null)).toBe('in_progress');
    expect(flowColumnOf(el('in_progress', 'create'), 'completed')).toBe('in_progress');
    expect(flowColumnOf(el('todo'), 'running')).toBe('in_progress');
    expect(flowColumnOf(el('backlog'), 'queued')).toBe('in_progress');
    expect(flowColumnOf(el('review'), 'running')).toBe('in_progress');
  });

  it('puts an Element in review, or whose run waits for review, in To review', () => {
    expect(flowColumnOf(el('review'), null)).toBe('review');
    expect(flowColumnOf(el('review', 'verify'), 'completed')).toBe('review');
    expect(flowColumnOf(el('in_progress'), 'awaiting_review')).toBe('review');
  });

  it('puts a done Element in Done, whatever its verb or run', () => {
    expect(flowColumnOf(el('done'), null)).toBe('done');
    expect(flowColumnOf(el('done', 'decide'), null)).toBe('done');
    expect(flowColumnOf(el('done'), 'awaiting_approval')).toBe('done');
  });

  it('leaves a cancelled Element off the board', () => {
    expect(flowColumnOf(el('cancelled'), null)).toBeNull();
    expect(flowColumnOf(el('cancelled', 'judge'), 'running')).toBeNull();
  });

  it('leaves the column to the Status when the run has ended', () => {
    const ended: AgentRunStatus[] = ['completed', 'failed', 'cancelled', 'paused'];
    for (const run of ended) {
      expect(flowColumnOf(el('todo'), run)).toBe('todo');
      expect(flowColumnOf(el('review'), run)).toBe('review');
    }
  });

  it('ignores an action that is not a known verb', () => {
    expect(flowColumnOf(el('todo', 'unknown'), null)).toBe('todo');
  });

  it('places every Element status somewhere or nowhere on purpose', () => {
    const statuses: Status[] = ['backlog', 'todo', 'in_progress', 'review', 'done', 'blocked', 'cancelled', null];
    const placed = statuses.map((s) => flowColumnOf(el(s), null));
    expect(placed).toEqual(['todo', 'todo', 'in_progress', 'review', 'done', 'waiting', null, 'todo']);
  });
});

describe('groupByFlowColumn', () => {
  it('groups in the given order and drops cancelled Elements', () => {
    const elements = [
      { id: 'a', status: 'todo' as Status, action: null },
      { id: 'b', status: 'todo' as Status, action: 'decide' },
      { id: 'c', status: 'cancelled' as Status, action: null },
      { id: 'd', status: 'todo' as Status, action: null },
      { id: 'e', status: 'done' as Status, action: null },
    ];
    const runs: Record<string, AgentRunStatus> = { d: 'running' };
    const grouped = groupByFlowColumn(elements, (id) => runs[id]);
    expect(grouped.todo.map((e) => e.id)).toEqual(['a']);
    expect(grouped.waiting.map((e) => e.id)).toEqual(['b']);
    expect(grouped.in_progress.map((e) => e.id)).toEqual(['d']);
    expect(grouped.review).toEqual([]);
    expect(grouped.done.map((e) => e.id)).toEqual(['e']);
  });
});

describe('Flow column labels', () => {
  it('are translated in every locale', () => {
    for (const locale of ['ja', 'ko', 'fr', 'es'] as const) {
      for (const column of FLOW_COLUMNS) expect(FLOW_COLUMN_LABEL[column] in MESSAGES[locale], `${locale}: ${column}`).toBe(true);
    }
  });
});
