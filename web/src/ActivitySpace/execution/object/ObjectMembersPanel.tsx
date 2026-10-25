'use client';

import { appDialog } from '@/Function/shared/appDialogStore';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { UserMinus, UserPlus, X } from 'lucide-react';
import { fetchObjectMemberAccess, removeObjectMember, type ObjectMemberCandidate, type ObjectMemberRow } from '@/hooks/objectData';
import { useAuthContext } from '@/providers/AuthProvider';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { FONT } from '@/shared/designTokens';
import { inviteMember, useScopeInvitations, useWhenInvitationsSettle } from '@/Function/membership/invitations';
import { PendingInviteRows } from '@/Function/membership/PendingInviteRows';
import { membershipErrorMessage } from '@/Function/membership/membershipErrors';
import { WorkerAvatar } from '@/Function/shared/WorkerAvatar';
import { useEscapeLayer } from '@/Function/shared/keyboard';
import { Button } from '@/ui/button';
import { useMyDomainRoles } from '@/hooks/useMyMemberships';

// "Who has access to this Object" panel — backs the Object-detail Members
// tab (rendered when tab_type === 'workers' so we don't need a schema/enum
// migration to introduce the tab type). Lists object_members + their worker
// info, lets the people who manage the Object's Domain invite its members who
// aren't here yet (they join when they accept, ADR 0029), and remove anyone
// except themselves.

type DomainCandidate = ObjectMemberCandidate & { name: string };

interface ObjectMembersPanelProps {
  objectId: string;
  domainId: string | null;
}

export function ObjectMembersPanel({ objectId, domainId }: ObjectMembersPanelProps) {
  const { user } = useAuthContext();
  const { t } = useI18n();
  const [members, setMembers] = useState<ObjectMemberRow[]>([]);
  const [domainCandidates, setCandidates] = useState<DomainCandidate[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  useEscapeLayer(showAdd, () => setShowAdd(false));
  const [loading, setLoading] = useState(true);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [invitingId, setInvitingId] = useState<string | null>(null);
  const { invitees, refetch: refetchInvitees } = useScopeInvitations('object', objectId);
  // Inviting to an Object is for the owners and admins of its Domain.
  const { data: myDomainRoles } = useMyDomainRoles(user?.id ?? null);
  const myDomainRole = domainId ? myDomainRoles?.get(domainId) : undefined;
  const managesObject = myDomainRole === 'owner' || myDomainRole === 'admin';
  // Already invited people wait for their answer instead of being offered again.
  const candidates = useMemo(() => {
    const invited = new Set(invitees.map((i) => i.userId));
    return domainCandidates.filter((c) => !invited.has(c.user_id));
  }, [domainCandidates, invitees]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const access = await fetchObjectMemberAccess(objectId, domainId);
      setMembers(access.members);
      setCandidates(access.candidates.map((c) => ({ ...c, name: c.name ?? t('Member') })));
    } finally {
      setLoading(false);
    }
  }, [objectId, domainId, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useWhenInvitationsSettle(invitees, () => void refresh());

  const handleInvite = async (userId: string) => {
    setInvitingId(userId);
    setInviteError(null);
    try {
      await inviteMember('object', objectId, userId);
      setShowAdd(false);
      await refetchInvitees();
    } catch (e) {
      setInviteError(e instanceof Error ? e.message : t('The invitation could not be sent. Try again.'));
    } finally {
      setInvitingId(null);
    }
  };

  const handleRemove = async (memberId: string) => {
    if (!await appDialog.confirm(t('Remove this member from the Object?'))) return;
    setInviteError(null);
    // A refused delete matches no rows; the last owner is refused outright
    // unless a manager of the Domain removes them (they then take it over).
    const { error, removed } = await removeObjectMember(memberId);
    if (error) setInviteError(membershipErrorMessage(error, t('The member could not be removed. Try again.')));
    else if (!removed) setInviteError(t('The member could not be removed. Try again.'));
    await refresh();
  };

  return (
    <div className="flex-1 overflow-auto bg-card p-6">
      <div className="max-w-2xl mx-auto">
        <div className="mb-4 flex items-end justify-between">
          <div>
            <h2 className={`${FONT.lg} text-foreground`}>
              {t('Members ({n})', { n: members.length })}
            </h2>
            <p className="text-[12px] text-muted-foreground">
              {t('People with access to this Object. Pulled from the Domain’s members.')}
            </p>
          </div>
          {managesObject && (
            <Button type="button" variant="secondary" onClick={() => { setInviteError(null); setShowAdd(true); }}>
              <UserPlus size={14} />{t('Invite')}
            </Button>
          )}
        </div>
        {inviteError && !showAdd && <p className="mb-3 text-[12px] text-[var(--status-danger)]">{inviteError}</p>}

        {loading ? (
          <div className="py-8 text-center text-xs text-muted-foreground">{t('Loading…')}</div>
        ) : (
          <div>
            {members.length === 0 ? (
              <p className="px-2 py-2 text-[13px] text-muted-foreground">
                {t('No members yet.')}
              </p>
            ) : (
              members.map((m) => (
                <div key={m.id} className="flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-muted/40">
                  <WorkerAvatar worker={m.worker ?? { name: t('Member') }} size={32} className="ring-border/70" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium text-foreground truncate">
                      {m.worker?.name ?? t('Member')}
                    </div>
                    <div className="text-[11px] text-muted-foreground">{m.role}</div>
                  </div>
                  {m.user_id !== user?.id && (
                    <button
                      type="button"
                      onClick={() => handleRemove(m.id)}
                      className="p-1.5 text-muted-foreground hover:text-[var(--status-danger)] hover:bg-[var(--status-danger-subtle)] dark:hover:bg-[var(--status-danger)]/20 rounded transition-colors"
                      title={t('Remove member')}
                      aria-label={t('Remove member')}
                    >
                      <UserMinus size={14} />
                    </button>
                  )}
                </div>
              ))
            )}
            <PendingInviteRows
              invitees={invitees}
              canCancel={(i) => managesObject || i.invitedBy === user?.id}
              onChanged={() => void refetchInvitees()}
            />
          </div>
        )}

        {showAdd && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-6"
            onClick={() => setShowAdd(false)}
          >
            <div
              className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-sm overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <h3 className="text-[14px] font-semibold">{t('Invite to Object')}</h3>
                <button
                  type="button"
                  onClick={() => setShowAdd(false)}
                  className="p-1 hover:bg-muted rounded transition-colors"
                  aria-label={t('Close')}
                >
                  <X size={14} />
                </button>
              </div>
              <p className="px-4 pt-3 text-[12px] text-muted-foreground">
                {t('They join when they accept the invitation in their Inbox.')}
              </p>
              {inviteError && <p className="px-4 pt-2 text-[12px] text-[var(--status-danger)]">{inviteError}</p>}
              <div className="mt-2 max-h-[320px] overflow-y-auto divide-y divide-border/40">
                {candidates.length === 0 ? (
                  <div className="p-6 text-center text-xs text-muted-foreground">
                    {t('Every Domain member is already in this Object or invited to it.')}
                  </div>
                ) : (
                  candidates.map((c) => (
                    <button
                      key={c.user_id}
                      type="button"
                      disabled={invitingId !== null}
                      onClick={() => void handleInvite(c.user_id)}
                      className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 disabled:opacity-50 text-left transition-colors"
                    >
                      <WorkerAvatar worker={c} size={32} className="ring-border/70" />
                      <span className="flex-1 text-[13px] font-medium text-foreground">{c.name}</span>
                      <span className="text-[12px] text-muted-foreground">
                        {t(invitingId === c.user_id ? 'Inviting…' : 'Invite')}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
