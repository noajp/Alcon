'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Asset, AssetEvent } from '@/types/database';

// A Space's connected assets (ADR 0036): the apps and AIs that announced
// themselves through the asset relay, and what they reported. RLS lets
// members read; accepting and revoking are owner-only RPCs. The list is
// re-read every few seconds while the panel is open, so an app that has
// just added its line shows up without a reload.

const ASSET_COLUMNS = 'id, activity_space_id, name, kind, status, manifest, observed, token_prefix, claimed_by, claimed_at, revoked_at, last_seen_at, event_count, created_at, updated_at';
const EVENT_COLUMNS = 'id, asset_id, kind, summary, payload, occurred_at, created_at';

const assetsKey = (spaceId: string | null) => ['assets', spaceId] as const;
const eventsKey = (assetId: string | null) => ['asset-events', assetId] as const;

const NO_ASSETS: Asset[] = [];
const NO_EVENTS: AssetEvent[] = [];

export function useAssets(spaceId: string | null) {
  const query = useQuery({
    queryKey: assetsKey(spaceId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('assets')
        .select(ASSET_COLUMNS)
        .eq('activity_space_id', spaceId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as Asset[];
    },
    enabled: !!spaceId,
    refetchInterval: 5_000,
    staleTime: 2_000,
  });
  return {
    data: query.data ?? NO_ASSETS,
    /** When the list was last read; "live" is judged against this moment. */
    readAt: query.dataUpdatedAt,
    loading: !!spaceId && query.isPending,
    error: (query.error as Error | null) ?? null,
  };
}

export function useAssetEvents(assetId: string | null, limit = 50) {
  const query = useQuery({
    queryKey: [...eventsKey(assetId), limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('asset_events')
        .select(EVENT_COLUMNS)
        .eq('asset_id', assetId!)
        .order('occurred_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as AssetEvent[];
    },
    enabled: !!assetId,
    refetchInterval: 5_000,
    staleTime: 2_000,
  });
  return {
    data: query.data ?? NO_EVENTS,
    loading: !!assetId && query.isPending,
    error: (query.error as Error | null) ?? null,
  };
}

export function useAssetActions(spaceId: string | null) {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: assetsKey(spaceId) });
    void qc.invalidateQueries({ queryKey: ['asset-events'] });
  };
  const accept = useMutation({
    // The caller shows this failure inline.
    meta: { silent: true },
    mutationFn: async (assetId: string) => {
      const { error } = await supabase.rpc('accept_asset', { p_asset_id: assetId });
      if (error) throw error;
    },
    onSettled: invalidate,
  });
  const revoke = useMutation({
    // The caller shows this failure inline.
    meta: { silent: true },
    mutationFn: async (assetId: string) => {
      const { error } = await supabase.rpc('revoke_asset', { p_asset_id: assetId });
      if (error) throw error;
    },
    onSettled: invalidate,
  });
  return { accept, revoke };
}
