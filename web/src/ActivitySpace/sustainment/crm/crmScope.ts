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
  // Any Domain of the Space can be the scope — an empty one too, to start its CRM there.
  const domainIds = useMemo(() => crm.domains.map(domain => domain.id), [crm.domains]);
  const [scope, setScope] = useToolScope('crm', domainIds);
  const name = (id: ToolScope) => id === null ? t('Everything') : id === SPACE_SCOPE ? t('Shared by the Space') : crm.domains.find(domain => domain.id === id)?.name ?? t('Unknown Domain');
  // Whether some records belong to no Domain (shared by the Space): only then is that scope offered.
  const hasShared = useMemo(() => [...crm.pipelines, ...crm.companies, ...crm.contacts].some(record => !record.domain_id), [crm.pipelines, crm.companies, crm.contacts]);
  /** The Domain new records made in this scope go into. */
  const domainId = scope && scope !== SPACE_SCOPE ? scope : null;

  const pipelines = useMemo(() => crm.pipelines.filter(item => inToolScope(scope, item.domain_id)), [crm.pipelines, scope]);
  const workspaces = useMemo(() => crm.workspaces.filter(workspace => inToolScope(scope, workspace.pipeline.domain_id)), [crm.workspaces, scope]);
  const pipeline = pipelines.find(item => item.id === pipelineId) ?? pipelines[0] ?? null;
  const workspace: CrmWorkspace | null = workspaces.find(item => item.pipeline.id === pipeline?.id) ?? null;
  // Everything in the scope read as one: the base pipeline lends its rhythm.
  const pooled = useMemo(() => workspace ? scopeWorkspace(workspaces, workspace) : null, [workspaces, workspace]);
  const companies = useMemo(() => crm.companies.filter(item => inToolScope(scope, item.domain_id)), [crm.companies, scope]);
  const contacts = useMemo(() => crm.contacts.filter(item => inToolScope(scope, item.domain_id)), [crm.contacts, scope]);
  return { scope, setScope, scopeName: name(scope), hasShared, domainId, pipelines, workspaces, pipeline, workspace, pooled, companies, contacts };
}
