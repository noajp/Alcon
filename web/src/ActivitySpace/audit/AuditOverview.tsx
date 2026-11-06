'use client';

import { useMemo, useState } from 'react';
import { CalendarRange, FileLock2, Layers, Plug, RefreshCw, ScrollText, Workflow } from '@/ui/icons';
import { Button, ButtonAppearanceProvider } from '@/ui/button';
import { FONT } from '@/shared/designTokens';
import { PageHead, PageLayout, PageSection } from '@/Function/shared/PageHead';
import { RailCard } from '@/Function/shared/RailCard';
import { RailRow } from '@/Function/shared/RailRow';
import { IndexList, IndexRow } from '@/Function/shared/IndexList';
import { SegmentedProgress } from '@/Function/shared/SegmentedProgress';
import { addDays } from '@/Function/shared/dateUtils';
import { NavAuditIcon } from '@/Frame/sidebar/NavIcons';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { AUDIT_WINDOW_DAYS } from '@/hooks/useAudit';
import type { useAuditScope } from './auditScope';
import type { AuditSource } from './auditSource';
import { Empty, RunRows, SampleBadge, SampleNotice, Stat, STATE_LABEL, pct } from './auditParts';

// Audit's first page: what needs a person now, how much of the work the AI
// finishes on its own, and each workflow — read the way a Domain or an
// Object opens (a head, figures, sections, and the Properties beside them).

export function AuditOverview({ source, scoped, status, onOpenWorkflow, onOpenRun, onOpenLog }: {
  source: AuditSource;
  scoped: ReturnType<typeof useAuditScope>;
  status: React.ReactNode;
  onOpenWorkflow: (id: string) => void;
  onOpenRun: (id: string) => void;
  onOpenLog: (attention: boolean) => void;
}) {
  const { t, locale } = useI18n();
  const [since] = useState(() => addDays(new Date(), -AUDIT_WINDOW_DAYS).toISOString());
  const totals = useMemo(() => {
    let runs = 0, auto = 0, finished = 0, approved = 0, returned = 0, hours = 0, priced = false;
    for (const d of scoped.deployments) {
      const s = scoped.summaries.get(d.id);
      if (!s) continue;
      runs += (source.runsByDeployment.get(d.id) ?? []).filter(run => run.started_at >= since).length;
      auto += s.outcomes.auto;
      finished += s.outcomes.auto + s.outcomes.approved + s.outcomes.returned;
      approved += s.outcomes.approved;
      returned += s.outcomes.returned;
      if (d.minutes_per_item !== null) { hours += s.outcomes.auto * d.minutes_per_item / 60; priced = true; }
    }
    return {
      runs, autoRate: finished ? auto / finished : null,
      returnRate: approved + returned ? returned / (approved + returned) : null,
      hours: priced ? hours : null,
    };
  }, [scoped.deployments, scoped.summaries, source.runsByDeployment, since]);
  const connectors = useMemo(() => new Set(scoped.deployments.flatMap(d => scoped.summaries.get(d.id)?.connectors.map(c => c.connector) ?? [])).size, [scoped.deployments, scoped.summaries]);
  const agents = new Set(scoped.deployments.flatMap(d => d.worker_id ? [d.worker_id] : [])).size;
  const template = (id: string) => source.templates.find(tp => tp.id === id);
  const icon = (node: React.ReactNode) => <span className="text-muted-foreground">{node}</span>;

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-card">
      <header className="flex h-[50px] flex-shrink-0 items-center gap-1.5 border-b border-border/60 bg-card pl-4 pr-2">
        <NavAuditIcon size={14} /><span className="text-[13px] font-medium text-foreground">{t('Audit')}</span>
        <span className="min-w-0 truncate text-[13px] text-muted-foreground">{scoped.scopeName}</span>
        {source.sample && <SampleBadge />}
        <div className="flex-1" />
        <Button size="icon-sm" variant="ghost" onClick={() => void source.refetch()} aria-label={t('Refresh')} title={t('Refresh')}><RefreshCw size={14} /></Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <PageLayout rail={<div className="space-y-3">
          <RailCard title={t('Properties')}>
            <RailRow icon={icon(<Layers className="size-3.5" />)} name={t('Scope')} dense label={scoped.scopeName} placeholder={scoped.scope === null} />
            <RailRow icon={icon(<Workflow className="size-3.5" />)} name={t('Workflows')} dense label={String(scoped.deployments.length)} placeholder={!scoped.deployments.length} />
            <RailRow icon={icon(<NavAuditIcon size={14} />)} name={t('Agents')} dense label={String(agents)} placeholder={!agents} />
            <RailRow icon={icon(<Plug className="size-3.5" />)} name={t('Connections')} dense label={String(connectors)} placeholder={!connectors} />
            <RailRow icon={icon(<CalendarRange className="size-3.5" />)} name={t('Period')} dense label={t('Last {n} days', { n: AUDIT_WINDOW_DAYS })} />
            <RailRow icon={icon(<FileLock2 className="size-3.5" />)} name={t('Kept')} dense label={t('Document numbers only')} />
          </RailCard>
          <RailCard title={t('How Audit works')} padded>
            <ol className={`${FONT.sm} space-y-2 text-muted-foreground`}>
              {[t('A workflow is registered: which work, in which Domain, by which agent, with which permissions.'),
                t('Every time the agent touches a system, the gateway records what it did — never the document itself.'),
                t('Audit links the records so none can be removed or altered unseen, and shows where a person is needed.')]
                .map((line, i) => <li key={i} className="flex gap-2"><span className="tabular-nums text-foreground">{i + 1}</span><span>{line}</span></li>)}
            </ol>
          </RailCard>
        </div>}>
          <PageHead icon={<NavAuditIcon size={18} />} title={t('Audit')}
            description={t('What the AI agents did in this Space’s work, kept as records without the documents — so you can see what was handed over, what needs a person, and that nothing was changed afterwards.')}
            canEdit={false} titleLabel={t('Audit')} titlePlaceholder="" descriptionLabel="" descriptionPlaceholder="" onSaveTitle={() => {}} />
          <div className="space-y-8">
            {source.sample && <SampleNotice />}
            {status}
            {!status && <>
              <dl className="grid grid-cols-2 gap-6 sm:grid-cols-4">
                <Stat label={t('Needs a person')} value={String(scoped.attention.length)} danger={scoped.attention.length > 0} hint={t('Waiting, handed over, blocked or stopped')} />
                <Stat label={t('Completed by AI')} value={pct(totals.autoRate)} hint={t('Of the runs that finished')} />
                <Stat label={t('Returned by a person')} value={pct(totals.returnRate)} hint={t('Of the runs a person reviewed')} />
                <Stat label={t('Runs in {n} days', { n: AUDIT_WINDOW_DAYS })} value={String(totals.runs)}
                  hint={totals.hours === null ? undefined : t('About {h} hours saved (estimate)', { h: totals.hours.toLocaleString(locale, { maximumFractionDigits: 1 }) })} />
              </dl>

              <PageSection title={t('Needs a person')} action={scoped.attention.length > 0 && <ButtonAppearanceProvider appearance="inline"><Button size="xs" variant="ghost" onClick={() => onOpenLog(true)}><ScrollText size={14} />{t('Open in the log')}</Button></ButtonAppearanceProvider>}>
                {scoped.attention.length
                  ? <RunRows runs={scoped.attention.slice(0, 5)} deploymentOf={scoped.deploymentOf} selectedId={null} onOpen={onOpenRun} limitStep={5} />
                  : <Empty>{t('Nothing needs a person right now.')}</Empty>}
              </PageSection>

              <PageSection title={t('Workflows')}>
                {!scoped.deployments.length ? <Empty>{t('No AI workflows are registered in this Space yet. A workflow appears here when its gateway is connected and starts reporting.')}</Empty> : (
                  <IndexList headers={[t('Workflow'), t('Completed by AI'), t('Runs in {n} days', { n: AUDIT_WINDOW_DAYS })]}>
                    {scoped.deployments.map(d => {
                      const s = scoped.summaries.get(d.id);
                      const rate = s?.autoRate ?? null;
                      return <IndexRow key={d.id} icon={<Workflow size={16} />} name={d.name}
                        description={[template(d.template_id)?.name, t(STATE_LABEL[d.state])].filter(Boolean).join(' · ')}
                        health={<div className="flex min-w-0 items-center gap-3 text-[11px] tabular-nums text-muted-foreground">
                          {rate === null ? <span className="text-muted-foreground/60">{t('No finished runs')}</span>
                            : <span className="flex w-28 shrink-0 items-center gap-1.5"><SegmentedProgress value={Math.round(rate * 100)} className="flex-1" /><span className="w-8 text-right">{pct(rate)}</span></span>}
                          {!!s?.needsPerson && <span className="text-[var(--status-danger)]">{t('{n} need a person', { n: s.needsPerson })}</span>}
                        </div>}
                        count={(source.runsByDeployment.get(d.id) ?? []).filter(run => run.started_at >= since).length} onOpen={() => onOpenWorkflow(d.id)} />;
                    })}
                  </IndexList>
                )}
              </PageSection>
            </>}
          </div>
        </PageLayout>
      </div>
    </div>
  );
}
