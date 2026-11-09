'use client';

import { useState } from 'react';
import { CircleAlert, RefreshCw, ScrollText } from '@/ui/icons';
import { Button } from '@/ui/button';
import { FONT } from '@/shared/designTokens';
import { ToolPage, type ToolView } from '@/Function/shared/tool/ToolPage';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { hasUnconfirmed } from '@/Function/audit/auditModel';
import { chainChildrenOf } from '@/Function/audit/chainScopeModel';
import { AGENT_AUDIT_RUN_LIMIT, AUDIT_RUN_LIMIT, AUDIT_WINDOW_DAYS } from '@/hooks/useAudit';
import type { useAuditScope } from './auditScope';
import type { AuditSource } from './auditSource';
import { AgentRunPanel, Empty, EntryRows, RunPanel, SampleBadge, SampleNotice } from './auditParts';

// The audit log: every run of both sources, read as a list with two tabs —
// all of them, or only those that ask something of a person — and a run's
// steps beside it. Route state carries the entry key (`ledger:`/`agent:`),
// so opening a row always opens the source it came from.

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
  const entries = attention ? scoped.attentionEntries : scoped.timeline;
  // The 未確認あり filter: finishes that named what they could not confirm
  // are born marked (finishClaims) — this is how a person finds them.
  const [unconfirmedOnly, setUnconfirmedOnly] = useState(false);
  const shown = unconfirmedOnly
    ? entries.filter(e => e.source === 'agent' && hasUnconfirmed(e.run.finishDetail))
    : entries;
  const ledgerRun = runId ? source.runs.find(r => `ledger:${r.id}` === runId || r.id === runId) ?? null : null;
  const agentRun = runId?.startsWith('agent:') ? source.agentRuns.find(r => `agent:${r.id}` === runId) ?? null : null;
  const views = TABS.map(view => ({
    ...view,
    description: view.description && t(view.description, { n: AUDIT_WINDOW_DAYS }),
    badge: view.id === 'attention' && scoped.attentionEntries.length ? scoped.attentionEntries.length : undefined,
  }));
  const panel = ledgerRun
    ? <RunPanel source={source} run={ledgerRun} deployment={scoped.deploymentOf.get(ledgerRun.deployment_id) ?? null} onClose={onCloseRun} />
    : agentRun ? <AgentRunPanel run={agentRun} chainChildren={chainChildrenOf(source.agentRuns, agentRun.id)} onClose={onCloseRun} /> : undefined;
  return (
    <ToolPage crumbs={[{ id: 'tool', label: t('Audit') }, { id: 'page', label: t('Audit log') }]} storageKey="audit-log" home="all"
      views={views} activeView={attention ? 'attention' : 'all'} onSelectView={id => onAttention(id === 'attention')}
      actions={<>{source.sample && <SampleBadge />}<Button size="icon-sm" variant="ghost" onClick={() => void source.refetch()} aria-label={t('Refresh')} title={t('Refresh')}><RefreshCw size={14} /></Button></>}
      panel={panel}>
      <div className="space-y-4">
        {source.sample && <SampleNotice />}
        {status}
        {!status && (
          <div>
            <Button shape="tab" size="xs" variant={unconfirmedOnly ? 'secondary' : 'ghost'} aria-pressed={unconfirmedOnly} onClick={() => setUnconfirmedOnly(v => !v)}>
              {t('Has unconfirmed')}
            </Button>
          </div>
        )}
        {!status && source.truncated && <p className={`${FONT.sm} text-muted-foreground`}>{t('Showing the latest {n} runs of the last {d} days.', { n: AUDIT_RUN_LIMIT.toLocaleString(), d: AUDIT_WINDOW_DAYS })}</p>}
        {!status && source.agentTruncated && <p className={`${FONT.sm} text-muted-foreground`}>{t('Showing the latest {n} agent runs of the last {d} days.', { n: AGENT_AUDIT_RUN_LIMIT.toLocaleString(), d: AUDIT_WINDOW_DAYS })}</p>}
        {!status && (shown.length
          ? <EntryRows entries={shown} deploymentOf={scoped.deploymentOf} selectedId={runId} onOpen={onOpenRun} />
          : <Empty>{unconfirmedOnly ? t('No runs with unconfirmed points.') : attention ? t('Nothing needs a person right now.') : t('No runs in the last {n} days.', { n: AUDIT_WINDOW_DAYS })}</Empty>)}
      </div>
    </ToolPage>
  );
}
