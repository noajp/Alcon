'use client';

import { fetchMySpaceIds, SPACE_IDS_QUERY_KEY } from '@/ActivitySpace/execution/domain/data';
import { supabase } from '@/lib/supabase';
import { useCurrentUserId } from '@/providers/authContext';
import type { ActivitySpace, ActivitySpaceInsert, ActivitySpaceUpdate } from '@/types/database';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';


// Cross-Domain Guests of a Space, for Administration > Member (el_QLT-026).
// domain_members' own RLS (`user_id = auth.uid() OR user_is_domain_member`)
// has no branch for "this Domain is workspace-privacy and I'm a Space
// member" — unlike `domains` itself, which does. A plain client-side query
// would silently return nothing for any Domain the viewer hasn't personally
// joined, regardless of that Domain's privacy. This RPC (SECURITY DEFINER,
// see its migration) reimplements the boundary correctly instead: workspace
// Domains are visible Space-wide, private Domains stay gated on the caller
// actually being a member of that specific Domain.
export interface SpaceGuestRow {
  user_id: string;
  domain_id: string;
  domain_name: string;
  domain_role: string;
}

export async function fetchSpaceGuests(spaceId: string): Promise<SpaceGuestRow[]> {
  const { data, error } = await supabase.rpc('get_space_guest_domain_members', { p_space_id: spaceId });
  if (error) throw error;
  return (data ?? []) as SpaceGuestRow[];
}

// ============================================
// ActivitySpace CRUD + useActivitySpaces hook
// The top-level org container (company / enterprise) above Domain.
// ============================================

export async function createActivitySpace(
  input: ActivitySpaceInsert & { user_id: string },
): Promise<ActivitySpace> {
  const { user_id, ...fields } = input;
  // The database enrols the creator as the Space's owner in the same insert
  // (activity_spaces_enrol_creator); the browser writes no membership rows.
  const { data, error } = await supabase
    .from('activity_spaces')
    .insert({ ...fields, created_by: user_id })
    .select()
    .single();
  if (error) throw error;
  return data as ActivitySpace;
}

export async function updateActivitySpace(id: string, updates: ActivitySpaceUpdate): Promise<ActivitySpace> {
  const { data, error } = await supabase
    .from('activity_spaces')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data as ActivitySpace;
}

export async function deleteActivitySpace(id: string): Promise<void> {
  const { error } = await supabase.from('activity_spaces').delete().eq('id', id);
  if (error) throw error;
}

const SPACES_QUERY_KEY = ['spaces'] as const;

async function fetchMemberSpaces(userId: string): Promise<ActivitySpace[]> {
  const ids = await fetchMySpaceIds(userId);
  if (ids.length === 0) return [];
  const { data: rows, error } = await supabase
    .from('activity_spaces')
    .select('*')
    .in('id', ids)
    .order('order_index');
  if (error) throw error;
  return (rows ?? []) as ActivitySpace[];
}

const EMPTY_SPACES: ActivitySpace[] = [];

/** Membership-scoped ActivitySpace list — the spaces the signed-in user belongs
 *  to. Signed-out hands back an empty list (the gate then shows the create-space
 *  onboarding). Shared query: every mount reads one cached row. */
export function useActivitySpaces() {
  const userId = useCurrentUserId();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: [...SPACES_QUERY_KEY, userId],
    queryFn: () => fetchMemberSpaces(userId!),
    enabled: !!userId,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
  });
  const refetch = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: SPACE_IDS_QUERY_KEY });
    await qc.invalidateQueries({ queryKey: SPACES_QUERY_KEY });
  }, [qc]);
  return {
    data: query.data ?? EMPTY_SPACES,
    loading: !!userId && query.isPending,
    error: (query.error as Error | null) ?? null,
    refetch,
  };
}
