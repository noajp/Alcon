'use client';

import { appDialog } from '@/Function/shared/appDialogStore';

import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Plus, Trash2, UserPlus, X } from 'lucide-react';
import { isCommitEnter, useEscapeLayer } from '@/Function/shared/keyboard';
import { supabase } from '@/lib/supabase';
import { useAuthContext } from '@/providers/AuthProvider';
import { createWorker, deleteWorker, updateWorker } from '@/hooks/useSupabase';
import type { Worker } from '@/types/database';
import { ReachHint, WorkerAvatar } from '@/Function/shared/WorkerAvatar';
import { isUnreachableWorker } from '@/Function/shared/workerReach';
import { SettingsSection } from './SettingsSection';
import { InviteUserDialog } from './InviteUserDialog';
import { ConnectWorkerAccountDialog } from './ConnectWorkerAccountDialog';

interface TeamSettingsProps {
  /** Optional Domain scope — when provided, the Humans list is filtered to
   *  members of this Domain (via `domain_members.user_id`). AI agents are
   *  always shown regardless of membership. Omit for the global view. */
  domainId?: string;
}

export function TeamSettings({ domainId }: TeamSettingsProps = {}) {
  const { user } = useAuthContext();
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [memberUserIds, setMemberUserIds] = useState<Set<string>>(new Set());
  const [myRole, setMyRole] = useState<'owner' | 'member' | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [connecting, setConnecting] = useState<Worker | null>(null);

  // Connecting a Worker to an account redirects that Worker's assignments
  // and notifications to whoever the admin picks — the same blast radius as
  // "Make owner"/"Make member" in MemberSettings.tsx and ActivitySpaceSettings.tsx,
  // both of which gate on the viewer's own role instead of trusting RLS
  // alone. `workers`' own RLS ("Authenticated full access") permits the
  // UPDATE from any signed-in user regardless of Domain membership, so this
  // page — not the database — is what has to say no to a plain member.
  // Global view (no domainId) has no single Domain to check ownership
  // against, so Connect stays unavailable there rather than guessing.
  const isOwner = domainId ? myRole === 'owner' : false;
  // Inviting, adding, deactivating and removing Workers are owner actions in
  // a Domain. The global view has no Domain to be owner of, so it keeps the
  // controls (it is the Workspace-wide roster).
  const canManage = domainId ? isOwner : true;

  const reload = async () => {
    setLoading(true);
    try {
      const [{ data: workersData, error: workersErr }, memberRowsResult] = await Promise.all([
        supabase.from('workers').select('*').order('type').order('name'),
        domainId
          ? supabase.from('domain_members').select('user_id, role').eq('domain_id', domainId)
          : Promise.resolve({ data: null, error: null } as const),
      ]);
      if (workersErr) throw workersErr;
      if (memberRowsResult.error) throw memberRowsResult.error;
      const memberRows = (memberRowsResult.data ?? []) as { user_id: string; role: 'owner' | 'member' }[];
      setWorkers((workersData ?? []) as Worker[]);
      setMemberUserIds(new Set(memberRows.map((r) => r.user_id)));
      setMyRole(memberRows.find((r) => r.user_id === user?.id)?.role ?? null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load team');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domainId, user?.id]);

  const handleDelete = async (id: string) => {
    if (!await appDialog.confirm('Remove this team member? Their assignments will be cleared.')) return;
    try {
      await deleteWorker(id);
      setWorkers((prev) => prev.filter((w) => w.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove member');
    }
  };

  const handleStatusToggle = async (w: Worker) => {
    const next: Worker['status'] = w.status === 'active' ? 'inactive' : 'active';
    try {
      const updated = await updateWorker(w.id, { status: next });
      setWorkers((prev) => prev.map((x) => (x.id === w.id ? updated : x)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update status');
    }
  };

  // Domain-scoped — show only humans whose user_id is a domain_member.
  // AI agents are always shown regardless of membership (they're scoped by
  // domain elsewhere via ai_config). When domainId is absent (global view)
  // show everyone.
  //
  // This is a structural consequence, not an oversight (el_QLT-008 review,
  // ELE_QLT-034): domain_members only has a row for an actual account, so a
  // human Worker with no account (user_id null) has no way to belong to a
  // Domain today — there is no other Worker↔Domain link to check. Giving
  // that Worker a seat here needs ELE_QLT-031's account-connection flow
  // first, not a different filter.
  const humans = workers.filter((w) => {
    if (w.type !== 'human') return false;
    if (!domainId) return true;
    return w.user_id != null && memberUserIds.has(w.user_id);
  });
  const agents = workers.filter((w) => w.type !== 'human');

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div className="min-w-[180px] flex-1">
          <h2 className="text-[15px] font-semibold text-foreground">Team</h2>
          <p className="text-[12px] text-muted-foreground mt-0.5">
            Workers (human or AI) that can be assigned to Elements.
          </p>
        </div>
        {canManage && <div className="flex shrink-0 items-center gap-2 whitespace-nowrap">
          {domainId && (
            <button
              onClick={() => setShowInvite(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-border text-foreground rounded-md text-[12px] font-medium hover:bg-muted/40 transition-colors"
            >
              <UserPlus size={12} />
              Invite
            </button>
          )}
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-foreground text-background rounded-md text-[12px] font-medium hover:opacity-90 transition-opacity"
          >
            <Plus size={12} />
            Add
          </button>
        </div>}
      </div>

      {error && (
        <div className="mb-3 p-3 rounded-md border border-[var(--status-danger)] dark:border-[var(--status-danger)] bg-[var(--status-danger-subtle)] dark:bg-[var(--status-danger)]/20 text-[12px] text-[var(--status-danger)] dark:text-[var(--status-danger)]">
          {error}
        </div>
      )}

      <SettingsSection title={`Humans (${humans.length})`}>
        {loading && humans.length === 0 ? (
          <div className="px-4 py-6 text-[12px] text-muted-foreground">Loading…</div>
        ) : humans.length === 0 ? (
          <div className="px-4 py-6 text-[12px] text-muted-foreground">No human members yet.</div>
        ) : (
          humans.map((w) => (
            <WorkerRow
              key={w.id}
              worker={w}
              onDelete={canManage ? () => handleDelete(w.id) : undefined}
              onToggleStatus={canManage ? () => handleStatusToggle(w) : undefined}
              onConnect={isOwner ? () => setConnecting(w) : undefined}
            />
          ))
        )}
      </SettingsSection>

      <SettingsSection title={`AI agents (${agents.length})`}>
        {agents.length === 0 ? (
          <div className="px-4 py-6 text-[12px] text-muted-foreground">No AI agents yet.</div>
        ) : (
          agents.map((w) => (
            <WorkerRow
              key={w.id}
              worker={w}
              onDelete={canManage ? () => handleDelete(w.id) : undefined}
              onToggleStatus={canManage ? () => handleStatusToggle(w) : undefined}
            />
          ))
        )}
      </SettingsSection>

      {showAdd && (
        <AddMemberDialog
          onClose={() => setShowAdd(false)}
          onCreated={(w) => {
            setWorkers((prev) => [...prev, w]);
            setShowAdd(false);
          }}
        />
      )}

      {showInvite && domainId && (
        <InviteUserDialog
          target={{ kind: 'domain', domainId }}
          existingMemberIds={memberUserIds}
          onClose={() => setShowInvite(false)}
          onInvited={() => {
            setShowInvite(false);
            void reload();
          }}
        />
      )}

      {connecting && (
        <ConnectWorkerAccountDialog
          worker={connecting}
          onClose={() => setConnecting(null)}
          onConnected={(updated) => {
            setWorkers((prev) => prev.map((w) => (w.id === updated.id ? updated : w)));
            setConnecting(null);
          }}
        />
      )}
    </div>
  );
}

function WorkerRow({
  worker,
  onDelete,
  onToggleStatus,
  onConnect,
}: {
  worker: Worker;
  /** Both omitted for a non-owner viewing a Domain's team. */
  onDelete?: () => void;
  onToggleStatus?: () => void;
  /** Omitted for AI agents — isUnreachableWorker is never true for them, so
   *  the button below never renders regardless, but the row itself is human-
   *  only about "no account". */
  onConnect?: () => void;
}) {
  const isAi = worker.type !== 'human';
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <WorkerAvatar worker={worker} size={32} className="shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[13px] font-medium text-foreground truncate">{worker.name}</span>
          {isAi && (
            <span className="text-[9px] font-medium px-1 py-px rounded bg-violet-50 text-violet-600">
              AI
            </span>
          )}
          {worker.status === 'inactive' && (
            <span className="text-[9px] font-medium px-1 py-px rounded bg-muted text-muted-foreground">
              Inactive
            </span>
          )}
          <ReachHint worker={worker} />
        </div>
        <div className="text-[11px] text-muted-foreground truncate">
          {[worker.role, worker.email].filter(Boolean).join(' · ') || (isAi ? worker.ai_model || 'Agent' : 'No role')}
        </div>
      </div>
      {onConnect && isUnreachableWorker(worker) && (
        <button
          onClick={onConnect}
          className="px-2 py-1 text-[11px] text-foreground border border-border rounded-md hover:bg-muted/40 transition-colors"
          title="Connect this Worker to an account so assignments and notifications reach them"
        >
          Connect
        </button>
      )}
      {onToggleStatus && <button
        onClick={onToggleStatus}
        className="px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent rounded transition-colors"
        title={worker.status === 'active' ? 'Deactivate' : 'Reactivate'}
      >
        {worker.status === 'active' ? 'Deactivate' : 'Activate'}
      </button>}
      {onDelete && <button
        onClick={onDelete}
        className="p-1.5 text-muted-foreground hover:text-[var(--status-danger)] hover:bg-[var(--status-danger-subtle)] dark:hover:bg-[var(--status-danger)]/20 rounded transition-colors"
        title="Remove"
      >
        <Trash2 size={13} />
      </button>}
    </div>
  );
}

function AddMemberDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (worker: Worker) => void;
}) {
  const [type, setType] = useState<'human' | 'ai_agent'>('human');
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [email, setEmail] = useState('');
  const [aiModel, setAiModel] = useState('claude-opus-4-7');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEscapeLayer(true, onClose);

  const handleSave = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const created = await createWorker({
        name: name.trim(),
        type,
        role: role.trim() || null,
        email: type === 'human' ? email.trim() || null : null,
        ai_model: type === 'ai_agent' ? aiModel.trim() || null : null,
      });
      onCreated(created);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add member');
      setSaving(false);
    }
  };

  // Every field here is single-line, so Enter in any of them is "Add".
  const submitOnEnter = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (isCommitEnter(e)) {
      e.preventDefault();
      void handleSave();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md bg-card rounded-xl border border-border shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="text-[14px] font-semibold text-foreground">Add team member</h3>
          <button
            onClick={onClose}
            className="p-1 text-muted-foreground hover:text-foreground hover:bg-accent rounded transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-[12px] font-medium text-foreground mb-1.5">Type</label>
            <div className="flex gap-2">
              <button
                onClick={() => setType('human')}
                className={`flex-1 py-2 rounded-md text-[12px] font-medium transition-colors ${
                  type === 'human'
                    ? 'bg-foreground text-background'
                    : 'border border-border text-muted-foreground hover:text-foreground'
                }`}
              >
                Human
              </button>
              <button
                onClick={() => setType('ai_agent')}
                className={`flex-1 py-2 rounded-md text-[12px] font-medium transition-colors ${
                  type === 'ai_agent'
                    ? 'bg-foreground text-background'
                    : 'border border-border text-muted-foreground hover:text-foreground'
                }`}
              >
                AI agent
              </button>
            </div>
          </div>

          <div>
            <label className="block text-[12px] font-medium text-foreground mb-1.5">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={type === 'human' ? 'e.g. Alex Chen' : 'e.g. Codex'}
              onKeyDown={submitOnEnter}
              autoFocus
              className="w-full px-3 py-2 bg-background border border-border rounded-md text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none transition-colors"
            />
          </div>

          <div>
            <label className="block text-[12px] font-medium text-foreground mb-1.5">Role</label>
            <input
              type="text"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder={type === 'human' ? 'e.g. Frontend Engineer' : 'e.g. Code reviewer'}
              onKeyDown={submitOnEnter}
              className="w-full px-3 py-2 bg-background border border-border rounded-md text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none transition-colors"
            />
          </div>

          {type === 'human' ? (
            <div>
              <label className="block text-[12px] font-medium text-foreground mb-1.5">
                Email <span className="text-muted-foreground font-normal">(optional)</span>
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="alex@example.com"
                onKeyDown={submitOnEnter}
                className="w-full px-3 py-2 bg-background border border-border rounded-md text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none transition-colors"
              />
            </div>
          ) : (
            <div>
              <label className="block text-[12px] font-medium text-foreground mb-1.5">AI model</label>
              <input
                type="text"
                value={aiModel}
                onChange={(e) => setAiModel(e.target.value)}
                placeholder="claude-opus-4-7"
                onKeyDown={submitOnEnter}
                className="w-full px-3 py-2 bg-background border border-border rounded-md text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none transition-colors"
              />
            </div>
          )}

          {error && (
            <p className="text-[12px] text-[var(--status-danger)]">{error}</p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border bg-muted/30 rounded-b-xl">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-[12px] text-muted-foreground hover:text-foreground hover:bg-accent rounded-md transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim() || saving}
            className="px-3 py-1.5 bg-foreground text-background rounded-md text-[12px] font-medium hover:opacity-90 disabled:opacity-40 transition-opacity"
          >
            {saving ? 'Adding…' : 'Add member'}
          </button>
        </div>
      </div>
    </div>
  );
}
