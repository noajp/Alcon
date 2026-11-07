// One run, told one way. The Element's AgentRunPanel, the Strategy
// conversation and the Execution Chain's cards each meet the same run;
// this is the single model they all read — the run's headline, its steps
// as rows, and its completion (the summary, the verifier's judgement, how
// long it took). The components in WorkTrace.tsx present it; nothing here
// renders. Pure.

import type { AgentRunStatus, AgentRunStep } from '@/types/database';
import type { RunVerdict } from '@/Function/audit/auditModel';

/** The structural subset of a run the trace needs — an Element's parsed
 *  run and the chain's run rows both satisfy it. */
export interface TraceRunFacts {
  status: AgentRunStatus;
  summary: string | null;
  error: string | null;
  cost_usd: number | string;
  started_at?: string | null;
  finished_at?: string | null;
  verdict: RunVerdict | null;
  /** The pending approval's own summary, when the run waits on one: the
   *  headline speaks of the ask, not of the run. */
  pendingSummary?: string | null;
}

export interface TraceStep {
  id: string;
  label: string;
  chip: string | null;
  detail: string | null;
  /** work: a tool did something. error: it failed. note: the agent
   *  talking, planning or recording — not a tool call. */
  tone: 'work' | 'error' | 'note';
}

export interface RunTraceCompletion {
  /** The word the finish earns: Complete, Stopped for review, Failed, Stopped. */
  status: 'Complete' | 'Stopped for review' | 'Failed' | 'Stopped';
  /** The run's deliverable summary, first line. */
  summary: string | null;
  /** The run's error, full text: it belongs to the outcome, not the header. */
  error: string | null;
  verdict: RunVerdict | null;
  durationMs: number | null;
}

export interface RunTrace {
  headline: string | null;
  steps: TraceStep[];
  completion: RunTraceCompletion | null;
  status: AgentRunStatus | null;
  costUsd: number;
}

/** The status word the surfaces speak (the panel's labels, kept as the
 *  i18n source strings: components translate them). */
export function traceStatusWord(status: AgentRunStatus): string {
  return TRACE_STATUS_WORD[status];
}

const TRACE_STATUS_WORD: Record<AgentRunStatus, string> = {
  queued: 'Queued',
  running: 'Working',
  awaiting_input: 'Waiting for you',
  awaiting_approval: 'Awaiting approval',
  paused: 'Paused',
  awaiting_review: 'Awaiting review',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Stopped',
};

/** The verdict's word, as the chain's cards already speak it. */
export const VERDICT_FAIL_WORD = 'Verifier: not passed';

/** "Echo Test: POST /notify" → label "Echo Test", chip "POST /notify". */
export function splitStepTitle(title: string): { label: string; chip: string | null } {
  const i = title.indexOf(': ');
  if (i <= 0 || i > 40) return { label: title, chip: null };
  return { label: title.slice(0, i), chip: title.slice(i + 2) };
}

const NOTE_STEP_TYPES = new Set(['thought', 'comment', 'message', 'reply', 'status', 'result', 'plan', 'plan_request', 'approval', 'start_request', 'answer_request']);

/** One engine step as one trace row. An error step is its own tone; the
 *  agent's talk and plans are notes; the rest is work. */
export function traceStepFromRunStep(step: AgentRunStep): TraceStep {
  const { label, chip } = splitStepTitle(step.title);
  return {
    id: step.id, label, chip, detail: step.detail,
    tone: step.type === 'error' ? 'error' : NOTE_STEP_TYPES.has(step.type) ? 'note' : 'work',
  };
}

const FINISHED: Partial<Record<AgentRunStatus, RunTraceCompletion['status']>> = {
  completed: 'Complete',
  awaiting_review: 'Stopped for review',
  failed: 'Failed',
  cancelled: 'Stopped',
};

function firstLine(text: string | null): string | null {
  const line = text?.split('\n')[0]?.trim();
  return line ? line : null;
}

function completionOf(run: TraceRunFacts): RunTraceCompletion | null {
  const word = FINISHED[run.status];
  if (!word) return null;
  const started = run.started_at ? new Date(run.started_at).getTime() : NaN;
  const finished = run.finished_at ? new Date(run.finished_at).getTime() : NaN;
  return {
    status: word,
    summary: firstLine(run.summary),
    error: run.error,
    verdict: run.verdict,
    durationMs: Number.isFinite(started) && Number.isFinite(finished) && finished >= started ? finished - started : null,
  };
}

/**
 * A run and its steps as one trace. The headline's precedence is the
 * panel's established one: what the run waits to have approved, then its
 * own summary, then — while it still works — the step it is on, then the
 * plain status word.
 */
export function traceFromRunSteps(run: TraceRunFacts | null, steps: readonly AgentRunStep[]): RunTrace {
  const traceSteps = steps.map(traceStepFromRunStep);
  if (!run) return { headline: null, steps: traceSteps, completion: null, status: null, costUsd: 0 };
  const lastStepTitle = steps.length && (run.status === 'queued' || run.status === 'running')
    ? steps[steps.length - 1].title : null;
  const headline = (run.status === 'awaiting_approval' && run.pendingSummary)
    || run.summary
    || lastStepTitle
    || traceStatusWord(run.status);
  return {
    headline,
    steps: traceSteps,
    completion: completionOf(run),
    status: run.status,
    costUsd: Number(run.cost_usd || 0),
  };
}

/**
 * The chain card's one run line. Working shows the state word; a failure
 * shows its error's first line; a finish shows its summary's first line; a
 * fail verdict prefixes its word to whichever line the finish earned —
 * the agent's claim never outranks the check.
 */
export function traceHeadline(run: TraceRunFacts | null | undefined): { text: string; tone: 'working' | 'danger' | 'muted' } | null {
  if (!run) return null;
  const verdictWord = run.verdict?.result === 'fail' ? VERDICT_FAIL_WORD : null;
  if (run.status === 'queued' || run.status === 'running') {
    return { text: traceStatusWord(run.status), tone: 'working' };
  }
  if (run.status === 'failed') {
    const text = [verdictWord, firstLine(run.error)].filter(Boolean).join(' — ');
    return text ? { text, tone: 'danger' } : null;
  }
  const summary = firstLine(run.summary);
  if (verdictWord) return { text: summary ? `${verdictWord} — ${summary}` : verdictWord, tone: 'danger' };
  return summary ? { text: summary, tone: 'muted' } : null;
}
