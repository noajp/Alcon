'use client';

import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SPACE_IDS_QUERY_KEY } from '@/hooks/domainData';
import { notifyDomainsChanged } from '@/Function/space/domainsStore';
import { invalidateWorkersCache } from '@/hooks/teamData';
import { translate } from '@/Function/i18n/I18nProvider';
import { getQueryClient } from '@/lib/queryClient';
import { supabase } from '@/lib/supabase';
import { useCurrentUserId } from '@/providers/authContext';
import type { InvitationRole, InvitationScope, InvitationStatus, MembershipInvitation } from '@/types/database';

// Membership takes effect when the invited person accepts (ADR 0029). An
// invitation is its own row; the membership tables only ever hold people who
// joined. Every write goes through an RPC: invite_member (someone who manages
// the scope), respond_to_invite (only the invitee), cancel_invite (the
// inviter or a manager). Pending invitations never feed pickers or Workers.

const INVITATIONS_QUERY_KEY = ['membership-invitations'] as const;

export interface InvitationScopeRef {
  scope: InvitationScope;
  scopeId: string;
}

/** Which Space, Domain or Object an invitation is to. */
export function invitationScope(invitation: Pick<MembershipInvitation, 'activity_space_id' | 'domain_id' | 'object_id'>): InvitationScopeRef {
  if (invitation.activity_space_id) return { scope: 'space', scopeId: invitation.activity_space_id };
  if (invitation.domain_id) return { scope: 'domain', scopeId: invitation.domain_id };
  return { scope: 'object', scopeId: invitation.object_id ?? '' };
}

/** The concept name for a scope. Concept names stay in English in every locale. */
export const SCOPE_LABEL: Record<InvitationScope, string> = { space: 'Space', domain: 'Domain', object: 'Object' };

function scopeColumn(scope: InvitationScope): 'activity_space_id' | 'domain_id' | 'object_id' {
  return scope === 'space' ? 'activity_space_id' : scope === 'domain' ? 'domain_id' : 'object_id';
}

/** The RPCs' refusals, in the viewer's language. */
function invitationErrorMessage(error: unknown): string {
  const e = error as { code?: string; message?: string; hint?: string } | null;
  const message = e?.message ?? '';
  if (/viewer_reaches_through_space/.test(e?.hint ?? '')) {
    return translate('This person already works in this Domain through its Space. Invite them as a member, or change their role in the member list.');
  }
  if (e?.code === '42501') return translate('Only people who manage this can invite to it or cancel an invitation.');
  if (e?.code === '23505') {
    return translate(/pending/i.test(message)
      ? 'This person already has a pending invitation.'
      : 'This person is already a member.');
  }
  if (e?.code === 'P0002') return translate('This invitation no longer exists.');
  if (/declined/i.test(message)) return translate('This person declined an invitation here in the last 7 days. You can invite them again after that.');
  if (/yourself/i.test(message)) return translate('You cannot invite yourself.');
  return translate('The invitation could not be sent. Try again.');
}

function invalidateInvitations(): void {
  void getQueryClient().invalidateQueries({ queryKey: INVITATIONS_QUERY_KEY });
}

/** Joining changes what the viewer can see: Spaces, Domains, memberships,
 *  and the Workers they can be assigned among. */
function afterJoining(): void {
  const qc = getQueryClient();
  invalidateWorkersCache();
  for (const queryKey of [SPACE_IDS_QUERY_KEY, ['spaces'], ['my-object-memberships'], ['my-domain-roles'], ['my-domain-memberships']]) {
    void qc.invalidateQueries({ queryKey });
  }
  notifyDomainsChanged();
}

/** Invite someone to a Space, Domain or Object. A Domain invitation may make
 *  them a viewer, who reads everything in it and changes nothing. */
export async function inviteMember(scope: InvitationScope, scopeId: string, userId: string, role: InvitationRole = 'member'): Promise<string> {
  const args = { p_scope: scope, p_scope_id: scopeId, p_user: userId, ...(role === 'viewer' ? { p_role: role } : {}) };
  const { data, error } = await supabase.rpc('invite_member', args);
  if (error) throw new Error(invitationErrorMessage(error));
  invalidateInvitations();
  return data as string;
}

/** Accept or decline. Returns the invitation's resulting status — 'canceled'
 *  when it lapsed because the inviter no longer manages the scope. */
export async function respondToInvite(invitationId: string, accept: boolean): Promise<InvitationStatus> {
  const { data, error } = await supabase.rpc('respond_to_invite', { p_invitation: invitationId, p_accept: accept });
  if (error) throw new Error(invitationErrorMessage(error));
  const status = data as InvitationStatus;
  invalidateInvitations();
  if (status === 'accepted') afterJoining();
  return status;
}

export async function cancelInvite(invitationId: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_invite', { p_invitation: invitationId });
  if (error) throw new Error(invitationErrorMessage(error));
  invalidateInvitations();
}

const EMPTY_INVITATIONS: MembershipInvitation[] = [];

/** The viewer's own pending invitations. */
export function useMyInvitations() {
  const userId = useCurrentUserId();
  const query = useQuery({
    queryKey: [...INVITATIONS_QUERY_KEY, 'mine', userId],
    enabled: !!userId,
    queryFn: async (): Promise<MembershipInvitation[]> => {
      const { data, error } = await supabase
        .from('membership_invitations')
        .select('*')
        .eq('invitee_id', userId!)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as MembershipInvitation[];
    },
  });
  return { invitations: query.data ?? EMPTY_INVITATIONS, loading: !!userId && query.isPending, error: (query.error as Error | null) ?? null };
}

/** One invitation, whatever its status — the Inbox shows how it was resolved. */
export function useInvitation(invitationId: string | null | undefined) {
  const query = useQuery({
    queryKey: [...INVITATIONS_QUERY_KEY, 'one', invitationId],
    enabled: !!invitationId,
    queryFn: async (): Promise<MembershipInvitation | null> => {
      const { data, error } = await supabase.from('membership_invitations').select('*').eq('id', invitationId!).maybeSingle();
      if (error) throw error;
      return (data as MembershipInvitation | null) ?? null;
    },
  });
  return { invitation: query.data ?? null, loading: !!invitationId && query.isPending };
}

export interface PendingInvitee {
  invitationId: string;
  userId: string;
  invitedBy: string | null;
  role: InvitationRole;
  name: string | null;
  avatarUrl: string | null;
}

const EMPTY_INVITEES: PendingInvitee[] = [];

/** Pending invitations to one Space / Domain / Object, for its member list.
 *  Visible to the scope's members and the people who manage it. */
export function useScopeInvitations(scope: InvitationScope, scopeId: string | null | undefined) {
  const query = useQuery({
    queryKey: [...INVITATIONS_QUERY_KEY, scope, scopeId],
    enabled: !!scopeId,
    queryFn: async (): Promise<PendingInvitee[]> => {
      const { data, error } = await supabase
        .from('membership_invitations')
        .select('id, invitee_id, invited_by, role')
        .eq(scopeColumn(scope), scopeId!)
        .eq('status', 'pending')
        .order('created_at');
      if (error) throw error;
      const rows = (data ?? []) as { id: string; invitee_id: string; invited_by: string | null; role: InvitationRole | null }[];
      if (rows.length === 0) return [];
      const { data: profiles, error: profileError } = await supabase
        .from('profiles')
        .select('id, display_name, avatar_url')
        .in('id', rows.map((r) => r.invitee_id));
      if (profileError) throw profileError;
      const byId = new Map((profiles ?? []).map((p) => [p.id as string, p as { display_name: string | null; avatar_url: string | null }]));
      return rows.map((r) => ({
        invitationId: r.id,
        userId: r.invitee_id,
        invitedBy: r.invited_by,
        role: r.role === 'viewer' ? 'viewer' : 'member',
        name: byId.get(r.invitee_id)?.display_name ?? null,
        avatarUrl: byId.get(r.invitee_id)?.avatar_url ?? null,
      }));
    },
  });
  return { invitees: query.data ?? EMPTY_INVITEES, refetch: query.refetch };
}

/** Re-read a member list when one of its pending invitations is answered or
 *  canceled — the same realtime change that clears the "Invited" row, so an
 *  accepted invitee appears as a member without reopening the list. */
export function useWhenInvitationsSettle(invitees: PendingInvitee[], onSettled: () => void) {
  const previous = useRef<ReadonlySet<string> | null>(null);
  const callback = useRef(onSettled);
  useEffect(() => { callback.current = onSettled; });
  useEffect(() => {
    const ids = new Set(invitees.map((i) => i.invitationId));
    const before = previous.current;
    previous.current = ids;
    if (before && [...before].some((id) => !ids.has(id))) callback.current();
  }, [invitees]);
}
