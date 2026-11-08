'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { ConstraintDraft, PlanningConstraint } from '@/types/database';

// Learned-constraint reads (B6): the Space's awaiting-review drafts
// (the tick derivation's proposals, with their evidence and the
// baseline each claims it will move) and the constraints already
// active on the Space's work. Members read both tables (RLS);
// deciding a draft or retiring a constraint goes through the
// owner-checked RPCs — there is no client write path to either
// table, so what the queue shows can only have been derived and
// activated, never authored here.

const DRAFT_COLUMNS = 'id, activity_space_id, scope, target_definition_id, target_strategy_id, constraint_text, derived_from, signature, evidence_outcome_ids, cluster, calibration_candidate_id, structure_hash, binding_hash, target_version, status, offered_at, decided_by, decided_at, activated_constraint_id, expires_at, created_at, updated_at';
const CONSTRAINT_COLUMNS = 'id, activity_space_id, scope, target_definition_id, target_strategy_id, constraint_text, draft_id, signature, derived_from, baseline_rate, baseline_outcomes, baseline_with, effect_status, effect, status, activated_by, activated_at, retired_by, retired_at, retire_reason, created_at, updated_at';

export interface ConstraintDraftRow extends ConstraintDraft {
  targetName: string;
}

/** The review queue's data: awaiting-review drafts with their target
 *  names resolved, plus every constraint the Space has activated
 *  (the KPI's denominators and the editor's rows share the table). */
export function useSpaceConstraintQueue(spaceId: string | null) {
  const qc = useQueryClient();
  const queryKey = ['constraint-queue', spaceId ?? 'none'] as const;
  const query = useQuery({
    queryKey,
    enabled: !!spaceId,
    queryFn: async (): Promise<{ drafts: ConstraintDraftRow[]; constraints: PlanningConstraint[] }> => {
      const [draftsRes, constraintsRes] = await Promise.all([
        supabase.from('constraint_drafts').select(DRAFT_COLUMNS)
          .eq('activity_space_id', spaceId!).eq('status', 'awaiting_review')
          .order('created_at', { ascending: true }).limit(50),
        supabase.from('planning_constraints').select(CONSTRAINT_COLUMNS)
          .eq('activity_space_id', spaceId!)
          .order('activated_at', { ascending: false }).limit(200),
      ]);
      if (draftsRes.error) throw draftsRes.error;
      if (constraintsRes.error) throw constraintsRes.error;
      const drafts = (draftsRes.data ?? []) as ConstraintDraft[];
      const nameOf = new Map<string, string>();
      const defIds = [...new Set(drafts.map((d) => d.target_definition_id).filter((x): x is string => !!x))];
      const stratIds = [...new Set(drafts.map((d) => d.target_strategy_id).filter((x): x is string => !!x))];
      if (defIds.length) {
        const { data } = await supabase.from('definitions').select('id, name').in('id', defIds);
        for (const d of (data ?? []) as { id: string; name: string }[]) nameOf.set(d.id, d.name);
      }
      if (stratIds.length) {
        const { data } = await supabase.from('strategies').select('id, name').in('id', stratIds);
        for (const s of (data ?? []) as { id: string; name: string }[]) nameOf.set(s.id, s.name);
      }
      return {
        drafts: drafts.map((d) => ({
          ...d,
          targetName: (d.target_definition_id ? nameOf.get(d.target_definition_id) : d.target_strategy_id ? nameOf.get(d.target_strategy_id) : undefined) ?? '',
        })),
        constraints: (constraintsRes.data ?? []) as PlanningConstraint[],
      };
    },
  });
  return {
    drafts: query.data?.drafts ?? [],
    constraints: query.data?.constraints ?? [],
    loading: !!spaceId && query.isPending,
    refetch: () => qc.invalidateQueries({ queryKey }),
  };
}

/** One definition's active constraints, for the harness editor's
 *  drill-down: what governs this definition now, and whether each
 *  is working. */
export function useDefinitionConstraints(spaceId: string | null, definitionId: string | null) {
  const qc = useQueryClient();
  const queryKey = ['definition-constraints', spaceId ?? 'none', definitionId ?? 'none'] as const;
  const query = useQuery({
    queryKey,
    enabled: !!spaceId && !!definitionId,
    queryFn: async (): Promise<PlanningConstraint[]> => {
      const { data, error } = await supabase.from('planning_constraints').select(CONSTRAINT_COLUMNS)
        .eq('target_definition_id', definitionId!).eq('status', 'active')
        .order('activated_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as PlanningConstraint[];
    },
  });
  return {
    constraints: query.data ?? [],
    loading: !!spaceId && !!definitionId && query.isPending,
    refetch: () => qc.invalidateQueries({ queryKey }),
  };
}

/** The owner's activation: the RPC re-checks ownership and that the
 *  target still matches the draft's stamped snapshot — an edit
 *  after drafting refuses, and the error says why. Returns the new
 *  constraint's id. */
export async function activateConstraintDraft(id: string): Promise<string> {
  const { data, error } = await supabase.rpc('activate_constraint_draft', { p_draft_id: id });
  if (error) throw error;
  return data as string;
}

/** The owner's refusal of a drafted lesson. */
export async function rejectConstraintDraft(id: string): Promise<void> {
  const { error } = await supabase.rpc('reject_constraint_draft', { p_draft_id: id });
  if (error) throw error;
}

/** Retiring a constraint is a person's call (owner, via the RPC):
 *  'owner' when they simply withdraw it, 'folded' when its text has
 *  been written into the definition body proper. The measurement
 *  never calls this — flagging is all it may do. */
export async function deactivatePlanningConstraint(id: string, reason: 'owner' | 'folded' = 'owner'): Promise<void> {
  const { error } = await supabase.rpc('deactivate_planning_constraint', { p_constraint_id: id, p_reason: reason });
  if (error) throw error;
}
