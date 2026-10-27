'use client';

import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, ScrollText, Workflow, X } from 'lucide-react';
import { Button } from '@/ui/button';
import { FONT } from '@/shared/designTokens';
import { PageSection } from '@/Function/shared/PageHead';
import { ToolPage, type ToolView } from '@/Function/shared/tool/ToolPage';
import { NavAuditIcon } from '@/shell/sidebar/NavIcons';
import { useI18n } from '@/Function/i18n/I18nProvider';
import type { NavigationState } from '@/types/navigation';
import { useAudit, AUDIT_WINDOW_DAYS, type Audit } from '@/hooks/useAudit';
import { auditRoute, type AuditRoute, type AuditViewId } from '@/Function/audit/auditRoute';
import {
  exceptionReason, flowObservation, inChainOrder, runOutcome, templateSteps, verifyChain,
  type ChainBreak, type DeploymentState, type DeploymentSummary, type RunOutcome, type StepResult,
  type WorkflowDeploymentRecord, type WorkflowRunRecord, type WorkflowStepRecord,
} from '@/Function/audit/auditModel';
import { useAuditScope } from './auditScope';

// The Audit App: what the AI agents did in this Space's business, read from
// the ledger the gateway writes (ADR 0044). Workflows is the ledger of
// deployments — where each runs and how it goes; the log is every run, with
// its steps beside it. Nothing here holds a document's body.

const VIEWS: readonly ToolView[] = [
  { id: 'workflows', label: 'Workflows', icon: Workflow, description: 'Each AI workflow running in this Space: where it runs, who runs it, and how its runs end.' },
  { id: 'log', label: 'Audit log', icon: ScrollText, description: 'Every run of the last {n} days, newest first. Records hold document numbers, never their contents.' },
];

const OUTCOME_LABEL: Record<RunOutcome, string> = {
  auto: 'Completed by AI', approved: 'Approved', returned: 'Returned', exception: 'Handed to a person',
  deviation: 'Blocked operation', stopped: 'Stopped', waiting: 'Waiting for approval', running: 'Running',
};
const OUTCOME_TONE: Record<RunOutcome, string> = {
  auto: 'text-[var(--status-success)]', approved: 'text-[var(--status-success)]', returned: 'text-[var(--status-warning)]',
  exception: 'text-[var(--status-warning)]', deviation: 'text-[var(--status-danger)]', stopped: 'text-[var(--status-danger)]',
  waiting: 'text-[var(--status-info)]', running: 'text-muted-foreground',
};
const STATE_LABEL: Record<DeploymentState, string> = { trial: 'Trial', live: 'Live', paused: 'Paused' };
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

const pct = (value: number | null) => value === null ? '—' : `${Math.round(value * 100)}%`;

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function AuditView({ navigation, onNavigate }: {
  navigation: NavigationState;
  onNavigate: (navigation: Partial<NavigationState>) => void;
}) {
  const { t } = useI18n();
  const route = auditRoute(navigation.audit);
  const audit = useAudit();
  const scoped = useAuditScope(audit);
  const go = (patch: Partial<AuditRoute>) => onNavigate({ audit: { ...route, ...patch } });
  const deployment = route.deploymentId ? scoped.deploymentOf.get(route.deploymentId) ?? null : null;
  const run = route.runId ? audit.runs.find(r => r.id === route.runId) ?? null : null;
  const views = VIEWS.map(view => ({ ...view, description: view.description && t(view.description, { n: AUDIT_WINDOW_DAYS }) }));

  const status = audit.error
    ? <p role="alert" className={`${FONT.base} rounded-md bg-[var(--status-danger-subtle)] p-3 text-foreground`}>{t('Could not read the audit ledger.')} {audit.error.message}</p>
    : audit.loading ? <p className={`${FONT.base} text-muted-foreground`}>{t('Loading the audit ledger…')}</p> : null;

  return (
    <ToolPage icon={NavAuditIcon} tool={t('Audit')} crumb={deployment?.name ?? scoped.scopeName} storageKey="audit" home="workflows"
      views={views} activeView={route.view} onSelectView={id => onNavigate({ audit: { view: id as AuditViewId } })}
      actions={<Button size="sm" variant="ghost" onClick={() => void audit.refetch()} aria-label={t('Refresh')} title={t('Refresh')}><RefreshCw size={14} /></Button>}
      scrollKey={route.deploymentId ?? null}
      record={route.view === 'workflows' && deployment
        ? <DeploymentPage audit={audit} deployment={deployment} summary={scoped.summaries.get(deployment.id)} onBack={() => go({ deploymentId: null })} onOpenRun={id => onNavigate({ audit: { view: 'log', runId: id } })} />
        : undefined}
      panel={route.view === 'log' && run ? <RunPanel audit={audit} run={run} deployment={scoped.deploymentOf.get(run.deployment_id) ?? null} onClose={() => go({ runId: null })} /> : undefined}>
      <div className="space-y-6">
        {status}
        {!status && route.view === 'workflows' && <Ledger audit={audit} deployments={scoped.deployments} summaries={scoped.summaries} onOpen={id => go({ deploymentId: id })} />}
        {!status && route.view === 'log' && <RunLog audit={audit} runs={route.attention ? scoped.attention : scoped.runs}
          deploymentOf={scoped.deploymentOf} selectedId={route.runId ?? null} attention={!!route.attention}
          onOpen={id => go({ runId: id })} onClearAttention={() => go({ attention: false })} />}
      </div>
    </ToolPage>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className={`${FONT.base} rounded-md bg-muted/30 p-4 text-muted-foreground`}>{children}</p>;
}

function Ledger({ audit, deployments, summaries, onOpen }: {
  audit: Audit; deployments: WorkflowDeploymentRecord[]; summaries: Map<string, DeploymentSummary>; onOpen: (id: string) => void;
}) {
  const { t } = useI18n();
  if (!deployments.length) return <Empty>{t('No AI workflows are registered in this Space yet. A workflow appears here when its gateway is connected and starts reporting.')}</Empty>;
  const template = (id: string) => audit.templates.find(tp => tp.id === id);
  const domain = (id: string | null) => id ? audit.domains.find(d => d.id === id)?.name ?? t('Unknown Domain') : t('Shared by the Space');
  const worker = (id: string | null) => id ? audit.workers.find(w => w.id === id)?.name ?? '—' : '—';
  const head = `${FONT.xs} text-muted-foreground/70`;
  const grid = 'grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_72px_88px_88px_88px] items-center gap-3';
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[760px]">
        <div className={`${grid} px-3 py-2 ${head}`}>
          <span>{t('Workflow')}</span><span>{t('Domain')}</span><span>{t('Agent')}</span>
          <span className="text-right">{t('Runs')}</span><span className="text-right">{t('Completed by AI')}</span>
          <span className="text-right">{t('Returned')}</span><span className="text-right">{t('Needs a person')}</span>
        </div>
        {deployments.map(d => {
          const s = summaries.get(d.id);
          const tp = template(d.template_id);
          return (
            <button key={d.id} type="button" onClick={() => onOpen(d.id)} className={`${grid} w-full rounded-md px-3 py-2.5 text-left hover:bg-muted/40`}>
              <span className="min-w-0">
                <span className={`${FONT.base} block truncate font-medium text-foreground`}>{d.name}</span>
                <span className={`${FONT.sm} block truncate text-muted-foreground`}>
                  {tp ? t('{name} · version {n}', { name: tp.name, n: tp.version }) : '—'} · {t(STATE_LABEL[d.state])}
                </span>
              </span>
              <span className={`${FONT.base} truncate text-muted-foreground`}>{domain(d.domain_id)}</span>
              <span className={`${FONT.base} truncate text-muted-foreground`}>{worker(d.worker_id)}</span>
              <span className={`${FONT.base} text-right tabular-nums`}>{s?.runs ?? 0}</span>
              <span className={`${FONT.base} text-right tabular-nums`}>{pct(s?.autoRate ?? null)}</span>
              <span className={`${FONT.base} text-right tabular-nums`}>{pct(s?.returnRate ?? null)}</span>
              <span className={`${FONT.base} text-right tabular-nums ${s?.needsPerson ? 'text-[var(--status-danger)]' : 'text-muted-foreground'}`}>{s?.needsPerson ?? 0}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Stat({ label, value, hint, danger }: { label: string; value: string; hint?: string; danger?: boolean }) {
  return <div className="min-w-0 space-y-0.5">
    <dt className={`${FONT.sm} truncate text-muted-foreground`}>{label}</dt>
    <dd className={`${FONT['2xl']} truncate tabular-nums ${danger ? 'text-[var(--status-danger)]' : 'text-foreground'}`}>{value}</dd>
    {hint && <dd className={`${FONT.sm} truncate text-muted-foreground`}>{hint}</dd>}
  </div>;
}

/** The deployment's steps, in chain order, across the runs read. */
function deploymentSteps(audit: Audit, deploymentId: string): WorkflowStepRecord[] {
  return inChainOrder((audit.runsByDeployment.get(deploymentId) ?? []).flatMap(run => audit.stepsByRun.get(run.id) ?? []));
}

/** The chain check for these steps; null while it runs. A result is kept with
 *  the steps it checked, so a newer read never shows an older verdict. */
function useChain(steps: WorkflowStepRecord[]) {
  const [state, setState] = useState<{ steps: WorkflowStepRecord[]; breaks: ChainBreak[] } | null>(null);
  useEffect(() => {
    let live = true;
    if (steps.length) verifyChain(steps, sha256Hex).then(breaks => { if (live) setState({ steps, breaks }); }, () => {});
    return () => { live = false; };
  }, [steps]);
  return state && state.steps === steps ? { checked: steps.length, breaks: state.breaks } : null;
}

function DeploymentPage({ audit, deployment, summary, onBack, onOpenRun }: {
  audit: Audit; deployment: WorkflowDeploymentRecord; summary: DeploymentSummary | undefined; onBack: () => void; onOpenRun: (id: string) => void;
}) {
  const { t, locale } = useI18n();
  const template = audit.templates.find(tp => tp.id === deployment.template_id);
  const steps = useMemo(() => deploymentSteps(audit, deployment.id), [audit, deployment.id]);
  const flow = useMemo(() => flowObservation(templateSteps(template?.steps), steps), [template?.steps, steps]);
  const chain = useChain(steps);
  const runs = audit.runsByDeployment.get(deployment.id) ?? [];
  const domain = deployment.domain_id ? audit.domains.find(d => d.id === deployment.domain_id)?.name ?? t('Unknown Domain') : t('Shared by the Space');
  const agent = deployment.worker_id ? audit.workers.find(w => w.id === deployment.worker_id)?.name ?? '—' : '—';
  // Hours saved is an estimate: the minutes a person spent per item, assumed
  // at registration, times the runs that finished without a person.
  const saved = deployment.minutes_per_item !== null && summary ? summary.outcomes.auto * deployment.minutes_per_item / 60 : null;

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <Button size="xs" variant="ghost" onClick={onBack}>{t('All workflows')}</Button>
        <h1 className={`${FONT['2xl']} text-foreground`}>{deployment.name}</h1>
        <p className={`${FONT.base} text-muted-foreground`}>
          {[template ? t('{name} · version {n}', { name: template.name, n: template.version }) : null, domain, agent, t(STATE_LABEL[deployment.state])].filter(Boolean).join(' · ')}
        </p>
        {template?.purpose && <p className={`${FONT.base} text-foreground`}>{template.purpose}</p>}
      </div>

      <dl className="grid grid-cols-2 gap-6 sm:grid-cols-4">
        <Stat label={t('Runs in {n} days', { n: AUDIT_WINDOW_DAYS })} value={String(summary?.runs ?? 0)} />
        <Stat label={t('Completed by AI')} value={pct(summary?.autoRate ?? null)} hint={t('Of the runs that finished')} />
        <Stat label={t('Returned by a person')} value={pct(summary?.returnRate ?? null)} hint={t('Of the runs a person reviewed')} />
        <Stat label={t('Needs a person')} value={String(summary?.needsPerson ?? 0)} danger={!!summary?.needsPerson}
          hint={saved === null ? undefined : t('About {h} hours saved (estimate)', { h: saved.toLocaleString(locale, { maximumFractionDigits: 1 }) })} />
      </dl>

      <PageSection title={t('Flow')}>
        <p className={`${FONT.sm} mb-3 text-muted-foreground`}>{t('The steps the template declares, with what the gateway saw at each one. A step outside the template is shown after them.')}</p>
        {!flow.length ? <Empty>{t('Nothing has passed through this workflow yet.')}</Empty> : (
          <ol className="space-y-1">
            {flow.map((s, i) => (
              <li key={s.key} className="grid grid-cols-[28px_minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-3 rounded-md px-3 py-2 hover:bg-muted/30">
                <span className={`${FONT.mono}`}>{s.declared ? i + 1 : '—'}</span>
                <span className="min-w-0">
                  <span className={`${FONT.base} block truncate text-foreground`}>{s.label}</span>
                  {!s.declared && <span className={`${FONT.sm} block text-[var(--status-warning)]`}>{t('Not in the template')}</span>}
                </span>
                <span className={`${FONT.sm} truncate text-muted-foreground`}>{s.connectors.join(', ') || '—'}</span>
                <span className={`${FONT.sm} flex gap-3 tabular-nums`}>
                  <span className="text-muted-foreground">{t('{n} passed', { n: s.events })}</span>
                  {s.failed > 0 && <span className="text-[var(--status-danger)]">{t('{n} failed', { n: s.failed })}</span>}
                  {s.blocked > 0 && <span className="text-[var(--status-danger)]">{t('{n} blocked', { n: s.blocked })}</span>}
                  {s.waiting > 0 && <span className="text-[var(--status-info)]">{t('{n} waiting', { n: s.waiting })}</span>}
                </span>
              </li>
            ))}
          </ol>
        )}
      </PageSection>

      <PageSection title={t('Connections used')}>
        {!summary?.connectors.length ? <Empty>{t('No connection has been called yet.')}</Empty> : (
          <ul className="space-y-1">
            {summary.connectors.map(c => (
              <li key={c.connector} className="flex items-center gap-3 rounded-md px-3 py-2 hover:bg-muted/30">
                <span className={`${FONT.base} flex-1 truncate text-foreground`}>{c.connector}</span>
                <span className={`${FONT.sm} tabular-nums text-muted-foreground`}>{t('{n} calls', { n: c.calls })}</span>
                {c.failed > 0 && <span className={`${FONT.sm} tabular-nums text-[var(--status-danger)]`}>{t('{n} failed', { n: c.failed })}</span>}
                {c.blocked > 0 && <span className={`${FONT.sm} tabular-nums text-[var(--status-danger)]`}>{t('{n} blocked', { n: c.blocked })}</span>}
              </li>
            ))}
          </ul>
        )}
      </PageSection>

      <PageSection title={t('Record integrity')}>
        <p className={`${FONT.base} ${chain?.breaks.length ? 'text-[var(--status-danger)]' : 'text-muted-foreground'}`}>
          {!steps.length ? t('No records to check yet.')
            : !chain ? t('Checking the records…')
            : chain.breaks.length ? t('The record chain breaks at #{seq}. A record may have been removed or altered.', { seq: chain.breaks[0].seq })
            : t('All {n} records link to the one before them and match their contents.', { n: chain.checked })}
        </p>
      </PageSection>

      <PageSection title={t('Recent runs')}>
        {!runs.length ? <Empty>{t('No runs in the last {n} days.', { n: AUDIT_WINDOW_DAYS })}</Empty> : (
          <RunRows audit={audit} runs={runs.slice(0, 20)} selectedId={null} onOpen={onOpenRun} />
        )}
      </PageSection>
    </div>
  );
}

function RunLog({ audit, runs, deploymentOf, selectedId, attention, onOpen, onClearAttention }: {
  audit: Audit; runs: WorkflowRunRecord[]; deploymentOf: Map<string, WorkflowDeploymentRecord>; selectedId: string | null;
  attention: boolean; onOpen: (id: string) => void; onClearAttention: () => void;
}) {
  const { t } = useI18n();
  return <div className="space-y-3">
    {attention && <div className="flex items-center gap-2">
      <Button size="xs" variant="secondary" onClick={onClearAttention} aria-label={t('Clear filter {name}', { name: t('Needs a person') })}>{t('Needs a person')}<X size={12} /></Button>
      <span className={`${FONT.sm} text-muted-foreground`}>{t('{n} runs', { n: runs.length })}</span>
    </div>}
    {!runs.length
      ? <Empty>{attention ? t('Nothing needs a person right now.') : t('No runs in the last {n} days.', { n: AUDIT_WINDOW_DAYS })}</Empty>
      : <RunRows audit={audit} runs={runs} deploymentOf={deploymentOf} selectedId={selectedId} onOpen={onOpen} />}
  </div>;
}

function RunRows({ audit, runs, deploymentOf, selectedId, onOpen }: {
  audit: Audit; runs: WorkflowRunRecord[]; deploymentOf?: Map<string, WorkflowDeploymentRecord>; selectedId: string | null; onOpen: (id: string) => void;
}) {
  const { t, locale } = useI18n();
  const [limit, setLimit] = useState(100);
  return <div className="space-y-0.5">
    {runs.slice(0, limit).map(run => {
      const steps = audit.stepsByRun.get(run.id) ?? [];
      const outcome = runOutcome(steps);
      const reason = exceptionReason(steps);
      return (
        <button key={run.id} type="button" onClick={() => onOpen(run.id)} aria-pressed={selectedId === run.id}
          className={`grid w-full grid-cols-[132px_minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-muted/40 ${selectedId === run.id ? 'bg-muted/50' : ''}`}>
          <span className={`${FONT.sm} tabular-nums text-muted-foreground`}>{new Date(run.started_at).toLocaleString(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
          <span className="min-w-0">
            <span className={`${FONT.base} block truncate text-foreground`}>{run.subject_ref ?? run.external_id}</span>
            {deploymentOf && <span className={`${FONT.sm} block truncate text-muted-foreground`}>{deploymentOf.get(run.deployment_id)?.name ?? '—'}</span>}
          </span>
          <span className={`${FONT.sm} truncate text-muted-foreground`}>{reason ? t(REASON_LABEL[reason] ?? reason) : ''}</span>
          <span className={`${FONT.sm} ${OUTCOME_TONE[outcome]}`}>{t(OUTCOME_LABEL[outcome])}</span>
        </button>
      );
    })}
    {runs.length > limit && <Button size="xs" variant="ghost" onClick={() => setLimit(limit + 100)}>{t('Show more')}</Button>}
  </div>;
}

function RunPanel({ audit, run, deployment, onClose }: {
  audit: Audit; run: WorkflowRunRecord; deployment: WorkflowDeploymentRecord | null; onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const steps = useMemo(() => inChainOrder(audit.stepsByRun.get(run.id) ?? []), [audit.stepsByRun, run.id]);
  const template = deployment ? audit.templates.find(tp => tp.id === deployment.template_id) : undefined;
  const labels = useMemo(() => new Map(templateSteps(template?.steps).map(s => [s.key, s.label])), [template?.steps]);
  const outcome = runOutcome(steps);
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
      <ol className="space-y-0.5 px-2 pb-4">
        {steps.map(step => (
          <li key={step.id} className="rounded-md px-2 py-2 hover:bg-muted/30">
            <div className="flex items-baseline gap-2">
              <span className={`${FONT.mono} w-10 shrink-0`}>#{step.seq}</span>
              <span className={`${FONT.base} min-w-0 flex-1 truncate text-foreground`}>{labels.get(step.step_key) ?? step.step_key}</span>
              <span className={`${FONT.sm} shrink-0 ${RESULT_TONE[step.result] ?? 'text-muted-foreground'}`}>{t(RESULT_LABEL[step.result])}</span>
            </div>
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
