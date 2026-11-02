// An Initiative read as a mission: what it is held to (its measures), the
// actions that serve them (Elements, bound with 'delivers'), the order they
// run in (depends_on edges) and what they produced (artifacts) — the graph on
// the Plan tab, the tallies on Execute and Evaluate, and the Planner's draft
// before anything is written.
//
// Pure — hooks/initiativeMissionData.ts reads the rows, the Initiative's
// tabs draw them; tests/missionModel.test.ts checks this file.

import type { AgentRunStatus } from '@/types/database';
import { measureState, type MeasureState } from '../initiativeMeasureModel';

export interface MissionElementRow {
  id: string;
  title: string;
  status: string | null;
  display_id: string | null;
  object_id: string | null;
}

export interface MissionMeasureRow {
  id: string;
  title: string;
  target_value: number | null;
  actual_value: number | null;
  unit: string | null;
  direction: 'at_least' | 'at_most' | null;
}

export interface MissionRunRow {
  element_id: string;
  model?: string | null;
  status: AgentRunStatus;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number | string;
  summary: string | null;
  error: string | null;
  created_at: string;
}

export interface MissionBindingRow { intent_id: string; target_type: string; target_id: string; relationship_type: string }
export interface MissionEdgeRow { from_element: string; to_element: string }
export interface MissionArtifactRow { id: string; element_id: string; title: string }

/** Pure. A measure's reading against its target. */
export function measureStateOf(m: MissionMeasureRow): MeasureState {
  return measureState({
    id: m.id, title: m.title, target: m.target_value, actual: m.actual_value, unit: m.unit,
    direction: m.direction, measuredAt: null, orderIndex: 0,
  });
}

/** Where an action stands, read from its Element and its latest run. */
export type ActionState = 'done' | 'running' | 'waiting' | 'blocked' | 'failed' | 'todo' | 'cancelled';

/** Pure. The latest run per Element. */
export function latestRuns(runs: readonly MissionRunRow[]): Map<string, MissionRunRow> {
  const out = new Map<string, MissionRunRow>();
  for (const r of runs) {
    const seen = out.get(r.element_id);
    if (!seen || r.created_at > seen.created_at) out.set(r.element_id, r);
  }
  return out;
}

/** Pure. The Element's own status decides done / cancelled / blocked; an open
 *  run says it is moving or waiting on a person; a failed last run with the
 *  work still open says so. */
export function actionState(element: MissionElementRow, run: MissionRunRow | undefined): ActionState {
  if (element.status === 'done') return 'done';
  if (element.status === 'cancelled') return 'cancelled';
  if (element.status === 'blocked') return 'blocked';
  if (run) {
    if (run.status === 'queued' || run.status === 'running') return 'running';
    if (run.status === 'awaiting_approval' || run.status === 'paused') return 'waiting';
    if (run.status === 'failed') return 'failed';
  }
  if (element.status === 'review') return 'waiting';
  if (element.status === 'in_progress') return 'running';
  return 'todo';
}

// ── Graph ──────────────────────────────────────────────────────────────────

export type MissionNodeKind = 'initiative' | 'measure' | 'action' | 'artifact';

export interface MissionNode {
  id: string;
  kind: MissionNodeKind;
  label: string;
  /** The column it is drawn in, left to right. */
  column: 0 | 1 | 2 | 3;
  /** Actions: where they stand. Measures: the reading against the target. */
  state: ActionState | MeasureState | null;
  /** True for a node of the Planner's draft, not yet written. */
  draft?: boolean;
  /** The Element it opens, for actions. */
  elementId?: string;
}

export interface MissionEdge {
  from: string;
  to: string;
  kind: 'serves' | 'depends' | 'produces';
  draft?: boolean;
}

export interface MissionGraph { nodes: MissionNode[]; edges: MissionEdge[] }

/** The node id of the Initiative itself; actions serving no measure hang off it. */
const ROOT = 'initiative';

/** Pure. The mission as it stands: measures, the Elements under the
 *  Initiative's Objects, what each serves, what each waits on, what each made. */
export function buildMissionGraph(input: {
  initiativeName: string;
  measures: readonly MissionMeasureRow[];
  elements: readonly MissionElementRow[];
  bindings: readonly MissionBindingRow[];
  edges: readonly MissionEdgeRow[];
  runs: readonly MissionRunRow[];
  artifacts: readonly MissionArtifactRow[];
}): MissionGraph {
  const nodes: MissionNode[] = [{ id: ROOT, kind: 'initiative', label: input.initiativeName, column: 0, state: null }];
  const edges: MissionEdge[] = [];
  const measureIds = new Set(input.measures.map((m) => m.id));
  for (const m of input.measures) {
    nodes.push({
      id: `m:${m.id}`, kind: 'measure', label: m.title, column: 1,
      state: measureStateOf(m),
    });
    edges.push({ from: ROOT, to: `m:${m.id}`, kind: 'serves' });
  }
  const runs = latestRuns(input.runs);
  const elementIds = new Set(input.elements.map((e) => e.id));
  const served = new Map<string, string[]>();
  for (const b of input.bindings) {
    if (b.target_type !== 'element' || b.relationship_type !== 'delivers') continue;
    if (!measureIds.has(b.intent_id) || !elementIds.has(b.target_id)) continue;
    served.set(b.target_id, [...(served.get(b.target_id) ?? []), b.intent_id]);
  }
  for (const e of input.elements) {
    nodes.push({
      id: `e:${e.id}`, kind: 'action', label: e.display_id ? `${e.display_id} ${e.title}` : e.title, column: 2,
      state: actionState(e, runs.get(e.id)), elementId: e.id,
    });
    const targets = served.get(e.id);
    if (targets?.length) for (const t of targets) edges.push({ from: `m:${t}`, to: `e:${e.id}`, kind: 'serves' });
    else edges.push({ from: ROOT, to: `e:${e.id}`, kind: 'serves' });
  }
  for (const d of input.edges) {
    if (elementIds.has(d.from_element) && elementIds.has(d.to_element)) {
      edges.push({ from: `e:${d.from_element}`, to: `e:${d.to_element}`, kind: 'depends' });
    }
  }
  for (const a of input.artifacts) {
    if (!elementIds.has(a.element_id)) continue;
    nodes.push({ id: `a:${a.id}`, kind: 'artifact', label: a.title, column: 3, state: null });
    edges.push({ from: `e:${a.element_id}`, to: `a:${a.id}`, kind: 'produces' });
  }
  return { nodes, edges };
}

// ── Tallies ────────────────────────────────────────────────────────────────

export interface MissionSummary {
  actions: number;
  done: number;
  running: number;
  waiting: number;
  blocked: number;
  failed: number;
  /** Done over everything not cancelled, 0–100. */
  progress: number;
  measures: number;
  measuresMet: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  artifacts: number;
}

/** Pure. Every run's tokens and cost count, not only the latest. */
export function missionSummary(input: {
  elements: readonly MissionElementRow[];
  measures: readonly MissionMeasureRow[];
  runs: readonly MissionRunRow[];
  artifacts: readonly MissionArtifactRow[];
}): MissionSummary {
  const runs = latestRuns(input.runs);
  const states = input.elements.map((e) => actionState(e, runs.get(e.id)));
  const count = (s: ActionState) => states.filter((x) => x === s).length;
  const live = states.filter((s) => s !== 'cancelled').length;
  const done = count('done');
  return {
    actions: live,
    done,
    running: count('running'),
    waiting: count('waiting'),
    blocked: count('blocked'),
    failed: count('failed'),
    progress: live === 0 ? 0 : Math.round((done / live) * 100),
    measures: input.measures.length,
    measuresMet: input.measures.filter((m) => measureStateOf(m) === 'met').length,
    inputTokens: input.runs.reduce((n, r) => n + (r.input_tokens || 0), 0),
    outputTokens: input.runs.reduce((n, r) => n + (r.output_tokens || 0), 0),
    costUsd: Math.round(input.runs.reduce((n, r) => n + Number(r.cost_usd || 0), 0) * 100) / 100,
    artifacts: input.artifacts.length,
  };
}

/** One thing standing in the mission's way, for the Evaluate tab. */
export interface MissionBarrier {
  elementId: string;
  label: string;
  kind: 'blocked' | 'failed' | 'waiting';
  detail: string | null;
}

/** Pure. Blocked first, then failed runs, then work waiting on a person. */
export function missionBarriers(elements: readonly MissionElementRow[], runs: readonly MissionRunRow[]): MissionBarrier[] {
  const latest = latestRuns(runs);
  const order: Record<MissionBarrier['kind'], number> = { blocked: 0, failed: 1, waiting: 2 };
  const out: MissionBarrier[] = [];
  for (const e of elements) {
    const run = latest.get(e.id);
    const state = actionState(e, run);
    if (state !== 'blocked' && state !== 'failed' && state !== 'waiting') continue;
    out.push({
      elementId: e.id,
      label: e.display_id ? `${e.display_id} ${e.title}` : e.title,
      kind: state,
      detail: state === 'failed' ? run?.error ?? null : run?.summary ?? run?.error ?? null,
    });
  }
  return out.sort((a, b) => order[a.kind] - order[b.kind]);
}

// ── The Planner's draft ────────────────────────────────────────────────────

export interface PlanObjective {
  key: string;
  title: string;
  /** An existing measure this objective is; absent for a new one. */
  measureId: string | null;
}

export interface PlanTask {
  key: string;
  title: string;
  description: string;
  objective: string | null;
  dependsOn: string[];
  assignee: 'ai' | 'human';
}

export interface PlanDraft { summary: string; objectives: PlanObjective[]; tasks: PlanTask[] }

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Pure. The Planner's answer as the screen may use it: keys unique, every
 *  reference pointing at something in the draft, measure ids only ones this
 *  Initiative has, dependencies without cycles. Anything else is dropped. */
export function normalizePlan(raw: unknown, measureIds: ReadonlySet<string>): PlanDraft {
  const r = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const objectives: PlanObjective[] = [];
  const objectiveKeys = new Set<string>();
  for (const o of Array.isArray(r.objectives) ? r.objectives : []) {
    const x = o && typeof o === 'object' ? o as Record<string, unknown> : {};
    const key = text(x.key, 40);
    const title = text(x.title, 200);
    if (!key || !title || objectiveKeys.has(key)) continue;
    const measureId = typeof x.measureId === 'string' && measureIds.has(x.measureId) ? x.measureId : null;
    objectiveKeys.add(key);
    objectives.push({ key, title, measureId });
  }
  const tasks: PlanTask[] = [];
  const taskKeys = new Set<string>();
  for (const t of Array.isArray(r.tasks) ? r.tasks : []) {
    const x = t && typeof t === 'object' ? t as Record<string, unknown> : {};
    const key = text(x.key, 40);
    const title = text(x.title, 200);
    if (!key || !title || taskKeys.has(key)) continue;
    taskKeys.add(key);
    const objective = typeof x.objective === 'string' && objectiveKeys.has(x.objective) ? x.objective : null;
    const dependsOn = (Array.isArray(x.dependsOn) ? x.dependsOn : []).filter((d): d is string => typeof d === 'string');
    tasks.push({
      key, title, description: text(x.description, 4000), objective, dependsOn,
      assignee: x.assignee === 'human' ? 'human' : 'ai',
    });
    if (tasks.length >= 30) break;
  }
  // Only dependencies on earlier tasks: keeps them pointing somewhere real
  // and makes a cycle impossible.
  const seen = new Set<string>();
  for (const t of tasks) {
    t.dependsOn = [...new Set(t.dependsOn)].filter((d) => seen.has(d));
    seen.add(t.key);
  }
  return { summary: text(r.summary, 1000), objectives, tasks };
}

/** Pure. The draft drawn on the same graph, its nodes marked as draft. */
export function draftGraph(initiativeName: string, measures: readonly MissionMeasureRow[], draft: PlanDraft): MissionGraph {
  const nodes: MissionNode[] = [{ id: ROOT, kind: 'initiative', label: initiativeName, column: 0, state: null }];
  const edges: MissionEdge[] = [];
  const objectiveNode = new Map<string, string>();
  for (const o of draft.objectives) {
    const existing = o.measureId ? measures.find((m) => m.id === o.measureId) : undefined;
    const id = existing ? `m:${existing.id}` : `o:${o.key}`;
    objectiveNode.set(o.key, id);
    if (nodes.some((n) => n.id === id)) continue;
    nodes.push({
      id, kind: 'measure', label: existing?.title ?? o.title, column: 1,
      state: existing ? measureStateOf(existing) : null,
      draft: !existing,
    });
    edges.push({ from: ROOT, to: id, kind: 'serves', draft: !existing });
  }
  for (const t of draft.tasks) {
    nodes.push({ id: `t:${t.key}`, kind: 'action', label: t.title, column: 2, state: 'todo', draft: true });
    const parent = (t.objective && objectiveNode.get(t.objective)) || ROOT;
    edges.push({ from: parent, to: `t:${t.key}`, kind: 'serves', draft: true });
    for (const d of t.dependsOn) edges.push({ from: `t:${d}`, to: `t:${t.key}`, kind: 'depends', draft: true });
  }
  return { nodes, edges };
}
