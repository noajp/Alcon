'use client';

import { useEffect, useState } from 'react';
import { Check, X, AlertCircle, Clock, ShieldCheck } from 'lucide-react';
import {
  fetchElementApprovals,
  decideApproval,
  setElementIsApproval,
  notifyMany,
  type ElementApproval,
  type ApprovalState,
  type ElementWithDetails,
} from '@/hooks/useSupabase';
import { useAuthContext } from '@/providers/AuthProvider';

interface Props {
  element: ElementWithDetails;
  onRefresh?: () => void;
}

const stateMeta: Record<ApprovalState, { label: string; icon: React.ComponentType<{ size?: number; className?: string }>; color: string }> = {
  pending:            { label: 'Pending',           icon: Clock,       color: 'text-amber-400' },
  approved:           { label: 'Approved',          icon: Check,       color: 'text-emerald-400' },
  changes_requested:  { label: 'Changes requested', icon: AlertCircle, color: 'text-blue-400' },
  rejected:           { label: 'Rejected',          icon: X,           color: 'text-red-400' },
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

export function ElementApprovalPanel({ element, onRefresh }: Props) {
  const { user, profile } = useAuthContext();
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

      const assigneeUserIds = (element.assignees || [])
        .map(a => a.worker?.user_id)
        .filter((u): u is string => !!u);
      if (assigneeUserIds.length > 0) {
        await notifyMany(assigneeUserIds, {
          actor_id: user?.id ?? null,
          actor_name: approverName,
          kind: 'approval_decided',
          element_id: element.id,
          title: `${approverName} ${stateMeta[state].label.toLowerCase()} "${element.title}"`,
          body: note.trim() || null,
        });
      }

      setNote('');
      const fresh = await fetchElementApprovals(element.id);
      setApprovals(fresh);
      onRefresh?.();
    } catch (e) {
      console.error(e);
    } finally { setBusy(false); }
  };

  if (!element.is_approval) {
    return (
      <div className="rounded-xl border border-border overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-muted/20">
          <div className="flex items-center gap-2">
            <ShieldCheck size={14} className="text-muted-foreground" />
            <span className="text-[13px] font-medium text-foreground">Approval</span>
          </div>
          <button
            onClick={toggleApproval}
            disabled={busy}
            className="text-[11px] text-muted-foreground hover:text-foreground"
          >
            Enable approval
          </button>
        </div>
      </div>
    );
  }

  const current = element.approval_state || 'pending';
  const Icon = stateMeta[current].icon;

  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-muted/20">
        <div className="flex items-center gap-2">
          <ShieldCheck size={14} className="text-muted-foreground" />
          <span className="text-[13px] font-medium text-foreground">Approval</span>
        </div>
        <button
          onClick={toggleApproval}
          disabled={busy}
          className="text-[11px] text-muted-foreground hover:text-destructive"
          title="Disable approval workflow"
        >
          Disable
        </button>
      </div>
      <div className="p-3 space-y-3">
        <div className={`flex items-center gap-2 text-[13px] ${stateMeta[current].color}`}>
          <Icon size={14} />
          <span className="font-medium">{stateMeta[current].label}</span>
        </div>

        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional note for the approval decision…"
          className="w-full text-[13px] bg-muted/30 border border-border rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary/20 resize-none min-h-[40px]"
        />
        <div className="grid grid-cols-3 gap-1.5">
          <button
            onClick={() => decide('approved')}
            disabled={busy}
            className="flex items-center justify-center gap-1 py-1.5 text-[12px] bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 rounded-md transition-colors disabled:opacity-50"
          >
            <Check size={12} /> Approve
          </button>
          <button
            onClick={() => decide('changes_requested')}
            disabled={busy}
            className="flex items-center justify-center gap-1 py-1.5 text-[12px] bg-blue-500/15 text-blue-300 hover:bg-blue-500/25 rounded-md transition-colors disabled:opacity-50"
          >
            <AlertCircle size={12} /> Changes
          </button>
          <button
            onClick={() => decide('rejected')}
            disabled={busy}
            className="flex items-center justify-center gap-1 py-1.5 text-[12px] bg-red-500/15 text-red-300 hover:bg-red-500/25 rounded-md transition-colors disabled:opacity-50"
          >
            <X size={12} /> Reject
          </button>
        </div>

        {approvals.length > 0 && (
          <div className="border-t border-border pt-2 space-y-1.5">
            {approvals.slice(0, 5).map(a => {
              const m = stateMeta[a.state];
              const I = m.icon;
              return (
                <div key={a.id} className="flex items-start gap-2 text-[12px]">
                  <I size={11} className={`${m.color} mt-0.5 flex-shrink-0`} />
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
    </div>
  );
}
