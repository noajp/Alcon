'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { FlaskConical, X } from '@/ui/icons';
import { Button } from '@/ui/button';
import { FONT } from '@/shared/designTokens';
import { useI18n } from '@/Function/i18n/I18nProvider';
import {
  agentRunOutcome, exceptionReason, runOutcome, templateSteps, verifyChain,
  type AgentOutcome, type AgentRunRecord, type AuditRunEntry, type ChainBreak, type ChainStep, type DeploymentState,
  type LedgerRun, type ProposedReading, type RunOutcome, type RunVerdict, type StepResult,
  type WorkflowDeploymentRecord,
} from '@/Function/audit/auditModel';
import { useAgentRunEvents } from '@/hooks/useAudit';
import { useMeasureLabels } from '@/AIP/ai/agentData';
import { useChainLinks, useRunSteps, sha256Hex, type AuditSource } from './auditSource';

// The pieces every Audit page shares: how a run's outcome and a step's
// result read, the figures, a run's row and its steps beside the list, the
// record-integrity line, and the notice that says the page shows a sample.

const OUTCOME_LABEL: Record<RunOutcome, string> = {
  auto: 'Completed by AI', approved: 'Approved', returned: 'Returned', exception: 'Handed to a person',
  deviation: 'Outside the grants', stopped: 'Stopped', waiting: 'Waiting for approval', running: 'Running',
};
const OUTCOME_TONE: Record<RunOutcome, string> = {
  auto: 'text-[var(--status-success)]', approved: 'text-[var(--status-success)]', returned: 'text-[var(--status-warning)]',
  exception: 'text-[var(--status-warning)]', deviation: 'text-[var(--status-danger)]', stopped: 'text-[var(--status-danger)]',
  waiting: 'text-[var(--status-info)]', running: 'text-muted-foreground',
};
export const STATE_LABEL: Record<DeploymentState, string> = { trial: 'Trial', live: 'Live', paused: 'Paused' };
const AGENT_OUTCOME_LABEL: Record<AgentOutcome, string> = {
  running: 'Running', waiting: 'Waiting', review: 'Awaiting review', passed: 'Verifier: passed',
  completed: 'Completed', unpassed: 'Verifier: not passed', failed: 'Failed', cancelled: 'Stopped',
};
const AGENT_OUTCOME_TONE: Record<AgentOutcome, string> = {
  running: 'text-muted-foreground', waiting: 'text-[var(--status-info)]', review: 'text-[var(--status-warning)]',
  passed: 'text-[var(--status-success)]', completed: 'text-muted-foreground', unpassed: 'text-[var(--status-danger)]',
  failed: 'text-[var(--status-danger)]', cancelled: 'text-muted-foreground',
};

/** The standing honesty marker on every agent row and panel: this source
 *  is the app's own record, not the gateway's sealed one. */
function AgentRunBadge() {
  const { t } = useI18n();
  return <span className={`${FONT.xs} rounded-md bg-muted px-1.5 py-0.5 text-muted-foreground`}>{t('Agent run · not hash-chained')}</span>;
}

/** The verifier's judgement as a small chip, when the run carries one. */
function VerdictChip({ verdict }: { verdict: RunVerdict }) {
  const { t } = useI18n();
  if (verdict.result === 'pass') return <span className="text-[var(--status-success)]">{t('Verifier: passed')}</span>;
  if (verdict.result === 'fail') return <span className="text-[var(--status-danger)]">{t('Verifier: not passed')}</span>;
  return <span className="text-muted-foreground">{t('Not verified')}</span>;
}
const RESULT_LABEL: Record<StepResult, string> = {
  ok: 'Done', failed: 'Failed', blocked: 'Blocked by the gateway', waiting: 'Waiting', approved: 'Approved', returned: 'Returned',
};
const RESULT_TONE: Partial<Record<StepResult, string>> = {
  failed: 'text-[var(--status-danger)]', blocked: 'text-[var(--status-danger)]', waiting: 'text-[var(--status-info)]', returned: 'text-[var(--status-warning)]',
};
const OPERATION_LABEL: Record<string, string> = { read: 'Read', draft: 'Draft', send: 'Send', money: 'Money', none: '' };
const REASON_LABEL: Record<string, string> = {
  low_confidence: 'Low reading confidence', unknown_item: 'Not in the master data', amount_mismatch: 'Amounts do not match',
  out_of_stock: 'Not enough stock', missing_field: 'A required field is missing',
};

export const pct = (value: number | null) => value === null ? '—' : `${Math.round(value * 100)}%`;

export function Empty({ children }: { children: ReactNode }) {
  return <p className={`${FONT.base} rounded-md bg-muted/30 p-4 text-muted-foreground`}>{children}</p>;
}

export function Stat({ label, value, hint, danger }: { label: string; value: string; hint?: string; danger?: boolean }) {
  return <div className="min-w-0 space-y-0.5">
    <dt className={`${FONT.sm} truncate text-muted-foreground`}>{label}</dt>
    <dd className={`${FONT['2xl']} truncate tabular-nums ${danger ? 'text-[var(--status-danger)]' : 'text-foreground'}`}>{value}</dd>
    {hint && <dd className={`${FONT.sm} truncate text-muted-foreground`}>{hint}</dd>}
  </div>;
}

/** Says the page shows the on-screen sample, and what makes it go away. */
export function SampleNotice() {
  const { t } = useI18n();
  return <div className="flex items-start gap-2.5 rounded-lg bg-[var(--status-info-subtle)] px-4 py-3">
    <FlaskConical size={16} className="mt-0.5 shrink-0 text-[var(--status-info)]" />
    <div className="min-w-0 space-y-0.5">
      <p className={`${FONT.base} font-medium text-foreground`}>{t('You are looking at sample data')}</p>
      <p className={`${FONT.sm} text-muted-foreground`}>{t('There is no AI work in this Space that you can see yet, so Audit shows two made-up workflows. The sample is not saved anywhere and disappears as soon as a workflow is registered or an agent runs.')}</p>
    </div>
  </div>;
}

/** A small label in a page header saying the page shows the sample. */
export function SampleBadge() {
  const { t } = useI18n();
  return <span className={`${FONT.xs} rounded-md bg-[var(--status-info-subtle)] px-2 py-0.5 text-[var(--status-info)]`}>{t('Sample')}</span>;
}

function runRowTime(iso: string, locale: string): string {
  return new Date(iso).toLocaleString(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** One ledger run as a row: when, which document, why it stopped, how it ended. */
function LedgerRunRow({ run, deploymentOf, selected, onOpen }: {
  run: LedgerRun; deploymentOf?: Map<string, WorkflowDeploymentRecord>; selected: boolean; onOpen: (key: string) => void;
}) {
  const { t, locale } = useI18n();
  const outcome = runOutcome(run.steps);
  const reason = exceptionReason(run.steps);
  return (
    <button type="button" onClick={() => onOpen(`ledger:${run.id}`)} aria-pressed={selected}
      className={`grid w-full grid-cols-[120px_minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-muted/40 ${selected ? 'bg-muted/50' : ''}`}>
      <span className={`${FONT.sm} tabular-nums text-muted-foreground`}>{runRowTime(run.started_at, locale)}</span>
      <span className="min-w-0">
        <span className={`${FONT.base} block truncate text-foreground`}>{run.subject_ref ?? run.external_id}</span>
        {deploymentOf && <span className={`${FONT.sm} block truncate text-muted-foreground`}>{deploymentOf.get(run.deployment_id)?.name ?? '—'}</span>}
      </span>
      <span className={`${FONT.sm} truncate text-muted-foreground`}>{reason ? t(REASON_LABEL[reason] ?? reason) : ''}</span>
      <span className={`${FONT.sm} ${OUTCOME_TONE[outcome]}`}>{t(OUTCOME_LABEL[outcome])}</span>
    </button>
  );
}

/** The runs as rows: when, which document, why it stopped, how it ended. */
export function RunRows({ runs, deploymentOf, selectedId, onOpen, limitStep = 100 }: {
  runs: LedgerRun[]; deploymentOf?: Map<string, WorkflowDeploymentRecord>; selectedId: string | null; onOpen: (id: string) => void; limitStep?: number;
}) {
  const { t } = useI18n();
  const [limit, setLimit] = useState(limitStep);
  return <div className="space-y-0.5">
    {runs.slice(0, limit).map(run => (
      <LedgerRunRow key={run.id} run={run} deploymentOf={deploymentOf} selected={selectedId === run.id || selectedId === `ledger:${run.id}`}
        onOpen={key => onOpen(key.replace(/^ledger:/, ''))} />
    ))}
    {runs.length > limit && <Button size="xs" variant="ghost" onClick={() => setLimit(limit + limitStep)}>{t('Show more')}</Button>}
  </div>;
}

/** One agent run as a row: when, which Element, its verdict, how it stands —
 *  and the badge that keeps it from ever being mistaken for a ledger record. */
function AgentRunRow({ run, startedAt, selected, onOpen }: {
  run: AgentRunRecord; startedAt: string; selected: boolean; onOpen: (key: string) => void;
}) {
  const { t, locale } = useI18n();
  const outcome = agentRunOutcome(run);
  return (
    <button type="button" onClick={() => onOpen(`agent:${run.id}`)} aria-pressed={selected}
      className={`grid w-full grid-cols-[120px_minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-muted/40 ${selected ? 'bg-muted/50' : ''}`}>
      <span className={`${FONT.sm} tabular-nums text-muted-foreground`}>{runRowTime(startedAt, locale)}</span>
      <span className="min-w-0">
        <span className={`${FONT.base} block truncate text-foreground`}>{run.elementTitle || run.element_id}</span>
        {run.objectName && <span className={`${FONT.sm} block truncate text-muted-foreground`}>{run.objectName}</span>}
      </span>
      <span className={`${FONT.sm} truncate text-muted-foreground`}>{run.summary ?? run.error ?? ''}</span>
      <span className="flex flex-col items-end gap-1">
        <span className={`${FONT.sm} flex items-baseline gap-2`}>
          {run.verdict && <VerdictChip verdict={run.verdict} />}
          <span className={AGENT_OUTCOME_TONE[outcome]}>{t(AGENT_OUTCOME_LABEL[outcome])}</span>
        </span>
        <AgentRunBadge />
      </span>
    </button>
  );
}

/** The merged timeline as rows: ledger runs exactly as RunRows renders
 *  them, agent runs badged as what they are. Selection and opening speak
 *  in entry keys, so the two id spaces never collide. */
export function EntryRows({ entries, deploymentOf, selectedId, onOpen, limitStep = 100 }: {
  entries: AuditRunEntry[]; deploymentOf?: Map<string, WorkflowDeploymentRecord>; selectedId: string | null; onOpen: (key: string) => void; limitStep?: number;
}) {
  const { t } = useI18n();
  const [limit, setLimit] = useState(limitStep);
  return <div className="space-y-0.5">
    {entries.slice(0, limit).map(entry => entry.source === 'ledger'
      ? <LedgerRunRow key={entry.key} run={entry.run} deploymentOf={deploymentOf} selected={selectedId === entry.key} onOpen={onOpen} />
      : <AgentRunRow key={entry.key} run={entry.run} startedAt={entry.startedAt} selected={selectedId === entry.key} onOpen={onOpen} />)}
    {entries.length > limit && <Button size="xs" variant="ghost" onClick={() => setLimit(limit + limitStep)}>{t('Show more')}</Button>}
  </div>;
}

/** One run's steps beside the list it was opened from. */
export function RunPanel({ source, run, deployment, onClose }: {
  source: AuditSource; run: LedgerRun; deployment: WorkflowDeploymentRecord | null; onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const detail = useRunSteps(source, run.id);
  const template = deployment ? source.templates.find(tp => tp.id === deployment.template_id) : undefined;
  const labels = useMemo(() => new Map(templateSteps(template?.steps).map(s => [s.key, s.label])), [template?.steps]);
  const outcome = runOutcome(run.steps);
  const time = (iso: string) => new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return (
    <aside className="flex w-[380px] flex-shrink-0 flex-col overflow-y-auto border-l border-border/60 bg-card" aria-label={t('Run')}>
      <div className="flex items-start gap-2 px-4 pb-3 pt-4">
        <div className="min-w-0 flex-1 space-y-0.5">
          <h2 className={`${FONT.lg} truncate text-foreground`}>{run.subject_ref ?? run.external_id}</h2>
          <p className={`${FONT.sm} truncate text-muted-foreground`}>{deployment?.name ?? '—'} · {t('version {n}', { n: run.template_version })}</p>
          <p className={`${FONT.sm} ${OUTCOME_TONE[outcome]}`}>{t(OUTCOME_LABEL[outcome])}</p>
        </div>
        <Button size="icon-sm" variant="ghost" onClick={onClose} aria-label={t('Close')} title={t('Close')}><X size={14} /></Button>
      </div>
      <dl className={`${FONT.sm} grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-1 px-4 pb-4 text-muted-foreground`}>
        <dt>{t('Started at')}</dt><dd className="text-foreground">{new Date(run.started_at).toLocaleString(locale)}</dd>
        <dt>{t('Run ID')}</dt><dd className={`${FONT.mono} truncate`}>{run.external_id}</dd>
        {run.subject_digest && <><dt>{t('Document digest')}</dt><dd className={`${FONT.mono} truncate`} title={run.subject_digest}>{run.subject_digest.slice(0, 16)}…</dd></>}
      </dl>
      {detail.error && <p role="alert" className={`${FONT.sm} mx-4 mb-3 rounded-md bg-[var(--status-danger-subtle)] p-2 text-foreground`}>{t("Could not read the run's steps.")}</p>}
      {detail.loading && <p className={`${FONT.sm} px-4 text-muted-foreground`}>{t('Loading the steps…')}</p>}
      <ol className="space-y-0.5 px-2 pb-4">
        {detail.steps.map(step => (
          <li key={step.id} className="rounded-md px-2 py-2 hover:bg-muted/30">
            <div className="flex items-baseline gap-2">
              <span className={`${FONT.mono} w-10 shrink-0`}>#{step.seq}</span>
              <span className={`${FONT.base} min-w-0 flex-1 truncate text-foreground`}>{labels.get(step.step_key) ?? step.step_key}</span>
              <span className={`${FONT.sm} shrink-0 ${RESULT_TONE[step.result] ?? 'text-muted-foreground'}`}>{t(RESULT_LABEL[step.result])}</span>
            </div>
            {step.outside_grant && <p className={`${FONT.sm} ml-12 text-[var(--status-danger)]`}>
              {step.grants_version === null ? t('Outside the grants: the gateway held none') : t('Outside the grants of version {n}', { n: step.grants_version })}
            </p>}
            <div className={`${FONT.sm} ml-12 flex flex-wrap gap-x-2 text-muted-foreground`}>
              <span>{time(step.occurred_at)}</span>
              {step.connector && <span>{step.connector}{OPERATION_LABEL[step.operation] ? ` · ${t(OPERATION_LABEL[step.operation])}` : ''}</span>}
              <span>{step.actor_name ?? t(step.actor_kind === 'human' ? 'A person' : step.actor_kind === 'ai_agent' ? 'AI agent' : 'System')}</span>
              {step.duration_ms !== null && <span>{t('{n} ms', { n: step.duration_ms })}</span>}
              {step.reason && <span className="text-[var(--status-warning)]">{t(REASON_LABEL[step.reason] ?? step.reason)}</span>}
            </div>
          </li>
        ))}
      </ol>
    </aside>
  );
}

const READING_STATE_LABEL = (r: ProposedReading): string =>
  r.applied ? 'Recorded'
    : r.heldReason === 'awaiting-acceptance' ? 'Waiting for acceptance'
    : r.heldReason === 'verdict-not-pass' ? 'Not recorded — the check did not pass'
    : r.heldReason === 'not-bound' ? 'Not recorded — not a measure this run serves'
    : 'Recording failed';

const VERDICT_UNCHECKED_REASON: Record<string, string> = {
  'verify-unavailable': 'The check could not run',
  'outcome-not-completed': 'Partial or blocked work is not checked',
  'external-model': 'Runs on an external model are not checked',
};

/**
 * One agent run beside the log: its Element, its standing, the verifier's
 * verdict and the readings its finish proposed, then its steps. It shares
 * the ledger panel's step-row markup and nothing else — no chain fields,
 * no digest, no integrity language, and a plain statement of why: this
 * record lives in the app database and is not part of the sealed ledger.
 * The live Workpad and its approvals live on the Element itself.
 */
export function AgentRunPanel({ run, onClose }: { run: AgentRunRecord; onClose: () => void }) {
  const { t, locale } = useI18n();
  const detail = useAgentRunEvents(run.id);
  const readings = run.proposed_readings ?? [];
  const labels = useMeasureLabels(readings.map(r => r.measureId));
  const outcome = agentRunOutcome(run);
  const time = (iso: string) => new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  // Each event pairs with the row it came from, in order: step events
  // consume step rows (their titles and times), approvals consume actions.
  let stepAt = 0;
  let actionAt = 0;
  const rows = detail.events.map(event => {
    if (event.kind === 'approval') {
      const action = detail.actions[actionAt++];
      return { event, title: t('Approval'), at: action?.created_at ?? null };
    }
    const stepRow = detail.steps[stepAt++];
    return { event, title: stepRow?.title ?? event.step_key, at: stepRow?.created_at ?? null };
  });
  const verdict = run.verdict;
  return (
    <aside className="flex w-[380px] flex-shrink-0 flex-col overflow-y-auto border-l border-border/60 bg-card" aria-label={t('Run')}>
      <div className="flex items-start gap-2 px-4 pb-3 pt-4">
        <div className="min-w-0 flex-1 space-y-0.5">
          <h2 className={`${FONT.lg} truncate text-foreground`}>{run.elementTitle || run.element_id}</h2>
          <p className={`${FONT.sm} truncate text-muted-foreground`}>{run.objectName ?? '—'}</p>
          <p className={`${FONT.sm} flex items-center gap-2`}>
            <span className={AGENT_OUTCOME_TONE[outcome]}>{t(AGENT_OUTCOME_LABEL[outcome])}</span>
            <AgentRunBadge />
          </p>
        </div>
        <Button size="icon-sm" variant="ghost" onClick={onClose} aria-label={t('Close')} title={t('Close')}><X size={14} /></Button>
      </div>
      <dl className={`${FONT.sm} grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-1 px-4 pb-4 text-muted-foreground`}>
        <dt>{t('Started at')}</dt><dd className="text-foreground">{run.started_at ? new Date(run.started_at).toLocaleString(locale) : '—'}</dd>
        {run.finished_at && <><dt>{t('Finished at')}</dt><dd className="text-foreground">{new Date(run.finished_at).toLocaleString(locale)}</dd></>}
        <dt>{t('Cost')}</dt><dd className="text-foreground">{`$${run.cost_usd.toFixed(2)}`}</dd>
        {run.summary && <><dt>{t('Summary')}</dt><dd className="text-foreground">{run.summary}</dd></>}
        {run.error && <><dt>{t('Error')}</dt><dd className="text-[var(--status-danger)]">{run.error}</dd></>}
      </dl>
      {verdict && (
        <div className="px-4 pb-4">
          <p className={`${FONT.sm} flex flex-wrap items-baseline gap-x-2`}>
            <VerdictChip verdict={verdict} />
            {verdict.result === 'pass' && verdict.revisions > 0 && <span className="text-muted-foreground">{t('after {n} revisions', { n: verdict.revisions })}</span>}
            {verdict.result === 'unchecked' && verdict.reason && VERDICT_UNCHECKED_REASON[verdict.reason] && <span className="text-muted-foreground">{t(VERDICT_UNCHECKED_REASON[verdict.reason])}</span>}
          </p>
          {verdict.gaps.length > 0 && (
            <ul className={`${FONT.sm} mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground`}>
              {verdict.gaps.map((gap, i) => <li key={i}>{gap}</li>)}
            </ul>
          )}
          {verdict.checkedAt && <p className={`${FONT.sm} mt-1 text-muted-foreground`}>{t('Checked at')} {new Date(verdict.checkedAt).toLocaleString(locale)}{verdict.evidence.verifyStepIdx !== null ? ` · #${verdict.evidence.verifyStepIdx}` : ''}</p>}
        </div>
      )}
      {readings.length > 0 && (
        <div className="space-y-0.5 px-4 pb-4">
          {readings.map(r => {
            const label = labels.get(r.measureId);
            return (
              <p key={r.measureId} className={`${FONT.sm} flex flex-wrap items-baseline gap-x-2`}>
                <span className="text-foreground">{label?.title ?? r.measureId}</span>
                <span className="text-foreground">{r.value}{label?.unit ? ` ${label.unit}` : ''}</span>
                <span className="text-muted-foreground">{t(READING_STATE_LABEL(r))}</span>
              </p>
            );
          })}
        </div>
      )}
      {detail.error && <p role="alert" className={`${FONT.sm} mx-4 mb-3 rounded-md bg-[var(--status-danger-subtle)] p-2 text-foreground`}>{t("Could not read the run's steps.")}</p>}
      {detail.loading && <p className={`${FONT.sm} px-4 text-muted-foreground`}>{t('Loading the steps…')}</p>}
      <ol className="space-y-0.5 px-2 pb-4">
        {rows.map(({ event, title, at }, i) => (
          <li key={i} className="rounded-md px-2 py-2 hover:bg-muted/30">
            <div className="flex items-baseline gap-2">
              <span className={`${FONT.mono} w-10 shrink-0`}>#{event.seq}</span>
              <span className={`${FONT.base} min-w-0 flex-1 truncate text-foreground`}>{title}</span>
              <span className={`${FONT.sm} shrink-0 ${RESULT_TONE[event.result] ?? 'text-muted-foreground'}`}>{t(RESULT_LABEL[event.result])}</span>
            </div>
            <div className={`${FONT.sm} ml-12 flex flex-wrap gap-x-2 text-muted-foreground`}>
              {at && <span>{time(at)}</span>}
              {event.reason && <span className={event.kind === 'exception' ? 'text-[var(--status-warning)]' : undefined}>{event.reason}</span>}
            </div>
          </li>
        ))}
      </ol>
      <p className={`${FONT.sm} border-t border-border/60 px-4 py-3 text-muted-foreground`}>{t('This run is recorded in the app database and is not part of the hash-chained ledger.')}</p>
    </aside>
  );
}

/** The chain check for these steps; null while it runs. A result is kept with
 *  the steps it checked, so a newer read never shows an older verdict. */
function useChain(steps: ChainStep[]) {
  const [state, setState] = useState<{ steps: ChainStep[]; breaks: ChainBreak[] } | null>(null);
  useEffect(() => {
    let live = true;
    if (steps.length) verifyChain(steps, sha256Hex).then(breaks => { if (live) setState({ steps, breaks }); }, () => {});
    return () => { live = false; };
  }, [steps]);
  return state && state.steps === steps ? { checked: steps.length, breaks: state.breaks } : null;
}

export type Integrity = 'none' | 'checking' | 'intact' | 'broken' | 'error';

/** Whether a deployment's latest records link up and match their contents. */
export function useIntegrity(source: AuditSource, deploymentId: string): { state: Integrity; message: string } {
  const { t } = useI18n();
  const links = useChainLinks(source, deploymentId);
  const chain = useChain(links.steps);
  if (links.error) return { state: 'error', message: t('Could not read the record chain.') };
  if (links.loading) return { state: 'checking', message: t('Checking the records…') };
  if (!links.steps.length) return { state: 'none', message: t('No records to check yet.') };
  if (!chain) return { state: 'checking', message: t('Checking the records…') };
  if (chain.breaks.length) return { state: 'broken', message: t('The record chain breaks at #{seq}. A record may have been removed or altered.', { seq: chain.breaks[0].seq }) };
  if (links.total > chain.checked) return { state: 'intact', message: t('The latest {n} of {total} records link to the one before them and match their contents.', { n: chain.checked, total: links.total }) };
  return { state: 'intact', message: t('All {n} records link to the one before them and match their contents.', { n: chain.checked }) };
}
