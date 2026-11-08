'use client';

import { useState } from 'react';
import { Check, Hand, X } from '@/ui/icons';
import { Button } from '@/ui/button';
import { Textarea } from '@/ui/textarea';
import { FONT } from '@/shared/designTokens';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { decideAgentActionById, fetchAgentActionById, useAgentAction } from '@/AIP/ai/agentData';
import { approvalRows } from '@/ActivitySpace/execution/element/agent/approvalView';

// A Copilot approval, decided where the notification landed: the Inbox.
// The card reads the action itself (its calls, their display, its hash),
// and the decision goes through the engine like the panel's — the run's
// starter is the only one who may decide, the paused chat turn resumes,
// and its continuation lands in the conversation. The action's own status
// is followed until the resume settles it.
export function CopilotApprovalInboxCard({ actionId }: { actionId: string }) {
  const { t, locale } = useI18n();
  const { action, canDecide, loading, error, refresh } = useAgentAction(actionId);
  const [note, setNote] = useState('');
  const [working, setWorking] = useState(false);
  const [failed, setFailed] = useState(false);

  if (error) return <p role="alert" className={`${FONT.sm} text-[var(--status-danger)]`}>{t('Could not read the approval.')}</p>;
  if (loading && !action) return <p className={`${FONT.sm} text-muted-foreground`}>{t('Opening…')}</p>;
  if (!action) return <p className={`${FONT.sm} text-muted-foreground`}>{t('This approval is no longer available.')}</p>;

  const when = (iso: string) => new Date(iso).toLocaleString(locale);
  const rows = approvalRows(action);
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

  const decide = async (approve: boolean) => {
    setFailed(false);
    setWorking(true);
    try {
      await decideAgentActionById({
        runId: action.run_id, actionId: action.id, inputHash: action.input_hash, approve, note,
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
          <h2 className={`${FONT.lg} text-foreground`}>{action.summary}</h2>
          <p className={`${FONT.sm} ${statusTone}`}>{statusLine}</p>
          {action.decision_note && <p className={`${FONT.sm} text-foreground/80`}>{action.decision_note}</p>}
          <p className={`${FONT.sm} text-muted-foreground`}>
            {t('Asked {time} · Approving runs exactly these calls with exactly this input.', { time: when(action.created_at) })}
          </p>
        </div>
      </div>

      {rows.length > 0 && (
        <ul className="space-y-1.5">
          {rows.map((r) => (
            <li key={r.id} className="rounded-md bg-muted/50 px-3 py-2">
              <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
                <span className="font-medium text-foreground">{r.integration}</span>
                <span className="rounded bg-background px-1 py-px font-mono text-[10.5px] text-muted-foreground">{r.operation}</span>
                <span className="text-[10.5px] text-muted-foreground">{r.effect === 'read' ? t('read') : t('write')}</span>
                {r.critical && (
                  <span className="rounded border border-[var(--status-danger)]/40 px-1 py-px text-[10.5px] text-[var(--status-danger)]">{t('Critical')}</span>
                )}
              </div>
              <div className="mt-0.5 text-[11.5px] text-muted-foreground">{t('Destination: {where}', { where: r.destination })}</div>
              {r.detail && <div className="mt-0.5 break-all font-mono text-[10.5px] text-muted-foreground">{r.detail}</div>}
              {r.fields.length > 0 && (
                <div className="mt-1 space-y-px">
                  {r.fields.map(([k, v]) => (
                    <div key={k} className="flex min-w-0 gap-1.5 text-[11.5px]">
                      <span className="shrink-0 text-muted-foreground">{k}</span>
                      <span className="truncate text-foreground/90">{v}</span>
                    </div>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {action.status === 'pending' && (canDecide ? (
        <div className="space-y-2">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('Note (optional)')} aria-label={t('Note (optional)')} rows={2} maxLength={2000} />
          <div className="flex gap-2">
            <Button size="sm" variant="primary" disabled={working} onClick={() => void decide(true)}><Check size={14} />{t('Approve')}</Button>
            <Button size="sm" variant="secondary" disabled={working} onClick={() => void decide(false)}><X size={14} />{t('Deny')}</Button>
          </div>
          {working && <p className={`${FONT.sm} text-muted-foreground`}>{t('Working…')}</p>}
          {failed && <p role="alert" className={`${FONT.sm} text-[var(--status-danger)]`}>{t('Could not record the decision.')}</p>}
        </div>
      ) : (
        <p className={`${FONT.sm} text-muted-foreground`}>{t('Only the person who started this conversation can decide this approval.')}</p>
      ))}
    </section>
  );
}
