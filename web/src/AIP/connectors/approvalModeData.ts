'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { approvalModeOf, type ApprovalMode, type ApprovalModeChange } from './approvalModeModel';

// A Space's approval mode and its change history. Members read both (the
// mode is the Space's standing policy, not a secret); the mode changes
// only through set_space_approval_mode — the RPC checks ownership and
// writes the history row in the same act, so the screen never updates
// the column itself.

const modeKey = (spaceId: string | null) => ['space-approval-mode', spaceId] as const;

export function useSpaceApprovalMode(spaceId: string | null) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: modeKey(spaceId),
    queryFn: async () => {
      const [space, history] = await Promise.all([
        supabase.from('activity_spaces').select('approval_mode').eq('id', spaceId!).maybeSingle(),
        supabase.from('space_approval_mode_changes')
          .select('id, from_mode, to_mode, changed_by, created_at')
          .eq('activity_space_id', spaceId!)
          .order('created_at', { ascending: false })
          .limit(10),
      ]);
      if (space.error) throw space.error;
      if (history.error) throw history.error;
      return {
        mode: approvalModeOf((space.data as { approval_mode?: unknown } | null)?.approval_mode),
        changes: (history.data ?? []) as unknown as ApprovalModeChange[],
      };
    },
    enabled: !!spaceId,
    staleTime: 10_000,
  });
  return {
    mode: query.data?.mode ?? null,
    changes: query.data?.changes ?? [],
    loading: !!spaceId && query.isPending,
    error: (query.error as Error | null) ?? null,
    refetch: () => qc.invalidateQueries({ queryKey: modeKey(spaceId) }),
  };
}

/** Changes the Space's mode through the one RPC (owner-only; the change
 *  and its history land atomically). Resolves with the mode now in force. */
export async function setSpaceApprovalMode(spaceId: string, mode: ApprovalMode): Promise<ApprovalMode> {
  const { data, error } = await supabase.rpc('set_space_approval_mode', { p_space_id: spaceId, p_mode: mode });
  if (error) throw error;
  return approvalModeOf(data);
}
