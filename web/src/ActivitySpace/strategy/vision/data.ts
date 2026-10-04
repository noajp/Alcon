'use client';

import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { getQueryClient } from '@/lib/queryClient';
import { translate } from '@/Function/i18n/I18nProvider';
import { useCurrentUserId } from '@/providers/authContext';
import type { Vision, VisionInsert, VisionUpdate } from '@/types/database';

// Visions of the active Space. Every member reads them and can add one; a
// Vision is changed or deleted by whoever wrote it, or by a Space owner
// (the same rule RLS enforces).

const VISIONS_QUERY_KEY = ['visions'] as const;
const EMPTY: Vision[] = [];

async function fetchVisions(spaceId: string): Promise<Vision[]> {
  const { data, error } = await supabase
    .from('visions')
    .select('*')
    .eq('activity_space_id', spaceId)
    .order('order_index')
    .order('created_at');
  if (error) throw error;
  return (data ?? []) as Vision[];
}

function invalidateVisions(): Promise<void> {
  return getQueryClient().invalidateQueries({ queryKey: VISIONS_QUERY_KEY });
}

export function useVisions(spaceId: string | null) {
  const query = useQuery({
    queryKey: [...VISIONS_QUERY_KEY, spaceId],
    queryFn: () => fetchVisions(spaceId!),
    enabled: !!spaceId,
    // No previous-Space placeholder: a Vision of the Space just left must
    // never stand in while this Space's load, or a create would pair it with
    // the new Space.
  });
  const refetch = useCallback(() => invalidateVisions(), []);
  return {
    data: query.data ?? EMPTY,
    loading: !!spaceId && query.isPending,
    error: (query.error as Error | null) ?? null,
    refetch,
  };
}

/** The Vision a Strategy page shows: the one navigation names, else the
 *  Space's first. Null while there is none. */
export function resolveVision(visions: Vision[], visionId: string | null | undefined): Vision | null {
  return visions.find((v) => v.id === visionId) ?? visions[0] ?? null;
}

export async function createVision(input: VisionInsert): Promise<Vision> {
  const { data, error } = await supabase.from('visions').insert(input).select().single();
  if (error) throw error;
  await invalidateVisions();
  return data as Vision;
}

export async function updateVision(id: string, updates: VisionUpdate): Promise<void> {
  const { data, error } = await supabase.from('visions').update(updates).eq('id', id).select('id');
  if (error) throw error;
  if (!data || data.length === 0) throw new Error(translate('Only the Vision\'s author or a Space owner can change it.'));
  void invalidateVisions();
}

/** Deleting a Vision deletes its Portfolios (cascade); its Initiatives stay,
 *  outside any Vision. */
export async function deleteVision(id: string): Promise<void> {
  const { data, error } = await supabase.from('visions').delete().eq('id', id).select('id');
  if (error) throw error;
  if (!data || data.length === 0) throw new Error(translate('Only the Vision\'s author or a Space owner can change it.'));
  const qc = getQueryClient();
  await Promise.all([
    invalidateVisions(),
    qc.invalidateQueries({ queryKey: ['portfolios'] }),
    qc.invalidateQueries({ queryKey: ['strategies'] }),
  ]);
}

/** Puts an Initiative directly under a Vision (or outside every Vision with
 *  null). Either way it leaves the Portfolio it was in — a Portfolio belongs
 *  to one Vision. The write is on the Initiative, so only its creator can. */
export async function setStrategyVision(strategyId: string, visionId: string | null): Promise<void> {
  const patch = { vision_id: visionId, portfolio_id: null };
  const { data, error } = await supabase
    .from('strategies')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', strategyId)
    .select('id');
  if (error) throw error;
  if (!data || data.length === 0) throw new Error(translate("Only the Initiative's owner can move it."));
  void getQueryClient().invalidateQueries({ queryKey: ['strategies'] });
}

/** The viewer's seat in a Space ('owner' | 'member'), or null while unknown.
 *  An owner may change any Vision; `pending` lets a page wait instead of
 *  flashing its read-only form. */
export function useSpaceRole(spaceId: string | null): 'owner' | 'member' | null {
  return useSpaceRoleQuery(spaceId).data ?? null;
}

export function useSpaceRoleQuery(spaceId: string | null) {
  const userId = useCurrentUserId();
  return useQuery({
    queryKey: ['space-role', spaceId, userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('activity_space_members')
        .select('role')
        .eq('activity_space_id', spaceId!)
        .eq('user_id', userId!)
        .maybeSingle();
      if (error) throw error;
      return (data?.role as 'owner' | 'member' | undefined) ?? null;
    },
    enabled: !!spaceId && !!userId,
  });
}
