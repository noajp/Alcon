'use client';

import { getQueryClient } from '@/lib/queryClient';
import { supabase } from '@/lib/supabase';
import { translate } from '@/Function/i18n/I18nProvider';
import { useQuery } from '@tanstack/react-query';
import type { DomainMemberRole, Worker } from '@/types/database';

// A Domain member's role changes only through set_domain_member_role: its
// owners and admins may change it, only an owner grants or removes ownership,
// and the last owner stays an owner. A viewer reads everything in the Domain
// and changes nothing.

export async function setDomainMemberRole(domainId: string, userId: string, role: DomainMemberRole): Promise<DomainMemberRole> {
  const { data, error } = await supabase.rpc('set_domain_member_role', { p_domain: domainId, p_user: userId, p_role: role });
  if (error) {
    const message = error.code === '42501' || error.code === '23514' ? error.message : translate('The role could not be changed. Try again.');
    throw new Error(message);
  }
  const qc = getQueryClient();
  for (const queryKey of [['my-domain-roles'], ['domain-role']]) void qc.invalidateQueries({ queryKey });
  return data as DomainMemberRole;
}

// ── The Domain's members, read ────────────────────────────────
//
// Who is in a Domain: every membership row with the person behind it (their
// Worker, or their profile when they have none — a viewer is not a Worker),
// and the AI Workers the Domain can assign. Someone outside the Domain reads
// no membership rows (RLS) and sees an empty list.

export interface DomainMemberRow {
  /** The account for a person; the Worker id for an AI. */
  id: string;
  userId: string | null;
  name: string;
  email: string | null;
  avatarUrl: string | null;
  kind: 'human' | 'ai';
  role: DomainMemberRole | null;
  worker: Worker | null;
}

async function fetchDomainMembers(domainId: string): Promise<DomainMemberRow[]> {
  const [members, domain] = await Promise.all([
    supabase.from('domain_members').select('user_id, role').eq('domain_id', domainId),
    supabase.from('domains').select('activity_space_id').eq('id', domainId).maybeSingle(),
  ]);
  if (members.error) throw new Error(members.error.message);
  const rows = (members.data ?? []) as { user_id: string; role: DomainMemberRole }[];
  const userIds = rows.map((r) => r.user_id);
  const [workers, profiles, assignable] = await Promise.all([
    userIds.length ? supabase.from('workers').select('*').in('user_id', userIds) : Promise.resolve({ data: [], error: null }),
    userIds.length ? supabase.from('profiles').select('id, display_name, avatar_url').in('id', userIds) : Promise.resolve({ data: [], error: null }),
    supabase.rpc('list_assignable_workers', { p_space_id: domain.data?.activity_space_id ?? null, p_domain_id: domainId, p_include_inactive: false }),
  ]);
  if (workers.error) throw new Error(workers.error.message);
  const workerByUser = new Map(((workers.data ?? []) as Worker[]).map((w) => [w.user_id, w]));
  const profileById = new Map(((profiles.data ?? []) as { id: string; display_name: string | null; avatar_url: string | null }[]).map((p) => [p.id, p]));
  const people: DomainMemberRow[] = rows.map((r) => {
    const worker = workerByUser.get(r.user_id) ?? null;
    const profile = profileById.get(r.user_id);
    return {
      id: r.user_id, userId: r.user_id, kind: 'human', role: r.role, worker,
      name: worker?.name ?? profile?.display_name ?? translate('Member'),
      email: worker?.email ?? null,
      avatarUrl: worker?.avatar_url ?? profile?.avatar_url ?? null,
    };
  });
  const agents: DomainMemberRow[] = ((assignable.data ?? []) as Worker[]).filter((w) => w.type === 'ai_agent').map((w) => ({
    id: w.id, userId: null, kind: 'ai', role: null, worker: w, name: w.name, email: null, avatarUrl: w.avatar_url ?? null,
  }));
  const byName = (a: DomainMemberRow, b: DomainMemberRow) => a.name.localeCompare(b.name);
  return [...people.sort(byName), ...agents.sort(byName)];
}

const DOMAIN_MEMBERS_KEY = ['domain-members'] as const;

export function useDomainMembers(domainId: string | null) {
  const query = useQuery({
    queryKey: [...DOMAIN_MEMBERS_KEY, domainId],
    enabled: !!domainId,
    queryFn: () => fetchDomainMembers(domainId!),
  });
  return {
    members: query.data ?? EMPTY_MEMBERS,
    loading: !!domainId && query.isPending,
    error: (query.error as Error | null) ?? null,
    refresh: () => { void getQueryClient().invalidateQueries({ queryKey: DOMAIN_MEMBERS_KEY }); },
  };
}
const EMPTY_MEMBERS: DomainMemberRow[] = [];
