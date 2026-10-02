'use client';

import { useEffect, useState } from 'react';
import { Check, X, AlertCircle, Clock, ShieldCheck } from 'lucide-react';
import {
  fetchElementApprovals,
  decideApproval,
  setElementIsApproval,
  notifyAboutElement,
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

  useEffect(() => {
    if (!element.is_approval) { setApprovals([]); return; }
    fetchElementApprovals(element.id).then(setApprovals).catch(console.error);
  }, [element.id, element.is_approval]);

  const toggleApproval = async () => {
    setBusy(true);
    try {
      await setElementIsApproval(element.id, !element.is_approval);
      onRefresh?.();
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
              <button
                onClick={toggleApproval}
                disabled={busy}
                className="text-[11px] text-muted-foreground hover:text-destructive transition-colors"
                title="Disable approval workflow"
              >
                Disable
              </button>
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
                disabled={busy}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[13px] text-left text-emerald-400 hover:bg-emerald-500/10 transition-colors disabled:opacity-50"
              >
                <Check size={13} /> Approve
              </button>
              <button
                onClick={() => decide('changes_requested')}
                disabled={busy}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[13px] text-left text-[var(--accent-default)] hover:bg-[var(--accent-default)]/10 transition-colors disabled:opacity-50"
              >
                <AlertCircle size={13} /> Request changes
              </button>
              <button
                onClick={() => decide('rejected')}
                disabled={busy}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[13px] text-left text-[var(--status-danger)] hover:bg-[var(--status-danger)]/10 transition-colors disabled:opacity-50"
              >
                <X size={13} /> Reject
              </button>
            </div>

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
