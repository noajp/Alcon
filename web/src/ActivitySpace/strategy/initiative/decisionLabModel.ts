import type { ElementEdge, ElementWithDetails, Worker, WorkerAvailability } from '@/types/database';
import { capacityOnDay, standingCapacity } from '@/Function/shared/workerCapacity';
import { DAY_MS, dateOnlyFromDayIndex, dayIndexOf } from '@/Function/shared/dateUtils';

export type DecisionLabWorkweek = 'weekdays' | 'everyday';

export interface DecisionLabInput {
  elements: readonly ElementWithDetails[];
  workers: readonly Worker[];
  availability: readonly WorkerAvailability[];
  edges: readonly ElementEdge[];
  scopeElementIds: readonly string[];
  today: string;
  /** Humans follow this calendar. AI agents and robots run every day. */
  workweek?: DecisionLabWorkweek;
  /** Calendar days, including today. Default 90; capped at 180. */
  horizonDays?: number;
}

/** A local experiment: no database values are changed by this model. */
export interface DecisionLabScenario {
  focusElementId?: string;
  deferElementId?: string;
  deferDays?: number;
  reassignElementId?: string;
  workerId?: string;
}

export type DecisionLabReason =
  | 'closed' | 'backlog' | 'blocked' | 'missing_element'
  | 'missing_estimate' | 'invalid_estimate' | 'invalid_progress'
  | 'unassigned' | 'missing_worker' | 'inactive_worker' | 'invalid_capacity'
  | 'invalid_date' | 'unknown_dependency' | 'dependency_cycle'
  | 'unresolved_dependency' | 'horizon';

export interface DecisionLabElementResult {
  elementId: string;
  start: string | null;
  finish: string | null;
  lateDays: number | null;
  reason: DecisionLabReason | null;
  remainingHours: number | null;
  workerIds: string[];
  inScope: boolean;
}

export interface DecisionLabSummary {
  total: number;
  scheduled: number;
  unknown: number;
  excluded: number;
  late: number;
  /** Null when any active Element in the scope cannot be estimated. */
  finish: string | null;
  /** Known remaining effort only; never substitutes zero for an unknown row. */
  remainingHours: number;
}

export interface DecisionLabSchedule {
  elements: DecisionLabElementResult[];
  byId: Record<string, DecisionLabElementResult>;
  scope: DecisionLabSummary;
  outside: DecisionLabSummary;
  excludedBacklogCount: number;
  fingerprint: string;
  horizonEnd: string | null;
  assumptions: string[];
}

export interface DecisionLabChange {
  elementId: string;
  before: DecisionLabElementResult;
  after: DecisionLabElementResult;
  change: 'improved' | 'worsened' | 'unchanged' | 'unknown';
  /** Calendar days recovered; negative means later. Null if either date is unknown. */
  days: number | null;
  recovered: boolean;
  newlyLate: boolean;
}

export interface DecisionLabComparison {
  baseline: DecisionLabSchedule;
  scenario: DecisionLabSchedule;
  changes: DecisionLabChange[];
  scopeChanges: DecisionLabChange[];
  outsideEffects: DecisionLabChange[];
  fingerprint: string;
}

const EPSILON = 1e-8;
const PRIORITY: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
const EXCLUDED = new Set<DecisionLabReason>(['closed', 'backlog']);

/**
 * A deterministic, conditional capacity forecast, not an optimal schedule or a
 * probability of delivery. Each day allocates available hours to ready work in
 * priority / due-date / id order. Focus promotes its unfinished prerequisites.
 *
 * As in Workload, every assignee carries the full effort. Multiple assignees
 * work together, so the smallest available capacity limits that day's work.
 * Missing estimates and blocked work stay unknown and reserve no invented
 * hours. Their unresolved dependencies stay unknown as well. The returned
 * assumptions explicitly limit all other dates to the modeled, known work.
 */
export function simulateDecisionLab(
  input: DecisionLabInput,
  scenario: DecisionLabScenario = {},
): DecisionLabSchedule {
  const elements = uniqueElements(input.elements);
  const elementById = new Map(elements.map((element) => [element.id, element]));
  const workers = new Map(input.workers.map((worker) => [worker.id, worker]));
  const scopeIds = new Set(input.scopeElementIds);
  const horizon = boundedHorizon(input.horizonDays);
  const today = dayIndexOf(input.today);
  const dayCount = today === null ? 0 : Math.min(horizon, dayIndexOf('9999-12-31')! - today + 1);
  const days = today === null ? [] : Array.from({ length: dayCount }, (_, index) => dateOnlyFromDayIndex(today + index));
  const dependencies = dependencyMap(input.edges);
  // A completed predecessor already supplies its output. Its historical inputs
  // cannot create a live cycle or acquire focus on behalf of that output.
  const activeDependencies = new Map([...dependencies].filter(([id]) => elementById.get(id)?.status !== 'done'));
  const cycles = cycleMembers(elements.map((element) => element.id), activeDependencies);
  const focused = prerequisiteClosure(scenario.focusElementId, activeDependencies);
  const spans = new Map<string, WorkerAvailability[]>();
  const invalidAvailability = new Set<string>();
  for (const span of input.availability) {
    const from = dayIndexOf(span.start_date);
    const to = dayIndexOf(span.end_date);
    if (from === null || to === null || from > to || !validNonnegative(span.capacity_hours_per_day)) {
      invalidAvailability.add(span.worker_id);
    } else {
      const list = spans.get(span.worker_id) ?? [];
      list.push(span);
      spans.set(span.worker_id, list);
    }
  }

  const results = new Map<string, DecisionLabElementResult>();
  const remaining = new Map<string, number>();
  const release = new Map<string, number>();
  for (const element of elements) {
    const workerIds = scenario.reassignElementId === element.id && scenario.workerId
      ? [scenario.workerId]
      : Array.from(new Set((element.assignees ?? []).map((assignee) => assignee.worker_id))).sort();
    const result: DecisionLabElementResult = {
      elementId: element.id, start: null, finish: null, lateDays: null,
      reason: null, remainingHours: remainingEffort(element), workerIds, inScope: scopeIds.has(element.id),
    };
    results.set(element.id, result);
    if (element.status === 'done' || element.status === 'cancelled') result.reason = 'closed';
    else if (element.status === 'backlog') result.reason = 'backlog';
    else if (today === null || (element.start_date !== null && dayIndexOf(element.start_date) === null)
      || (element.due_date !== null && dayIndexOf(element.due_date) === null)) result.reason = 'invalid_date';
    else if (element.status === 'blocked') result.reason = 'blocked';
    else if (element.estimated_hours === null) result.reason = 'missing_estimate';
    else if (!validNonnegative(element.estimated_hours)) result.reason = 'invalid_estimate';
    else if (element.progress !== null && (!Number.isFinite(element.progress) || element.progress < 0 || element.progress > 100)) result.reason = 'invalid_progress';
    else if (cycles.has(element.id)) result.reason = 'dependency_cycle';
    else if ((dependencies.get(element.id) ?? []).some((id) => !elementById.has(id))) result.reason = 'unknown_dependency';
    else if (result.remainingHours !== 0) {
      if (workerIds.length === 0) result.reason = 'unassigned';
      else if (workerIds.some((id) => !workers.has(id))) result.reason = 'missing_worker';
      else if (workerIds.some((id) => workers.get(id)?.status === 'inactive')) result.reason = 'inactive_worker';
      else if (workerIds.some((id) => invalidAvailability.has(id) || !validNonnegative(standingCapacity(workers.get(id)!)))) result.reason = 'invalid_capacity';
    }
    if (result.reason) continue;
    remaining.set(element.id, result.remainingHours!);
    const start = Math.max(today!, dayIndexOf(element.start_date) ?? today!);
    const defer = scenario.deferElementId === element.id ? boundedDefer(scenario.deferDays) : 0;
    release.set(element.id, start + defer);
  }
  for (const id of scopeIds) {
    if (!results.has(id)) results.set(id, {
      elementId: id, start: null, finish: null, lateDays: null, reason: 'missing_element',
      remainingHours: null, workerIds: [], inScope: true,
    });
  }

  // Propagate unknown prerequisites before reserving hours for any dependent.
  // A cancelled predecessor does not mean its required output was delivered.
  const dependents = new Map<string, string[]>();
  for (const [id, upstreams] of dependencies) {
    for (const upstream of upstreams) dependents.set(upstream, [...(dependents.get(upstream) ?? []), id]);
  }
  const uncertain = Array.from(results.values())
    .filter((row) => row.reason && elementById.get(row.elementId)?.status !== 'done')
    .map((row) => row.elementId);
  for (let index = 0; index < uncertain.length; index += 1) {
    for (const id of dependents.get(uncertain[index]) ?? []) {
      const row = results.get(id);
      if (row && !row.reason) {
        row.reason = 'unresolved_dependency';
        uncertain.push(id);
      }
    }
  }

  const ordered = elements.slice().sort((a, b) =>
    Number(focused.has(b.id)) - Number(focused.has(a.id))
    || (PRIORITY[a.priority ?? 'medium'] ?? 2) - (PRIORITY[b.priority ?? 'medium'] ?? 2)
    || compareText(a.due_date ?? '9999-12-31', b.due_date ?? '9999-12-31')
    || compareText(a.id, b.id));

  for (let index = 0; index < days.length; index += 1) {
    const day = days[index];
    const date = today! + index;
    const available = new Map<string, number>();
    for (const worker of workers.values()) {
      const weekday = new Date(date * DAY_MS).getUTCDay();
      const weekend = worker.type === 'human' && input.workweek !== 'everyday' && (weekday === 0 || weekday === 6);
      const capacity = capacityOnDay(standingCapacity(worker), spans.get(worker.id) ?? [], day);
      available.set(worker.id, worker.status === 'inactive' || weekend || !validNonnegative(capacity) ? 0 : capacity);
    }
    for (const element of ordered) {
      const row = results.get(element.id)!;
      if (row.reason || row.finish || release.get(element.id)! > date) continue;
      const ready = (dependencies.get(element.id) ?? []).every((id) => {
        if (elementById.get(id)?.status === 'done') return true;
        const finish = results.get(id)?.finish;
        return finish !== null && finish !== undefined && finish < day;
      });
      if (!ready) continue;
      const left = remaining.get(element.id)!;
      const capacity = left === 0 ? 0 : Math.min(...row.workerIds.map((id) => available.get(id) ?? 0));
      if (left > EPSILON && capacity <= EPSILON) continue;
      const work = Math.min(left, capacity);
      row.start ??= day;
      for (const id of row.workerIds) available.set(id, Math.max(0, (available.get(id) ?? 0) - work));
      remaining.set(element.id, Math.max(0, left - work));
      if (left - work <= EPSILON) {
        row.finish = day;
        const due = dayIndexOf(element.due_date);
        row.lateDays = due === null ? null : Math.max(0, date - due);
      }
    }
  }
  for (const row of results.values()) {
    if (!row.reason && !row.finish) row.reason = 'horizon';
  }
  const rows = Array.from(results.values()).sort((a, b) => compareText(a.elementId, b.elementId));
  return {
    elements: rows,
    byId: Object.fromEntries(rows.map((row) => [row.elementId, row])),
    scope: summarize(rows.filter((row) => row.inScope)),
    outside: summarize(rows.filter((row) => !row.inScope)),
    excludedBacklogCount: rows.filter((row) => row.reason === 'backlog').length,
    fingerprint: decisionLabFingerprint(input),
    horizonEnd: days.at(-1) ?? null,
    assumptions: [
      `Conditional forecast of visible, estimated work over ${horizon} calendar days; it is not a delivery probability or an optimal plan.`,
      input.workweek === 'everyday' ? 'Humans work every day.' : 'Humans work Monday–Friday.',
      'AI agents and robots work every day. Standing capacity uses Workload defaults (human/robot 8h, AI agent 16h) unless a Worker specifies hours; inactive Workers have zero capacity.',
      'Remaining effort is estimated hours × (1 − progress / 100); unset progress means 0%. Actual hours are not subtracted.',
      'Every assignee carries the full remaining effort and works together, limited by the smallest available capacity. Availability spans include both boundary dates.',
      'Ready work shares daily capacity in priority, due date, then id order. Focus also promotes prerequisites; dependencies start the day after their predecessor finishes.',
      'Closed and backlog Elements are excluded. Unknown or blocked work reserves no invented hours; other dates assume that excluded uncertainty does not consume capacity.',
      'Hidden work, future changes, and dependencies absent from the supplied data are outside this forecast. Known edges to unavailable predecessors remain unknown.',
    ],
  };
}

export function compareDecisionLab(input: DecisionLabInput, experiment: DecisionLabScenario): DecisionLabComparison {
  const baseline = simulateDecisionLab(input);
  const scenario = simulateDecisionLab(input, experiment);
  const changes = baseline.elements.map((before): DecisionLabChange => {
    const after = scenario.byId[before.elementId];
    const days = before.finish && after.finish ? dayIndexOf(before.finish)! - dayIndexOf(after.finish)! : null;
    const change = days === null
      ? (before.reason !== null && EXCLUDED.has(before.reason) && before.reason === after.reason ? 'unchanged' : 'unknown')
      : days > 0 ? 'improved' : days < 0 ? 'worsened' : 'unchanged';
    return {
      elementId: before.elementId, before, after, change, days,
      recovered: before.lateDays !== null && before.lateDays > 0 && after.lateDays === 0,
      newlyLate: before.lateDays === 0 && after.lateDays !== null && after.lateDays > 0,
    };
  });
  return {
    baseline, scenario, changes,
    scopeChanges: changes.filter((change) => change.before.inScope),
    outsideEffects: changes.filter((change) => !change.before.inScope && (
      change.before.start !== change.after.start || change.before.finish !== change.after.finish
      || change.before.reason !== change.after.reason
    )),
    fingerprint: fingerprint([baseline.fingerprint, experiment.focusElementId ?? null,
      experiment.deferElementId ?? null, boundedDefer(experiment.deferDays),
      experiment.reassignElementId ?? null, experiment.workerId ?? null]),
  };
}

/** A stable snapshot key for the planning facts, independent of fetch order. */
export function decisionLabFingerprint(input: DecisionLabInput): string {
  const sort = (rows: unknown[][]) => rows.sort((a, b) => compareText(JSON.stringify(a), JSON.stringify(b)));
  return fingerprint([
    'decision-lab-v1', input.today, input.workweek ?? 'weekdays', boundedHorizon(input.horizonDays),
    [...new Set(input.scopeElementIds)].sort(),
    uniqueElements(input.elements).map((element) => [element.id, element.title, element.status, element.priority,
      element.start_date, element.due_date, element.estimated_hours, element.progress,
      [...new Set((element.assignees ?? []).map((assignee) => assignee.worker_id))].sort()]),
    sort(input.workers.map((worker) => [worker.id, worker.type, worker.status, worker.capacity_hours_per_day])),
    sort(input.availability.map((span) => [span.worker_id, span.start_date, span.end_date, span.capacity_hours_per_day])),
    [...dependencyMap(input.edges)].sort(([a], [b]) => compareText(a, b)),
  ]);
}

function summarize(rows: DecisionLabElementResult[]): DecisionLabSummary {
  const scheduled = rows.filter((row) => row.finish !== null);
  const excluded = rows.filter((row) => row.reason !== null && EXCLUDED.has(row.reason)).length;
  const unknown = rows.length - scheduled.length - excluded;
  return {
    total: rows.length, scheduled: scheduled.length, unknown, excluded,
    late: scheduled.filter((row) => row.lateDays !== null && row.lateDays > 0).length,
    finish: unknown > 0 ? null : scheduled.map((row) => row.finish!).sort().at(-1) ?? null,
    remainingHours: rows.reduce((sum, row) => sum + (row.reason && EXCLUDED.has(row.reason) ? 0 : row.remainingHours ?? 0), 0),
  };
}

function remainingEffort(element: ElementWithDetails): number | null {
  const estimate = element.estimated_hours;
  const progress = element.progress ?? 0;
  if (!validNonnegative(estimate) || !Number.isFinite(progress) || progress < 0 || progress > 100) return null;
  return estimate * (1 - progress / 100);
}

function validNonnegative(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value >= 0;
}

function boundedHorizon(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) ? Math.min(180, Math.max(1, Math.floor(value))) : 90;
}

function boundedDefer(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) ? Math.min(180, Math.max(0, Math.floor(value))) : 7;
}


function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function uniqueElements(input: readonly ElementWithDetails[]): ElementWithDetails[] {
  const grouped = new Map<string, ElementWithDetails[]>();
  for (const element of input) grouped.set(element.id, [...(grouped.get(element.id) ?? []), element]);
  return [...grouped].sort(([a], [b]) => compareText(a, b)).map(([, copies]) => {
    // Multi-home joins can duplicate rows or include only part of the relation.
    // The newest copy supplies fields; assignments are a union, charged once.
    const sorted = copies.slice().sort((a, b) => compareText(b.updated_at ?? '', a.updated_at ?? '')
      || compareText(JSON.stringify(a), JSON.stringify(b)));
    const assignees = new Map(sorted.flatMap((element) => element.assignees ?? []).map((assignee) => [assignee.worker_id, assignee]));
    return { ...sorted[0], assignees: [...assignees.values()].sort((a, b) => compareText(a.worker_id, b.worker_id)) };
  });
}

function dependencyMap(edges: readonly ElementEdge[]): Map<string, string[]> {
  const map = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (edge.edge_type !== 'depends_on') continue;
    const ids = map.get(edge.to_element) ?? new Set<string>();
    ids.add(edge.from_element);
    map.set(edge.to_element, ids);
  }
  return new Map([...map].map(([id, ids]) => [id, [...ids].sort()]));
}

function prerequisiteClosure(id: string | undefined, dependencies: Map<string, string[]>): Set<string> {
  const found = new Set<string>();
  const queue = id ? [id] : [];
  while (queue.length > 0) {
    const next = queue.pop()!;
    if (found.has(next)) continue;
    found.add(next);
    queue.push(...(dependencies.get(next) ?? []));
  }
  return found;
}

/** Iterative strongly connected components also catch overlapping cycles. */
function cycleMembers(ids: string[], dependencies: Map<string, string[]>): Set<string> {
  const visited = new Set<string>();
  const finishOrder: string[] = [];
  const reverse = new Map<string, string[]>();
  for (const [id, upstreams] of dependencies) {
    for (const upstream of upstreams) {
      const children = reverse.get(upstream) ?? [];
      children.push(id);
      reverse.set(upstream, children);
    }
  }
  // A first iterative DFS orders components without growing the call stack.
  for (const root of ids) {
    if (visited.has(root)) continue;
    const path: { id: string; next: number }[] = [{ id: root, next: 0 }];
    visited.add(root);
    while (path.length > 0) {
      const frame = path[path.length - 1];
      const upstreams = dependencies.get(frame.id) ?? [];
      if (frame.next >= upstreams.length) {
        finishOrder.push(frame.id);
        path.pop();
      } else {
        const next = upstreams[frame.next++];
        if (!visited.has(next)) {
          visited.add(next);
          path.push({ id: next, next: 0 });
        }
      }
    }
  }
  visited.clear();
  const cycles = new Set<string>();
  for (let index = finishOrder.length - 1; index >= 0; index -= 1) {
    const root = finishOrder[index];
    if (visited.has(root)) continue;
    const component: string[] = [];
    const stack = [root];
    while (stack.length > 0) {
      const next = stack.pop()!;
      if (visited.has(next)) continue;
      visited.add(next);
      component.push(next);
      stack.push(...(reverse.get(next) ?? []));
    }
    if (component.length > 1 || (dependencies.get(root) ?? []).includes(root)) {
      for (const id of component) cycles.add(id);
    }
  }
  return cycles;
}

function fingerprint(value: unknown): string {
  const content = JSON.stringify(value, (_, item) => typeof item === 'number' && !Number.isFinite(item) ? String(item) : item);
  let first = 2166136261;
  let second = 5381;
  for (let index = 0; index < content.length; index += 1) {
    first = Math.imul(first ^ content.charCodeAt(index), 16777619);
    second = Math.imul(second, 33) ^ content.charCodeAt(index);
  }
  return `dl1-${(first >>> 0).toString(16)}-${(second >>> 0).toString(16)}`;
}
