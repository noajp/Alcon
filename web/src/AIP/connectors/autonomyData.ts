'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { AutonomyGrant, CommandTrackRecord } from '@/types/database';

// Graduated autonomy (B7) for the connection surface: a Space's
// grants and track records. Members read both (a command's standing
// is the Space's policy made visible, not a secret); the standing
// changes only through the tick evaluator and the owner's pin RPC —
// the screen never writes the tables itself.

const autonomyKey = (spaceId: string | null) => ['space-autonomy', spaceId] as const;

const keyOf = (integrationId: string, action: string) => `${integrationId}:${action}`;

export function useSpaceAutonomy(spaceId: string | null) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: autonomyKey(spaceId),
    queryFn: async () => {
      const [grants, records] = await Promise.all([
        supabase.from('autonomy_grants')
          .select('id, activity_space_id, integration_id, action, lane, level, basis, granted_by, pinned, required_clean, last_incident_at, last_incident_kind, created_at, updated_at')
          .eq('activity_space_id', spaceId!),
        supabase.from('command_track_records')
          .select('id, activity_space_id, integration_id, action, window_start, window_days, clean_completions, checked_passes, clean_streak, checked_in_streak, verify_checked, verify_ok, verify_green_streak, incidents, last_incident_at, updated_at')
          .eq('activity_space_id', spaceId!),
      ]);
      if (grants.error) throw grants.error;
      if (records.error) throw records.error;
      return {
        grants: new Map((grants.data ?? []).map((g) => [keyOf(g.integration_id, g.action), g as unknown as AutonomyGrant])),
        records: new Map((records.data ?? []).map((r) => [keyOf(r.integration_id, r.action), r as unknown as CommandTrackRecord])),
      };
    },
    enabled: !!spaceId,
    staleTime: 10_000,
  });
  return {
    grants: query.data?.grants ?? new Map<string, AutonomyGrant>(),
    records: query.data?.records ?? new Map<string, CommandTrackRecord>(),
    loading: !!spaceId && query.isPending,
    refetch: () => qc.invalidateQueries({ queryKey: autonomyKey(spaceId) }),
  };
}

/** Pins (or unpins, with level null) one command's autonomy through
 *  the one RPC — owner-only inside it, and the change is logged
 *  there. Resolves with the level now in force ('none' when unpinned
 *  and no grant stands). */
export async function setAutonomyPin(
  spaceId: string, integrationId: string, action: string, level: 'ask' | 'auto' | null,
): Promise<string> {
  const { data, error } = await supabase.rpc('set_autonomy_pin', {
    p_space_id: spaceId, p_integration_id: integrationId, p_action: action, p_level: level,
  });
  if (error) throw error;
  return data as string;
}
