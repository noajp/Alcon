// A Strategy read as a mission: what it is held to (its measures), the
// Objects its work sits in and the Elements that carry it out (bound to the
// measures with 'delivers'), the order they run in (depends_on edges) and
// what they produced (artifacts) — the Object and Element columns on the
// Execution tab, with the Planner's draft laid over them before anything is
// written, and the tallies on Execution and Evaluate.
//
// Pure — hooks/initiativeMissionData.ts reads the rows, the Strategy's
// tabs draw them; tests/missionModel.test.ts checks this file.

import { isAiWeight, type AgentRunStatus, type AiWeight, type Worker } from '@/types/database';
import { measureState, type MeasureState } from '../initiativeMeasureModel';
import { isElementAction, type ElementAction } from '@/Function/shared/elementActionKinds';
import type { ProposedReading, RunVerdict } from '@/Function/audit/auditModel';

export interface MissionElementRow {
  id: string;
  title: string;
  status: string | null;
  display_id: string | null;
  object_id: string | null;
  labels?: readonly string[] | null;
  /** An assignee runs in Claude Code: the dev loop's dispatcher starts it, not run-agent. */
  claudeCode?: boolean;
  /** A session holds an unexpired lease on it (Function/shared/element/lease.ts). */
  leased?: boolean;
  /** Who carries it out: an AI Worker, a person, or nobody yet. */
  assignee?: 'ai' | 'human' | null;
  /** What it asks someone to do (elements.action). */
  action?: ElementAction | null;
  assigneeName?: string | null;
  /** The Worker itself, for its avatar. */
  assigneeWorker?: MissionWorker | null;
  due_date?: string | null;
}

/** What a card needs of a Worker to draw its avatar. */
export interface MissionWorker { name?: string | null; type?: Worker['type'] | null; avatar_url?: string | null; ai_model?: string | null }

/** The label that hands an Element to the dev loop's dispatcher. */
const DISPATCH_LABEL = 'dispatch';

/** Pure. Claude Code work has been handed over (the dispatcher will start it). */
export function isHandedOver(element: MissionElementRow): boolean {
  return (element.labels ?? []).includes(DISPATCH_LABEL);
}

/** Pure. The labels that hand an Element over. */
export function handOverLabels(labels: readonly string[] | null | undefined): string[] {
  const current = [...(labels ?? [])];
  return current.includes(DISPATCH_LABEL) ? current : [...current, DISPATCH_LABEL];
}

export interface MissionMeasureRow {
  id: string;
  title: string;
  target_value: number | null;
  actual_value: number | null;
  unit: string | null;
  direction: 'at_least' | 'at_most' | null;
  /** When the current value was measured (intents.measured_at); null when never. */
  measured_at: string | null;
}

export interface MissionRunRow {
  id: string;
  element_id: string;
  model?: string | null;
  status: AgentRunStatus;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number | string;
  summary: string | null;
  error: string | null;
  created_at: string;
  /** The verifier's record of the finish that stood; null when none was written. */
  verdict: RunVerdict | null;
  /** The readings the finish proposed, and which of them landed. */
  proposed_readings: ProposedReading[] | null;
}

/** One row of a measure's reading history (intent_measure_readings). */
export interface MissionReadingRow {
  intent_id: string;
  value: number | null;
  measured_at: string | null;
  source: string;
  recorded_by_name: string | null;
  recorded_at: string;
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
  // Claude Code work has no run row: a held lease is the session working on it.
  if (element.claudeCode) {
    if (element.status === 'review') return 'waiting';
    return element.leased ? 'running' : 'todo';
  }
  if (run) {
    if (run.status === 'queued' || run.status === 'running') return 'running';
    if (run.status === 'awaiting_approval' || run.status === 'paused') return 'waiting';
    if (run.status === 'failed') return 'failed';
  }
  if (element.status === 'review') return 'waiting';
  if (element.status === 'in_progress') return 'running';
  return 'todo';
}

// ── Objects and Elements ─────────────────────────────────────────────────────

/** One Element as a card in the Object's column — written, or a task of the
 *  Planner's draft. */
export interface FleetElement {
  /** The Element's id, or `t:<task key>` for a draft task. */
  key: string;
  elementId: string | null;
  title: string;
  state: ActionState;
  draft: boolean;
  assignee: 'ai' | 'human' | null;
  /** What it asks someone to do; null when not said. */
  action: ElementAction | null;
  assigneeName: string | null;
  assigneeWorker: MissionWorker | null;
  /** The Element's own status; a draft task is 'todo'. */
  status: string;
  /** Its latest run's verdict — an overlay on the state, never a state. */
  verdict: RunVerdict | null;
  dueDate: string | null;
  /** The measures it delivers, by title. */
  serves: string[];
  /** Predecessors not done yet, by title. */
  waitsOn: string[];
  /** An AI may start it now: not a person's, not Claude Code's, open, and
   *  nothing it waits on is unfinished. */
  ready: boolean;
  /** Claude Code work waiting to be handed to the dispatcher. */
  handable: boolean;
  model: string | null;
  costUsd: number;
}

export interface FleetTally { total: number; done: number; running: number; waiting: number; stopped: number }

/** One Object as a card, with the Elements under it. */
export interface FleetObject {
  /** The Object's id, or `b:<object key>` for one the draft adds. */
  key: string;
  objectId: string | null;
  name: string;
  domainId: string | null;
  /** The Object's own icon and colour, when it has them. */
  icon?: string | null;
  color?: string | null;
  draft: boolean;
  elements: FleetElement[];
  tally: FleetTally;
  /** Its Elements' latest verdicts, tallied the same way. */
  verdicts: VerdictTally;
  /** The state that most needs a look: stopped, then waiting, running, open, done. */
  state: ActionState;
  costUsd: number;
}

export interface FleetObjectRow { id: string; name: string; domain_id: string | null; icon?: string | null; color?: string | null }

const roundCost = (n: number) => Math.round(n * 100) / 100;

/** What needs a look comes first: stopped, waiting on a person, running, not
 *  started, then finished. */
const CARD_ORDER: Record<ActionState, number> = { failed: 0, blocked: 0, waiting: 1, running: 2, todo: 3, done: 4, cancelled: 5 };

function tallyOf(elements: readonly FleetElement[]): FleetTally {
  const live = elements.filter((e) => e.state !== 'cancelled');
  return {
    total: live.length,
    done: live.filter((e) => e.state === 'done').length,
    running: live.filter((e) => e.state === 'running').length,
    waiting: live.filter((e) => e.state === 'waiting').length,
    stopped: live.filter((e) => e.state === 'blocked' || e.state === 'failed').length,
  };
}

function objectState(t: FleetTally, elements: readonly FleetElement[]): ActionState {
  if (t.stopped) return elements.some((e) => e.state === 'failed') ? 'failed' : 'blocked';
  if (t.waiting) return 'waiting';
  if (t.running) return 'running';
  if (t.total > 0 && t.done === t.total) return 'done';
  return 'todo';
}

function withTally(o: Omit<FleetObject, 'tally' | 'verdicts' | 'state' | 'costUsd'>): FleetObject {
  const tally = tallyOf(o.elements);
  return {
    ...o, tally, verdicts: countVerdicts(o.elements.map((e) => e.verdict)),
    state: objectState(tally, o.elements), costUsd: roundCost(o.elements.reduce((n, e) => n + e.costUsd, 0)),
  };
}

/** Pure. The Strategy's Objects in their order, each with its Elements —
 *  what needs a look first — and where each stands, who carries it out, what it delivers, what it waits on, and
 *  whether an AI may start it now. */
export function buildFleet(input: {
  objects: readonly FleetObjectRow[];
  elements: readonly MissionElementRow[];
  measures: readonly MissionMeasureRow[];
  bindings: readonly MissionBindingRow[];
  edges: readonly MissionEdgeRow[];
  runs: readonly MissionRunRow[];
}): FleetObject[] {
  const latest = latestRuns(input.runs);
  const costs = new Map<string, number>();
  for (const r of input.runs) costs.set(r.element_id, (costs.get(r.element_id) ?? 0) + Number(r.cost_usd || 0));
  const state = new Map(input.elements.map((e) => [e.id, actionState(e, latest.get(e.id))]));
  const title = new Map(input.elements.map((e) => [e.id, e.display_id ? `${e.display_id} ${e.title}` : e.title]));
  const measureTitle = new Map(input.measures.map((m) => [m.id, m.title]));
  const serves = new Map<string, string[]>();
  for (const b of input.bindings) {
    if (b.target_type !== 'element' || b.relationship_type !== 'delivers') continue;
    const m = measureTitle.get(b.intent_id);
    if (m) serves.set(b.target_id, [...(serves.get(b.target_id) ?? []), m]);
  }
  const upstream = new Map<string, string[]>();
  for (const d of input.edges) {
    if (state.has(d.from_element)) upstream.set(d.to_element, [...(upstream.get(d.to_element) ?? []), d.from_element]);
  }
  const card = (e: MissionElementRow): FleetElement => {
    const s = state.get(e.id)!;
    const waitsOn = (upstream.get(e.id) ?? []).filter((u) => state.get(u) !== 'done' && state.get(u) !== 'cancelled').map((u) => title.get(u)!);
    const open = s === 'todo' || s === 'failed';
    const run = latest.get(e.id);
    return {
      key: e.id, elementId: e.id, title: title.get(e.id)!, state: s, draft: false,
      assignee: e.assignee ?? null, action: e.action ?? null, assigneeName: e.assigneeName ?? null, assigneeWorker: e.assigneeWorker ?? null,
      status: e.status ?? 'todo', dueDate: e.due_date ?? null,
      serves: serves.get(e.id) ?? [], waitsOn,
      ready: open && !e.claudeCode && e.assignee !== 'human' && waitsOn.length === 0,
      handable: !!e.claudeCode && s === 'todo' && !isHandedOver(e),
      verdict: run?.verdict ?? null,
      model: run?.model ?? null, costUsd: roundCost(costs.get(e.id) ?? 0),
    };
  };
  return input.objects.map((o) => withTally({
    key: o.id, objectId: o.id, name: o.name, domainId: o.domain_id, icon: o.icon ?? null, color: o.color ?? null, draft: false,
    elements: input.elements.filter((e) => e.object_id === o.id).map(card)
      .map((c, i) => ({ c, i }))
      .sort((x, y) => CARD_ORDER[x.c.state] - CARD_ORDER[y.c.state] || x.i - y.i)
      .map(({ c }) => c),
  }));
}

/** The key of the column that holds draft tasks the Planner put in no Object. */
export const UNPLACED = 'b:';

/** Pure. The draft laid over the Objects as they stand: its tasks join the
 *  Objects they name (dashed), the Objects it adds follow (dashed), and tasks
 *  it put nowhere gather in one column for the person to place. A person's
 *  task the Planner gave to someone carries that person's name, from `people`. */
export function draftFleet(
  current: readonly FleetObject[], measures: readonly MissionMeasureRow[], draft: PlanDraft,
  people: ReadonlyMap<string, string> = new Map(),
): FleetObject[] {
  const objectiveTitle = new Map(draft.objectives.map((o) => [
    o.key, (o.measureId && measures.find((m) => m.id === o.measureId)?.title) || o.title,
  ]));
  const taskTitle = new Map(draft.tasks.map((t) => [t.key, t.title]));
  const columnOf = new Map<string, string>();
  for (const o of draft.objects) columnOf.set(o.key, o.objectId && current.some((c) => c.objectId === o.objectId) ? o.objectId : `b:${o.key}`);
  const added = new Map<string, FleetElement[]>();
  for (const t of draft.tasks) {
    const column = (t.object && columnOf.get(t.object)) || UNPLACED;
    const objective = t.objective ? objectiveTitle.get(t.objective) : undefined;
    added.set(column, [...(added.get(column) ?? []), {
      key: `t:${t.key}`, elementId: null, title: t.title, state: 'todo', draft: true,
      assignee: t.assignee, action: t.action ?? null,
      assigneeName: (t.assigneeWorkerId && people.get(t.assigneeWorkerId)) || null, assigneeWorker: null, status: 'todo', verdict: null, dueDate: null,
      serves: objective ? [objective] : [],
      waitsOn: t.dependsOn.map((d) => taskTitle.get(d)!).filter(Boolean),
      ready: false, handable: false, model: null, costUsd: 0,
    }]);
  }
  const out = current.map((o) => (added.has(o.key) ? withTally({ ...o, elements: [...o.elements, ...added.get(o.key)!] }) : o));
  for (const o of draft.objects) {
    const key = columnOf.get(o.key)!;
    if (!key.startsWith('b:') || out.some((x) => x.key === key)) continue;
    out.push(withTally({ key, objectId: null, name: o.name, domainId: o.domainId, draft: true, elements: added.get(key) ?? [] }));
  }
  if (added.has(UNPLACED)) {
    out.push(withTally({ key: UNPLACED, objectId: null, name: '', domainId: null, draft: true, elements: added.get(UNPLACED)! }));
  }
  return out;
}

// ── Verdicts and measure outcomes ────────────────────────────────────────
// Attribution, read-side: a verdict says whether the finish that stood was
// checked; a measure's history says where its current number came from.
// Both are tallied over the latest run per Element only — a re-run
// supersedes the run before it, in outcomes as in readings.

export type VerdictTally = { pass: number; fail: number; unchecked: number; none: number };

function countVerdicts(verdicts: readonly (RunVerdict | null)[]): VerdictTally {
  const tally: VerdictTally = { pass: 0, fail: 0, unchecked: 0, none: 0 };
  for (const v of verdicts) {
    if (!v) tally.none += 1;
    else tally[v.result] += 1;
  }
  return tally;
}

/** Verdicts of the latest run per Element. 'none' = no verdict recorded
 *  (no finished run, or a run from before verdicts). */
export function verdictTallyOf(runs: readonly MissionRunRow[]): VerdictTally {
  return countVerdicts([...latestRuns(runs).values()].map((r) => r.verdict));
}

export type MeasureFreshness = 'fresh' | 'aging' | 'stale' | 'never';

const DAY_MS = 86_400_000;

/** Pure. How old a measure's current value is, against an injected now:
 *  'fresh' ≤ freshDays, 'aging' ≤ agingDays, 'stale' beyond, 'never' when
 *  it was never measured. Ages are computed from timestamps, not dates. */
function measureFreshness(measuredAt: string | null, now: Date, freshDays = 7, agingDays = 30): MeasureFreshness {
  if (!measuredAt) return 'never';
  const age = now.getTime() - Date.parse(measuredAt);
  if (age <= freshDays * DAY_MS) return 'fresh';
  if (age <= agingDays * DAY_MS) return 'aging';
  return 'stale';
}

/** One measure with its outcome context: where its value stands, how fresh
 *  it is, where the last reading came from, and the work beneath it. */
export interface MeasureOutcome {
  measure: MissionMeasureRow;
  state: MeasureState;
  freshness: MeasureFreshness;
  /** Latest history row: who/what wrote the current value, when. */
  lastReading: { value: number | null; source: string; recordedByName: string | null; recordedAt: string } | null;
  /** Applied readings that came from agent runs, newest first — the
   *  attribution link from the number back to the run that produced it. */
  agentReadings: { runId: string; elementId: string; value: number; appliedAt: string }[];
  /** The Elements that deliver this measure, with their latest verdicts. */
  serves: { elementId: string; title: string; verdict: RunVerdict | null; state: ActionState }[];
}

/** Pure. Each measure of the Strategy with its outcome context. */
export function measureOutcomes(input: {
  measures: readonly MissionMeasureRow[];
  bindings: readonly MissionBindingRow[];
  elements: readonly MissionElementRow[];
  runs: readonly MissionRunRow[];
  readings: readonly MissionReadingRow[];
  now: Date;
  freshWithinDays?: number;
  agingWithinDays?: number;
}): MeasureOutcome[] {
  const latest = latestRuns(input.runs);
  const elementOf = new Map(input.elements.map((e) => [e.id, e]));
  const lastByIntent = new Map<string, MissionReadingRow>();
  for (const r of input.readings) {
    const seen = lastByIntent.get(r.intent_id);
    if (!seen || r.recorded_at > seen.recorded_at) lastByIntent.set(r.intent_id, r);
  }
  return input.measures.map((measure) => {
    const agentReadings = input.runs
      .flatMap((run) => (run.proposed_readings ?? [])
        .filter((p) => p.applied && p.measureId === measure.id && p.appliedAt !== null)
        .map((p) => ({ runId: run.id, elementId: run.element_id, value: p.value, appliedAt: p.appliedAt as string })))
      .sort((a, b) => (a.appliedAt < b.appliedAt ? 1 : a.appliedAt > b.appliedAt ? -1 : 0));
    const serves = input.bindings
      .filter((b) => b.intent_id === measure.id && b.target_type === 'element' && b.relationship_type === 'delivers')
      .flatMap((b) => {
        const element = elementOf.get(b.target_id);
        if (!element) return [];
        const run = latest.get(element.id);
        return [{
          elementId: element.id,
          title: element.display_id ? `${element.display_id} ${element.title}` : element.title,
          verdict: run?.verdict ?? null,
          state: actionState(element, run),
        }];
      });
    const last = lastByIntent.get(measure.id);
    return {
      measure,
      state: measureStateOf(measure),
      freshness: measureFreshness(measure.measured_at, input.now, input.freshWithinDays, input.agingWithinDays),
      lastReading: last ? { value: last.value, source: last.source, recordedByName: last.recorded_by_name, recordedAt: last.recorded_at } : null,
      agentReadings,
      serves,
    };
  });
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
  /** Latest-run verdicts across the Strategy (Elements that never ran count as none). */
  verdicts: VerdictTally;
  /** Measures nobody has refreshed (stale or never measured) that are not met. */
  measuresStale: number;
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
  /** For measure freshness; defaults to the moment of the call. */
  now?: Date;
}): MissionSummary {
  const runs = latestRuns(input.runs);
  const states = input.elements.map((e) => actionState(e, runs.get(e.id)));
  const count = (s: ActionState) => states.filter((x) => x === s).length;
  const live = states.filter((s) => s !== 'cancelled').length;
  const done = count('done');
  const now = input.now ?? new Date();
  const verdicts = verdictTallyOf(input.runs);
  const ran = new Set(input.runs.map((r) => r.element_id));
  verdicts.none += input.elements.filter((e) => !ran.has(e.id)).length;
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
    verdicts,
    measuresStale: input.measures.filter((m) => {
      if (measureStateOf(m) === 'met') return false;
      const freshness = measureFreshness(m.measured_at, now);
      return freshness === 'stale' || freshness === 'never';
    }).length,
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

/** An Object the draft puts work in: one of the Strategy's, or a new one. */
export interface PlanObject {
  key: string;
  /** One of the Strategy's Objects; null for a new one. */
  objectId: string | null;
  name: string;
  /** Where a new Object goes; null when the Planner named no Domain the Space has. */
  domainId: string | null;
}

export interface PlanTask {
  key: string;
  title: string;
  description: string;
  objective: string | null;
  /** The key of the Object it goes into; null when the Planner placed it nowhere. */
  object: string | null;
  dependsOn: string[];
  assignee: 'ai' | 'human';
  /** The Space's definition the task follows, when the Planner found one that fits. */
  definitionId?: string | null;
  /** How heavy the work is for an AI; picks the model by cost. */
  weight?: AiWeight | null;
  /** What the task asks someone to do. */
  action?: ElementAction | null;
  /** The person of the Space a person's task goes to, as the Planner chose by
   *  the harness's assignment rule; null leaves it to whoever approves. */
  assigneeWorkerId?: string | null;
}

export interface PlanDraft { summary: string; objectives: PlanObjective[]; objects: PlanObject[]; tasks: PlanTask[] }

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Pure. The Planner's answer as the screen may use it: keys unique, every
 *  reference pointing at something in the draft, measure ids only ones this
 *  Strategy has, Object ids only its Objects, Domain ids only the Space's,
 *  a person's id only on a person's task and only one of the Space's people,
 *  dependencies without cycles. Anything else is dropped. */
export function normalizePlan(
  raw: unknown,
  measureIds: ReadonlySet<string>,
  known: { objects?: ReadonlyMap<string, string>; domainIds?: ReadonlySet<string>; definitionIds?: ReadonlySet<string>; workerIds?: ReadonlySet<string> } = {},
): PlanDraft {
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
  const objects: PlanObject[] = [];
  // Two keys for one existing Object read as the first.
  const objectKey = new Map<string, string>();
  for (const o of Array.isArray(r.objects) ? r.objects : []) {
    const x = o && typeof o === 'object' ? o as Record<string, unknown> : {};
    const key = text(x.key, 40);
    if (!key || objectKey.has(key)) continue;
    const objectId = typeof x.objectId === 'string' && known.objects?.has(x.objectId) ? x.objectId : null;
    if (objectId) {
      const first = objects.find((b) => b.objectId === objectId);
      if (first) { objectKey.set(key, first.key); continue; }
      objectKey.set(key, key);
      objects.push({ key, objectId, name: known.objects!.get(objectId)!, domainId: null });
      continue;
    }
    const name = text(x.name, 200);
    if (!name) continue;
    const domainId = typeof x.domainId === 'string' && known.domainIds?.has(x.domainId) ? x.domainId : null;
    objectKey.set(key, key);
    objects.push({ key, objectId: null, name, domainId });
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
    const object = typeof x.object === 'string' ? objectKey.get(x.object) ?? null : null;
    const dependsOn = (Array.isArray(x.dependsOn) ? x.dependsOn : []).filter((d): d is string => typeof d === 'string');
    const assignee = x.assignee === 'human' ? 'human' : 'ai';
    tasks.push({
      key, title, description: text(x.description, 4000), objective, object, dependsOn,
      assignee,
      assigneeWorkerId: assignee === 'human' && typeof x.assigneeWorkerId === 'string' && known.workerIds?.has(x.assigneeWorkerId) ? x.assigneeWorkerId : null,
      definitionId: typeof x.definitionId === 'string' && known.definitionIds?.has(x.definitionId) ? x.definitionId : null,
      weight: isAiWeight(x.weight) ? x.weight : null,
      action: isElementAction(x.action) ? x.action : null,
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
  // An Object no task went into adds nothing.
  const used = new Set(tasks.map((t) => t.object));
  return { summary: text(r.summary, 4000), objectives, objects: objects.filter((o) => used.has(o.key)), tasks };
}

// ── Your turn ────────────────────────────────────────────────────────────────

/** A question the Planner asks before it plans; `options` empty means free text. */
export interface PlanQuestion { key: string; question: string; options: string[] }

/** Pure. The Planner's questions as the screen may use them: keys unique,
 *  at most five, each with at most five distinct options. */
export function normalizeQuestions(raw: unknown): PlanQuestion[] {
  const out: PlanQuestion[] = [];
  const keys = new Set<string>();
  for (const q of Array.isArray(raw) ? raw : []) {
    const x = q && typeof q === 'object' ? q as Record<string, unknown> : {};
    const key = text(x.key, 40) || `q${out.length + 1}`;
    const question = text(x.question, 300);
    if (!question || keys.has(key)) continue;
    keys.add(key);
    const options = [...new Set((Array.isArray(x.options) ? x.options : []).map((o) => text(o, 120)).filter(Boolean))].slice(0, 5);
    out.push({ key, question, options });
    if (out.length >= 5) break;
  }
  return out;
}

/** Pure. The answered questions, in order, as the Planner and the Strategy's
 *  assumptions take them. An unanswered question is left out. */
export function answeredQuestions(questions: readonly PlanQuestion[], answers: Readonly<Record<string, string>>): { question: string; answer: string }[] {
  return questions
    .map((q) => ({ question: q.question, answer: (answers[q.key] ?? '').trim().slice(0, 1000) }))
    .filter((x) => x.answer);
}

/** Pure. The draft's tasks that an AI may start as soon as they are written:
 *  an AI's, and waiting on nothing. */
export function startableTasks(draft: PlanDraft): string[] {
  return draft.tasks.filter((t) => t.assignee === 'ai' && t.dependsOn.length === 0).map((t) => t.key);
}

/** Pure. The draft with one task moved to another Object column: one of the
 *  Strategy's Objects (`objectId`), an Object the draft adds (`draftKey`), or
 *  none (both null — it waits to be placed). An Object of the Strategy the
 *  draft did not use yet joins its Objects. */
export function moveDraftTask(draft: PlanDraft, taskKey: string, to: { objectId: string | null; name?: string; draftKey: string | null }): PlanDraft {
  let objects = draft.objects;
  let target: string | null = to.draftKey;
  if (to.objectId) {
    const known = objects.find((o) => o.objectId === to.objectId);
    if (known) target = known.key;
    else {
      let key = `x${objects.length + 1}`;
      while (objects.some((o) => o.key === key)) key = `${key}_`;
      objects = [...objects, { key, objectId: to.objectId, name: to.name ?? '', domainId: null }];
      target = key;
    }
  }
  const tasks = draft.tasks.map((t) => (t.key === taskKey ? { ...t, object: target } : t));
  // An Object the draft adds keeps its column only while work is in it.
  const used = new Set(tasks.map((t) => t.object));
  return { ...draft, objects: objects.filter((o) => o.objectId || used.has(o.key)), tasks };
}

/** A file attached to the Strategy, as the Planner read it: whole, in parts
 *  (every part, planned from the readings), or not at all (with why). */
export interface PlannerSource { name: string; chars: number; mode: 'full' | 'digest' | 'unread'; reason?: string }

/** Pure. The Planner's account of the files, kept to the shape the page
 *  shows; null when the reply carries none (a Planner that does not report). */
export function plannerSources(raw: unknown): PlannerSource[] | null {
  if (!Array.isArray(raw)) return null;
  return raw.flatMap((x): PlannerSource[] => {
    if (!x || typeof x !== 'object') return [];
    const r = x as Record<string, unknown>;
    const mode = r.mode === 'full' || r.mode === 'digest' || r.mode === 'unread' ? r.mode : null;
    if (typeof r.name !== 'string' || !mode) return [];
    return [{ name: r.name, chars: typeof r.chars === 'number' ? r.chars : 0, mode, ...(typeof r.reason === 'string' ? { reason: r.reason } : {}) }];
  });
}
