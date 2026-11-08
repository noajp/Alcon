'use client';

import { FONT } from '@/shared/designTokens';
import { useI18n } from '@/Function/i18n/I18nProvider';
import type { NavigationState } from '@/types/navigation';
import { auditRoute, type AuditRoute } from '@/Function/audit/auditRoute';
import { useAuditScope } from './auditScope';
import { useAuditSource } from './auditSource';
import { AuditOverview } from './AuditOverview';
import { AuditWorkflowPage } from './AuditWorkflowPage';
import { AuditLog } from './AuditLog';
import { AuditCredentials } from './AuditCredentials';

// The Audit App: what the AI agents did in this Space's work, read from the
// ledger the gateway writes (ADR 0044) — or, while the Space has none, from
// the on-screen sample. Three places, chosen in the sidebar: the overview,
// a workflow (with its tabs), and the log. Nothing here holds a document.

export function AuditView({ navigation, onNavigate }: {
  navigation: NavigationState;
  onNavigate: (navigation: Partial<NavigationState>) => void;
}) {
  const { t } = useI18n();
  const route = auditRoute(navigation.audit);
  const source = useAuditSource();
  const scoped = useAuditScope(source);
  const go = (next: AuditRoute) => onNavigate({ audit: next });

  const status = source.error
    ? <p role="alert" className={`${FONT.base} rounded-md bg-[var(--status-danger-subtle)] p-3 text-foreground`}>{t('Could not read the audit ledger.')} {source.error.message}</p>
    : source.loading ? <p className={`${FONT.base} text-muted-foreground`}>{t('Loading the audit ledger…')}</p> : null;

  const deployment = route.view === 'workflow' && route.deploymentId ? scoped.deploymentOf.get(route.deploymentId) ?? null : null;
  if (deployment) {
    const tab = route.tab ?? 'overview';
    // The workflow page is ledger-only and speaks in bare run ids; the
    // route carries entry keys, so the prefix is added and stripped here.
    return <AuditWorkflowPage source={source} deployment={deployment} summary={scoped.summaries.get(deployment.id)}
      tab={tab} runId={route.runId?.replace(/^ledger:/, '') ?? null}
      onTab={next => go({ ...route, tab: next, runId: next === 'runs' ? route.runId : null })}
      onOpenRun={id => go({ ...route, tab: 'runs', runId: `ledger:${id}` })}
      onCloseRun={() => go({ ...route, runId: null })} />;
  }

  if (route.view === 'credentials') {
    // The credential trail stands apart from the ledger and the
    // sample: it is the Space's own record, owners-only, and a run a
    // row names opens in the log like everywhere else.
    return <AuditCredentials spaceId={source.spaceId} onOpenRun={id => go({ view: 'log', runId: `agent:${id}` })} />;
  }

  if (route.view === 'log') {
    return <AuditLog source={source} scoped={scoped} status={status} attention={!!route.attention} runId={route.runId ?? null}
      onAttention={attention => go({ view: 'log', attention })}
      onOpenRun={id => go({ ...route, runId: id })}
      onCloseRun={() => go({ ...route, runId: null })} />;
  }

  return <AuditOverview source={source} scoped={scoped} status={status}
    onOpenWorkflow={id => go({ view: 'workflow', deploymentId: id, tab: 'overview' })}
    onOpenRun={id => go({ view: 'log', attention: true, runId: id })}
    onOpenLog={attention => go({ view: 'log', attention })} />;
}
