'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useCurrentUserId } from '@/providers/authContext';
import type { WorkflowApprovalRecord } from '@/Function/audit/auditModel';

const EMPTY: never[] = [];
const COLUMNS = 'id,activity_space_id,deployment_id,request_id,run_external_id,connector,operation,input_hash,summary,requested_at,expires_at,status,decided_by_name,decided_at,decision_note,consumed_at';

/** One approval a gateway asked for (ADR 0047), the name of its workflow,
 *  and whether the caller — the Space's owner — may decide it. */
export function useWorkflowApproval(approvalId: string | null) {
  const userId = useCurrentUserId();
  const qc = useQueryClient();
  const key = ['workflow-approval', userId, approvalId];
  const query = useQuery({
    queryKey: key,
    queryFn: async ({ signal }) => {
      const { data, error } = await supabase.from('workflow_approvals').select(`${COLUMNS},deployment:workflow_deployments(name)`)
        .eq('id', approvalId!).abortSignal(signal).maybeSingle();
      if (error) throw new Error(`Unable to read the approval: ${error.message}`);
      if (!data) return null;
      const row = data as unknown as WorkflowApprovalRecord & { deployment: { name: string } | null };
      const owner = await supabase.rpc('is_activity_space_owner', { p_space: row.activity_space_id }).abortSignal(signal);
      return { approval: row as WorkflowApprovalRecord, workflow: row.deployment?.name ?? null, canDecide: owner.data === true };
    },
    enabled: Boolean(userId && approvalId),
    staleTime: 5_000,
  });
  const mutation = useMutation({
    mutationFn: async ({ approve, note }: { approve: boolean; note?: string }) => {
      const { data, error } = await supabase.rpc('decide_workflow_approval', { _approval_id: approvalId!, _approve: approve, _note: note?.trim() || null });
      if (error) throw new Error(`Unable to decide the approval: ${error.message}`);
      // Decided by someone else first, or expired while the card was open:
      // nothing changed, and the card says so after it reads the row again.
      const outcome = data as { status: string; changed: boolean } | null;
      return { changed: outcome?.changed === true, status: outcome?.status ?? null };
    },
    onSettled: () => Promise.all([
      qc.invalidateQueries({ queryKey: key }),
      qc.invalidateQueries({ queryKey: ['workflow-approvals'] }),
    ]),
  });
  return {
    approval: query.data?.approval ?? null,
    workflow: query.data?.workflow ?? null,
    canDecide: query.data?.canDecide ?? false,
    loading: query.isPending && Boolean(approvalId),
    error: query.error,
    decide: mutation.mutateAsync,
    deciding: mutation.isPending,
  };
}

/** A workflow's latest approvals, newest first. */
export function useDeploymentApprovals(deploymentId: string | null) {
  const userId = useCurrentUserId();
  const query = useQuery({
    queryKey: ['workflow-approvals', userId, deploymentId],
    queryFn: async ({ signal }) => {
      const { data, error } = await supabase.from('workflow_approvals').select(COLUMNS)
        .eq('deployment_id', deploymentId!).order('requested_at', { ascending: false }).limit(50).abortSignal(signal);
      if (error) throw new Error(`Unable to read the approvals: ${error.message}`);
      return (data ?? []) as WorkflowApprovalRecord[];
    },
    enabled: Boolean(userId && deploymentId),
    staleTime: 15_000,
  });
  return { approvals: query.data ?? EMPTY, loading: query.isPending && Boolean(deploymentId), error: query.error };
}
