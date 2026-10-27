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
  ChainStep, LedgerRun, StepEvent, WorkflowDeploymentRecord, WorkflowStepRecord, WorkflowTemplateRecord,
} from '@/Function/audit/auditModel';

/** How far back the Audit app reads runs. Older runs stay in the ledger; an
 *  older run still waiting on something is always read. */
export const AUDIT_WINDOW_DAYS = 30;
/** The most recent runs read at once; past it the app says it shows the latest. */
export const AUDIT_RUN_LIMIT = 5000;
/** The latest links of a deployment's chain the integrity check reads (the
 *  API's default row cap; the exact count says when there are more). */
const AUDIT_CHAIN_LIMIT = 1000;

const EMPTY: never[] = [];

interface AuditLedger {
  templates: WorkflowTemplateRecord[];
  deployments: WorkflowDeploymentRecord[];
  runs: LedgerRun[];
  /** More runs started in the window than AUDIT_RUN_LIMIT. */
  truncated: boolean;
}

async function loadLedger(spaceId: string, since: string, signal: AbortSignal): Promise<AuditLedger> {
  const deployments = await readAllPages<WorkflowDeploymentRecord>('deployments', (from, to) =>
    supabase.from('workflow_deployments').select('*', { count: 'exact' }).eq('activity_space_id', spaceId)
      .order('created_at').order('id').range(from, to).abortSignal(signal) as never, row => row.id);
  if (!deployments.length) return { templates: [], deployments, runs: [], truncated: false };
  const templateIds = [...new Set(deployments.map(d => d.template_id))];
  const [templates, runs] = await Promise.all([
    supabase.from('workflow_templates').select('*').in('id', templateIds).abortSignal(signal).then(({ data, error }) => {
      if (error) throw new Error(`Unable to read templates: ${error.message}`);
      return (data ?? []) as WorkflowTemplateRecord[];
    }),
    // One call, one snapshot, one JSON value: the gateway keeps appending
    // while this reads, and a set of rows could be cut at the API's row cap
    // without a word. The function says itself when the window held more.
    supabase.rpc('audit_ledger_runs', { _space_id: spaceId, _since: since, _limit: AUDIT_RUN_LIMIT }).abortSignal(signal).then(({ data, error }) => {
      if (error) throw new Error(`Unable to read runs: ${error.message}`);
      const value = data as { runs?: (Omit<LedgerRun, 'steps'> & { steps: StepEvent[] | null })[]; truncated?: boolean } | null;
      if (!value || !Array.isArray(value.runs)) throw new Error('Unable to read runs: the ledger answered in an unknown shape.');
      return { runs: value.runs.map(run => ({ ...run, steps: run.steps ?? [] })), truncated: value.truncated === true };
    }),
  ]);
  return { templates, deployments, runs: runs.runs, truncated: runs.truncated };
}

/** The active Space's audit ledger: its deployments, the runs of the last
 *  AUDIT_WINDOW_DAYS and every older run still open, each with its steps.
 *  Read-only — the ingest function writes. */
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

  const runs = ledger?.runs ?? EMPTY;
  const stepsByRun = useMemo(() => new Map<string, StepEvent[]>(runs.map(run => [run.id, run.steps])), [runs]);
  const runsByDeployment = useMemo(() => {
    const map = new Map<string, LedgerRun[]>();
    for (const run of runs) {
      const list = map.get(run.deployment_id);
      if (list) list.push(run); else map.set(run.deployment_id, [run]);
    }
    return map;
  }, [runs]);

  return {
    spaceId,
    templates: ledger?.templates ?? EMPTY,
    deployments,
    runs,
    truncated: ledger?.truncated ?? false,
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

/** One run's steps in full (who, when, how long), for the run's own page. */
export function useAuditRunSteps(runId: string | null) {
  const userId = useCurrentUserId();
  const query = useQuery({
    queryKey: ['audit-run-steps', userId, runId],
    queryFn: async ({ signal }) => {
      const { data, error } = await supabase.from('workflow_run_steps').select('*').eq('run_id', runId!).order('seq').abortSignal(signal);
      if (error) throw new Error(`Unable to read the run's steps: ${error.message}`);
      return (data ?? []) as WorkflowStepRecord[];
    },
    enabled: Boolean(userId && runId),
    staleTime: 15_000,
  });
  return { steps: query.data ?? EMPTY, loading: query.isPending && Boolean(runId), error: query.error };
}

/** The latest links of a deployment's chain with their runs — a contiguous
 *  seq range, read in one request — for the integrity check. */
export function useAuditChain(deploymentId: string | null) {
  const userId = useCurrentUserId();
  const query = useQuery({
    queryKey: ['audit-chain', userId, deploymentId],
    queryFn: async ({ signal }) => {
      // The exact count rides on the same request, so whether these are all
      // of the deployment's records is known, not guessed from a row cap.
      const { data, error, count } = await supabase.from('workflow_run_steps')
        .select('*, run:workflow_runs!inner(external_id,subject_ref,subject_digest,started_at)', { count: 'exact' })
        .eq('deployment_id', deploymentId!).order('seq', { ascending: false }).limit(AUDIT_CHAIN_LIMIT).abortSignal(signal);
      if (error) throw new Error(`Unable to read the record chain: ${error.message}`);
      if (count === null) throw new Error('Unable to read the record chain: its size is unknown.');
      return { steps: (data ?? []) as ChainStep[], total: count };
    },
    enabled: Boolean(userId && deploymentId),
    staleTime: 15_000,
  });
  return {
    steps: query.data?.steps ?? EMPTY,
    /** All of the deployment's records, of which `steps` are the latest. */
    total: query.data?.total ?? 0,
    loading: query.isPending && Boolean(deploymentId),
    error: query.error,
  };
}
