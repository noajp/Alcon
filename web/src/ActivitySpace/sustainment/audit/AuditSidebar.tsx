'use client';

import { CircleAlert, Layers, ScrollText, Workflow } from 'lucide-react';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { ToolSidebar } from '@/Function/shared/tool/ToolSidebar';
import type { NavigationState } from '@/types/navigation';
import { useAudit } from '@/hooks/useAudit';
import { auditRoute, type AuditRoute } from '@/Function/audit/auditRoute';
import { useAuditScope } from './auditScope';

// The Audit sidebar, on the shared ToolSidebar: the scope (which Domain's
// deployments), what needs a person now, the ledger with each deployment,
// and the log of runs.

export function AuditSidebar({ navigation, onNavigate }: {
  navigation: NavigationState;
  onNavigate: (navigation: Partial<NavigationState>) => void;
}) {
  const { t } = useI18n();
  const route = auditRoute(navigation.audit);
  const audit = useAudit();
  const scoped = useAuditScope(audit);
  const go = (next: AuditRoute) => onNavigate({ audit: next });

  return <ToolSidebar
    title={t('Audit')}
    scope={{
      value: scoped.scope, options: scoped.options, label: scoped.scopeName, icon: Layers,
      active: route.view === 'workflows' && !route.deploymentId,
      onOpen: () => go({ view: 'workflows' }),
      onChange: next => { scoped.setScope(next); go({ view: 'workflows' }); },
    }}
    queue={[{
      id: 'attention', label: t('Needs a person'), icon: CircleAlert, count: scoped.attention.length,
      active: route.view === 'log' && !!route.attention,
      onClick: () => go({ view: 'log', attention: true }),
    }]}
    sections={[{ id: 'ledger', items: [
      {
        id: 'workflows', label: t('Workflows'), icon: Workflow,
        active: route.view === 'workflows' && !route.deploymentId,
        onClick: () => go({ view: 'workflows' }),
        children: scoped.deployments.map(d => ({
          id: `deployment:${d.id}`, label: d.name, active: route.view === 'workflows' && route.deploymentId === d.id,
          count: scoped.summaries.get(d.id)?.needsPerson ?? null,
          onClick: () => go({ view: 'workflows', deploymentId: d.id }),
        })),
      },
      { id: 'log', label: t('Audit log'), icon: ScrollText, active: route.view === 'log' && !route.attention, onClick: () => go({ view: 'log' }) },
    ] }]}
  />;
}
