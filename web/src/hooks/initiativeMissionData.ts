'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { AgentRunStatus, AiWeight } from '@/types/database';
import { createElement } from './elementData';
import { createObject } from './objectData';
import { addIntentBinding, createIntent } from './strategyData';
import { setElementDependency } from './coordinationData';
import { setElementAiWeight, setElementDefinition } from './definitionData';
import { parseProposedReadings, parseRunVerdict, type ProposedReading, type RunVerdict } from '@/Function/audit/auditModel';

// =============================================================
// A Strategy's mission, read and written: the runs, artifacts, approvals
// and dependencies of the Elements under its Objects (the Execution and
// Evaluate tabs), the Planner's draft (plan-initiative), and the draft turned
// into Objects and Elements bound to the measures they serve.
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
  /** The verifier's record of the finish that stood, parsed at this boundary. */
  verdict: RunVerdict | null;
  /** The readings the finish proposed, and which of them landed. */
  proposed_readings: ProposedReading[] | null;
}

export interface MissionArtifact { id: string; element_id: string; title: string; format: string; content: string; author_name: string | null; updated_at: string }
export interface MissionAction { id: string; element_id: string; summary: string; status: string; decision_note: string | null; decided_at: string | null; created_at: string }
export interface MissionEdge { from_element: string; to_element: string }
/** One row of a measure's reading history — the shape missionModel's
 *  MissionReadingRow describes; kept here so hooks never import the view layer. */
export interface MissionReading { intent_id: string; value: number | null; measured_at: string | null; source: string; recorded_by_name: string | null; recorded_at: string }

export interface MissionData { runs: MissionRun[]; artifacts: MissionArtifact[]; actions: MissionAction[]; edges: MissionEdge[]; readings: MissionReading[] }

const EMPTY: MissionData = { runs: [], artifacts: [], actions: [], edges: [], readings: [] };
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

type MissionRunRaw = Omit<MissionRun, 'verdict' | 'proposed_readings'> & { verdict: unknown; proposed_readings: unknown };

async function fetchMission(elementIds: string[], measureIds: string[]): Promise<MissionData> {
  if (elementIds.length === 0 && measureIds.length === 0) return EMPTY;
  const [rawRuns, artifacts, actions, edges, readings] = await Promise.all([
    elementIds.length === 0 ? [] : inChunks<MissionRunRaw>(elementIds, (c) => supabase.from('agent_runs')
      .select('id, element_id, status, model, input_tokens, output_tokens, cost_usd, summary, error, created_at, finished_at, verdict, proposed_readings')
      .in('element_id', c).order('created_at', { ascending: false })),
    elementIds.length === 0 ? [] : inChunks<MissionArtifact>(elementIds, (c) => supabase.from('agent_artifacts')
      .select('id, element_id, title, format, content, author_name, updated_at').in('element_id', c).order('updated_at', { ascending: false })),
    elementIds.length === 0 ? [] : inChunks<MissionAction>(elementIds, (c) => supabase.from('agent_actions')
      .select('id, element_id, summary, status, decision_note, decided_at, created_at').in('element_id', c).order('created_at', { ascending: false })),
    elementIds.length === 0 ? [] : inChunks<MissionEdge>(elementIds, (c) => supabase.from('element_edges')
      .select('from_element, to_element').eq('edge_type', 'depends_on').in('to_element', c)),
    // The latest reading per measure of this Strategy: the history table is
    // indexed (intent_id, recorded_at desc) for exactly this read; the
    // reduction to latest-per-measure happens in measureOutcomes.
    measureIds.length === 0 ? [] : inChunks<MissionReading>(measureIds, (c) => supabase.from('intent_measure_readings')
      .select('intent_id, value, measured_at, source, recorded_by_name, recorded_at')
      .in('intent_id', c).order('recorded_at', { ascending: false })),
  ]);
  const runs: MissionRun[] = rawRuns.map((r) => ({
    ...r, verdict: parseRunVerdict(r.verdict), proposed_readings: parseProposedReadings(r.proposed_readings),
  }));
  return { runs, artifacts, actions, edges, readings };
}

const OPEN: AgentRunStatus[] = ['queued', 'running'];

/** The mission's rows for these Elements and measures. Re-read every 5s while any run is working. */
export function useInitiativeMission(initiativeId: string, elementIds: string[], measureIds: string[] = []) {
  const key = ['initiative-mission', initiativeId, [...elementIds].sort().join(','), [...measureIds].sort().join(',')];
  const query = useQuery({
    queryKey: key,
    queryFn: () => fetchMission(elementIds, measureIds),
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

/** What the Planner answered: a draft, or questions to answer first, and how it read the Strategy's files. */
export interface PlannerReply { plan: unknown; questions: unknown; reason: string; sources: unknown }

/** Asks the Planner for a draft. It may ask questions first, unless answers
 *  are given or `noQuestions` is set. The raw reply is checked by
 *  normalizePlan / normalizeQuestions / plannerSources. */
export async function requestInitiativePlan(
  initiativeId: string,
  guidance: string,
  opts: { answers?: { question: string; answer: string }[]; noQuestions?: boolean } = {},
): Promise<PlannerReply> {
  const { data, error } = await supabase.functions.invoke('plan-initiative', {
    body: { initiativeId, guidance, answers: opts.answers ?? [], noQuestions: opts.noQuestions ?? false },
  });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    let message = error.message;
    if (ctx && typeof ctx.json === 'function') {
      try { const j = await ctx.json(); if (j?.error) message = String(j.error); } catch { /* keep */ }
    }
    throw new Error(message);
  }
  const d = (data ?? {}) as { plan?: unknown; questions?: unknown; reason?: unknown; sources?: unknown };
  return { plan: d.plan ?? null, questions: d.questions ?? null, reason: typeof d.reason === 'string' ? d.reason : '', sources: d.sources ?? null };
}

export interface ApplyPlanInput {
  initiativeId: string;
  spaceId: string | null;
  /** Where tasks the Planner placed in no Object go; null leaves them out. */
  fallbackObjectId: string | null;
  /** Where a new Object goes when the Planner named no Domain. */
  fallbackDomainId: string | null;
  /** The Strategy's root intent, for new objectives; null when the viewer may not write intents. */
  rootIntentId: string | null;
  /** The AI Worker the ai tasks are assigned to; null leaves them unassigned. */
  aiWorkerId: string | null;
  /** The AI Worker runs in Claude Code: hand its tasks over on creation. */
  dispatch?: boolean;
  objectives: { key: string; title: string; measureId: string | null }[];
  objects: { key: string; objectId: string | null; name: string; domainId: string | null }[];
  tasks: { key: string; title: string; description: string; objective: string | null; object: string | null; dependsOn: string[]; assignee: 'ai' | 'human'; definitionId?: string | null; weight?: AiWeight | null; action?: string | null; assigneeWorkerId?: string | null }[];
}

export interface ApplyPlanResult {
  created: number;
  failed: string[];
  /** The Element written for each task, by task key. */
  elementIds: Record<string, string>;
}

/** Writes an approved draft: new Objects in their Domains, linked to the
 *  Strategy; new objectives as measures (when the viewer may); each task an
 *  Element in its Object, bound with 'delivers' to the measure it serves,
 *  its predecessors as depends_on edges, ai tasks assigned to the AI Worker
 *  and a person's tasks to the person the Planner chose (normalizePlan keeps
 *  only the Space's people), else to whoever approved the draft — so each
 *  lands in someone's queue. A step that fails is reported by name, not thrown; the rest go on. */
/** The signed-in person's own Worker, or null when they have none. */
async function approverWorkerId(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from('workers').select('id').eq('user_id', user.id).eq('type', 'human').limit(1).maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

export async function applyInitiativePlan(input: ApplyPlanInput): Promise<ApplyPlanResult> {
  const failed: string[] = [];
  const objectFor = new Map<string, string>();
  for (const o of input.objects) {
    if (o.objectId) { objectFor.set(o.key, o.objectId); continue; }
    const domainId = o.domainId ?? input.fallbackDomainId;
    try {
      if (!domainId) throw new Error('no Domain');
      const created = await createObject({ name: o.name, domain_id: domainId, domain_ids: [domainId] });
      const { error } = await supabase.from('strategy_objects')
        .upsert({ strategy_id: input.initiativeId, object_id: created.id }, { onConflict: 'strategy_id,object_id', ignoreDuplicates: true });
      if (error) throw new Error(error.message);
      objectFor.set(o.key, created.id);
    } catch {
      failed.push(o.name);
    }
  }
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
  const approverId = input.tasks.some((t) => t.assignee === 'human' && !t.assigneeWorkerId) ? await approverWorkerId() : null;
  const elementFor = new Map<string, string>();
  for (const t of input.tasks) {
    const objectId = t.object ? objectFor.get(t.object) : input.fallbackObjectId;
    if (!objectId) { failed.push(t.title); continue; }
    try {
      // Work for a Claude Code agent is handed over with the plan's approval:
      // the 'dispatch' label is what the dev loop's dispatcher starts.
      const handOver = t.assignee === 'ai' && !!input.aiWorkerId && !!input.dispatch;
      const el = await createElement({
        title: t.title, description: t.description || null, object_id: objectId, status: 'todo',
        ...(t.action ? { action: t.action } : {}),
        ...(handOver ? { labels: ['dispatch'] } : {}),
      });
      elementFor.set(t.key, el.id);
      // The definition the Planner matched to this task, from the Space's library.
      if (t.definitionId) await setElementDefinition(el.id, t.definitionId);
      // How heavy the Planner judged it, for the model an AI run picks.
      if (t.assignee === 'ai' && t.weight) await setElementAiWeight(el.id, t.weight);
      const measureId = t.objective ? measureFor.get(t.objective) : undefined;
      if (measureId) {
        await addIntentBinding({ intent_id: measureId, target_type: 'element', target_id: el.id, relationship_type: 'delivers' });
      }
      const workerId = t.assignee === 'ai' ? input.aiWorkerId : t.assigneeWorkerId || approverId;
      if (workerId) {
        const { error } = await supabase.from('element_assignees').insert({ element_id: el.id, worker_id: workerId, role: 'assignee' });
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
  return { created: elementFor.size, failed: [...new Set(failed)], elementIds: Object.fromEntries(elementFor) };
}
