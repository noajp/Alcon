import { describe, expect, it } from 'vitest';
import {
  splitStepTitle, traceFromRunSteps, traceHeadline, type TraceRunFacts,
} from '@/Function/shared/workTrace';
import { traceStepFromWorkItem } from '@/ActivitySpace/strategy/initiative/conversationModel';
import type { AgentRunStep } from '@/types/database';

const step = (partial: Partial<AgentRunStep>): AgentRunStep => ({
  id: 's1', run_id: 'r1', idx: 0, type: 'action', title: 'Did a thing', detail: null,
  created_at: '2026-01-01T00:00:00Z', ...partial,
});

const runFacts = (partial: Partial<TraceRunFacts>): TraceRunFacts => ({
  status: 'running', summary: null, error: null, cost_usd: 0, verdict: null, ...partial,
});

const verdict = (result: 'pass' | 'fail' | 'unchecked') => ({
  v: 1 as const, result, source: result === 'unchecked' ? 'none' as const : 'verifier' as const,
  model: 'claude-test', gaps: [] as string[], revisions: 0,
  checkedAt: '2026-01-01T00:03:00Z', outcome: 'completed' as const,
  reason: result === 'unchecked' ? 'verify-unavailable' as const : null,
  evidence: { verifyStepIdx: 3, artifactIds: [] as string[] },
});

describe('splitStepTitle', () => {
  it('splits a short label from its chip at the first ": "', () => {
    expect(splitStepTitle('Echo Test: POST /notify')).toEqual({ label: 'Echo Test', chip: 'POST /notify' });
  });

  it('keeps a title without the separator whole', () => {
    expect(splitStepTitle('Just a title')).toEqual({ label: 'Just a title', chip: null });
    expect(splitStepTitle(': leading')).toEqual({ label: ': leading', chip: null });
  });

  it('does not split when the label would be implausibly long', () => {
    const title = `${'x'.repeat(41)}: rest`;
    expect(splitStepTitle(title)).toEqual({ label: title, chip: null });
  });
});

describe('traceFromRunSteps headline precedence', () => {
  it('an awaiting-approval run speaks of the ask, not of itself', () => {
    const trace = traceFromRunSteps(runFacts({ status: 'awaiting_approval', summary: 'Run summary', pendingSummary: 'Approve 2 sends' }), [step({})]);
    expect(trace.headline).toBe('Approve 2 sends');
  });

  it('the run summary beats the current step', () => {
    const trace = traceFromRunSteps(runFacts({ status: 'running', summary: 'Half-way report' }), [step({ title: 'Current step' })]);
    expect(trace.headline).toBe('Half-way report');
  });

  it('a working run without a summary speaks of the step it is on', () => {
    const trace = traceFromRunSteps(runFacts({ status: 'running' }), [step({ title: 'First' }), step({ id: 's2', title: 'Latest step' })]);
    expect(trace.headline).toBe('Latest step');
  });

  it('with nothing of its own to say, the status word stands', () => {
    expect(traceFromRunSteps(runFacts({ status: 'queued' }), []).headline).toBe('Queued');
    expect(traceFromRunSteps(runFacts({ status: 'running' }), []).headline).toBe('Working');
    expect(traceFromRunSteps(runFacts({ status: 'paused' }), []).headline).toBe('Paused');
  });

  it('no run: no headline, no status, but the steps still map', () => {
    const trace = traceFromRunSteps(null, [step({})]);
    expect(trace.headline).toBeNull();
    expect(trace.status).toBeNull();
    expect(trace.completion).toBeNull();
    expect(trace.steps).toHaveLength(1);
    expect(trace.costUsd).toBe(0);
  });

  it('cost reads as a number either way the row stores it', () => {
    expect(traceFromRunSteps(runFacts({ cost_usd: '2.50' }), []).costUsd).toBe(2.5);
    expect(traceFromRunSteps(runFacts({ cost_usd: 0 }), []).costUsd).toBe(0);
  });
});

describe('traceFromRunSteps steps', () => {
  it('maps tone by kind: work, notes, and failures apart', () => {
    const trace = traceFromRunSteps(runFacts({}), [
      step({ id: 'a', type: 'action', title: 'Echo Test: POST /notify' }),
      step({ id: 'b', type: 'thought', title: 'Thinking it through' }),
      step({ id: 'c', type: 'error', title: 'It broke', detail: 'stack' }),
    ]);
    expect(trace.steps[0]).toMatchObject({ label: 'Echo Test', chip: 'POST /notify', tone: 'work' });
    expect(trace.steps[1]).toMatchObject({ label: 'Thinking it through', chip: null, tone: 'note' });
    expect(trace.steps[2]).toMatchObject({ label: 'It broke', detail: 'stack', tone: 'error' });
  });
});

describe('traceFromRunSteps completion', () => {
  it('a completed run completes: first-line summary and the time it took', () => {
    const trace = traceFromRunSteps(runFacts({
      status: 'completed', summary: 'Delivered the report\nwith details',
      started_at: '2026-01-01T00:00:00Z', finished_at: '2026-01-01T00:02:30Z',
    }), []);
    expect(trace.completion).toMatchObject({ status: 'Complete', summary: 'Delivered the report', durationMs: 150_000, error: null });
  });

  it('a run stopped for review says so; a working run has no completion', () => {
    expect(traceFromRunSteps(runFacts({ status: 'awaiting_review' }), []).completion?.status).toBe('Stopped for review');
    expect(traceFromRunSteps(runFacts({ status: 'running' }), []).completion).toBeNull();
    expect(traceFromRunSteps(runFacts({ status: 'paused' }), []).completion).toBeNull();
  });

  it('a failed run carries its error and verdict into the completion', () => {
    const v = verdict('fail');
    const trace = traceFromRunSteps(runFacts({ status: 'failed', error: 'Boom\nstack', verdict: v }), []);
    expect(trace.completion).toMatchObject({ status: 'Failed', error: 'Boom\nstack', verdict: v });
    expect(trace.completion?.durationMs).toBeNull();
  });
});

describe('traceHeadline', () => {
  it('no run, no line', () => {
    expect(traceHeadline(null)).toBeNull();
    expect(traceHeadline(undefined)).toBeNull();
  });

  it('a working run shows its state word', () => {
    expect(traceHeadline(runFacts({ status: 'running' }))).toEqual({ text: 'Working', tone: 'working' });
    expect(traceHeadline(runFacts({ status: 'queued' }))).toEqual({ text: 'Queued', tone: 'working' });
  });

  it("a failed run shows its error's first line", () => {
    expect(traceHeadline(runFacts({ status: 'failed', error: 'Boom\nstack trace' }))).toEqual({ text: 'Boom', tone: 'danger' });
  });

  it("a finish shows its summary's first line, muted", () => {
    expect(traceHeadline(runFacts({ status: 'completed', summary: 'All delivered\nmore' }))).toEqual({ text: 'All delivered', tone: 'muted' });
    expect(traceHeadline(runFacts({ status: 'completed' }))).toBeNull();
  });

  it("a fail verdict prefixes its word to the finish's line", () => {
    const v = verdict('fail');
    expect(traceHeadline(runFacts({ status: 'completed', summary: 'Claimed done', verdict: v })))
      .toEqual({ text: 'Verifier: not passed — Claimed done', tone: 'danger' });
    expect(traceHeadline(runFacts({ status: 'completed', verdict: v })))
      .toEqual({ text: 'Verifier: not passed', tone: 'danger' });
    expect(traceHeadline(runFacts({ status: 'failed', error: 'Boom', verdict: v })))
      .toEqual({ text: 'Verifier: not passed — Boom', tone: 'danger' });
  });

  it('an unchecked verdict adds no word', () => {
    expect(traceHeadline(runFacts({ status: 'completed', summary: 'Done', verdict: verdict('unchecked') }))).toEqual({ text: 'Done', tone: 'muted' });
  });
});

describe('traceStepFromWorkItem', () => {
  it('a write reads as work under its conversation label', () => {
    expect(traceStepFromWorkItem({ id: 'w1', name: 'addIntent', kind: 'write', detail: 'Purpose', ok: true }))
      .toEqual({ id: 'w1', label: 'Recorded', chip: null, detail: 'Purpose', tone: 'work' });
  });

  it("a failure's error is its detail, in the error tone", () => {
    expect(traceStepFromWorkItem({ id: 'w2', name: 'getInitiative', kind: 'read', detail: '', ok: false, error: 'denied' }))
      .toEqual({ id: 'w2', label: 'Read the Strategy', chip: null, detail: 'denied', tone: 'error' });
  });

  it('the hand-off to the Planner is a note, not work', () => {
    expect(traceStepFromWorkItem({ id: 'w3', name: 'hand_to_planner', kind: 'plan', detail: 'Focus on cost', ok: true }))
      .toMatchObject({ label: 'Handed to the Planner', tone: 'note', detail: 'Focus on cost' });
  });

  it('an unknown tool stands under its own name', () => {
    expect(traceStepFromWorkItem({ id: 'w4', name: 'someTool', kind: 'read', detail: '', ok: true }).label).toBe('someTool');
  });
});
