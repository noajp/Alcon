'use client';

import { useEffect, useState } from 'react';
import { Check, ShieldCheck, X } from '@/ui/icons';
import { Button } from '@/ui/button';
import { Textarea } from '@/ui/textarea';
import { FONT } from '@/shared/designTokens';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { useWorkflowApproval } from '@/hooks/useWorkflowApprovals';
import { approvalState, type ApprovalState, type GrantOperation } from './auditModel';

// A gateway's request for a person's yes (ADR 0047), where the Space's owner
// decides it: in the Inbox, and beside the workflow in Audit. The person
// reads the gateway's summary — Clayware never holds the content itself — and
// the approval is bound to the content's fingerprint, so the gateway can use
// it once, for exactly that content.

const OPERATION_LABEL: Record<GrantOperation, string> = { read: 'Read', draft: 'Draft', send: 'Send', money: 'Money' };
const STATE_TONE: Record<ApprovalState, string> = {
  pending: 'text-[var(--status-info)]', approved: 'text-[var(--status-success)]', used: 'text-[var(--status-success)]',
  rejected: 'text-[var(--status-danger)]', expired: 'text-muted-foreground',
};

export function WorkflowApprovalCard({ approvalId, compact = false }: { approvalId: string; compact?: boolean }) {
  const { t, locale } = useI18n();
  const { approval, workflow, canDecide, loading, error, decide, deciding } = useWorkflowApproval(approvalId);
  const [note, setNote] = useState('');
  const [failed, setFailed] = useState<'error' | 'unchanged' | null>(null);
  // The clock the card reads expiry by, kept current while it is open.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  if (error) return <p role="alert" className={`${FONT.sm} text-[var(--status-danger)]`}>{t('Could not read the approval.')}</p>;
  if (loading) return <p className={`${FONT.sm} text-muted-foreground`}>{t('Opening…')}</p>;
  if (!approval) return <p className={`${FONT.sm} text-muted-foreground`}>{t('This approval is no longer available.')}</p>;

  const state = approvalState(approval, now);
  const when = (iso: string) => new Date(iso).toLocaleString(locale);
  const status = state === 'pending' ? t('Waiting for a decision until {time}', { time: when(approval.expires_at) })
    : state === 'approved' ? t('Approved by {name} · {time}', { name: approval.decided_by_name ?? '—', time: when(approval.decided_at!) })
    : state === 'rejected' ? t('Rejected by {name} · {time}', { name: approval.decided_by_name ?? '—', time: when(approval.decided_at!) })
    : state === 'used' ? t('Used by the gateway · {time}', { time: when(approval.consumed_at!) })
    : t('Expired without being used');

  const run = async (approve: boolean) => {
    setFailed(null);
    try {
      const outcome = await decide({ approve, note });
      setNow(Date.now());
      if (!outcome.changed) setFailed('unchanged');
    } catch {
      setFailed('error');
    }
  };

  return (
    <section className={`space-y-4 rounded-lg border border-border/60 bg-card ${compact ? 'p-4' : 'p-6'}`} aria-label={t('Approval request')}>
      <div className="flex items-start gap-3">
        <ShieldCheck size={compact ? 16 : 18} className="mt-0.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1 space-y-1">
          <h2 className={`${compact ? FONT.base : FONT.lg} text-foreground`}>{approval.summary}</h2>
          <p className={`${FONT.sm} text-muted-foreground`}>
            {[workflow, approval.run_external_id, `${approval.connector} · ${t(OPERATION_LABEL[approval.operation])}`].filter(Boolean).join(' — ')}
          </p>
          <p className={`${FONT.sm} ${STATE_TONE[state]}`}>{status}</p>
          {approval.decision_note && <p className={`${FONT.sm} text-foreground/80`}>{approval.decision_note}</p>}
        </div>
      </div>

      {!compact && <dl className={`${FONT.sm} grid grid-cols-[120px_minmax(0,1fr)] gap-x-3 gap-y-1 text-muted-foreground`}>
        <dt>{t('Requested at')}</dt><dd className="text-foreground">{when(approval.requested_at)}</dd>
        <dt>{t('Content fingerprint')}</dt><dd className={`${FONT.mono} truncate`} title={approval.input_hash}>{approval.input_hash.slice(0, 16)}…</dd>
      </dl>}
      {!compact && <p className={`${FONT.sm} text-muted-foreground`}>
        {t('The gateway can use this approval once, and only to send content with this fingerprint. If the content changes, it has to ask again.')}
      </p>}

      {state === 'pending' && (canDecide ? (
        <div className="space-y-2">
          {!compact && <Textarea value={note} onChange={e => setNote(e.target.value)} placeholder={t('Note (optional)')} aria-label={t('Note (optional)')} rows={2} maxLength={2000} />}
          <div className="flex gap-2">
            <Button size="sm" variant="primary" disabled={deciding} onClick={() => void run(true)}><Check size={14} />{t('Approve')}</Button>
            <Button size="sm" variant="secondary" disabled={deciding} onClick={() => void run(false)}><X size={14} />{t('Reject')}</Button>
          </div>
          {failed === 'error' && <p role="alert" className={`${FONT.sm} text-[var(--status-danger)]`}>{t('Could not record the decision.')}</p>}
        </div>
      ) : <p className={`${FONT.sm} text-muted-foreground`}>{t("Only the Space's owner can decide this approval.")}</p>)}
      {state !== 'pending' && failed === 'unchanged' && <p role="status" className={`${FONT.sm} text-muted-foreground`}>{t('Your decision was not recorded: this request was already decided or has expired.')}</p>}
    </section>
  );
}
