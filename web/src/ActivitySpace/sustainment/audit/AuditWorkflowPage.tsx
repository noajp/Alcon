'use client';

import { useMemo, useState } from 'react';
import { Activity, Bot, Box, CalendarDays, CircleDot, GitBranch, KeyRound, Layers, ListOrdered, RefreshCw, ShieldCheck, Timer, Workflow } from 'lucide-react';
import { Button } from '@/ui/button';
import { FONT } from '@/shared/designTokens';
import { PageHead, PageSection } from '@/Function/shared/PageHead';
import { RailCard } from '@/Function/shared/RailCard';
import { RailRow } from '@/Function/shared/RailRow';
import { ToolPage, type ToolView } from '@/Function/shared/tool/ToolPage';
import { addDays } from '@/Function/shared/dateUtils';
import { NavAuditIcon } from '@/shell/sidebar/NavIcons';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { AUDIT_WINDOW_DAYS } from '@/hooks/useAudit';
import { flowObservation, NEEDS_PERSON, runOutcome, templateSteps, type DeploymentSummary, type WorkflowDeploymentRecord } from '@/Function/audit/auditModel';
import type { WorkflowTab } from '@/Function/audit/auditRoute';
import type { AuditSource } from './auditSource';
import { AuditGrants } from './AuditGrants';
import { Empty, RunPanel, RunRows, SampleBadge, SampleNotice, Stat, STATE_LABEL, pct, useIntegrity } from './auditParts';

// One workflow, opened the way an Object is: its name and purpose with the
// Properties beside them, and tabs that read it — how it goes, its runs,
// the flow it was designed for against the one the gateway saw, what it may
// do, and whether its records are whole.

const TABS: readonly ToolView[] = [
  { id: 'overview', label: 'Overview', icon: CircleDot },
  { id: 'runs', label: 'Runs', icon: ListOrdered, description: 'Every run of this workflow in the last {n} days and every older one still open, newest first.' },
  { id: 'flow', label: 'Flow', icon: GitBranch, description: 'The steps the template declares, with what the gateway saw at each one. A step outside the template is shown after them.' },
  { id: 'grants', label: 'Grants', icon: KeyRound, description: 'What this workflow may do on each connection. The gateway enforces it; whatever a run did outside it is counted here.' },
  { id: 'integrity', label: 'Record integrity', icon: ShieldCheck, description: 'Each record carries the hash of the one before it. A removed or altered record breaks the chain here.' },
];

export function AuditWorkflowPage({ source, deployment, summary, tab, runId, onTab, onOpenRun, onCloseRun }: {
  source: AuditSource;
  deployment: WorkflowDeploymentRecord;
  summary: DeploymentSummary | undefined;
  tab: WorkflowTab;
  runId: string | null;
  onTab: (tab: WorkflowTab) => void;
  onOpenRun: (id: string) => void;
  onCloseRun: () => void;
}) {
  const { t, locale } = useI18n();
  const template = source.templates.find(tp => tp.id === deployment.template_id);
  const runs = useMemo(() => source.runsByDeployment.get(deployment.id) ?? [], [source.runsByDeployment, deployment.id]);
  const flow = useMemo(() => flowObservation(templateSteps(template?.steps), runs.flatMap(run => run.steps)), [template?.steps, runs]);
  const integrity = useIntegrity(source, deployment.id);
  const [since] = useState(() => addDays(new Date(), -AUDIT_WINDOW_DAYS).toISOString());
  const recentRuns = runs.filter(run => run.started_at >= since).length;
  const attention = summary?.needsPerson ?? 0;
  const domain = deployment.domain_id ? source.domains.find(d => d.id === deployment.domain_id)?.name ?? t('Unknown Domain') : t('Shared by the Space');
  const agent = deployment.worker_id ? source.workers.find(w => w.id === deployment.worker_id)?.name ?? '—' : null;
  const saved = deployment.minutes_per_item !== null && summary ? summary.outcomes.auto * deployment.minutes_per_item / 60 : null;
  const run = runId ? runs.find(r => r.id === runId) ?? null : null;
  const views = TABS.map(view => ({
    ...view,
    description: view.description && t(view.description, { n: AUDIT_WINDOW_DAYS }),
    badge: view.id === 'runs' ? runs.length : view.id === 'integrity' && integrity.state === 'broken' ? '!' : undefined,
  }));
  const icon = (node: React.ReactNode) => <span className="text-muted-foreground">{node}</span>;

  const properties = <RailCard title={t('Properties')}>
    <RailRow icon={icon(<Workflow className="size-3.5" />)} name={t('Process')} dense label={template?.name ?? '—'} placeholder={!template} />
    <RailRow icon={icon(<Activity className="size-3.5" />)} name={t('Version')} dense label={template ? t('version {n}', { n: template.version }) : '—'} placeholder={!template} />
    <RailRow icon={icon(<CircleDot className="size-3.5" />)} name={t('State')} dense label={t(STATE_LABEL[deployment.state])} />
    <RailRow icon={icon(<Layers className="size-3.5" />)} name={t('Domain')} dense label={domain} />
    <RailRow icon={icon(<Bot className="size-3.5" />)} name={t('Agent')} dense label={agent ?? t('Not set')} placeholder={!agent} />
    <RailRow icon={icon(<Box className="size-3.5" />)} name={t('Exceptions to')} dense label={deployment.object_id ? t('An Object') : t('Not set')} placeholder={!deployment.object_id} />
    <RailRow icon={icon(<Timer className="size-3.5" />)} name={t('By hand')} dense
      label={deployment.minutes_per_item === null ? t('Not set') : t('{n} min per item', { n: deployment.minutes_per_item })} placeholder={deployment.minutes_per_item === null} />
    <RailRow icon={icon(<CalendarDays className="size-3.5" />)} name={t('Registered')} dense label={new Date(deployment.created_at).toLocaleDateString(locale)} />
    <RailRow icon={icon(<ShieldCheck className="size-3.5" />)} name={t('Records')} dense
      label={integrity.state === 'intact' ? t('Intact') : integrity.state === 'broken' ? t('Broken') : integrity.state === 'none' ? t('None yet') : '…'}
      placeholder={integrity.state !== 'intact' && integrity.state !== 'broken'} />
  </RailCard>;

  return (
    <ToolPage icon={NavAuditIcon} tool={t('Audit')} crumb={deployment.name} storageKey="audit-workflow" home="overview"
      views={views} activeView={tab} onSelectView={id => onTab(id as WorkflowTab)}
      actions={<>{source.sample && <SampleBadge />}<Button size="icon-sm" variant="ghost" onClick={() => void source.refetch()} aria-label={t('Refresh')} title={t('Refresh')}><RefreshCw size={14} /></Button></>}
      head={<PageHead icon={<Workflow size={18} />} title={deployment.name} description={template?.purpose ?? ''}
        emptyDescription={t('No purpose written for this workflow.')} canEdit={false} titleLabel={t('Workflow')} titlePlaceholder=""
        descriptionLabel="" descriptionPlaceholder="" onSaveTitle={() => {}} />}
      properties={properties}
      scrollKey={deployment.id}
      panel={tab === 'runs' && run ? <RunPanel source={source} run={run} deployment={deployment} onClose={onCloseRun} /> : undefined}>
      <div className="space-y-8">
        {source.sample && tab === 'overview' && <SampleNotice />}

        {tab === 'overview' && <>
          <dl className="grid grid-cols-2 gap-6 sm:grid-cols-4">
            <Stat label={t('Needs a person')} value={String(attention)} danger={attention > 0} />
            <Stat label={t('Completed by AI')} value={pct(summary?.autoRate ?? null)} hint={t('Of the runs that finished')} />
            <Stat label={t('Returned by a person')} value={pct(summary?.returnRate ?? null)} hint={t('Of the runs a person reviewed')} />
            <Stat label={t('Runs in {n} days', { n: AUDIT_WINDOW_DAYS })} value={String(recentRuns)}
              hint={saved === null ? undefined : t('About {h} hours saved (estimate)', { h: saved.toLocaleString(locale, { maximumFractionDigits: 1 }) })} />
          </dl>
          <PageSection title={t('Needs a person')}>
            {attention ? <RunRows runs={runs.filter(r => NEEDS_PERSON.has(runOutcome(r.steps)))} selectedId={null}
              onOpen={id => { onTab('runs'); onOpenRun(id); }} limitStep={5} />
              : <Empty>{t('Nothing needs a person right now.')}</Empty>}
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
        </>}

        {tab === 'runs' && (runs.length
          ? <RunRows runs={runs} selectedId={runId} onOpen={onOpenRun} />
          : <Empty>{t('No runs in the last {n} days.', { n: AUDIT_WINDOW_DAYS })}</Empty>)}

        {tab === 'flow' && (!flow.length ? <Empty>{t('Nothing has passed through this workflow yet.')}</Empty> : (
          <ol className="space-y-1">
            {flow.map((s, i) => (
              <li key={s.key} className="grid grid-cols-[28px_minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-3 rounded-md px-3 py-2 hover:bg-muted/30">
                <span className={FONT.mono}>{s.declared ? i + 1 : '—'}</span>
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
        ))}

        {tab === 'grants' && <AuditGrants source={source} deployment={deployment} runs={runs} />}

        {tab === 'integrity' && (
          <div className={`flex items-start gap-3 rounded-lg p-4 ${integrity.state === 'broken' ? 'bg-[var(--status-danger-subtle)]' : integrity.state === 'intact' ? 'bg-[var(--status-success-subtle)]' : 'bg-muted/30'}`}>
            <ShieldCheck size={18} className={`mt-0.5 shrink-0 ${integrity.state === 'broken' ? 'text-[var(--status-danger)]' : integrity.state === 'intact' ? 'text-[var(--status-success)]' : 'text-muted-foreground'}`} />
            <p className={`${FONT.base} text-foreground`}>{integrity.message}</p>
          </div>
        )}
      </div>
    </ToolPage>
  );
}
