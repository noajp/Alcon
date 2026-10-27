'use client';

import { useMemo } from 'react';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { inToolScope, SPACE_SCOPE, useToolScope, type ToolScope } from '@/Function/shared/tool/toolScope';
import { NEEDS_PERSON, runOutcome, summarizeDeployment, type DeploymentSummary, type WorkflowDeploymentRecord } from '@/Function/audit/auditModel';
import type { AuditSource } from './auditSource';

/** What the Audit App shows in its scope (the Domain a deployment serves),
 *  read the same way by the sidebar and the pages. */
export function useAuditScope(audit: AuditSource) {
  const { t } = useI18n();
  const domainIds = useMemo(() => [...new Set(audit.deployments.flatMap(d => d.domain_id ? [d.domain_id] : []))], [audit.deployments]);
  const [scope, setScope] = useToolScope('audit', domainIds);
  const name = (id: ToolScope) => id === null ? t('All departments') : id === SPACE_SCOPE ? t('Shared by the Space') : audit.domains.find(domain => domain.id === id)?.name ?? t('Unknown Domain');
  const options = domainIds.length ? [null, SPACE_SCOPE, ...[...domainIds].sort((a, b) => name(a).localeCompare(name(b)))].map(id => ({ id, name: name(id) })) : [];

  const deployments = useMemo(() => audit.deployments.filter(d => inToolScope(scope, d.domain_id)), [audit.deployments, scope]);
  const summaries = useMemo(() => new Map<string, DeploymentSummary>(deployments.map(d =>
    [d.id, summarizeDeployment(audit.runsByDeployment.get(d.id) ?? [], audit.stepsByRun)])), [deployments, audit.runsByDeployment, audit.stepsByRun]);
  const inScope = useMemo(() => new Set(deployments.map(d => d.id)), [deployments]);
  const runs = useMemo(() => audit.runs.filter(run => inScope.has(run.deployment_id)), [audit.runs, inScope]);
  const attention = useMemo(() => runs.filter(run => NEEDS_PERSON.has(runOutcome(audit.stepsByRun.get(run.id) ?? []))), [runs, audit.stepsByRun]);
  const deploymentOf = useMemo(() => new Map<string, WorkflowDeploymentRecord>(audit.deployments.map(d => [d.id, d])), [audit.deployments]);
  return { scope, setScope, scopeName: name(scope), options, deployments, summaries, runs, attention, deploymentOf };
}
