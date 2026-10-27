'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useCurrentUserId } from '@/providers/authContext';
import type { DeploymentGrant, GrantVersionRecord } from '@/Function/audit/auditModel';

const EMPTY: never[] = [];

/** A deployment's grants (ADR 0046): those in force, every version they
 *  have been in (newest first), and whether the caller — the Space's owner —
 *  may change them. A change is one row added or removed; the database
 *  numbers the version it makes. */
export function useDeploymentGrants(deploymentId: string | null, spaceId: string | null) {
  const userId = useCurrentUserId();
  const qc = useQueryClient();
  const key = ['deployment-grants', userId, deploymentId];
  const query = useQuery({
    queryKey: key,
    queryFn: async ({ signal }) => {
      const [grants, versions, owner] = await Promise.all([
        supabase.from('deployment_grants').select('connector,operation').eq('deployment_id', deploymentId!).abortSignal(signal),
        supabase.from('deployment_grant_versions').select('deployment_id,version,grants,changed_by,created_at')
          .eq('deployment_id', deploymentId!).order('version', { ascending: false }).abortSignal(signal),
        supabase.rpc('is_activity_space_owner', { p_space: spaceId! }).abortSignal(signal),
      ]);
      if (grants.error) throw new Error(`Unable to read the grants: ${grants.error.message}`);
      if (versions.error) throw new Error(`Unable to read the grant history: ${versions.error.message}`);
      return {
        grants: (grants.data ?? []) as DeploymentGrant[],
        versions: (versions.data ?? []) as GrantVersionRecord[],
        canEdit: owner.data === true,
      };
    },
    enabled: Boolean(userId && deploymentId && spaceId),
    staleTime: 15_000,
  });
  const mutation = useMutation({
    mutationFn: async ({ grant, allowed }: { grant: DeploymentGrant; allowed: boolean }) => {
      const { error } = allowed
        ? await supabase.from('deployment_grants').insert({ deployment_id: deploymentId!, ...grant })
        : await supabase.from('deployment_grants').delete().eq('deployment_id', deploymentId!)
          .eq('connector', grant.connector).eq('operation', grant.operation);
      // Someone else made the same change first: what is in force is what was asked.
      if (error && error.code !== '23505') throw new Error(`Unable to change the grant: ${error.message}`);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
  return {
    grants: query.data?.grants ?? EMPTY,
    versions: query.data?.versions ?? EMPTY,
    canEdit: query.data?.canEdit ?? false,
    loading: query.isPending && Boolean(deploymentId),
    error: query.error,
    setGrant: mutation.mutateAsync,
    saving: mutation.isPending,
  };
}
