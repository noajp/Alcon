'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { AgentRunStatus } from '@/types/database';
import { createElement } from './elementData';
import { addIntentBinding, createIntent } from './strategyData';
import { setElementDependency } from './coordinationData';

// =============================================================
// An Initiative's mission, read and written: the runs, artifacts, approvals
// and dependencies of the Elements under its Objects (the Plan, Execute and
// Evaluate tabs), the Planner's draft (plan-initiative), and the draft turned
// into Elements bound to the measures they serve.
// =============================================================

export interface MissionRun {
  id: string;
  element_id: string;
  status: AgentRunStatus;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number | string;
  summary: string | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

export interface MissionArtifact { id: string; element_id: string; title: string; format: string; content: string; author_name: string | null; updated_at: string }
export interface MissionAction { id: string; element_id: string; summary: string; status: string; decision_note: string | null; decided_at: string | null; created_at: string }
export interface MissionEdge { from_element: string; to_element: string }

export interface MissionData { runs: MissionRun[]; artifacts: MissionArtifact[]; actions: MissionAction[]; edges: MissionEdge[] }

const EMPTY: MissionData = { runs: [], artifacts: [], actions: [], edges: [] };
const CHUNK = 100;

async function inChunks<T>(ids: string[], read: (chunk: string[]) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await read(ids.slice(i, i + CHUNK));
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as T[]));
  }
  return out;
}

async function fetchMission(elementIds: string[]): Promise<MissionData> {
  if (elementIds.length === 0) return EMPTY;
  const [runs, artifacts, actions, edges] = await Promise.all([
    inChunks<MissionRun>(elementIds, (c) => supabase.from('agent_runs')
      .select('id, element_id, status, model, input_tokens, output_tokens, cost_usd, summary, error, created_at, finished_at')
      .in('element_id', c).order('created_at', { ascending: false })),
    inChunks<MissionArtifact>(elementIds, (c) => supabase.from('agent_artifacts')
      .select('id, element_id, title, format, content, author_name, updated_at').in('element_id', c).order('updated_at', { ascending: false })),
    inChunks<MissionAction>(elementIds, (c) => supabase.from('agent_actions')
      .select('id, element_id, summary, status, decision_note, decided_at, created_at').in('element_id', c).order('created_at', { ascending: false })),
    inChunks<MissionEdge>(elementIds, (c) => supabase.from('element_edges')
      .select('from_element, to_element').eq('edge_type', 'depends_on').in('to_element', c)),
  ]);
  return { runs, artifacts, actions, edges };
}

const OPEN: AgentRunStatus[] = ['queued', 'running'];

/** The mission's rows for these Elements. Re-read every 5s while any run is working. */
export function useInitiativeMission(initiativeId: string, elementIds: string[]) {
  const key = ['initiative-mission', initiativeId, [...elementIds].sort().join(',')];
  const query = useQuery({
    queryKey: key,
    queryFn: () => fetchMission(elementIds),
    staleTime: 5_000,
    refetchInterval: (q) => ((q.state.data as MissionData | undefined)?.runs.some((r) => OPEN.includes(r.status)) ? 5_000 : false),
  });
  const qc = useQueryClient();
  return {
    data: query.data ?? EMPTY,
    loading: query.isPending,
    error: (query.error as Error | null) ?? null,
    refetch: () => qc.invalidateQueries({ queryKey: ['initiative-mission', initiativeId] }),
  };
}

// ── The Planner ─────────────────────────────────────────────────────────────

/** Asks the Planner for a draft. The raw draft is checked by normalizePlan. */
export async function requestInitiativePlan(initiativeId: string, guidance: string): Promise<unknown> {
  const { data, error } = await supabase.functions.invoke('plan-initiative', { body: { initiativeId, guidance } });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    let message = error.message;
    if (ctx && typeof ctx.json === 'function') {
      try { const j = await ctx.json(); if (j?.error) message = String(j.error); } catch { /* keep */ }
    }
    throw new Error(message);
  }
  return (data as { plan?: unknown } | null)?.plan ?? null;
}

export interface ApplyPlanInput {
  initiativeId: string;
  spaceId: string | null;
  /** The Object the new Elements go into. */
  objectId: string;
  /** The Initiative's root intent, for new objectives; null when the viewer may not write intents. */
  rootIntentId: string | null;
  /** The AI Worker the ai tasks are assigned to; null leaves them unassigned. */
  aiWorkerId: string | null;
  objectives: { key: string; title: string; measureId: string | null }[];
  tasks: { key: string; title: string; description: string; objective: string | null; dependsOn: string[]; assignee: 'ai' | 'human' }[];
}

export interface ApplyPlanResult { created: number; failed: string[] }

/** Writes an approved draft: new objectives become measures (when the viewer
 *  may), each task an Element bound with 'delivers' to the measure it serves,
 *  its predecessors as depends_on edges, and ai tasks assigned to the AI
 *  Worker. A step that fails is reported by task, not thrown; the rest go on. */
export async function applyInitiativePlan(input: ApplyPlanInput): Promise<ApplyPlanResult> {
  const failed: string[] = [];
  const measureFor = new Map<string, string>();
  for (const o of input.objectives) {
    if (o.measureId) { measureFor.set(o.key, o.measureId); continue; }
    if (!input.rootIntentId) continue;
    try {
      const intent = await createIntent({ strategy_id: input.initiativeId, parent_intent_id: input.rootIntentId, kind: 'measure', title: o.title });
      measureFor.set(o.key, intent.id);
    } catch {
      failed.push(o.title);
    }
  }
  const elementFor = new Map<string, string>();
  for (const t of input.tasks) {
    try {
      const el = await createElement({ title: t.title, description: t.description || null, object_id: input.objectId, status: 'todo' });
      elementFor.set(t.key, el.id);
      const measureId = t.objective ? measureFor.get(t.objective) : undefined;
      if (measureId) {
        await addIntentBinding({ intent_id: measureId, target_type: 'element', target_id: el.id, relationship_type: 'delivers' });
      }
      if (t.assignee === 'ai' && input.aiWorkerId) {
        const { error } = await supabase.from('element_assignees').insert({ element_id: el.id, worker_id: input.aiWorkerId, role: 'assignee' });
        if (error) throw new Error(error.message);
      }
    } catch {
      failed.push(t.title);
    }
  }
  if (input.spaceId) {
    for (const t of input.tasks) {
      const down = elementFor.get(t.key);
      if (!down) continue;
      for (const d of t.dependsOn) {
        const up = elementFor.get(d);
        if (!up) continue;
        try {
          await setElementDependency({ spaceId: input.spaceId, upstreamId: up, downstreamId: down });
        } catch {
          failed.push(t.title);
        }
      }
    }
  }
  return { created: elementFor.size, failed: [...new Set(failed)] };
}
