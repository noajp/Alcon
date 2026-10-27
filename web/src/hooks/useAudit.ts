'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { useCurrentUserId } from '@/providers/authContext';
import { readAllPages } from '@/hooks/readAllPages';
import { useSustainmentDomains } from '@/hooks/useSustainmentDomains';
import { useWorkersByIds } from '@/hooks/teamData';
import { addDays } from '@/Function/shared/dateUtils';
import type {
  WorkflowDeploymentRecord, WorkflowRunRecord, WorkflowStepRecord, WorkflowTemplateRecord,
} from '@/Function/audit/auditModel';

/** How far back the Audit app reads runs. Older runs stay in the ledger. */
export const AUDIT_WINDOW_DAYS = 30;

const EMPTY: never[] = [];

interface AuditLedger {
  templates: WorkflowTemplateRecord[];
  deployments: WorkflowDeploymentRecord[];
  runs: WorkflowRunRecord[];
  steps: WorkflowStepRecord[];
}

async function loadLedger(spaceId: string, since: string, signal: AbortSignal): Promise<AuditLedger> {
  const deployments = await readAllPages<WorkflowDeploymentRecord>('deployments', (from, to) =>
    supabase.from('workflow_deployments').select('*', { count: 'exact' }).eq('activity_space_id', spaceId)
      .order('created_at').order('id').range(from, to).abortSignal(signal) as never, row => row.id);
  if (!deployments.length) return { templates: [], deployments, runs: [], steps: [] };
  const templateIds = [...new Set(deployments.map(d => d.template_id))];
  const [templates, runs, steps] = await Promise.all([
    supabase.from('workflow_templates').select('*').in('id', templateIds).abortSignal(signal).then(({ data, error }) => {
      if (error) throw new Error(`Unable to read templates: ${error.message}`);
      return (data ?? []) as WorkflowTemplateRecord[];
    }),
    readAllPages<WorkflowRunRecord>('runs', (from, to) =>
      supabase.from('workflow_runs').select('id,deployment_id,external_id,template_version,subject_ref,subject_digest,started_at', { count: 'exact' })
        .eq('activity_space_id', spaceId).gte('started_at', since)
        .order('started_at', { ascending: false }).order('id').range(from, to).abortSignal(signal) as never, row => row.id),
    // A run's steps all happen after it starts, so the same window holds them.
    readAllPages<WorkflowStepRecord>('run steps', (from, to) =>
      supabase.from('workflow_run_steps').select('*', { count: 'exact' })
        .eq('activity_space_id', spaceId).gte('occurred_at', since)
        .order('seq').order('id').range(from, to).abortSignal(signal) as never, row => row.id),
  ]);
  return { templates, deployments, runs, steps };
}

/** The active Space's audit ledger: its deployments, and the runs of the last
 *  AUDIT_WINDOW_DAYS with their steps. Read-only — the ingest function writes. */
export function useAudit() {
  const userId = useCurrentUserId();
  const spaceId = useActiveSpaceId();
  const enabled = Boolean(userId && spaceId);
  const query = useQuery({
    queryKey: ['audit-ledger', userId, spaceId],
    queryFn: ({ signal }) => loadLedger(spaceId!, addDays(new Date(), -AUDIT_WINDOW_DAYS).toISOString(), signal),
    enabled,
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });
  const domains = useSustainmentDomains();
  const ledger = enabled ? query.data : undefined;
  const deployments = ledger?.deployments ?? EMPTY;
  const workers = useWorkersByIds(useMemo(() => deployments.flatMap(d => d.worker_id ? [d.worker_id] : []), [deployments]));

  const stepsByRun = useMemo(() => {
    const map = new Map<string, WorkflowStepRecord[]>();
    for (const step of ledger?.steps ?? EMPTY) {
      const list = map.get(step.run_id);
      if (list) list.push(step); else map.set(step.run_id, [step]);
    }
    return map;
  }, [ledger?.steps]);
  const runsByDeployment = useMemo(() => {
    const map = new Map<string, WorkflowRunRecord[]>();
    for (const run of ledger?.runs ?? EMPTY) {
      const list = map.get(run.deployment_id);
      if (list) list.push(run); else map.set(run.deployment_id, [run]);
    }
    return map;
  }, [ledger?.runs]);

  return {
    spaceId,
    templates: ledger?.templates ?? EMPTY,
    deployments,
    runs: ledger?.runs ?? EMPTY,
    stepsByRun,
    runsByDeployment,
    domains: domains.data,
    workers,
    loading: enabled && query.isPending,
    error: enabled ? query.error : null,
    refetch: query.refetch,
  };
}

export type Audit = ReturnType<typeof useAudit>;
