'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/ui/button';
import { Check, X, AlertCircle, Clock, ShieldCheck } from 'lucide-react';
import { useAssignableWorkers } from '@/hooks/teamData';
import {
  fetchElementApprovals,
  decideApproval,
  setElementIsApproval,
  notifyAboutElement,
  addElementAssignee,
  removeElementAssignee,
  type ElementApproval,
  type ApprovalState,
  type ElementWithDetails,
} from '@/hooks/useSupabase';
import { useAuthContext } from '@/providers/AuthProvider';
import { Popover, PopoverAnchor, PopoverTrigger, PopoverContent } from '@/ui/popover';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { formatAge } from '@/Function/shared/dateUtils';
import { fetchApprovalRights } from '@/hooks/elementData';

interface Props {
  element: ElementWithDetails;
  onRefresh?: () => void;
  /** Bumped by the Element's "…" menu (Approval) to open the panel. */
  openSignal?: number;
}

const stateMeta: Record<ApprovalState, { label: string; icon: React.ComponentType<{ size?: number; className?: string }>; color: string }> = {
  pending:            { label: 'Pending',           icon: Clock,       color: 'text-[var(--status-warning)]' },
  approved:           { label: 'Approved',          icon: Check,       color: 'text-foreground' },
  changes_requested:  { label: 'Changes requested', icon: AlertCircle, color: 'text-[var(--accent-default)]' },
  rejected:           { label: 'Rejected',          icon: X,           color: 'text-[var(--status-danger)]' },
};

/**
 * Approval as a single header affordance: a ShieldCheck button that opens a
 * popover menu. The trigger glyph tints to the current decision state once the
 * workflow is enabled; the menu carries the enable/disable toggle, an optional
 * note, the three decisions (Approve / Request changes / Reject) and a compact
 * decision history. Replaces the old right-rail "Approval" island.
 */
export function ElementApprovalMenu({ element, onRefresh, openSignal = 0 }: Props) {
  const { t } = useI18n();
  const { user, profile } = useAuthContext();
  const [open, setOpen] = useState(false);
  const [seenSignal, setSeenSignal] = useState(openSignal);
  if (openSignal !== seenSignal) {
    setSeenSignal(openSignal);
    setOpen(true);
  }
  const [approvals, setApprovals] = useState<ElementApproval[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const [error, setError] = useState<string | null>(null);
  // Who decides is the server's rule (user_can_decide_approval): the reviewers
  // when there are any, otherwise the Domain's owners and admins — never the
  // person doing the work. Asked again whenever the Element changes.
  // null while asking; the answer belongs to the Element and people it was asked for.
  const [rights, setRights] = useState<{ key: string; decide: boolean; manage: boolean } | null>(null);
  const reviewers = (element.assignees ?? []).filter((a) => a.role === 'reviewer');
  const reviewerKey = reviewers.map((r) => r.worker_id).join(',');
  const assigneeKey = (element.assignees ?? []).filter((a) => a.role === 'assignee').map((a) => a.worker_id).join(',');
  const rightsKey = `${element.id}|${reviewerKey}|${assigneeKey}`;
  useEffect(() => {
    if (!open || !element.is_approval) return;
    let live = true;
    void fetchApprovalRights(element.id).then((r) => { if (live) setRights({ key: rightsKey, ...r }); });
    return () => { live = false; };
  }, [open, element.id, element.is_approval, rightsKey]);
  const currentRights = rights && rights.key === rightsKey ? rights : null;
  const canDecide = currentRights?.decide ?? false;
  const canManage = currentRights?.manage ?? false;
  const { data: people } = useAssignableWorkers({ elementId: element.id }, open && !!element.is_approval);
  const candidates = people.filter((w) => w.type === 'human' && !(element.assignees ?? []).some((a) => a.worker_id === w.id));

  const addReviewer = async (workerId: string) => {
    setError(null);
    try { await addElementAssignee({ element_id: element.id, worker_id: workerId, role: 'reviewer', worker: people.find((w) => w.id === workerId) }); onRefresh?.(); }
    catch (e) { setError(e instanceof Error ? e.message : t('Could not add the reviewer.')); }
  };
  const removeReviewer = async (assigneeId: string) => {
    setError(null);
    try { await removeElementAssignee(assigneeId); onRefresh?.(); }
    catch (e) { setError(e instanceof Error ? e.message : t('Could not remove the reviewer.')); }
  };

  useEffect(() => {
    if (!element.is_approval) { setApprovals([]); return; }
    fetchElementApprovals(element.id).then(setApprovals).catch(console.error);
  }, [element.id, element.is_approval]);

  const toggleApproval = async () => {
    setBusy(true);
    setError(null);
    try {
      await setElementIsApproval(element.id, !element.is_approval);
      onRefresh?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('Could not change the approval step.'));
    } finally { setBusy(false); }
  };

  const decide = async (state: ApprovalState) => {
    if (busy) return;
    setBusy(true);
    try {
      const approverName = profile?.display_name || user?.email?.split('@')[0] || 'You';
      await decideApproval({
        element_id: element.id,
        approver_id: user?.id ?? null,
        approver_name: approverName,
        state,
        note: note.trim() || null,
      });

      // The RPC tells the assignees, using the decision row written above.
      await notifyAboutElement(element.id, 'approval_decided');

      setNote('');
      const fresh = await fetchElementApprovals(element.id);
      setApprovals(fresh);
      onRefresh?.();
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : t('Could not record the decision.'));
    } finally { setBusy(false); }
  };

  const enabled = !!element.is_approval;
  const current = element.approval_state || 'pending';
  const StateIcon = stateMeta[current].icon;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {/* Turning approval on lives in the Element's "…" menu; once it is on,
          its state shows here as an icon that opens the same panel. */}
      {enabled ? (
        <PopoverTrigger asChild>
          <button
            type="button"
            title={t('Approval — {state}', { state: t(stateMeta[current].label) })}
            aria-label={t('Approval')}
            className="inline-flex items-center justify-center w-7 h-7 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
          >
            <ShieldCheck size={15} className={stateMeta[current].color} />
          </button>
        </PopoverTrigger>
      ) : <PopoverAnchor asChild><span aria-hidden className="inline-block h-7 w-0" /></PopoverAnchor>}
      <PopoverContent align="end" className="w-64 p-2">
        {!enabled ? (
          <button
            onClick={toggleApproval}
            disabled={busy}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/40 text-[13px] text-left disabled:opacity-50 transition-colors"
          >
            <ShieldCheck size={13} className="text-muted-foreground" />
            {t('Enable approval workflow')}
          </button>
        ) : (
          <div className="space-y-2">
            {/* Current state + disable */}
            <div className="flex items-center justify-between px-1">
              <span className={`flex items-center gap-1.5 text-[12px] font-medium ${stateMeta[current].color}`}>
                <StateIcon size={13} />
                {t(stateMeta[current].label)}
              </span>
              {canManage && (
                <button
                  onClick={toggleApproval}
                  disabled={busy}
                  className="text-[11px] text-muted-foreground hover:text-destructive transition-colors"
                  title={t('Disable approval workflow')}
                >
                  {t('Disable')}
                </button>
              )}
            </div>

            {/* Who decides: the reviewers, or else the Domain's owners and admins. */}
            <div className="space-y-1 px-1">
              <p className="text-[11px] text-muted-foreground">
                {reviewers.length
                  ? t('Decided by its reviewers — never by anyone working on it.')
                  : t('Decided by whoever manages it — its Domain’s owners and admins, or its owner — never by anyone working on it.')}
              </p>
              <div className="flex flex-wrap items-center gap-1">
                {reviewers.map((r) => (
                  <span key={r.id} className="inline-flex h-6 items-center gap-1 rounded-md bg-muted/40 pl-1.5 pr-0.5 text-[12px]">
                    {r.worker?.name ?? t('Reviewer')}
                    {canManage && (
                      <button type="button" aria-label={t('Remove reviewer {name}', { name: r.worker?.name ?? '' })} disabled={r.id.startsWith('temp-')} onClick={() => void removeReviewer(r.id)}
                        className="flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"><X size={11} /></button>
                    )}
                  </span>
                ))}
                {canManage && candidates.length > 0 && (
                  <select aria-label={t('Add a reviewer')} value="" onChange={(e) => { if (e.target.value) void addReviewer(e.target.value); }}
                    className="h-6 rounded-md bg-muted/30 px-1 text-[12px] text-muted-foreground outline-none hover:bg-muted/40 focus:bg-muted/60">
                    <option value="">{t('+ Reviewer')}</option>
                    {candidates.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                )}
              </div>
            </div>

            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('Optional note…')}
              className="w-full text-[12px] bg-muted/30 rounded-md px-2 py-1.5 resize-none min-h-[36px] border-none"
            />

            {/* Decisions — approving is the decisive one, so it is the accent-blue
                primary button; asking for changes and rejecting sit beside it. */}
            <div className="flex flex-wrap items-center gap-1.5">
              <Button variant="primary" size="sm" className="gap-1.5" onClick={() => decide('approved')} disabled={busy || !canDecide}>
                <Check size={13} /> {t('Approve')}
              </Button>
              <Button variant="secondary" size="sm" className="gap-1.5" onClick={() => decide('changes_requested')} disabled={busy || !canDecide}>
                <AlertCircle size={13} /> {t('Request changes')}
              </Button>
              <Button variant="ghost" size="sm" className="gap-1.5 text-[var(--status-danger)]" onClick={() => decide('rejected')} disabled={busy || !canDecide}>
                <X size={13} /> {t('Reject')}
              </Button>
            </div>

            {currentRights && !canDecide && <p className="px-1 text-[11px] text-muted-foreground">{t('You cannot decide this approval.')}</p>}
            {error && <p role="alert" className="px-1 text-[11px] text-[var(--status-danger)]">{error}</p>}

            {/* Compact decision history */}
            {approvals.length > 0 && (
              <div className="border-t border-border/60 pt-2 space-y-1.5 max-h-40 overflow-auto">
                {approvals.slice(0, 5).map(a => {
                  const m = stateMeta[a.state];
                  const I = m.icon;
                  return (
                    <div key={a.id} className="flex items-start gap-2 text-[12px] px-1">
                      <I size={11} className={`${m.color} mt-0.5 shrink-0`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1">
                          <span className="font-medium text-foreground truncate">{a.approver_name || t('Unknown')}</span>
                          <span className="text-muted-foreground">{t(m.label)}</span>
                          <span className="ml-auto text-[10px] text-muted-foreground">{formatAge(a.decided_at)}</span>
                        </div>
                        {a.note && <div className="text-muted-foreground/80 italic">{a.note}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
