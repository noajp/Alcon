'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { DefinitionRevisionCandidate, VerifierCalibration } from '@/types/database';

// Verifier calibration reads (B5): one definition's latest
// calibration row (the trailing window's pair counts, refreshed by
// the automations tick's evaluator) and its open revision candidate,
// if the evaluator has queued one. Members of the Space read both
// (RLS); resolving the candidate goes through the owner-checked RPC
// — there is no client write path to either table, so what the
// drill-down shows can only have been measured, never authored.

const CALIBRATION_COLUMNS = 'id, activity_space_id, definition_id, window_start, window_days, agree_pass, agree_fail, false_pass, false_fail, pairs, updated_at';
const CANDIDATE_COLUMNS = 'id, definition_id, activity_space_id, reason, rate, pairs, sample_outcome_ids, status, created_at, updated_at';

export function useDefinitionCalibration(spaceId: string | null, definitionId: string | null) {
  const qc = useQueryClient();
  const queryKey = ['definition-calibration', spaceId ?? 'none', definitionId ?? 'none'] as const;
  const query = useQuery({
    queryKey,
    enabled: !!spaceId && !!definitionId,
    queryFn: async (): Promise<{ calibration: VerifierCalibration | null; candidate: DefinitionRevisionCandidate | null }> => {
      const [cal, cand] = await Promise.all([
        supabase.from('verifier_calibration').select(CALIBRATION_COLUMNS)
          .eq('definition_id', definitionId!).order('window_start', { ascending: false }).limit(1),
        supabase.from('definition_revision_candidates').select(CANDIDATE_COLUMNS)
          .eq('definition_id', definitionId!).eq('status', 'open').limit(1),
      ]);
      if (cal.error) throw cal.error;
      if (cand.error) throw cand.error;
      return {
        calibration: ((cal.data ?? []) as VerifierCalibration[])[0] ?? null,
        candidate: ((cand.data ?? []) as DefinitionRevisionCandidate[])[0] ?? null,
      };
    },
  });
  return {
    calibration: query.data?.calibration ?? null,
    candidate: query.data?.candidate ?? null,
    loading: !!spaceId && !!definitionId && query.isPending,
    refetch: () => qc.invalidateQueries({ queryKey }),
  };
}

/** A Space owner's answer to a revision candidate: dismissed (the
 *  claim does not hold) or addressed (the definition was revised).
 *  The RPC checks ownership itself; a member's call is refused. */
export async function resolveRevisionCandidate(id: string, status: 'dismissed' | 'addressed'): Promise<void> {
  const { error } = await supabase.rpc('resolve_revision_candidate', { p_candidate_id: id, p_status: status });
  if (error) throw error;
}
