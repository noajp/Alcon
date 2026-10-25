'use client';

import { appDialog } from '@/Function/shared/appDialogStore';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuthContext } from '@/providers/AuthProvider';
import { useActivitySpaces, fetchSpaceGuests, type SpaceGuestRow } from '@/hooks/useSupabase';
import { getActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { WorkerAvatar } from '@/Function/shared/WorkerAvatar';
import { Button } from '@/ui/button';
import { SettingsSection } from './SettingsSection';
import { useScopeInvitations, useWhenInvitationsSettle } from '@/Function/membership/invitations';
import { PendingInviteRows } from '@/Function/membership/PendingInviteRows';
import { membershipErrorMessage } from '@/Function/membership/membershipErrors';
import { useI18n } from '@/Function/i18n/I18nProvider';

const ROLE_LABEL: Record<string, string> = { owner: 'Space owner', member: 'Member' };
const DOMAIN_ROLE_LABEL: Record<string, string> = { owner: 'Domain owner', admin: 'Domain admin', member: 'Member', viewer: 'Viewer' };

// Cross-boundary read of the current ActivitySpace: every Space member (role
// editable here) plus every Guest across the Space's Domains (a domain_member
// whose user_id never joined the Space itself). Invite / remove stay on
// ActivitySpaceSettings and TeamSettings — this surface only unions the two
// memberships for visibility and edits the one field neither of those touch:
// activity_space_members.role.

type SpaceRole = 'owner' | 'member';

interface SpaceMemberRow {
  user_id: string;
  role: string;
}

type GuestRow = SpaceGuestRow;

interface Profile {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
}

export function MemberSettings() {
  const { user } = useAuthContext();
  const { t } = useI18n();
  const { data: spaces } = useActivitySpaces();
  const [activeId] = useState(() => getActiveSpaceId() ?? '');
  const active = spaces.find((s) => s.id === activeId) ?? spaces[0];

  const [members, setMembers] = useState<SpaceMemberRow[]>([]);
  const [guests, setGuests] = useState<GuestRow[]>([]);
  const [profiles, setProfiles] = useState<Map<string, Profile>>(new Map());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  // Invited to the Space but not yet accepted: listed, never a member.
  const { invitees, refetch: refetchInvitees } = useScopeInvitations('space', active?.id);

  const reload = useCallback(async () => {
    if (!active) return;
    setLoading(true);
    try {
      const [{ data: memberRows, error: memberErr }, guestRows] = await Promise.all([
        supabase.from('activity_space_members').select('user_id, role').eq('activity_space_id', active.id),
        // Cross-Domain Guests via RPC, not a plain domain_members select: see
        // fetchSpaceGuests — domain_members' own RLS has no branch for
        // "workspace-privacy Domain + I'm a Space member", so a plain query
        // would silently miss every Domain the viewer hasn't personally
        // joined regardless of its privacy.
        fetchSpaceGuests(active.id),
      ]);
      if (memberErr) throw memberErr;

      const memberList = (memberRows ?? []) as SpaceMemberRow[];

      const allIds = [...new Set([...memberList.map((m) => m.user_id), ...guestRows.map((g) => g.user_id)])];
      const { data: profRows } = allIds.length
        ? await supabase.from('profiles').select('id, display_name, avatar_url').in('id', allIds)
        : { data: [] as Profile[] };

      setProfiles(new Map((profRows ?? []).map((p) => [p.id, p as Profile])));
      setMembers(memberList);
      setGuests(guestRows);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : t('Failed to load members'));
    } finally {
      setLoading(false);
    }
  }, [active, t]);

  useEffect(() => {
    void reload();
  }, [reload]);
  useWhenInvitationsSettle(invitees, () => void reload());

  const myRole = members.find((m) => m.user_id === user?.id)?.role ?? null;
  const isOwner = myRole === 'owner';
  const ownerCount = members.filter((m) => m.role === 'owner').length;

  const profileFor = useCallback(
    (userId: string) => profiles.get(userId) ?? null,
    [profiles],
  );

  const sortedMembers = useMemo(
    () =>
      [...members].sort((a, b) => {
        if (a.role !== b.role) return a.role === 'owner' ? -1 : 1;
        const an = profileFor(a.user_id)?.display_name ?? '';
        const bn = profileFor(b.user_id)?.display_name ?? '';
        return an.localeCompare(bn);
      }),
    [members, profileFor],
  );

  const sortedGuests = useMemo(
    () =>
      [...guests].sort((a, b) => {
        if (a.domain_name !== b.domain_name) return a.domain_name.localeCompare(b.domain_name);
        const an = profileFor(a.user_id)?.display_name ?? '';
        const bn = profileFor(b.user_id)?.display_name ?? '';
        return an.localeCompare(bn);
      }),
    [guests, profileFor],
  );
  // A person Guest-invited into two Domains of this Space yields two rows
  // (each worth showing — different Domain, possibly different role), but
  // the heading counts people, matching "Space members (n)" above it.
  const uniqueGuestCount = useMemo(() => new Set(guests.map((g) => g.user_id)).size, [guests]);

  const handleRoleChange = async (member: SpaceMemberRow, nextRole: SpaceRole) => {
    if (!active || pendingUserId) return;
    if (member.role === 'owner' && nextRole === 'member' && ownerCount <= 1) {
      setRowErrors((prev) => ({ ...prev, [member.user_id]: t('A Space needs at least one owner') }));
      return;
    }
    const isSelf = member.user_id === user?.id;
    if (member.role === 'owner' && nextRole === 'member') {
      const target = profileFor(member.user_id)?.display_name || t('this member');
      const question = isSelf
        ? t("Change your own role to Member? You'll lose owner access — invites, removals, role changes, and deleting this Space — immediately.")
        : t('Change {name} from Owner to Member?', { name: target });
      if (!await appDialog.confirm(question)) return;
    } else if (nextRole === 'owner') {
      const target = profileFor(member.user_id)?.display_name || t('this member');
      if (!await appDialog.confirm(t("Make {name} an Owner? They'll be able to invite, remove, and change the role of any Space member, and delete this Space.", { name: target }))) return;
    }

    setRowErrors((prev) => {
      if (!(member.user_id in prev)) return prev;
      const next = { ...prev };
      delete next[member.user_id];
      return next;
    });

    const prevRole = member.role;
    setPendingUserId(member.user_id);
    setMembers((list) => list.map((m) => (m.user_id === member.user_id ? { ...m, role: nextRole } : m)));

    try {
      const { data, error } = await supabase
        .from('activity_space_members')
        .update({ role: nextRole })
        .eq('activity_space_id', active.id)
        .eq('user_id', member.user_id)
        .select('user_id');
      if (error) throw error;
      // PostgREST returns 204/empty (not an error) when RLS admits zero
      // rows — e.g. the actor's own owner role was revoked elsewhere while
      // this panel was open. Without checking this, a no-op update reads as
      // success and the optimistic state never rolls back.
      if (!data || data.length === 0) {
        throw new Error(t("Couldn't update — you may no longer have owner access to this Space."));
      }
    } catch (e) {
      // Roll back — a failed save must not keep the optimistic "saved" state.
      setMembers((list) => list.map((m) => (m.user_id === member.user_id ? { ...m, role: prevRole } : m)));
      setRowErrors((prev) => ({
        ...prev,
        [member.user_id]: membershipErrorMessage(e, t('Failed to update role')),
      }));
    } finally {
      setPendingUserId(null);
    }
  };

  if (!active) return null;

  return (
    <div>
      {loadError && (
        <div className="mb-4 text-[12px] text-destructive">{loadError}</div>
      )}

      <SettingsSection
        title={t('Space members ({n})', { n: members.length })}
        description={t('Everyone in "{space}", plus Guests invited into one of its Domains (except private Domains you’re not in). Invite and remove people from Activity space and Domain settings; change a Space member’s role here.', { space: active.name })}
      >
        {loading && members.length === 0 ? (
          <div className="py-3 text-[13px] text-muted-foreground">{t('Loading…')}</div>
        ) : sortedMembers.length === 0 ? (
          <div className="py-3 text-[13px] text-muted-foreground">{t('No Space members yet.')}</div>
        ) : (
          sortedMembers.map((m) => {
            const profile = profileFor(m.user_id);
            const isSelf = m.user_id === user?.id;
            const isPending = pendingUserId === m.user_id;
            const isLastOwner = m.role === 'owner' && ownerCount <= 1;
            return (
              <div key={m.user_id} className="-mx-2 rounded-md px-2 py-2 transition-colors hover:bg-muted/40">
                <div className="flex items-center gap-3">
                  <WorkerAvatar
                    worker={{ name: profile?.display_name, avatar_url: profile?.avatar_url }}
                    size={32}
                    className="ring-border/70"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium text-foreground truncate">
                      {profile?.display_name || t('Unnamed')}
                      {isSelf && <span className="ml-1.5 text-[11px] text-muted-foreground">{t('(you)')}</span>}
                    </div>
                    <div className="text-[11px] text-muted-foreground">{t(ROLE_LABEL[m.role] ?? m.role)}</div>
                  </div>
                  {isOwner && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      disabled={isPending || isLastOwner}
                      title={isLastOwner ? t('A Space needs at least one owner') : undefined}
                      onClick={() => handleRoleChange(m, m.role === 'owner' ? 'member' : 'owner')}
                    >
                      {isPending ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : m.role === 'owner' ? (
                        t('Make member')
                      ) : (
                        t('Make owner')
                      )}
                    </Button>
                  )}
                </div>
                {rowErrors[m.user_id] && (
                  <div className="mt-1.5 ml-11 text-[11px] text-destructive">{rowErrors[m.user_id]}</div>
                )}
              </div>
            );
          })
        )}
        <PendingInviteRows invitees={invitees} canCancel={(i) => isOwner || i.invitedBy === user?.id} onChanged={() => void refetchInvitees()} />
      </SettingsSection>

      <SettingsSection
        title={t('Guests ({n})', { n: uniqueGuestCount })}
        description={t('Invited into a single Domain, not the Space — they see only the Domain that invited them.')}
      >
        {loading && guests.length === 0 && members.length === 0 ? (
          <div className="py-3 text-[13px] text-muted-foreground">{t('Loading…')}</div>
        ) : sortedGuests.length === 0 ? (
          <div className="py-3 text-[13px] text-muted-foreground">{t('No Guests in this Space’s Domains.')}</div>
        ) : (
          sortedGuests.map((g) => {
            const profile = profileFor(g.user_id);
            return (
              <div key={`${g.domain_id}-${g.user_id}`} className="-mx-2 flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-muted/40">
                <WorkerAvatar
                  worker={{ name: profile?.display_name, avatar_url: profile?.avatar_url }}
                  size={32}
                  className="ring-border/70"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium text-foreground truncate">
                    {profile?.display_name || t('Unnamed')}
                  </div>
                  <div className="text-[11px] text-muted-foreground truncate">
                    {t('Guest of {domain} · {role}', { domain: g.domain_name, role: t(DOMAIN_ROLE_LABEL[g.domain_role] ?? g.domain_role) })}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </SettingsSection>
    </div>
  );
}
