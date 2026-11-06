'use client';

import { useState } from 'react';
import { FONT } from '@/shared/designTokens';
import { PageSection } from '@/Function/shared/PageHead';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { useDeploymentApprovals } from '@/hooks/useWorkflowApprovals';
import { approvalState } from '@/Function/audit/auditModel';
import { WorkflowApprovalCard } from '@/Function/audit/WorkflowApprovalCard';
import { Empty } from './auditParts';

// The approvals a workflow's gateway asked for (ADR 0047), beside the
// workflow: the ones still waiting first, so they can be decided here as
// well as in the Inbox (where muting a kind of notification would hide them).

export function AuditApprovals({ deploymentId }: { deploymentId: string }) {
  const { t } = useI18n();
  const { approvals, loading, error } = useDeploymentApprovals(deploymentId);
  const [now] = useState(() => Date.now());
  if (loading) return null;
  const waiting = approvals.filter(a => approvalState(a, now) === 'pending');
  const recent = approvals.filter(a => approvalState(a, now) !== 'pending').slice(0, 5);
  return (
    <PageSection title={t('Approvals')}>
      {error ? <Empty>{t('Could not read the approvals.')}</Empty>
        : !approvals.length ? <Empty>{t('The gateway has not asked for an approval yet.')}</Empty> : (
          <div className="space-y-3">
            {waiting.map(a => <WorkflowApprovalCard key={a.id} approvalId={a.id} compact />)}
            {!waiting.length && <p className={`${FONT.sm} text-muted-foreground`}>{t('Nothing is waiting for a decision.')}</p>}
            {recent.map(a => <WorkflowApprovalCard key={a.id} approvalId={a.id} compact />)}
          </div>
        )}
    </PageSection>
  );
}
