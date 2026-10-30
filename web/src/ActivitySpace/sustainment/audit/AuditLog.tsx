'use client';

import { CircleAlert, RefreshCw, ScrollText } from 'lucide-react';
import { Button } from '@/ui/button';
import { FONT } from '@/shared/designTokens';
import { ToolPage, type ToolView } from '@/Function/shared/tool/ToolPage';
import { NavAuditIcon } from '@/shell/sidebar/NavIcons';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { AUDIT_RUN_LIMIT, AUDIT_WINDOW_DAYS } from '@/hooks/useAudit';
import type { useAuditScope } from './auditScope';
import type { AuditSource } from './auditSource';
import { Empty, RunPanel, RunRows, SampleBadge, SampleNotice } from './auditParts';

// The audit log: every run, read as a list with two tabs — all of them, or
// only those that ask something of a person — and a run's steps beside it.

const TABS: readonly ToolView[] = [
  { id: 'all', label: 'All runs', icon: ScrollText, description: 'Every run of the last {n} days and every older run still open, newest first. Records hold document numbers, never their contents.' },
  { id: 'attention', label: 'Needs a person', icon: CircleAlert, description: 'Runs waiting for approval, handed to a person, stopped, or blocked by the gateway.' },
];

export function AuditLog({ source, scoped, status, attention, runId, onAttention, onOpenRun, onCloseRun }: {
  source: AuditSource;
  scoped: ReturnType<typeof useAuditScope>;
  status: React.ReactNode;
  attention: boolean;
  runId: string | null;
  onAttention: (attention: boolean) => void;
  onOpenRun: (id: string) => void;
  onCloseRun: () => void;
}) {
  const { t } = useI18n();
  const runs = attention ? scoped.attention : scoped.runs;
  const run = runId ? source.runs.find(r => r.id === runId) ?? null : null;
  const views = TABS.map(view => ({
    ...view,
    description: view.description && t(view.description, { n: AUDIT_WINDOW_DAYS }),
    badge: view.id === 'attention' && scoped.attention.length ? scoped.attention.length : undefined,
  }));
  return (
    <ToolPage icon={NavAuditIcon} tool={t('Audit')} crumb={t('Audit log')} storageKey="audit-log" home="all"
      views={views} activeView={attention ? 'attention' : 'all'} onSelectView={id => onAttention(id === 'attention')}
      actions={<>{source.sample && <SampleBadge />}<Button size="icon-sm" variant="ghost" onClick={() => void source.refetch()} aria-label={t('Refresh')} title={t('Refresh')}><RefreshCw size={14} /></Button></>}
      panel={run ? <RunPanel source={source} run={run} deployment={scoped.deploymentOf.get(run.deployment_id) ?? null} onClose={onCloseRun} /> : undefined}>
      <div className="space-y-4">
        {source.sample && <SampleNotice />}
        {status}
        {!status && source.truncated && <p className={`${FONT.sm} text-muted-foreground`}>{t('Showing the latest {n} runs of the last {d} days.', { n: AUDIT_RUN_LIMIT.toLocaleString(), d: AUDIT_WINDOW_DAYS })}</p>}
        {!status && (runs.length
          ? <RunRows runs={runs} deploymentOf={scoped.deploymentOf} selectedId={runId} onOpen={onOpenRun} />
          : <Empty>{attention ? t('Nothing needs a person right now.') : t('No runs in the last {n} days.', { n: AUDIT_WINDOW_DAYS })}</Empty>)}
      </div>
    </ToolPage>
  );
}
