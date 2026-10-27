'use client';

import { CircleAlert, LayoutDashboard, ScrollText, Workflow } from 'lucide-react';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { ToolSidebar } from '@/Function/shared/tool/ToolSidebar';
import type { NavigationState } from '@/types/navigation';
import { auditRoute, type AuditRoute } from '@/Function/audit/auditRoute';
import { useAuditScope } from './auditScope';
import { useAuditSource } from './auditSource';

// The Audit sidebar, on the shared ToolSidebar, and the App's only
// navigation: the overview (its ▾ narrows every page to one department),
// what needs a person now, each workflow, and the log.

export function AuditSidebar({ navigation, onNavigate }: {
  navigation: NavigationState;
  onNavigate: (navigation: Partial<NavigationState>) => void;
}) {
  const { t } = useI18n();
  const route = auditRoute(navigation.audit);
  const source = useAuditSource();
  const scoped = useAuditScope(source);
  const go = (next: AuditRoute) => onNavigate({ audit: next });

  return <ToolSidebar
    title={source.sample ? `${t('Audit')} · ${t('Sample')}` : t('Audit')}
    scope={{
      value: scoped.scope, options: scoped.options, label: scoped.scope === null ? t('Overview') : scoped.scopeName, icon: LayoutDashboard,
      active: route.view === 'overview',
      onOpen: () => go({ view: 'overview' }),
      onChange: next => { scoped.setScope(next); go({ view: 'overview' }); },
    }}
    queue={[{
      id: 'attention', label: t('Needs a person'), icon: CircleAlert, count: scoped.attention.length,
      active: route.view === 'log' && !!route.attention,
      onClick: () => go({ view: 'log', attention: true }),
    }]}
    sections={[
      { id: 'workflows', label: t('Workflows'), items: scoped.deployments.map(d => ({
        id: `deployment:${d.id}`, label: d.name, icon: Workflow,
        active: route.view === 'workflow' && route.deploymentId === d.id,
        count: scoped.summaries.get(d.id)?.needsPerson ?? null,
        onClick: () => go({ view: 'workflow', deploymentId: d.id, tab: 'overview' }),
      })) },
      { id: 'records', label: t('Records'), items: [
        { id: 'log', label: t('Audit log'), icon: ScrollText, active: route.view === 'log' && !route.attention, onClick: () => go({ view: 'log' }) },
      ] },
    ]}
  />;
}
