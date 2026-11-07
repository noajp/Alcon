'use client';

import { useMemo, useState } from 'react';
import { DisclosureTriangle } from '@/Function/shared/DisclosureTriangle';
import { AlertCircle, ArrowRight, Check, CheckCircle2, Copy, FileText, Flag, Hand, ListChecks, Loader2, MessageSquare, Pause, ShieldCheck, Wrench, CircleDot } from '@/ui/icons';
import { Button } from '@/ui/button';
import { TextComposer } from '@/ui/text-composer';
import { cn } from '@/lib/utils';
import { FONT } from '@/shared/designTokens';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { MarkdownLite } from '@/Function/shared/MarkdownLite';
import type { AgentOutput, AgentRunStatus, AgentRunStep, AgentRunStepType } from '@/types/database';
import type { ProposedReading, RunVerdict } from '@/Function/audit/auditModel';
import { useMeasureLabels } from '@/AIP/ai/agentData';
import type { useAgentRun } from '@/hooks/useSupabase';
import { approvalRows, rememberChoices, sharedColumns } from './approvalView';
import { CRITICAL_CLASS_LABELS } from '@/AIP/connectors/catalog';
import { useIsSpaceOwner } from '@/AIP/connectors/data';
import { useActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { useNow } from '@/Function/shared/useNow';

// The agent on an Element (ADR 0027): one status line for the run, its
// Workpad as compact tool rows, the approval card when it waits on a
// person, and the deliverables it saved. Shapes follow the Task Rows / Tool
// Chips / Approval Card patterns, drawn with Alcon's own tokens.

type Agent = ReturnType<typeof useAgentRun>;

const STATUS: Record<AgentRunStatus, { label: string; tone: string }> = {
  queued: { label: 'Queued', tone: 'text-muted-foreground' },
  running: { label: 'Working', tone: 'text-[var(--accent-default)]' },
  awaiting_input: { label: 'Waiting for you', tone: 'text-foreground' },
  awaiting_approval: { label: 'Awaiting approval', tone: 'text-[var(--accent-default)]' },
  paused: { label: 'Paused', tone: 'text-muted-foreground' },
  awaiting_review: { label: 'Awaiting review', tone: 'text-foreground' },
  completed: { label: 'Completed', tone: 'text-foreground' },
  failed: { label: 'Failed', tone: 'text-[var(--status-danger)]' },
  cancelled: { label: 'Stopped', tone: 'text-muted-foreground' },
};

type Glyph = React.ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;
const STEP_ICON: Record<AgentRunStepType, Glyph> = {
  plan: ListChecks, thought: CircleDot, action: Wrench, subelement: CheckCircle2, comment: MessageSquare,
  status: ArrowRight, result: Flag, error: AlertCircle, approval: ShieldCheck, artifact: FileText,
  message: MessageSquare, reply: MessageSquare, write: FileText, plan_request: ListChecks,
};

function StatusGlyph({ status }: { status: AgentRunStatus }) {
  if (status === 'queued' || status === 'running') return <Loader2 size={15} className="animate-spin text-[var(--accent-default)]" />;
  if (status === 'awaiting_approval') return <Hand size={15} className="text-[var(--accent-default)]" />;
  if (status === 'paused' || status === 'cancelled') return <Pause size={15} className="text-muted-foreground" />;
  if (status === 'failed') return <AlertCircle size={15} className="text-[var(--status-danger)]" />;
  return <CheckCircle2 size={15} className="text-foreground" />;
}

/** "Echo Test: POST /notify" → label "Echo Test", chip "POST /notify". */
function splitStepTitle(title: string): { label: string; chip: string | null } {
  const i = title.indexOf(': ');
  if (i <= 0 || i > 40) return { label: title, chip: null };
  return { label: title.slice(0, i), chip: title.slice(i + 2) };
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="max-w-full truncate rounded-md border border-border bg-muted/40 px-1.5 py-px font-mono text-[11px] text-foreground/80">{children}</span>;
}

function StepRow({ step }: { step: AgentRunStep }) {
  const [open, setOpen] = useState(false);
  const Icon = STEP_ICON[step.type] ?? CircleDot;
  const { label, chip } = splitStepTitle(step.title);
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
        <Icon size={13} strokeWidth={2} className={step.type === 'error' ? 'shrink-0 text-[var(--status-danger)]' : 'shrink-0 text-muted-foreground'} />
        <span className="shrink-0 text-foreground/90">{label}</span>
        {chip && <Chip>{chip}</Chip>}
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

const VISIBLE_STEPS = 5;

function Workpad({ steps }: { steps: AgentRunStep[] }) {
  const { t } = useI18n();
  const [all, setAll] = useState(false);
  if (!steps.length) return null;
  const shown = all ? steps : steps.slice(-VISIBLE_STEPS);
  return (
    <div className="mt-1">
      {steps.length > VISIBLE_STEPS && (
        <button type="button" aria-expanded={all} onClick={() => setAll((a) => !a)} className="mb-0.5 flex items-center gap-1 px-1 text-[12px] text-muted-foreground hover:text-foreground">
          <DisclosureTriangle open={all} />
          {all ? t('Show fewer steps') : t('Show all {n} steps', { n: steps.length })}
        </button>
      )}
      <ul className="space-y-px">{shown.map((s) => <StepRow key={s.id} step={s} />)}</ul>
    </div>
  );
}

function ApprovalCard({ agent }: { agent: Agent }) {
  const { t } = useI18n();
  const [note, setNote] = useState('');
  // The note belongs to one request: a new request starts empty, but a
  // decision that fails and comes back keeps what was typed.
  const pendingId = agent.pending?.id ?? null;
  const [noteFor, setNoteFor] = useState(pendingId);
  if (pendingId && pendingId !== noteFor) { setNoteFor(pendingId); setNote(''); }
  const [openRow, setOpenRow] = useState<string | null>(null);
  const rows = useMemo(() => (agent.pending ? approvalRows(agent.pending) : []), [agent.pending]);
  // A standing approval changes the Space's connection rules: owners only.
  const isOwner = useIsSpaceOwner(useActiveSpaceId()) === true;
  const choices = useMemo(() => (agent.pending ? rememberChoices(agent.pending) : []), [agent.pending]);
  const [remember, setRemember] = useState<string[]>([]);
  const [rememberFor, setRememberFor] = useState(pendingId);
  if (pendingId !== rememberFor) { setRememberFor(pendingId); setRemember([]); }
  if (!agent.pending) return null;
  const shared = sharedColumns(rows);
  const omitted = rows.reduce((n, r) => n + r.more, 0);
  const destinations = [...new Set(rows.map((r) => r.destination))];
  const anyCritical = rows.some((r) => r.critical);
  return (
    <div className="mt-2">
      <div className="flex items-start gap-2 px-1 pt-1">
        <Hand size={15} className="mt-0.5 shrink-0 text-[var(--accent-default)]" />
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-foreground">{agent.pending.summary}</div>
          <div className="text-[12px] text-muted-foreground">{t('Approving runs all {n} operations', { n: rows.length })}</div>
          <div className="text-[12px] text-muted-foreground">
            {destinations.length === 1
              ? t('Destination: {where}', { where: `${rows[0].integration} · ${destinations[0]}` })
              : t('{n} destinations', { n: destinations.length })}
          </div>
          {anyCritical && (
            <div className="text-[12px] text-[var(--status-warning)]">{t('This includes a critical operation. It asks every time: full delegation and saved conditions do not apply, and it cannot be remembered.')}</div>
          )}
        </div>
      </div>

      <div className="mt-2 overflow-x-auto px-1">
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="border-b border-border py-1 pr-3 font-medium">{t('Operation')}</th>
              {shared ? shared.map((c) => <th key={c} className="border-b border-border py-1 pr-3 font-medium">{c}</th>)
                : <th className="border-b border-border py-1 pr-3 font-medium">{t('Content')}</th>}
              <th className="w-6 border-b border-border" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <FragmentRow key={r.id} open={openRow === r.id} colSpan={(shared?.length ?? 1) + 2} raw={r.raw} rawLabel={t('Exact input')}>
                <td className="border-b border-border/60 py-1.5 pr-3 align-top">
                  <div className="text-foreground/90">{r.integration}</div>
                  {destinations.length > 1 && <div className="max-w-56 truncate font-mono text-[11px] text-muted-foreground">{r.destination}</div>}
                  <Chip>{r.operation}</Chip>
                  {r.detail && <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">{r.detail}</div>}
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] text-muted-foreground">{r.effect === 'read' ? t('read') : t('write')}</span>
                    {r.critical && (
                      <span className="rounded-full border border-[var(--border-default)] px-1.5 text-[11px] text-[var(--status-warning)]">
                        {t('Critical · {class} — always asks', { class: t(CRITICAL_CLASS_LABELS[r.critical]) })}
                      </span>
                    )}
                  </div>
                </td>
                {shared
                  ? r.fields.map(([k, v]) => <td key={k} className="border-b border-border/60 py-1.5 pr-3 align-top text-foreground">{v}</td>)
                  : (
                    <td className="border-b border-border/60 py-1.5 pr-3 align-top">
                      {r.fields.length ? r.fields.map(([k, v]) => (
                        <div key={k} className="flex gap-2"><span className="shrink-0 text-muted-foreground">{k}</span><span className="min-w-0 break-words text-foreground">{v}</span></div>
                      )) : <span className="text-muted-foreground">—</span>}
                      {r.more > 0 && <div className="text-muted-foreground">{t('+{n} more fields in the raw input', { n: r.more })}</div>}
                    </td>
                  )}
                <td className="border-b border-border/60 py-1.5 align-top">
                  <button type="button" aria-label={t('Exact input')} aria-expanded={openRow === r.id} onClick={() => setOpenRow((o) => (o === r.id ? null : r.id))} className="rounded p-0.5 text-muted-foreground hover:bg-muted/50 hover:text-foreground">
                    <DisclosureTriangle open={openRow === r.id} />
                  </button>
                </td>
              </FragmentRow>
            ))}
          </tbody>
        </table>
        {shared && omitted > 0 && (
          <div className="mt-1 text-[12px] text-muted-foreground">{t('+{n} more fields in the raw input', { n: omitted })}</div>
        )}
        <div className="mt-1 text-[12px] text-muted-foreground">{t('Allowing runs exactly these calls with exactly this input. If the input changes, this approval no longer matches.')}</div>
      </div>

      {agent.isMine && isOwner && choices.length > 0 && (
        <div className="px-1 pt-2">
          <div className="text-[12px] text-muted-foreground">{t('Don’t ask again for {target} when these fields match exactly:', { target: `${rows[0].integration} · ${rows[0].operation}` })}</div>
          <div className="mt-1 flex flex-wrap gap-1">
            {choices.map((c) => {
              const on = remember.includes(c.field);
              return (
                <button key={c.field} type="button" aria-pressed={on}
                  onClick={() => setRemember((r) => (on ? r.filter((f) => f !== c.field) : [...r, c.field]))}
                  className={cn('max-w-full truncate rounded-[var(--control-tab-radius)] border px-2 py-0.5 text-[12px]',
                    on ? 'border-[var(--accent-default)] bg-[var(--accent-default)]/10 text-foreground' : 'border-[var(--border-default)] text-muted-foreground hover:bg-muted/40')}>
                  {c.field} = {c.value}
                </button>
              );
            })}
          </div>
          {remember.length > 0 && (
            <div className="mt-1 text-[12px] text-muted-foreground">{t('Approving saves this condition on the connector; any other value, operation, or connector asks again.')}</div>
          )}
        </div>
      )}

      <div className="px-1 pt-2">
        {agent.isMine ? (
          <TextComposer
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('Note to the agent (optional)')}
            rows={2}
            className="text-[13px]"
            secondaryAction={<Button variant="secondary" size="sm" disabled={agent.deciding} onClick={() => void agent.decide(false, note)}>{t('Deny')}</Button>}
            action={
              <Button variant="primary" size="sm" disabled={agent.deciding} onClick={() => void agent.decide(true, note, remember)}>
                {agent.deciding ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                {t('Approve and run')}
              </Button>
            }
          />
        ) : (
          <p className="text-[12px] text-muted-foreground">{t('Waiting for the person who started this run to approve.')}</p>
        )}
      </div>
    </div>
  );
}

const VERDICT_UNCHECKED_REASON: Record<string, string> = {
  'verify-unavailable': 'The check could not run',
  'outcome-not-completed': 'Partial or blocked work is not checked',
  'external-model': 'Runs on an external model are not checked',
};

/**
 * The verifier's judgement of the finish that stood, under the agent's own
 * report: a checked pass, a fail the run ended on anyway, or an honest
 * "not verified". A run with no record (before verdicts existed) shows
 * nothing rather than a false "not verified".
 */
function VerdictLine({ verdict }: { verdict: RunVerdict }) {
  const { t } = useI18n();
  if (verdict.result === 'pass') {
    return (
      <div className="mt-1 flex items-center gap-2 px-1 text-[12px]">
        <ShieldCheck size={13} className="shrink-0 text-muted-foreground" />
        <span className="text-foreground/90">{t('Verifier: passed')}</span>
        {verdict.revisions > 0 && <span className="text-muted-foreground">{t('after {n} revisions', { n: verdict.revisions })}</span>}
      </div>
    );
  }
  if (verdict.result === 'fail') {
    return (
      <div className="mt-1 px-1 text-[12px]">
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
    <div className="mt-1 flex items-center gap-2 px-1 text-[12px]">
      <ShieldCheck size={13} className="shrink-0 text-muted-foreground" />
      <span className="text-foreground/90">{t('Not verified')}</span>
      {verdict.reason && VERDICT_UNCHECKED_REASON[verdict.reason] && (
        <span className="text-muted-foreground">{t(VERDICT_UNCHECKED_REASON[verdict.reason])}</span>
      )}
    </div>
  );
}

/**
 * The readings this run proposed for its Strategies' measures, and what
 * became of each: recorded, waiting for this review's acceptance, or
 * refused with the reason. Renders nothing when the run proposed none —
 * under manual review this block is part of what the reviewer accepts.
 */
function ReadingsBlock({ readings }: { readings: readonly ProposedReading[] }) {
  const { t } = useI18n();
  const labels = useMeasureLabels(readings.map((r) => r.measureId));
  if (!readings.length) return null;
  const stateOf = (r: ProposedReading): string =>
    r.applied ? t('Recorded')
      : r.heldReason === 'awaiting-acceptance' ? t('Waiting for acceptance')
      : r.heldReason === 'verdict-not-pass' ? t('Not recorded — the check did not pass')
      : r.heldReason === 'not-bound' ? t('Not recorded — not a measure this run serves')
      : t('Recording failed');
  return (
    <div className="mt-1 space-y-0.5 px-1 text-[12px]">
      {readings.map((r) => {
        const label = labels.get(r.measureId);
        return (
          <p key={r.measureId} className="flex flex-wrap items-baseline gap-x-2 leading-snug">
            <span className="text-foreground/90">{label?.title ?? r.measureId}</span>
            <span className="text-foreground/90">{r.value}{label?.unit ? ` ${label.unit}` : ''}</span>
            <span className="text-muted-foreground">{stateOf(r)}</span>
          </p>
        );
      })}
    </div>
  );
}

function FragmentRow({ children, open, colSpan, raw, rawLabel }: { children: React.ReactNode; open: boolean; colSpan: number; raw: Record<string, unknown>; rawLabel: string }) {
  return (
    <>
      <tr>{children}</tr>
      {open && (
        <tr>
          <td colSpan={colSpan} className="border-b border-border/60 pb-2">
            <div className="mb-1 text-[11px] text-muted-foreground">{rawLabel}</div>
            <pre className="max-h-60 overflow-auto rounded-md bg-muted/40 p-2 font-mono text-[11px] leading-relaxed">{JSON.stringify(raw, null, 2)}</pre>
          </td>
        </tr>
      )}
    </>
  );
}

function OutputItem({ output }: { output: AgentOutput }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(output.content); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch { /* clipboard denied */ }
  };
  return (
    <li>
      <div className="flex items-center gap-2 rounded-md px-1 py-1 transition-colors hover:bg-muted/40">
        <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <DisclosureTriangle open={open} className="text-muted-foreground" />
          <FileText size={13} className="shrink-0 text-muted-foreground" />
          <span className="truncate text-[13px] text-foreground">{output.title}</span>
          <span className="shrink-0 text-[11px] text-muted-foreground">{output.format}</span>
        </button>
        <Button variant="ghost" size="xs" onClick={() => void copy()} aria-label={t('Copy')}>
          {copied ? <Check size={12} /> : <Copy size={12} />}{copied ? t('Copied') : t('Copy')}
        </Button>
      </div>
      {open && (
        <div className="py-2 pl-6 pr-1">
          {output.format === 'markdown' || output.format === 'text'
            ? <MarkdownLite text={output.content} />
            : <pre className="max-h-96 overflow-auto font-mono text-[12px] leading-relaxed">{output.content}</pre>}
        </div>
      )}
    </li>
  );
}

/** A running run whose Workpad has been silent this long is stuck (its
 *  invocation died mid-turn): run-agent accepts a resume for it (its
 *  STALE_MS), so the panel offers one next to Stop. */
const STALE_RUNNING_MS = 10 * 60 * 1000;

export function AgentRunPanel({ agent, onRunAgain }: { agent: Agent; onRunAgain: () => void }) {
  const { t } = useI18n();
  const now = useNow();
  const run = agent.run;
  if (!run && !agent.outputs.length && !agent.error) return null;
  const status = run ? STATUS[run.status] ?? STATUS.completed : null;
  const finished = run && ['awaiting_review', 'completed', 'failed', 'cancelled'].includes(run.status);
  const cost = run ? Number(run.cost_usd || 0) : 0;
  const lastStep = agent.steps.at(-1);
  const lastActivity = lastStep?.created_at ?? run?.started_at ?? run?.created_at;
  const stuckRunning = run?.status === 'running' && !!lastActivity
    && now - new Date(lastActivity).getTime() > STALE_RUNNING_MS;
  const line = (run?.status === 'awaiting_approval' && agent.pending?.summary)
    || run?.summary
    || (run && ['queued', 'running'].includes(run.status) ? lastStep?.title : null)
    || (status ? t(status.label) : '');

  return (
    <section className="space-y-2">
      {agent.error && <p className="px-1 text-[12px] text-[var(--status-danger)]">{agent.error}</p>}
      {run && status && (
        <div>
          <div role="status" aria-live="polite" className="flex min-h-9 items-center gap-2.5 px-1 py-1.5">
            <StatusGlyph status={run.status} />
            <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">{line}</span>
            {cost > 0 && <span className="shrink-0 font-mono text-[11px] text-muted-foreground">${cost.toFixed(2)}</span>}
            <span className={cn('shrink-0 text-[12px]', status.tone)}>{t(status.label)}</span>
            {agent.isActive || run.status === 'awaiting_approval' ? (
              <>
                {stuckRunning && agent.isMine && (
                  <Button variant="secondary" size="xs" onClick={() => void agent.resume()}>{t('Resume')}</Button>
                )}
                <Button variant="ghost" size="xs" onClick={() => void agent.cancel()}>{t('Stop')}</Button>
              </>
            ) : run.status === 'paused' ? (
              agent.isMine ? <Button variant="secondary" size="xs" onClick={() => void agent.resume()}>{t('Resume')}</Button> : null
            ) : finished ? (
              <Button variant="ghost" size="xs" disabled={agent.starting} onClick={onRunAgain}>
                {run.mode === 'reply' ? t('Work on the Element') : t('Run again')}
              </Button>
            ) : null}
          </div>
          {(run.status === 'failed' || run.status === 'paused') && run.error && (
            <p className="mt-1 px-1 text-[12px] text-muted-foreground">{run.error}</p>
          )}
          <div className="px-1">
            <Workpad steps={agent.steps} />
          </div>
          <ReadingsBlock readings={run.proposed_readings ?? []} />
          {run.verdict && <VerdictLine verdict={run.verdict} />}
          <ApprovalCard agent={agent} />
        </div>
      )}

      {agent.outputs.length > 0 && (
        <div>
          <h2 className={`${FONT.lg} mb-1 px-1 text-foreground`}>{t('Outputs')}</h2>
          <ul className="space-y-px">{agent.outputs.map((a) => <OutputItem key={a.id} output={a} />)}</ul>
        </div>
      )}
    </section>
  );
}
