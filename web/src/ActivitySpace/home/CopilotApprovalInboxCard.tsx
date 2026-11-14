'use client';

import { useState } from 'react';
import { Hand } from '@/ui/icons';
import { FONT } from '@/shared/designTokens';
import { Button } from '@/ui/button';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { decideAgentActionById, fetchAgentActionById, useAgentAction } from '@/AIP/ai/agentData';
import { ApprovalDecisionCard } from '@/Function/shared/ApprovalDecisionCard';

// A Copilot approval, decided where the notification landed: the Inbox.
// The card reads the action itself (its calls, their display, its hash),
// and the decision goes through the engine like the panel's — the run's
// starter is the only one who may decide, the paused chat turn resumes,
// and its continuation lands in the conversation. The action's own status
// is followed until the resume settles it.
//
// This surface keeps its status line (where the approval stands, in the
// Inbox's own words); the decision block is the shared card, the same
// anatomy the chat and the run panel decide with. Remember chips are
// not offered here: a standing approval is the Space owner's to give,
// and this card does not know its Space — the chat and the panel do.
export function CopilotApprovalInboxCard({ actionId }: { actionId: string }) {
  const { t, locale } = useI18n();
  const { action, canDecide, loading, error, refresh } = useAgentAction(actionId);
  const [working, setWorking] = useState(false);
  const [failed, setFailed] = useState(false);

  if (error) return (
    <p role="alert" className={`flex items-center gap-2 ${FONT.sm} text-[var(--status-danger)]`}>
      {t('Could not read the approval.')}
      <Button variant="ghost" size="xs" onClick={() => void refresh()}>{t('Retry')}</Button>
    </p>
  );
  if (loading && !action) return <p className={`${FONT.sm} text-muted-foreground`}>{t('Opening…')}</p>;
  if (!action) return <p className={`${FONT.sm} text-muted-foreground`}>{t('This approval is no longer available.')}</p>;

  const when = (iso: string) => new Date(iso).toLocaleString(locale);
  const statusLine =
    action.status === 'pending' ? (action.expires_at
      ? t('Waiting for a decision until {time}', { time: when(action.expires_at) })
      : t('Awaiting approval'))
    : action.status === 'approved' ? t('Approved · the conversation is continuing')
    : action.status === 'executed' ? t('Approved and run · {time}', { time: action.decided_at ? when(action.decided_at) : '' })
    : action.status === 'failed' ? t('Approved, but the run failed · {time}', { time: action.decided_at ? when(action.decided_at) : '' })
    : action.status === 'rejected' ? t('Denied · {time}', { time: action.decided_at ? when(action.decided_at) : '' })
    : t('Expired without a decision');
  const statusTone = action.status === 'pending' ? 'text-[var(--status-info)]'
    : action.status === 'executed' || action.status === 'approved' ? 'text-[var(--status-success)]'
    : action.status === 'failed' || action.status === 'rejected' ? 'text-[var(--status-danger)]'
    : 'text-muted-foreground';

  const decide = async (approve: boolean, opts: { note?: string; remember?: string[] }) => {
    setFailed(false);
    setWorking(true);
    try {
      await decideAgentActionById({
        runId: action.run_id, actionId: action.id, inputHash: action.input_hash, approve,
        note: opts.note, remember: opts.remember,
      });
      // The resume settles the action (executed / failed, or the denial
      // lands at once); follow it to its rest, then re-read the card.
      for (let i = 0; i < 90; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const now = await fetchAgentActionById(action.id).catch(() => null);
        if (!now || ['executed', 'failed', 'rejected', 'expired'].includes(now.status)) break;
      }
      await refresh();
    } catch {
      setFailed(true);
    } finally {
      setWorking(false);
    }
  };

  return (
    <section className="space-y-4 rounded-lg border border-border/60 bg-card p-6" aria-label={t('Approval request')}>
      <div className="flex items-start gap-3">
        <Hand size={18} className="mt-0.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1 space-y-1">
          <p className={`${FONT.sm} ${statusTone}`}>{statusLine}</p>
          {action.decision_note && <p className={`${FONT.sm} text-foreground/80`}>{action.decision_note}</p>}
        </div>
      </div>

      <ApprovalDecisionCard action={action} surface="inbox"
        canDecide={canDecide} deciding={working}
        onDecide={decide} />
      {working && <p className={`${FONT.sm} text-muted-foreground`}>{t('Working…')}</p>}
      {failed && <p role="alert" className={`${FONT.sm} text-[var(--status-danger)]`}>{t('Could not record the decision.')}</p>}
    </section>
  );
}
