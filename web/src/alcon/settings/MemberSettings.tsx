'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuthContext } from '@/providers/AuthProvider';
import { useActivitySpaces } from '@/hooks/useSupabase';
import { getActiveSpaceId } from '@/alcon/space/activeSpaceStore';
import { WorkerAvatar } from '@/alcon/shared/WorkerAvatar';
import { Button } from '@/ui/button';
import { SettingsSection } from './SettingsSection';

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

interface DomainRow {
  id: string;
  name: string;
}

interface GuestRow {
  user_id: string;
  domain_id: string;
  domain_name: string;
  domain_role: string;
}

interface Profile {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
}

export function MemberSettings() {
  const { user } = useAuthContext();
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

  const reload = useCallback(async () => {
    if (!active) return;
    setLoading(true);
    try {
      const [{ data: memberRows, error: memberErr }, { data: domainRows, error: domainErr }] = await Promise.all([
        supabase.from('activity_space_members').select('user_id, role').eq('activity_space_id', active.id),
        supabase.from('domains').select('id, name').eq('activity_space_id', active.id),
      ]);
      if (memberErr) throw memberErr;
      if (domainErr) throw domainErr;

      const memberList = (memberRows ?? []) as SpaceMemberRow[];
      const memberIds = new Set(memberList.map((m) => m.user_id));
      const domainList = (domainRows ?? []) as DomainRow[];
      const domainIds = domainList.map((d) => d.id);
      const domainNameById = new Map(domainList.map((d) => [d.id, d.name]));

      let guestRows: GuestRow[] = [];
      if (domainIds.length > 0) {
        const { data: dmRows, error: dmErr } = await supabase
          .from('domain_members')
          .select('user_id, domain_id, role')
          .in('domain_id', domainIds);
        if (dmErr) throw dmErr;
        guestRows = ((dmRows ?? []) as { user_id: string; domain_id: string; role: string }[])
          // A Guest is a domain_member who never joined the Space itself —
          // the same rule useDomains() uses for "Shared with me", applied
          // per-Domain instead of per-Domain-list.
          .filter((r) => !memberIds.has(r.user_id))
          .map((r) => ({
            user_id: r.user_id,
            domain_id: r.domain_id,
            domain_name: domainNameById.get(r.domain_id) ?? 'Unknown Domain',
            domain_role: r.role,
          }));
      }

      const allIds = [...new Set([...memberList.map((m) => m.user_id), ...guestRows.map((g) => g.user_id)])];
      const { data: profRows } = allIds.length
        ? await supabase.from('profiles').select('id, display_name, avatar_url').in('id', allIds)
        : { data: [] as Profile[] };

      setProfiles(new Map((profRows ?? []).map((p) => [p.id, p as Profile])));
      setMembers(memberList);
      setGuests(guestRows);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load members');
    } finally {
      setLoading(false);
    }
  }, [active]);

  useEffect(() => {
    void reload();
  }, [reload]);

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

  const handleRoleChange = async (member: SpaceMemberRow, nextRole: SpaceRole) => {
    if (!active || pendingUserId) return;
    if (member.role === 'owner' && nextRole === 'member' && ownerCount <= 1) {
      setRowErrors((prev) => ({ ...prev, [member.user_id]: 'A Space needs at least one owner' }));
      return;
    }
    if (member.role === 'owner' && nextRole === 'member') {
      const target = profileFor(member.user_id)?.display_name || 'this member';
      if (!window.confirm(`Change ${target} from Owner to Member?`)) return;
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
      const { error } = await supabase
        .from('activity_space_members')
        .update({ role: nextRole })
        .eq('activity_space_id', active.id)
        .eq('user_id', member.user_id);
      if (error) throw error;
    } catch (e) {
      // Roll back — a failed save must not keep the optimistic "saved" state.
      setMembers((list) => list.map((m) => (m.user_id === member.user_id ? { ...m, role: prevRole } : m)));
      setRowErrors((prev) => ({
        ...prev,
        [member.user_id]: e instanceof Error ? e.message : 'Failed to update role',
      }));
    } finally {
      setPendingUserId(null);
    }
  };

  if (!active) return null;

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-[15px] font-semibold text-foreground">Space members ({members.length})</h2>
        <p className="text-[12px] text-muted-foreground mt-0.5">
          Everyone with access to &quot;{active.name}&quot; — its Space members, and every Guest invited into one of
          its Domains without joining the Space itself. Invites and removals stay on Activity space and Domain
          settings; this is the cross-Domain view and the place to change a Space member&apos;s role.
        </p>
      </div>

      {loadError && (
        <div className="mb-4 px-3 py-2 rounded-md bg-destructive/10 text-[12px] text-destructive">{loadError}</div>
      )}

      <SettingsSection title="">
        {loading && members.length === 0 ? (
          <div className="px-4 py-6 text-[12px] text-muted-foreground">Loading…</div>
        ) : sortedMembers.length === 0 ? (
          <div className="px-4 py-6 text-[12px] text-muted-foreground">No Space members yet.</div>
        ) : (
          sortedMembers.map((m) => {
            const profile = profileFor(m.user_id);
            const isSelf = m.user_id === user?.id;
            const isPending = pendingUserId === m.user_id;
            const isLastOwner = m.role === 'owner' && ownerCount <= 1;
            return (
              <div key={m.user_id} className="px-4 py-2.5">
                <div className="flex items-center gap-3">
                  <WorkerAvatar
                    worker={{ name: profile?.display_name, avatar_url: profile?.avatar_url }}
                    size={32}
                    className="ring-border/70"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium text-foreground truncate">
                      {profile?.display_name || 'Unnamed'}
                      {isSelf && <span className="ml-1.5 text-[11px] text-muted-foreground">(you)</span>}
                    </div>
                    <div className="text-[11px] text-muted-foreground capitalize">{m.role}</div>
                  </div>
                  {isOwner && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      disabled={isPending || isLastOwner}
                      title={isLastOwner ? 'A Space needs at least one owner' : undefined}
                      onClick={() => handleRoleChange(m, m.role === 'owner' ? 'member' : 'owner')}
                    >
                      {isPending ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : m.role === 'owner' ? (
                        'Make member'
                      ) : (
                        'Make owner'
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
      </SettingsSection>

      <div className="mb-2 mt-8">
        <h2 className="text-[15px] font-semibold text-foreground">Guests ({guests.length})</h2>
        <p className="text-[12px] text-muted-foreground mt-0.5">
          Invited into a single Domain, not the Space — they see only the Domain that invited them.
        </p>
      </div>

      <SettingsSection title="">
        {loading && guests.length === 0 && members.length === 0 ? (
          <div className="px-4 py-6 text-[12px] text-muted-foreground">Loading…</div>
        ) : sortedGuests.length === 0 ? (
          <div className="px-4 py-6 text-[12px] text-muted-foreground">No Guests in this Space&apos;s Domains.</div>
        ) : (
          sortedGuests.map((g) => {
            const profile = profileFor(g.user_id);
            return (
              <div key={`${g.domain_id}-${g.user_id}`} className="flex items-center gap-3 px-4 py-2.5">
                <WorkerAvatar
                  worker={{ name: profile?.display_name, avatar_url: profile?.avatar_url }}
                  size={32}
                  className="ring-border/70"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium text-foreground truncate">
                    {profile?.display_name || 'Unnamed'}
                  </div>
                  <div className="text-[11px] text-muted-foreground truncate capitalize">
                    Guest of {g.domain_name} · {g.domain_role}
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
