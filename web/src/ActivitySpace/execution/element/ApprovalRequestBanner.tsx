'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/ui/button';
import { AlertCircle, Check, ShieldCheck, X } from '@/ui/icons';
import { useAuthContext } from '@/providers/AuthProvider';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { fetchApprovalRights } from '@/hooks/elementData';
import type { ApprovalState, ElementWithDetails } from '@/hooks/useSupabase';
import { recordApprovalDecision } from './ElementApprovalMenu';

/**
 * The question, where the person asked to answer it lands: under the title of
 * an Element waiting on an approval, for someone the server lets decide it.
 * Everyone else sees nothing here — the approval menu below explains why.
 */
export function ApprovalRequestBanner({ element, onRefresh }: { element: ElementWithDetails; onRefresh?: () => void }) {
  const { t } = useI18n();
  const { user, profile } = useAuthContext();
  const pending = !!element.is_approval && (element.approval_state ?? 'pending') === 'pending';
  // The answer belongs to this Element: a stale one for another is ignored.
  const [rights, setRights] = useState<{ elementId: string; decide: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!pending) return;
    let live = true;
    void fetchApprovalRights(element.id).then((r) => { if (live) setRights({ elementId: element.id, decide: r.decide }); });
    return () => { live = false; };
  }, [pending, element.id]);

  if (!pending || rights?.elementId !== element.id || !rights.decide) return null;

  const decide = async (state: ApprovalState) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const approverName = profile?.display_name || user?.email?.split('@')[0] || 'You';
      await recordApprovalDecision({ elementId: element.id, approverId: user?.id ?? null, approverName, state, note: null });
      onRefresh?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('Could not record the decision.'));
    } finally { setBusy(false); }
  };

  return (
    <div role="region" aria-label={t('Your decision is needed')}
      className="mb-5 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
      <ShieldCheck size={15} className="text-[var(--status-warning)]" />
      <span className="mr-auto text-[13px] font-medium">{t('Your decision is needed')}</span>
      <Button variant="primary" size="sm" className="gap-1.5" disabled={busy} onClick={() => void decide('approved')}>
        <Check size={13} /> {t('Approve')}
      </Button>
      <Button variant="secondary" size="sm" className="gap-1.5" disabled={busy} onClick={() => void decide('changes_requested')}>
        <AlertCircle size={13} /> {t('Request changes')}
      </Button>
      <Button variant="ghost" size="sm" className="gap-1.5 text-[var(--status-danger)]" disabled={busy} onClick={() => void decide('rejected')}>
        <X size={13} /> {t('Reject')}
      </Button>
      {error && <p role="alert" className="w-full text-[11px] text-[var(--status-danger)]">{error}</p>}
    </div>
  );
}
