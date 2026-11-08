'use client';

import { useState } from 'react';
import { AlertCircle, Check, CheckCircle2, CircleDot, Hand, Loader2, Pause, ShieldCheck } from '@/ui/icons';
import { cn } from '@/lib/utils';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { DisclosureTriangle } from '@/Function/shared/DisclosureTriangle';
import { MarkdownLite } from '@/Function/shared/MarkdownLite';
import type { AgentRunStatus } from '@/types/database';
import type { RunVerdict } from '@/Function/audit/auditModel';
import { traceStatusWord, type RunTrace, type TraceStep } from './workTrace';

// The one presentation of a run's trace (WorkTrace model in workTrace.ts):
// the headline a person reads first, the steps under it, and the
// completion block when the run has finished. The Element's run panel,
// the Strategy conversation and the chain's cards present runs through
// these, so a run reads the same wherever it is met.

const STATUS_TONE: Record<AgentRunStatus, string> = {
  queued: 'text-muted-foreground',
  running: 'text-[var(--accent-default)]',
  awaiting_input: 'text-foreground',
  awaiting_approval: 'text-[var(--accent-default)]',
  paused: 'text-muted-foreground',
  awaiting_review: 'text-foreground',
  completed: 'text-foreground',
  failed: 'text-[var(--status-danger)]',
  cancelled: 'text-muted-foreground',
};

function TraceStatusGlyph({ status }: { status: AgentRunStatus }) {
  if (status === 'queued' || status === 'running') return <Loader2 size={15} className="animate-spin text-[var(--accent-default)]" />;
  if (status === 'awaiting_approval') return <Hand size={15} className="text-[var(--accent-default)]" />;
  if (status === 'paused' || status === 'cancelled') return <Pause size={15} className="text-muted-foreground" />;
  if (status === 'failed') return <AlertCircle size={15} className="text-[var(--status-danger)]" />;
  return <CheckCircle2 size={15} className="text-foreground" />;
}

/**
 * The run's first line: its glyph, what it is doing (or did), its cost and
 * its status word — and the host's own controls (Stop, Resume, Run again)
 * in the slot at the right. The headline falls back to the status word,
 * translated here, when the run has nothing of its own to say yet.
 */
export function TraceHeadline({ trace, controls }: { trace: RunTrace; controls?: React.ReactNode }) {
  const { t } = useI18n();
  if (!trace.status) return null;
  const word = traceStatusWord(trace.status);
  const line = trace.headline && trace.headline !== word ? trace.headline : t(word);
  return (
    <div role="status" aria-live="polite" className="flex min-h-9 items-center gap-2.5 px-1 py-1.5">
      <TraceStatusGlyph status={trace.status} />
      <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">{line}</span>
      {trace.costUsd > 0 && <span className="shrink-0 font-mono text-[11px] text-muted-foreground">${trace.costUsd.toFixed(2)}</span>}
      <span className={cn('shrink-0 text-[12px]', STATUS_TONE[trace.status])}>{t(word)}</span>
      {controls}
    </div>
  );
}

function TraceChip({ children }: { children: React.ReactNode }) {
  return <span className="max-w-full truncate rounded-md border border-border bg-muted/40 px-1.5 py-px font-mono text-[11px] text-foreground/80">{children}</span>;
}

/** One step as one row: a check for work done, a dot for the agent's
 *  notes, danger for a failure; the detail opens underneath. */
function TraceStepRow({ step }: { step: TraceStep }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const hasDetail = !!step.detail;
  return (
    <li>
      <button
        type="button"
        disabled={!hasDetail}
        aria-expanded={hasDetail ? open : undefined}
        onClick={() => setOpen((o) => !o)}
        className={cn('flex w-full min-w-0 items-center gap-2 rounded-md px-1 py-1 text-left text-[12px]', hasDetail && 'hover:bg-muted/40')}
      >
        {step.tone === 'error'
          ? <AlertCircle size={13} strokeWidth={2} className="shrink-0 text-[var(--status-danger)]" />
          : step.tone === 'note'
            ? <CircleDot size={13} strokeWidth={2} className="shrink-0 text-muted-foreground" />
            : <Check size={13} strokeWidth={2} className="shrink-0 text-muted-foreground" />}
        <span className="shrink-0 text-foreground/90">{t(step.label)}</span>
        {step.chip && <TraceChip>{step.chip}</TraceChip>}
        {hasDetail && <DisclosureTriangle open={open} className="ml-auto text-muted-foreground" />}
      </button>
      {open && step.detail && (
        <div className="mb-1 ml-6 mt-0.5 rounded-md bg-muted/30 px-2 py-1.5">
          <MarkdownLite text={step.detail} className="text-[12px]" />
        </div>
      )}
    </li>
  );
}

/**
 * The step rows, folded: the first `foldAfter` show (the LAST `foldAfter`
 * when `fromEnd` — a live panel reads at the tail), the rest behind one
 * toggle. Without `foldAfter`, every step shows.
 */
export function TraceStepList({ steps, foldAfter, fromEnd }: {
  steps: TraceStep[];
  foldAfter?: number;
  fromEnd?: boolean;
}) {
  const { t } = useI18n();
  const [all, setAll] = useState(false);
  if (!steps.length) return null;
  const folded = foldAfter !== undefined && !all && steps.length > foldAfter;
  const shown = folded ? (fromEnd ? steps.slice(-foldAfter) : steps.slice(0, foldAfter)) : steps;
  return (
    <div className="mt-1">
      {foldAfter !== undefined && steps.length > foldAfter && (
        <button type="button" aria-expanded={all} onClick={() => setAll((a) => !a)} className="mb-0.5 flex items-center gap-1 px-1 text-[12px] text-muted-foreground hover:text-foreground">
          <DisclosureTriangle open={all} />
          {all ? t('Show fewer steps') : t('Show all {n} steps', { n: steps.length })}
        </button>
      )}
      <ul className="space-y-px">{shown.map((s) => <TraceStepRow key={s.id} step={s} />)}</ul>
    </div>
  );
}

const VERDICT_UNCHECKED_REASON: Record<string, string> = {
  'verify-unavailable': 'The check could not run',
  'outcome-not-completed': 'Partial or blocked work is not checked',
  'external-model': 'Runs on an external model are not checked',
};

/** The verifier's judgement of the finish that stood: a checked pass, a
 *  fail the run ended on anyway, or an honest "not verified". */
function TraceVerdict({ verdict }: { verdict: RunVerdict }) {
  const { t } = useI18n();
  if (verdict.result === 'pass') {
    return (
      <div className="mt-1 flex items-center gap-2 text-[12px]">
        <ShieldCheck size={13} className="shrink-0 text-muted-foreground" />
        <span className="text-foreground/90">{t('Verifier: passed')}</span>
        {verdict.revisions > 0 && <span className="text-muted-foreground">{t('after {n} revisions', { n: verdict.revisions })}</span>}
      </div>
    );
  }
  if (verdict.result === 'fail') {
    return (
      <div className="mt-1 text-[12px]">
        <div className="flex items-center gap-2">
          <ShieldCheck size={13} className="shrink-0 text-[var(--status-danger)]" />
          <span className="text-foreground/90">{t('Verifier: not passed — the run ended after the revision limit')}</span>
        </div>
        {verdict.gaps.length > 0 && (
          <ul className="mt-0.5 space-y-px pl-5 text-muted-foreground">
            {verdict.gaps.map((g, i) => <li key={i}>{g}</li>)}
          </ul>
        )}
      </div>
    );
  }
  return (
    <div className="mt-1 flex items-center gap-2 text-[12px]">
      <ShieldCheck size={13} className="shrink-0 text-muted-foreground" />
      <span className="text-foreground/90">{t('Not verified')}</span>
      {verdict.reason && VERDICT_UNCHECKED_REASON[verdict.reason] && (
        <span className="text-muted-foreground">{t(VERDICT_UNCHECKED_REASON[verdict.reason])}</span>
      )}
    </div>
  );
}

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

/**
 * What a finished run leaves behind: its status word and how long it
 * took, the summary it claimed, the error it stopped on, and the
 * verifier's judgement of the finish. Renders nothing while it works.
 */
export function TraceCompletion({ trace }: { trace: RunTrace }) {
  const { t } = useI18n();
  const c = trace.completion;
  if (!c) return null;
  return (
    <div className="mt-1 px-1">
      <div className="flex items-center gap-2 text-[12px]">
        {c.status === 'Complete' ? <CheckCircle2 size={13} className="shrink-0 text-foreground" />
          : c.status === 'Failed' ? <AlertCircle size={13} className="shrink-0 text-[var(--status-danger)]" />
          : c.status === 'Stopped for review' ? <Hand size={13} className="shrink-0 text-[var(--accent-default)]" />
          : <Pause size={13} className="shrink-0 text-muted-foreground" />}
        <span className="text-foreground/90">{t(c.status)}</span>
        {c.durationMs !== null && <span className="text-muted-foreground">{formatDuration(c.durationMs)}</span>}
      </div>
      {c.summary && <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">{c.summary}</p>}
      {c.error && <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">{c.error}</p>}
      {c.verdict && <TraceVerdict verdict={c.verdict} />}
    </div>
  );
}
