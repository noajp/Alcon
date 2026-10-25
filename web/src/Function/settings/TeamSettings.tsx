'use client';

import { appDialog } from '@/Function/shared/appDialogStore';

import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Plus, Trash2, UserPlus, X } from 'lucide-react';
import { isCommitEnter, useEscapeLayer } from '@/Function/shared/keyboard';
import { supabase } from '@/lib/supabase';
import { useAuthContext } from '@/providers/AuthProvider';
import { useActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { createWorker, deleteWorker, updateWorker } from '@/hooks/useSupabase';
import type { DomainMemberRole, Worker } from '@/types/database';
import { setDomainMemberRole } from '@/hooks/useDomainMembers';
import { Button } from '@/ui/button';
import { ReachHint, WorkerAvatar } from '@/Function/shared/WorkerAvatar';
import { isUnreachableWorker } from '@/Function/shared/workerReach';
import { SettingsSection } from './SettingsSection';
import { InviteUserDialog } from './InviteUserDialog';
import { ConnectWorkerAccountDialog } from './ConnectWorkerAccountDialog';
import { useScopeInvitations, useWhenInvitationsSettle } from '@/Function/membership/invitations';
import { PendingInviteRows } from '@/Function/membership/PendingInviteRows';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { FONT } from '@/shared/designTokens';

interface TeamSettingsProps {
  /** Optional Domain scope — when provided, the Humans list is filtered to
   *  members of this Domain (via `domain_members.user_id`). AI agents are
   *  always shown regardless of membership. Omit for the global view. */
  domainId?: string;
}

export function TeamSettings({ domainId }: TeamSettingsProps = {}) {
  const { user } = useAuthContext();
  const { t } = useI18n();
  const activeSpaceId = useActiveSpaceId();
  const [workers, setWorkers] = useState<Worker[]>([]);
  // The Space a Worker added here belongs to: the Domain's, else the active one.
  const [workerSpaceId, setWorkerSpaceId] = useState<string | null>(null);
  const [memberUserIds, setMemberUserIds] = useState<Set<string>>(new Set());
  const [memberRoles, setMemberRoles] = useState<Map<string, DomainMemberRole>>(new Map());
  // Viewers are not assignable, so they are not among the Workers above; they
  // are listed from their membership rows.
  const [viewers, setViewers] = useState<{ userId: string; name: string | null; avatarUrl: string | null }[]>([]);
  const [roleBusy, setRoleBusy] = useState<string | null>(null);
  const [myRole, setMyRole] = useState<DomainMemberRole | null>(null);
  const [isSpaceOwner, setIsSpaceOwner] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [connecting, setConnecting] = useState<Worker | null>(null);
  // Invited to this Domain but not yet accepted: listed, not a Worker here.
  const { invitees, refetch: refetchInvitees } = useScopeInvitations('domain', domainId);

  // The database decides who may change a Worker (workers RLS, ADR 0028);
  // these flags only hide controls it would refuse. An owner of a person's
  // Space or Domain may change only their capacity and status.
  const isOwner = domainId ? myRole === 'owner' : false;
  const isAnyOwner = isOwner || isSpaceOwner;
  // set_domain_member_role: owners and admins change roles; only an owner
  // touches an owner's.
  const canManageRoles = domainId ? myRole === 'owner' || myRole === 'admin' : false;
  const canChangeRoleOf = (userId: string) =>
    canManageRoles && userId !== user?.id && (memberRoles.get(userId) !== 'owner' || isOwner);
  // Connecting redirects a Worker's assignments and notifications to an
  // account. Only a human Object Worker can be connected, by an owner, to
  // someone in its Space: every account already has its own human Worker, so
  // a Space's unlinked roster Worker could never take one.
  const canConnect = (w: Worker) => isAnyOwner && w.type === 'human' && w.user_id === null && w.object_id !== null;
  // Inviting and adding Workers are owner actions in a Domain. The global
  // view is the Space-wide roster, where any member may add an unlinked one.
  const canManage = domainId ? isOwner : true;
  // Your own Worker and the Space's unlinked Workers are yours to (de)activate
  // as a member; someone else's Worker needs an owner of their Space or Domain.
  const canToggle = (w: Worker) => canManage && (w.user_id === null || w.user_id === user?.id || isAnyOwner);
  // Only an unlinked Worker is removed, by an owner of its Space. A person's
  // Worker stays so the work they did keeps their name; they leave by losing
  // their membership, and are deactivated here.
  const canRemove = (w: Worker) => isSpaceOwner && w.user_id === null && w.object_id === null
    && w.activity_space_id !== null && w.activity_space_id === workerSpaceId;

  const reload = async () => {
    setLoading(true);
    try {
      // The Workers of the active Space (a Domain's own Space when scoped to
      // one) — the same list the assignee pickers offer.
      const [{ data: workersData, error: workersErr }, memberRowsResult, domainResult] = await Promise.all([
        supabase.rpc('list_assignable_workers', { p_space_id: activeSpaceId, p_domain_id: domainId ?? null, p_include_inactive: true }),
        domainId
          ? supabase.from('domain_members').select('user_id, role').eq('domain_id', domainId)
          : Promise.resolve({ data: null, error: null } as const),
        domainId
          ? supabase.from('domains').select('activity_space_id').eq('id', domainId).maybeSingle()
          : Promise.resolve({ data: null, error: null } as const),
      ]);
      if (workersErr) throw workersErr;
      if (memberRowsResult.error) throw memberRowsResult.error;
      const memberRows = (memberRowsResult.data ?? []) as { user_id: string; role: DomainMemberRole }[];
      const viewerIds = memberRows.filter((r) => r.role === 'viewer').map((r) => r.user_id);
      const { data: viewerProfiles, error: viewerProfilesErr } = viewerIds.length > 0
        ? await supabase.from('profiles').select('id, display_name, avatar_url').in('id', viewerIds)
        : { data: [], error: null };
      if (viewerProfilesErr) throw viewerProfilesErr;
      const profileById = new Map(((viewerProfiles ?? []) as { id: string; display_name: string | null; avatar_url: string | null }[]).map((p) => [p.id, p]));
      const spaceId = (domainResult.data as { activity_space_id: string | null } | null)?.activity_space_id ?? activeSpaceId;
      const { data: spaceRole, error: spaceRoleErr } = spaceId && user?.id
        ? await supabase.from('activity_space_members').select('role')
          .eq('activity_space_id', spaceId).eq('user_id', user.id).maybeSingle()
        : { data: null, error: null };
      if (spaceRoleErr) throw spaceRoleErr;
      setWorkers((workersData ?? []) as Worker[]);
      setWorkerSpaceId(spaceId);
      setIsSpaceOwner((spaceRole as { role: string } | null)?.role === 'owner');
      setMemberUserIds(new Set(memberRows.map((r) => r.user_id)));
      setMemberRoles(new Map(memberRows.map((r) => [r.user_id, r.role])));
      setViewers(viewerIds.map((id) => ({ userId: id, name: profileById.get(id)?.display_name ?? null, avatarUrl: profileById.get(id)?.avatar_url ?? null })));
      setMyRole(memberRows.find((r) => r.user_id === user?.id)?.role ?? null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('Failed to load team'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domainId, user?.id, activeSpaceId]);
  useWhenInvitationsSettle(invitees, () => void reload());

  const handleDelete = async (id: string) => {
    if (!await appDialog.confirm(t('Remove this team member? Their assignments will be cleared.'))) return;
    try {
      await deleteWorker(id);
      setWorkers((prev) => prev.filter((w) => w.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('Failed to remove member'));
    }
  };

  const handleRoleChange = async (userId: string, role: DomainMemberRole) => {
    if (!domainId) return;
    setRoleBusy(userId);
    try {
      await setDomainMemberRole(domainId, userId, role);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('Failed to change role'));
    } finally {
      setRoleBusy(null);
    }
  };

  const handleStatusToggle = async (w: Worker) => {
    const next: Worker['status'] = w.status === 'active' ? 'inactive' : 'active';
    try {
      const updated = await updateWorker(w.id, { status: next });
      setWorkers((prev) => prev.map((x) => (x.id === w.id ? updated : x)));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('Failed to update status'));
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
          <h2 className={`${FONT.lg} text-foreground`}>{t('Team')}</h2>
          <p className="text-[12px] text-muted-foreground mt-0.5">
            {t('Workers (human or AI) that can be assigned to Elements.')}
          </p>
        </div>
        {canManage && <div className="flex shrink-0 items-center gap-2 whitespace-nowrap">
          {domainId && (
            <Button variant="ghost" onClick={() => setShowInvite(true)}>
              <UserPlus size={12} />
              {t('Invite')}
            </Button>
          )}
          <Button variant="ghost" onClick={() => setShowAdd(true)}>
            <Plus size={12} />
            {t('Add')}
          </Button>
        </div>}
      </div>

      {error && (
        <div className="mb-3 text-[12px] text-[var(--status-danger)]">
          {error}
        </div>
      )}

      <SettingsSection title={t('Humans ({n})', { n: humans.length })}>
        {loading && humans.length === 0 ? (
          <div className="py-3 text-[13px] text-muted-foreground">{t('Loading…')}</div>
        ) : humans.length === 0 ? (
          <div className="py-3 text-[13px] text-muted-foreground">{t('No human members yet.')}</div>
        ) : (
          humans.map((w) => (
            <WorkerRow
              key={w.id}
              worker={w}
              onDelete={canRemove(w) ? () => handleDelete(w.id) : undefined}
              onToggleStatus={canToggle(w) ? () => handleStatusToggle(w) : undefined}
              onConnect={canConnect(w) ? () => setConnecting(w) : undefined}
              roleAction={w.user_id && canChangeRoleOf(w.user_id) ? {
                label: t('Make viewer'),
                busy: roleBusy === w.user_id,
                run: () => void handleRoleChange(w.user_id!, 'viewer'),
              } : undefined}
            />
          ))
        )}
        {domainId && (
          <PendingInviteRows invitees={invitees} canCancel={(i) => isOwner || i.invitedBy === user?.id} onChanged={() => void refetchInvitees()} />
        )}
      </SettingsSection>

      {domainId && viewers.length > 0 && (
        <SettingsSection title={t('Viewers ({n})', { n: viewers.length })}>
          {viewers.map((v) => (
            <div key={v.userId} className="-mx-2 flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-muted/40">
              <WorkerAvatar worker={{ name: v.name, avatar_url: v.avatarUrl }} size={32} className="shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium text-foreground truncate">{v.name || t('Unnamed')}</div>
                <div className="text-[11px] text-muted-foreground">{t('View only')}</div>
              </div>
              {canChangeRoleOf(v.userId) && (
                <Button type="button" variant="ghost" size="xs" disabled={roleBusy === v.userId}
                  onClick={() => void handleRoleChange(v.userId, 'member')}>
                  {t('Make member')}
                </Button>
              )}
            </div>
          ))}
        </SettingsSection>
      )}

      <SettingsSection title={t('AI agents ({n})', { n: agents.length })}>
        {agents.length === 0 ? (
          <div className="py-3 text-[13px] text-muted-foreground">{t('No AI agents yet.')}</div>
        ) : (
          agents.map((w) => (
            <WorkerRow
              key={w.id}
              worker={w}
              onDelete={canRemove(w) ? () => handleDelete(w.id) : undefined}
              onToggleStatus={canToggle(w) ? () => handleStatusToggle(w) : undefined}
            />
          ))
        )}
      </SettingsSection>

      {showAdd && (
        <AddMemberDialog
          spaceId={workerSpaceId}
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
          pendingInviteeIds={new Set(invitees.map((i) => i.userId))}
          onClose={() => setShowInvite(false)}
          onInvited={() => {
            setShowInvite(false);
            void refetchInvitees();
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
  roleAction,
}: {
  worker: Worker;
  /** Change this person's role in the Domain, for its owners and admins. */
  roleAction?: { label: string; busy: boolean; run: () => void };
  /** Omitted when the viewer may not remove / (de)activate this Worker. */
  onDelete?: () => void;
  onToggleStatus?: () => void;
  /** Omitted for AI agents — isUnreachableWorker is never true for them, so
   *  the button below never renders regardless, but the row itself is human-
   *  only about "no account". */
  onConnect?: () => void;
}) {
  const { t } = useI18n();
  const isAi = worker.type !== 'human';
  return (
    <div className="-mx-2 flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-muted/40">
      <WorkerAvatar worker={worker} size={32} className="shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[13px] font-medium text-foreground truncate">{worker.name}</span>
          {worker.status === 'inactive' && (
            <span className="text-[11px] text-muted-foreground">
              {t('Inactive')}
            </span>
          )}
          <ReachHint worker={worker} />
        </div>
        <div className="text-[11px] text-muted-foreground truncate">
          {[worker.role, worker.email].filter(Boolean).join(' · ') || (isAi ? worker.ai_model || t('Agent') : t('No role'))}
        </div>
      </div>
      {onConnect && isUnreachableWorker(worker) && (
        <Button type="button" variant="ghost" size="xs" onClick={onConnect}
          title={t('Connect this Worker to an account so assignments and notifications reach them')}>
          {t('Connect')}
        </Button>
      )}
      {roleAction && (
        <Button type="button" variant="ghost" size="xs" disabled={roleAction.busy} onClick={roleAction.run}>
          {roleAction.label}
        </Button>
      )}
      {onToggleStatus && <button
        onClick={onToggleStatus}
        className="px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent rounded transition-colors"
        title={worker.status === 'active' ? t('Deactivate') : t('Reactivate')}
      >
        {worker.status === 'active' ? t('Deactivate') : t('Activate')}
      </button>}
      {onDelete && <button
        onClick={onDelete}
        className="p-1.5 text-muted-foreground hover:text-[var(--status-danger)] hover:bg-[var(--status-danger-subtle)] dark:hover:bg-[var(--status-danger)]/20 rounded transition-colors"
        title={t('Remove')}
        aria-label={t('Remove')}
      >
        <Trash2 size={13} />
      </button>}
    </div>
  );
}

function AddMemberDialog({
  spaceId,
  onClose,
  onCreated,
}: {
  /** The Space the new Worker belongs to. */
  spaceId: string | null;
  onClose: () => void;
  onCreated: (worker: Worker) => void;
}) {
  const { t } = useI18n();
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
        activity_space_id: spaceId,
        role: role.trim() || null,
        email: type === 'human' ? email.trim() || null : null,
        ai_model: type === 'ai_agent' ? aiModel.trim() || null : null,
      });
      onCreated(created);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('Failed to add member'));
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
          <h3 className="text-[14px] font-semibold text-foreground">{t('Add team member')}</h3>
          <button
            onClick={onClose}
            aria-label={t('Close')}
            className="p-1 text-muted-foreground hover:text-foreground hover:bg-accent rounded transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-[12px] font-medium text-foreground mb-1.5">{t('Type')}</label>
            <div className="flex gap-2" role="tablist">
              <Button shape="tab" role="tab" aria-selected={type === 'human'} variant={type === 'human' ? 'secondary' : 'ghost'}
                className="flex-1 justify-center" onClick={() => setType('human')}>
                {t('Human')}
              </Button>
              <Button shape="tab" role="tab" aria-selected={type === 'ai_agent'} variant={type === 'ai_agent' ? 'secondary' : 'ghost'}
                className="flex-1 justify-center" onClick={() => setType('ai_agent')}>
                {t('AI agent')}
              </Button>
            </div>
          </div>

          <div>
            <label className="block text-[12px] font-medium text-foreground mb-1.5">{t('Name')}</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={type === 'human' ? t('e.g. Alex Chen') : t('e.g. Codex')}
              onKeyDown={submitOnEnter}
              autoFocus
              className="w-full px-3 py-2 bg-background border border-border rounded-md text-[13px] text-foreground placeholder:text-muted-foreground outline-none focus:bg-muted/40 transition-colors"
            />
          </div>

          <div>
            <label className="block text-[12px] font-medium text-foreground mb-1.5">{t('Role')}</label>
            <input
              type="text"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder={type === 'human' ? t('e.g. Frontend Engineer') : t('e.g. Code reviewer')}
              onKeyDown={submitOnEnter}
              className="w-full px-3 py-2 bg-background border border-border rounded-md text-[13px] text-foreground placeholder:text-muted-foreground outline-none focus:bg-muted/40 transition-colors"
            />
          </div>

          {type === 'human' ? (
            <div>
              <label className="block text-[12px] font-medium text-foreground mb-1.5">
                {t('Email')} <span className="text-muted-foreground font-normal">{t('(optional)')}</span>
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="alex@example.com"
                onKeyDown={submitOnEnter}
                className="w-full px-3 py-2 bg-background border border-border rounded-md text-[13px] text-foreground placeholder:text-muted-foreground outline-none focus:bg-muted/40 transition-colors"
              />
            </div>
          ) : (
            <div>
              <label className="block text-[12px] font-medium text-foreground mb-1.5">{t('AI model')}</label>
              <input
                type="text"
                value={aiModel}
                onChange={(e) => setAiModel(e.target.value)}
                placeholder="claude-opus-4-7"
                onKeyDown={submitOnEnter}
                className="w-full px-3 py-2 bg-background border border-border rounded-md text-[13px] text-foreground placeholder:text-muted-foreground outline-none focus:bg-muted/40 transition-colors"
              />
            </div>
          )}

          {error && (
            <p className="text-[12px] text-[var(--status-danger)]">{error}</p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border">
          <Button variant="ghost" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button variant="primary" onClick={handleSave} disabled={!name.trim() || saving}>
            {saving ? t('Adding…') : t('Add member')}
          </Button>
        </div>
      </div>
    </div>
  );
}
