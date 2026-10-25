'use client';

import { useMemo } from 'react';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { inToolScope, SPACE_SCOPE, useToolScope, type ToolScope } from '@/Function/shared/tool/toolScope';
import type { Crm } from '@/hooks/useCrm';
import { scopeWorkspace, type CrmWorkspace } from '@/Function/crm/crmModel';

/** What the CRM shows in its scope: the pipelines, their pooled deals, the
 *  companies and contacts — read the same way by the sidebar and the pages. */
export function useCrmScope(crm: Crm, pipelineId: string | null | undefined) {
  const { t } = useI18n();
  // The Domains worth offering: those holding CRM records.
  const domainIds = useMemo(() => {
    const used = new Set<string>();
    for (const record of [...crm.pipelines, ...crm.companies, ...crm.contacts]) if (record.domain_id) used.add(record.domain_id);
    return [...used];
  }, [crm.pipelines, crm.companies, crm.contacts]);
  const [scope, setScope] = useToolScope('crm', domainIds);
  const name = (id: ToolScope) => id === null ? t('Everything') : id === SPACE_SCOPE ? t('Shared by the Space') : crm.domains.find(domain => domain.id === id)?.name ?? t('Unknown Domain');
  const options = domainIds.length ? [null, SPACE_SCOPE, ...[...domainIds].sort((a, b) => name(a).localeCompare(name(b)))].map(id => ({ id, name: name(id) })) : [];

  const pipelines = useMemo(() => crm.pipelines.filter(item => inToolScope(scope, item.domain_id)), [crm.pipelines, scope]);
  const workspaces = useMemo(() => crm.workspaces.filter(workspace => inToolScope(scope, workspace.pipeline.domain_id)), [crm.workspaces, scope]);
  const pipeline = pipelines.find(item => item.id === pipelineId) ?? pipelines[0] ?? null;
  const workspace: CrmWorkspace | null = workspaces.find(item => item.pipeline.id === pipeline?.id) ?? null;
  // Everything in the scope read as one: the base pipeline lends its rhythm.
  const pooled = useMemo(() => workspace ? scopeWorkspace(workspaces, workspace) : null, [workspaces, workspace]);
  const companies = useMemo(() => crm.companies.filter(item => inToolScope(scope, item.domain_id)), [crm.companies, scope]);
  const contacts = useMemo(() => crm.contacts.filter(item => inToolScope(scope, item.domain_id)), [crm.contacts, scope]);
  return { scope, setScope, scopeName: name(scope), options, pipelines, workspaces, pipeline, workspace, pooled, companies, contacts };
}
