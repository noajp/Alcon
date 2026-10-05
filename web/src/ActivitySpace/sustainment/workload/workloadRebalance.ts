// What to change so that nobody's week is impossible.
//
// The load chart shows where a Worker is over; it does not say what would fix
// it. That question has an answer the board can work out on its own — who has
// room on those days, which Element could start earlier and still land on its
// date, which deadline is sitting on a day its owner is away — and working it
// out by hand means holding every Worker's week in your head at once.
//
// Everything here is deterministic arithmetic over the same numbers the chart
// draws (`assignmentLoad` for an Element's hours per day, `workerCapacity` for
// a Worker's hours). Nothing calls a model, so a plan costs nothing to compute
// and the same board always yields the same plan. Nothing is written either: a
// proposal is a reading with a reason, applied only when a person chooses to.
//
// The search is greedy and simulated. Each accepted proposal is applied to an
// in-memory copy of the board before the next one is chosen, so two proposals
// never both hand work to the same free afternoon.

import { daysInSpan, elementHours, elementSpan, type LoadElement } from '@/Function/shared/assignmentLoad';
import { isOpenStatus } from '@/Function/shared/completion';
import { fromDateOnlyString, toDateOnlyString } from '@/Function/shared/dateUtils';
import { capacityOnDay, standingCapacity, type CapacitySpan } from '@/Function/shared/workerCapacity';

/** Days ahead a plan looks at, starting today. Six weeks is past the point
 *  where most dates on a board are still the dates they will turn out to be. */
export const PLAN_HORIZON_DAYS = 42;

/** Hours below this count as zero — splitting 8h over 3 days must not leave a
 *  floating-point sliver that reads as an overload. */
const EPS = 0.01;

/** The furthest a date is pushed when nothing else fits. Further than this is
 *  a replan, not a nudge, and a person should make it. */
const MAX_POSTPONE_DAYS = 14;

/** Proposals for Elements nobody holds are capped: a backlog of two hundred
 *  unassigned items is a triage meeting, not a list of suggestions. */
const MAX_ASSIGN_PROPOSALS = 12;

export type PlanWorker = {
  id: string;
  name: string;
  type: 'human' | 'ai_agent' | 'robot';
  status?: string | null;
  capacity_hours_per_day: number | null;
};

export type PlanElement = LoadElement & {
  title: string;
  object_id?: string | null;
  objectIds?: string[];
  assignees?: { id: string; worker_id: string; role?: string | null }[];
};

export type PlanIssue = 'overload' | 'away' | 'unassigned';

type ProposalBase = {
  /** Stable for the same change on the same board, so a dismissal holds. */
  id: string;
  elementId: string;
  issue: PlanIssue;
  /** The Worker whose problem this solves (null for unassigned work). */
  workerId: string | null;
  /** Over-capacity hours of `workerId` in the horizon, before and after. */
  overBefore: number;
  overAfter: number;
};

/** Dates as the Element carries them; a missing one stays missing. */
export type PlanDates = { start: string | null; due: string | null };

export type Proposal =
  | (ProposalBase & {
      kind: 'reassign';
      fromWorkerId: string;
      /** The element_assignees row to remove once the new one is in. */
      assigneeId: string;
      toWorkerId: string;
      target: TargetReading;
    })
  | (ProposalBase & { kind: 'assign'; toWorkerId: string; target: TargetReading })
  | (ProposalBase & {
      kind: 'reschedule';
      /** start-earlier keeps the due date; pull-in moves it before an absence;
       *  postpone moves it later. Only the last one breaks a commitment. */
      mode: 'start-earlier' | 'pull-in' | 'postpone';
      from: PlanDates;
      to: PlanDates;
    });

export type TargetReading = {
  /** Highest load ÷ capacity on any day of the span once the Element lands. */
  peakAfter: number;
  /** Hours the target had free across the span before taking it. */
  freeHours: number;
  /** Elements in the same Object(s) the target already holds. */
  familiarity: number;
};

export type PlanInput = {
  workers: readonly PlanWorker[];
  spans: Readonly<Record<string, readonly CapacitySpan[]>>;
  elements: readonly PlanElement[];
  /** 'YYYY-MM-DD'. */
  today: string;
  horizonDays?: number;
  /** Proposals a person turned down. The plan is worked out again without
   *  them, so nothing later in it counts on a change that will not happen. */
  dismissed?: ReadonlySet<string>;
  /** Only changes involving this Worker. Planned with the restriction rather
   *  than filtered afterwards, so every shown proposal stands on the shown ones. */
  focusWorkerId?: string | null;
};

export type Plan = {
  proposals: Proposal[];
  /** Over-capacity hours across everyone in the horizon, before and after. */
  overBefore: number;
  overAfter: number;
};

// =============================================================
// Board simulation
// =============================================================

type Board = {
  days: string[];
  index: Map<string, number>;
  workers: Map<string, PlanWorker>;
  capacity: Map<string, number[]>;
  /** Per Worker, hours booked on each horizon day. */
  load: Map<string, number[]>;
  elements: Map<string, SimElement>;
  /** Per Worker, how many Elements they hold in each Object — kept current
   *  as holders move, so familiarity is a lookup rather than a scan. */
  held: Map<string, Map<string, number>>;
};

type Holder = { assigneeId: string; role: string };
type SimElement = PlanElement & { holders: Map<string, Holder> };

function addDays(day: string, n: number): string {
  const d = fromDateOnlyString(day);
  if (!d) return day;
  d.setDate(d.getDate() + n);
  return toDateOnlyString(d);
}

/** Saturday or Sunday. The capacity model does not know weekends, but a plan
 *  that says "start Saturday" reads as a machine's plan, so new dates avoid them. */
function isWeekend(day: string): boolean {
  const d = fromDateOnlyString(day);
  return d !== null && (d.getDay() === 0 || d.getDay() === 6);
}

/** The horizon starting today. */
export function planHorizon(today: string, horizonDays = PLAN_HORIZON_DAYS): string[] {
  return daysInSpan({ start: today, end: addDays(today, horizonDays - 1) });
}

function eligible(worker: PlanWorker): boolean {
  return worker.type !== 'robot' && worker.status !== 'inactive';
}

/** Hours an Element puts on each of its days. Same rule as the chart. */
function perDay(element: LoadElement): number {
  const span = elementSpan(element);
  if (!span) return 0;
  const n = daysInSpan(span).length;
  return n === 0 ? 0 : elementHours(element) / n;
}

function spanIndexes(board: Board, element: LoadElement): number[] {
  const span = elementSpan(element);
  if (!span) return [];
  const out: number[] = [];
  for (let i = 0; i < board.days.length; i++) {
    if (board.days[i] >= span.start && board.days[i] <= span.end) out.push(i);
  }
  return out;
}

function book(board: Board, element: LoadElement, workerId: string, sign: 1 | -1) {
  const load = board.load.get(workerId);
  if (!load || !isOpenStatus(element.status)) return;
  const h = perDay(element) * sign;
  for (const i of spanIndexes(board, element)) load[i] += h;
}

const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function buildBoard(input: PlanInput): Board {
  const days = planHorizon(input.today, input.horizonDays);
  const index = new Map(days.map((d, i) => [d, i]));
  const workers = new Map<string, PlanWorker>();
  const capacity = new Map<string, number[]>();
  const load = new Map<string, number[]>();
  // Id order, not caller order: the same board must give the same plan
  // whichever way the chart happens to be sorted.
  for (const w of [...input.workers].sort(byId)) {
    if (workers.has(w.id)) continue;
    workers.set(w.id, w);
    const standing = standingCapacity(w);
    capacity.set(w.id, days.map((d) => capacityOnDay(standing, input.spans[w.id] ?? [], d)));
    load.set(w.id, days.map(() => 0));
  }
  const board: Board = { days, index, workers, capacity, load, elements: new Map(), held: new Map() };
  for (const el of [...input.elements].sort(byId)) {
    if (board.elements.has(el.id)) continue;
    const holders = new Map<string, Holder>();
    for (const a of el.assignees ?? []) {
      if (!holders.has(a.worker_id)) holders.set(a.worker_id, { assigneeId: a.id, role: a.role ?? 'assignee' });
    }
    const sim: SimElement = { ...el, holders };
    board.elements.set(el.id, sim);
    for (const wid of holders.keys()) {
      book(board, sim, wid, 1);
      countHeld(board, sim, wid, 1);
    }
  }
  return board;
}

function overOn(board: Board, workerId: string, from: number, to: number): number {
  const load = board.load.get(workerId);
  const cap = board.capacity.get(workerId);
  if (!load || !cap) return 0;
  let over = 0;
  for (let i = Math.max(0, from); i <= Math.min(load.length - 1, to); i++) if (load[i] > cap[i] + EPS) over += load[i] - cap[i];
  return over;
}

function overHours(board: Board, workerId: string): number {
  return round(overOn(board, workerId, 0, board.days.length - 1));
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function objectsOf(element: PlanElement): string[] {
  const ids = new Set(element.objectIds ?? []);
  if (element.object_id) ids.add(element.object_id);
  return [...ids];
}

function countHeld(board: Board, element: PlanElement, workerId: string, sign: 1 | -1) {
  let counts = board.held.get(workerId);
  if (!counts) board.held.set(workerId, (counts = new Map()));
  for (const o of objectsOf(element)) counts.set(o, (counts.get(o) ?? 0) + sign);
}

/** Elements in the same Object(s) the Worker already holds. An Element in two
 *  of their Objects counts once per Object — close enough for a preference. */
function familiarity(board: Board, workerId: string, element: SimElement): number {
  const counts = board.held.get(workerId);
  if (!counts) return 0;
  let n = 0;
  for (const o of objectsOf(element)) n += counts.get(o) ?? 0;
  return element.holders.has(workerId) ? Math.max(0, n - objectsOf(element).length) : n;
}

/**
 * Who could take this Element without going over on any of its days.
 *
 * The reading is the one the assignment menu takes, run for every candidate:
 * none of the Element's days may be one the candidate is away, and none may
 * end up over that day's capacity. Among those that fit, someone who already
 * works in the same Object wins, then whoever stays furthest from full.
 */
function bestTarget(board: Board, element: SimElement, accept: (workerId: string) => boolean): { workerId: string; reading: TargetReading } | null {
  const idx = spanIndexes(board, element);
  if (idx.length === 0) return null;
  const h = perDay(element);
  let best: { workerId: string; reading: TargetReading; score: number } | null = null;
  for (const [wid, worker] of board.workers) {
    if (!eligible(worker) || element.holders.has(wid) || !accept(wid)) continue;
    const load = board.load.get(wid)!;
    const cap = board.capacity.get(wid)!;
    let fits = true;
    let peak = 0;
    let free = 0;
    for (const i of idx) {
      if (cap[i] <= 0 || load[i] + h > cap[i] + EPS) { fits = false; break; }
      peak = Math.max(peak, (load[i] + h) / cap[i]);
      free += Math.max(0, cap[i] - load[i]);
    }
    if (!fits) continue;
    const fam = familiarity(board, wid, element);
    // Familiarity dominates, but only up to a point: three Elements in the
    // Object is "knows it", and a fourth should not outweigh being half as busy.
    const score = Math.min(fam, 3) * 10 - peak * 8;
    if (!best || score > best.score || (score === best.score && wid < best.workerId)) {
      best = { workerId: wid, reading: { peakAfter: round(peak), freeHours: round(free), familiarity: fam }, score };
    }
  }
  return best && { workerId: best.workerId, reading: best.reading };
}

function datesOf(element: PlanElement): PlanDates {
  return { start: element.start_date?.slice(0, 10) ?? null, due: element.due_date?.slice(0, 10) ?? null };
}

function setDates(board: Board, element: SimElement, dates: PlanDates) {
  for (const wid of element.holders.keys()) book(board, element, wid, -1);
  element.start_date = dates.start;
  element.due_date = dates.due;
  for (const wid of element.holders.keys()) book(board, element, wid, 1);
}

/** `fn` read with the Element on other dates, then put back. */
function withDates<T>(board: Board, element: SimElement, dates: PlanDates, fn: () => T): T {
  const original = datesOf(element);
  setDates(board, element, dates);
  const result = fn();
  setDates(board, element, original);
  return result;
}

/** Over-hours of every holder of `element` — moving dates affects all of them. */
function holdersOver(board: Board, element: SimElement, from = 0, to = board.days.length - 1): number {
  let n = 0;
  for (const wid of element.holders.keys()) n += overOn(board, wid, from, to);
  return round(n);
}

function moveHolder(board: Board, element: SimElement, from: string | null, to: string) {
  if (from) {
    book(board, element, from, -1);
    countHeld(board, element, from, -1);
    element.holders.delete(from);
  }
  element.holders.set(to, { assigneeId: `planned:${to}`, role: 'assignee' });
  book(board, element, to, 1);
  countHeld(board, element, to, 1);
}

// =============================================================
// Proposals for one Element
// =============================================================

/**
 * Earlier start, same due date: the cheapest change — owner and commitment
 * both stay.
 *
 * Judged on the Element's own stretch of days (its new start through its due
 * date), not the whole horizon: an overload three weeks away is not this
 * Element's to fix, and asking it to would drag every start back to today.
 * Takes the latest start that clears that stretch; failing that, the start
 * that lowers the holders' overload most, latest first on ties.
 */
function tryStartEarlier(board: Board, element: SimElement, today: string): PlanDates | null {
  const span = elementSpan(element);
  if (!span || !element.due_date || span.start <= today) return null;
  const end = board.index.get(span.end) ?? board.days.length - 1;
  const before = holdersOver(board, element);
  let best: { start: string; over: number } | null = null;
  for (let start = addDays(span.start, -1); start >= today; start = addDays(start, -1)) {
    if (isWeekend(start)) continue;
    const from = board.index.get(start) ?? 0;
    const [local, total] = withDates(board, element, { start, due: span.end }, () => [holdersOver(board, element, from, end), holdersOver(board, element)]);
    if (local <= EPS && total < before - EPS) return { start, due: span.end };
    if (total < before - EPS && (!best || total < best.over - EPS)) best = { start, over: total };
  }
  return best && { start: best.start, due: span.end };
}

/** Later dates, same length. Breaks the date, so it is offered last. A date
 *  the Element did not have is not invented. */
function tryPostpone(board: Board, element: SimElement): PlanDates | null {
  if (element.priority === 'urgent') return null;
  const span = elementSpan(element);
  if (!span) return null;
  const original = datesOf(element);
  const before = holdersOver(board, element);
  for (let k = 1; k <= MAX_POSTPONE_DAYS; k++) {
    const dates = {
      start: original.start ? addDays(original.start, k) : null,
      due: original.due ? addDays(original.due, k) : null,
    };
    if ((dates.start && isWeekend(dates.start)) || (dates.due && isWeekend(dates.due))) continue;
    const after = withDates(board, element, dates, () => holdersOver(board, element));
    if (after < before - EPS) return dates;
  }
  return null;
}

function proposalId(parts: (string | null | undefined)[]): string {
  return parts.filter(Boolean).join(':');
}

// =============================================================
// The plan
// =============================================================

/**
 * A rebalancing plan for the board as it stands.
 *
 * Three passes, in order of how much each problem costs if left:
 *   1. Deadlines on a day their owner is away — certain to slip.
 *   2. Days a Worker is over capacity — likely to slip, and wear people out.
 *   3. Dated work nobody holds — slips silently because nobody is watching it.
 *
 * Within a Worker's overload, cheaper fixes are tried first: start earlier
 * (nothing moves but a start date), hand to someone with room, and only then
 * push the dates out. A fix that was dismissed, or that would not involve the
 * focused Worker, is passed over for the next one.
 */
export function planRebalance(input: PlanInput): Plan {
  const board = buildBoard(input);
  const { today } = input;
  const dismissed = input.dismissed ?? new Set<string>();
  const focus = input.focusWorkerId ?? null;
  const allowed = (id: string, workers: (string | null)[]) => !dismissed.has(id) && (!focus || workers.includes(focus));
  const horizonEnd = board.days[board.days.length - 1] ?? today;
  const proposals: Proposal[] = [];
  const touched = new Set<string>();
  const overBefore = round([...board.workers.keys()].reduce((s, w) => s + overHours(board, w), 0));

  const openHeld = (wid: string) => [...board.elements.values()].filter((el) =>
    el.holders.has(wid) && isOpenStatus(el.status) && !touched.has(el.id));
  // Hand-overs move the people doing the work; a reviewer stays a reviewer.
  const movable = (el: SimElement, wid: string) => el.holders.get(wid)?.role === 'assignee';

  const reassign = (el: SimElement, wid: string, issue: PlanIssue): boolean => {
    if (!movable(el, wid)) return false;
    const target = bestTarget(board, el, (to) => allowed(proposalId(['reassign', el.id, wid, to]), [wid, to]));
    if (!target) return false;
    const overBeforeW = overHours(board, wid);
    const assigneeId = el.holders.get(wid)!.assigneeId;
    moveHolder(board, el, wid, target.workerId);
    touched.add(el.id);
    proposals.push({
      kind: 'reassign', id: proposalId(['reassign', el.id, wid, target.workerId]), elementId: el.id, issue,
      workerId: wid, fromWorkerId: wid, assigneeId, toWorkerId: target.workerId, target: target.reading,
      overBefore: overBeforeW, overAfter: overHours(board, wid),
    });
    return true;
  };

  const reschedule = (el: SimElement, wid: string, issue: PlanIssue, mode: 'start-earlier' | 'pull-in' | 'postpone', to: PlanDates | null): boolean => {
    if (!to) return false;
    const id = proposalId([mode, el.id, to.start, to.due]);
    if (!allowed(id, [wid])) return false;
    const before = overHours(board, wid);
    const from = datesOf(el);
    setDates(board, el, to);
    touched.add(el.id);
    proposals.push({ kind: 'reschedule', mode, id, elementId: el.id, issue, workerId: wid, from, to, overBefore: before, overAfter: overHours(board, wid) });
    return true;
  };

  // ---- 1. Due while away -------------------------------------------------
  for (const [wid, worker] of board.workers) {
    if (!eligible(worker)) continue;
    const cap = board.capacity.get(wid)!;
    for (const el of openHeld(wid)) {
      const due = el.due_date?.slice(0, 10);
      if (!due || due < today || due > horizonEnd) continue;
      const di = board.index.get(due);
      if (di === undefined || cap[di] > 0) continue;
      if (reassign(el, wid, 'away')) continue;
      // Nobody can take it: finish it on the last working day before the gap.
      let lastWorking = -1;
      for (let i = di - 1; i >= 0; i--) if (cap[i] > 0 && !isWeekend(board.days[i])) { lastWorking = i; break; }
      if (lastWorking < 0) continue;
      const newDue = board.days[lastWorking];
      const start = datesOf(el).start;
      reschedule(el, wid, 'away', 'pull-in', { start: start && start > newDue ? newDue : start, due: newDue });
    }
  }

  // ---- 2. Overload ---------------------------------------------------------
  const overloaded = [...board.workers.keys()]
    .filter((w) => eligible(board.workers.get(w)!) && overHours(board, w) > EPS)
    .sort((a, b) => overHours(board, b) - overHours(board, a) || (a < b ? -1 : 1));
  for (const wid of overloaded) {
    for (let guard = 0; guard < 25 && overHours(board, wid) > EPS; guard++) {
      const load = board.load.get(wid)!;
      const cap = board.capacity.get(wid)!;
      // Contribution = hours this Element puts on the days this Worker is over.
      const candidates = openHeld(wid)
        .map((el) => {
          const h = perDay(el);
          let c = 0;
          for (const i of spanIndexes(board, el)) if (load[i] > cap[i] + EPS) c += h;
          return { el, c };
        })
        .filter((x) => x.c > EPS)
        // Work already under way is the last to move — someone is in the middle of it.
        .sort((a, b) => Number(a.el.status === 'in_progress' || a.el.status === 'review') - Number(b.el.status === 'in_progress' || b.el.status === 'review')
          || PRIORITY_RANK[a.el.priority ?? 'medium'] - PRIORITY_RANK[b.el.priority ?? 'medium']
          || b.c - a.c || (a.el.id < b.el.id ? -1 : 1));
      let progressed = false;
      for (const { el } of candidates) {
        if (reschedule(el, wid, 'overload', 'start-earlier', tryStartEarlier(board, el, today))
          || reassign(el, wid, 'overload')
          || reschedule(el, wid, 'overload', 'postpone', tryPostpone(board, el))) {
          progressed = true;
          break;
        }
      }
      if (!progressed) break;
    }
  }

  // ---- 3. Unassigned ---------------------------------------------------------
  const unassigned = [...board.elements.values()]
    .filter((el) => el.holders.size === 0 && isOpenStatus(el.status) && !touched.has(el.id))
    .filter((el) => {
      const span = elementSpan(el);
      return span !== null && span.end >= today && span.start <= horizonEnd;
    })
    .sort((a, b) => PRIORITY_RANK[b.priority ?? 'medium'] - PRIORITY_RANK[a.priority ?? 'medium']
      || (a.due_date ?? '').localeCompare(b.due_date ?? '') || (a.id < b.id ? -1 : 1));
  let assigned = 0;
  for (const el of unassigned) {
    if (assigned >= MAX_ASSIGN_PROPOSALS) break;
    const target = bestTarget(board, el, (to) => allowed(proposalId(['assign', el.id, to]), [to]));
    if (!target) continue;
    moveHolder(board, el, null, target.workerId);
    touched.add(el.id);
    assigned += 1;
    proposals.push({
      kind: 'assign', id: proposalId(['assign', el.id, target.workerId]), elementId: el.id, issue: 'unassigned',
      workerId: null, toWorkerId: target.workerId, target: target.reading, overBefore: 0, overAfter: 0,
    });
  }

  const overAfter = round([...board.workers.keys()].reduce((s, w) => s + overHours(board, w), 0));
  return { proposals, overBefore, overAfter };
}

const PRIORITY_RANK: Record<string, number> = { low: 0, medium: 1, high: 2, urgent: 3 };

// =============================================================
// Order between proposals
// =============================================================

/** Workers a proposal changes the load of — the rows the chart previews. */
export function proposalWorkers(p: Proposal): string[] {
  if (p.kind === 'reassign') return [p.fromWorkerId, p.toWorkerId];
  if (p.kind === 'assign') return [p.toWorkerId];
  return p.workerId ? [p.workerId] : [];
}

/**
 * The earlier proposals this one stands on, in plan order.
 *
 * Each proposal was chosen on the board as every earlier one left it. One that
 * touches none of the same Workers or Elements did not change what this one
 * saw; one that does may be the reason this one fits (it freed the afternoon
 * this one hands work into). Followed transitively, so applying the returned
 * proposals and then this one reproduces exactly the board it was chosen on,
 * as far as anybody it affects is concerned.
 */
export function proposalPrerequisites(proposals: readonly Proposal[], index: number): Proposal[] {
  const target = proposals[index];
  if (!target) return [];
  const workers = new Set(proposalWorkers(target));
  const elements = new Set([target.elementId]);
  const out: Proposal[] = [];
  for (let j = index - 1; j >= 0; j--) {
    const p = proposals[j];
    const ws = proposalWorkers(p);
    if (!elements.has(p.elementId) && !ws.some((w) => workers.has(w))) continue;
    out.unshift(p);
    elements.add(p.elementId);
    for (const w of ws) workers.add(w);
  }
  return out;
}

// =============================================================
// Previewing a proposal on the chart
// =============================================================

type PreviewElement = PlanElement & { assignees?: { id: string; worker_id: string; worker?: unknown }[] };

/**
 * The board's Elements as they would be after `proposals`, for drawing the
 * "after" line on the chart before anything is written. `workerOf` supplies
 * the Worker record a new assignee row carries.
 */
export function applyProposals<T extends PreviewElement>(
  elements: readonly T[],
  proposals: readonly Proposal[],
  workerOf: (workerId: string) => unknown,
): T[] {
  if (proposals.length === 0) return elements as T[];
  const byElement = new Map<string, Proposal[]>();
  for (const p of proposals) byElement.set(p.elementId, [...(byElement.get(p.elementId) ?? []), p]);
  return elements.map((el) => {
    const mine = byElement.get(el.id);
    if (!mine) return el;
    let next: T = el;
    for (const p of mine) {
      if (p.kind === 'reschedule') {
        next = { ...next, start_date: p.to.start, due_date: p.to.due };
      } else {
        const kept = (next.assignees ?? []).filter((a) => p.kind !== 'reassign' || a.worker_id !== p.fromWorkerId);
        next = { ...next, assignees: [...kept, { id: `preview:${p.id}`, worker_id: p.toWorkerId, worker: workerOf(p.toWorkerId) }] };
      }
    }
    return next;
  });
}
