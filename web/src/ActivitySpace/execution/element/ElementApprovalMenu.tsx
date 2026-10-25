'use client';

import { useEffect, useState } from 'react';
import { Check, X, AlertCircle, Clock, ShieldCheck } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAssignableWorkers } from '@/ActivitySpace/sustainment/team/data';
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
import { Popover, PopoverTrigger, PopoverContent } from '@/ui/popover';

interface Props {
  element: ElementWithDetails;
  onRefresh?: () => void;
}

const stateMeta: Record<ApprovalState, { label: string; icon: React.ComponentType<{ size?: number; className?: string }>; color: string }> = {
  pending:            { label: 'Pending',           icon: Clock,       color: 'text-amber-400' },
  approved:           { label: 'Approved',          icon: Check,       color: 'text-emerald-400' },
  changes_requested:  { label: 'Changes requested', icon: AlertCircle, color: 'text-[var(--accent-default)]' },
  rejected:           { label: 'Rejected',          icon: X,           color: 'text-[var(--status-danger)]' },
};

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/**
 * Approval as a single header affordance: a ShieldCheck button that opens a
 * popover menu. The trigger glyph tints to the current decision state once the
 * workflow is enabled; the menu carries the enable/disable toggle, an optional
 * note, the three decisions (Approve / Request changes / Reject) and a compact
 * decision history. Replaces the old right-rail "Approval" island.
 */
export function ElementApprovalMenu({ element, onRefresh }: Props) {
  const { user, profile } = useAuthContext();
  const [open, setOpen] = useState(false);
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
    void Promise.all([
      supabase.rpc('user_can_decide_approval', { p_element: element.id }),
      supabase.rpc('user_can_manage_approval', { p_element: element.id }),
    ]).then(([decide, manage]) => { if (live) setRights({ key: rightsKey, decide: decide.data === true, manage: manage.data === true }); });
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
    catch (e) { setError(e instanceof Error ? e.message : 'Could not add the reviewer.'); }
  };
  const removeReviewer = async (assigneeId: string) => {
    setError(null);
    try { await removeElementAssignee(assigneeId); onRefresh?.(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not remove the reviewer.'); }
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
      setError(e instanceof Error ? e.message : 'Could not change the approval step.');
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
      setError(e instanceof Error ? e.message : 'Could not record the decision.');
    } finally { setBusy(false); }
  };

  const enabled = !!element.is_approval;
  const current = element.approval_state || 'pending';
  const StateIcon = stateMeta[current].icon;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={enabled ? `Approval — ${stateMeta[current].label}` : 'Approval'}
          aria-label="Approval"
          className="inline-flex items-center justify-center w-7 h-7 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
        >
          <ShieldCheck size={15} className={enabled ? stateMeta[current].color : ''} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-2">
        {!enabled ? (
          <button
            onClick={toggleApproval}
            disabled={busy}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/40 text-[13px] text-left disabled:opacity-50 transition-colors"
          >
            <ShieldCheck size={13} className="text-muted-foreground" />
            Enable approval workflow
          </button>
        ) : (
          <div className="space-y-2">
            {/* Current state + disable */}
            <div className="flex items-center justify-between px-1">
              <span className={`flex items-center gap-1.5 text-[12px] font-medium ${stateMeta[current].color}`}>
                <StateIcon size={13} />
                {stateMeta[current].label}
              </span>
              {canManage && (
                <button
                  onClick={toggleApproval}
                  disabled={busy}
                  className="text-[11px] text-muted-foreground hover:text-destructive transition-colors"
                  title="Disable approval workflow"
                >
                  Disable
                </button>
              )}
            </div>

            {/* Who decides: the reviewers, or else the Domain's owners and admins. */}
            <div className="space-y-1 px-1">
              <p className="text-[11px] text-muted-foreground">
                {reviewers.length ? 'Decided by its reviewers' : 'Decided by an owner or admin of its Domain'} — never by anyone working on it.
              </p>
              <div className="flex flex-wrap items-center gap-1">
                {reviewers.map((r) => (
                  <span key={r.id} className="inline-flex h-6 items-center gap-1 rounded-md bg-muted/40 pl-1.5 pr-0.5 text-[12px]">
                    {r.worker?.name ?? 'Reviewer'}
                    {canManage && (
                      <button type="button" aria-label={`Remove reviewer ${r.worker?.name ?? ''}`} disabled={r.id.startsWith('temp-')} onClick={() => void removeReviewer(r.id)}
                        className="flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"><X size={11} /></button>
                    )}
                  </span>
                ))}
                {canManage && candidates.length > 0 && (
                  <select aria-label="Add a reviewer" value="" onChange={(e) => { if (e.target.value) void addReviewer(e.target.value); }}
                    className="h-6 rounded-md bg-muted/30 px-1 text-[12px] text-muted-foreground outline-none hover:bg-muted/40 focus:bg-muted/60">
                    <option value="">+ Reviewer</option>
                    {candidates.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                )}
              </div>
            </div>

            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional note…"
              className="w-full text-[12px] bg-muted/30 rounded-md px-2 py-1.5 resize-none min-h-[36px] border-none"
            />

            {/* Decisions — the menu's selectable actions */}
            <div className="space-y-0.5">
              <button
                onClick={() => decide('approved')}
                disabled={busy || !canDecide}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[13px] text-left text-emerald-400 hover:bg-emerald-500/10 transition-colors disabled:opacity-50"
              >
                <Check size={13} /> Approve
              </button>
              <button
                onClick={() => decide('changes_requested')}
                disabled={busy || !canDecide}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[13px] text-left text-[var(--accent-default)] hover:bg-[var(--accent-default)]/10 transition-colors disabled:opacity-50"
              >
                <AlertCircle size={13} /> Request changes
              </button>
              <button
                onClick={() => decide('rejected')}
                disabled={busy || !canDecide}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[13px] text-left text-[var(--status-danger)] hover:bg-[var(--status-danger)]/10 transition-colors disabled:opacity-50"
              >
                <X size={13} /> Reject
              </button>
            </div>

            {currentRights && !canDecide && <p className="px-1 text-[11px] text-muted-foreground">You cannot decide this approval.</p>}
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
                          <span className="font-medium text-foreground truncate">{a.approver_name || 'Unknown'}</span>
                          <span className="text-muted-foreground">{m.label.toLowerCase()}</span>
                          <span className="ml-auto text-[10px] text-muted-foreground">{formatRelative(a.decided_at)}</span>
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
