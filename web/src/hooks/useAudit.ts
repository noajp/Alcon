'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { useCurrentUserId } from '@/providers/authContext';
import { readAllPages } from '@/hooks/readAllPages';
import { selectIn } from '@/hooks/chunkedIn';
import { useSustainmentDomains } from '@/hooks/useSustainmentDomains';
import { useWorkersByIds } from '@/hooks/teamData';
import { addDays } from '@/Function/shared/dateUtils';
import {
  agentRunEvents, mergeAuditTimeline, parseChainScope, parseFailureDetail, parseFinishDetail, parseProposedReadings, parseRunVerdict,
  type AgentRunRecord, type StepEvent,
} from '@/Function/audit/auditModel';
import type {
  ChainStep, LedgerRun, WorkflowDeploymentRecord, WorkflowStepRecord, WorkflowTemplateRecord,
} from '@/Function/audit/auditModel';
import type { AgentRunStatus } from '@/types/database';

/** How far back the Audit app reads runs. Older runs stay in the ledger; an
 *  older run still waiting on something is always read. */
export const AUDIT_WINDOW_DAYS = 30;
/** The most recent runs read at once; past it the app says it shows the latest. */
export const AUDIT_RUN_LIMIT = 5000;
/** The latest links of a deployment's chain the integrity check reads (the
 *  API's default row cap; the exact count says when there are more). */
const AUDIT_CHAIN_LIMIT = 1000;
/** The most recent agent runs read at once; past it the app says so. */
export const AGENT_AUDIT_RUN_LIMIT = 1000;
/** Agent run statuses that count as still open, however old the run is. */
const OPEN_AGENT_STATUSES: readonly AgentRunStatus[] = ['queued', 'running', 'awaiting_input', 'awaiting_approval', 'paused', 'awaiting_review'];

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

interface AgentRunRow {
  id: string; element_id: string; domain_id: string | null; worker_id: string | null;
  status: AgentRunStatus; mode: AgentRunRecord['mode']; summary: string | null; error: string | null;
  started_at: string | null; finished_at: string | null; created_at: string; cost_usd: number | string;
  verdict: unknown; proposed_readings: unknown; finish_detail: unknown; failure_detail: unknown; chain_scope: unknown;
}

/**
 * The Space's own agent work, read beside the ledger. Browser-safe columns
 * only — the AGENT_RUN_COLUMNS discipline from agentData.ts, plus the
 * verdict and proposed readings — under the same window rule: the last
 * AUDIT_WINDOW_DAYS, plus every older run still open. Element runs only:
 * a conversation run carries no Element and is not audit material here.
 *
 * RLS note: the ledger read is Space-scoped by the RPC; this read is
 * Space-scoped by the query but RLS further limits it to Elements the
 * person can see, so two members of one Space may see different agent
 * timelines. That matches every other agent surface — element visibility
 * is the product's rule.
 */
async function loadAgentRuns(spaceId: string, since: string, signal: AbortSignal): Promise<{ runs: AgentRunRecord[]; truncated: boolean }> {
  const { data, error } = await supabase.from('agent_runs')
    .select('id, element_id, domain_id, worker_id, status, mode, summary, error, started_at, finished_at, created_at, cost_usd, verdict, proposed_readings, finish_detail, failure_detail, chain_scope')
    .eq('activity_space_id', spaceId)
    .not('element_id', 'is', null)
    .or(`created_at.gte.${since},status.in.(${OPEN_AGENT_STATUSES.join(',')})`)
    .order('created_at', { ascending: false })
    .limit(AGENT_AUDIT_RUN_LIMIT)
    .abortSignal(signal);
  if (error) throw new Error(`Unable to read agent runs: ${error.message}`);
  const rows = (data ?? []) as unknown as AgentRunRow[];
  if (!rows.length) return { runs: [], truncated: false };

  const elements = await selectIn<{ id: string; title: string; status: string | null; object_id: string | null }>(
    rows.map(r => r.element_id),
    chunk => supabase.from('elements').select('id, title, status, object_id').in('id', chunk).abortSignal(signal) as never);
  const elementOf = new Map(elements.map(el => [el.id, el]));
  const objects = await selectIn<{ id: string; name: string }>(
    elements.flatMap(el => el.object_id ? [el.object_id] : []),
    chunk => supabase.from('objects').select('id, name').in('id', chunk).abortSignal(signal) as never);
  const objectNameOf = new Map(objects.map(o => [o.id, o.name]));
  const pending = await selectIn<{ run_id: string }>(
    rows.map(r => r.id),
    chunk => supabase.from('agent_actions').select('run_id').eq('status', 'pending').in('run_id', chunk).abortSignal(signal) as never);
  const pendingOf = new Map<string, number>();
  for (const row of pending) pendingOf.set(row.run_id, (pendingOf.get(row.run_id) ?? 0) + 1);

  // Chain scopes (B10): parsed at the boundary like the verdict, and
  // their fenced integrations resolved to names — the audit shows a
  // chain's reach in names, not ids. A name the read cannot resolve
  // stands as its id rather than vanishing.
  const parsedScopes = rows.map(r => parseChainScope(r.chain_scope));
  const scopedIds = [...new Set(parsedScopes.flatMap(s => (s ? s.integrations : [])))];
  const integrationRows = scopedIds.length
    ? await selectIn<{ id: string; name: string }>(
      scopedIds,
      chunk => supabase.from('integrations').select('id, name').in('id', chunk).abortSignal(signal) as never)
    : [];
  const integrationNameOf = new Map(integrationRows.map(r => [r.id, r.name]));

  return {
    truncated: rows.length >= AGENT_AUDIT_RUN_LIMIT,
    runs: rows.map((row, i) => {
      const element = elementOf.get(row.element_id);
      const scope = parsedScopes[i];
      return {
        id: row.id, element_id: row.element_id, domain_id: row.domain_id, worker_id: row.worker_id,
        status: row.status, mode: row.mode, summary: row.summary, error: row.error,
        started_at: row.started_at, finished_at: row.finished_at, created_at: row.created_at,
        cost_usd: typeof row.cost_usd === 'number' ? row.cost_usd : Number(row.cost_usd) || 0,
        verdict: parseRunVerdict(row.verdict),
        finishDetail: parseFinishDetail(row.finish_detail),
        failureDetail: parseFailureDetail(row.failure_detail),
        proposed_readings: parseProposedReadings(row.proposed_readings),
        chainScope: scope,
        chainIntegrationNames: scope ? scope.integrations.map(id => integrationNameOf.get(id) ?? id) : [],
        elementTitle: element?.title ?? '',
        elementStatus: element?.status ?? null,
        objectName: element?.object_id ? objectNameOf.get(element.object_id) ?? null : null,
        pendingActions: pendingOf.get(row.id) ?? 0,
      };
    }),
  };
}

/** The active Space's audit ledger: its deployments, the runs of the last
 *  AUDIT_WINDOW_DAYS and every older run still open, each with its steps —
 *  and, beside it, the Space's agent runs under the same window rule.
 *  Read-only — the ingest function writes the ledger; the engine writes runs. */
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
  const agentQuery = useQuery({
    queryKey: ['audit-agent-runs', userId, spaceId],
    queryFn: ({ signal }) => loadAgentRuns(spaceId!, addDays(new Date(), -AUDIT_WINDOW_DAYS).toISOString(), signal),
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

  const agentRuns: readonly AgentRunRecord[] = agentQuery.data?.runs ?? EMPTY;
  const timeline = useMemo(() => mergeAuditTimeline(runs, agentRuns), [runs, agentRuns]);

  return {
    spaceId,
    templates: ledger?.templates ?? EMPTY,
    deployments,
    runs,
    truncated: ledger?.truncated ?? false,
    stepsByRun,
    runsByDeployment,
    agentRuns,
    agentTruncated: agentQuery.data?.truncated ?? false,
    timeline,
    domains: domains.data,
    workers,
    loading: enabled && (query.isPending || agentQuery.isPending),
    error: enabled ? (query.error ?? agentQuery.error) : null,
    refetch: () => { void query.refetch(); void agentQuery.refetch(); },
  };
}

export type Audit = ReturnType<typeof useAudit>;

/** One agent run's steps and approvals as one event list, read only when
 *  the run's panel opens (the timeline itself never carries steps). */
export function useAgentRunEvents(runId: string | null) {
  const userId = useCurrentUserId();
  const query = useQuery({
    queryKey: ['audit-agent-run-events', userId, runId],
    queryFn: async ({ signal }) => {
      const [steps, actions] = await Promise.all([
        supabase.from('agent_run_steps').select('idx, type, title, detail, created_at').eq('run_id', runId!).order('idx').abortSignal(signal),
        supabase.from('agent_actions').select('status, summary, created_at, decision_source, policy_mode').eq('run_id', runId!).order('created_at').abortSignal(signal),
      ]);
      if (steps.error) throw new Error(`Unable to read the run's steps: ${steps.error.message}`);
      if (actions.error) throw new Error(`Unable to read the run's approvals: ${actions.error.message}`);
      const stepRows = (steps.data ?? []) as { idx: number; type: string; title: string; detail: string | null; created_at: string }[];
      const actionRows = (actions.data ?? []) as { status: 'pending' | 'approved' | 'rejected' | 'executed' | 'failed'; summary: string; created_at: string; decision_source: 'policy' | null; policy_mode: string | null }[];
      return { events: agentRunEvents(stepRows, actionRows), steps: stepRows, actions: actionRows };
    },
    enabled: Boolean(userId && runId),
    staleTime: 15_000,
  });
  return {
    events: query.data?.events ?? EMPTY,
    steps: query.data?.steps ?? EMPTY,
    actions: query.data?.actions ?? EMPTY,
    loading: query.isPending && Boolean(runId),
    error: query.error,
  };
}

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
