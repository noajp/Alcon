// =============================================================
// Initiative assumptions — the things being taken as true, and whether they
// still are.
//
// A Initiative rests on statements nobody plans to verify: one person speaks the
// language, the existing line runs on whatever is left over, the vendor ships
// in March. They are not risks and not decisions — they are the ground the plan
// is standing on, and the plan does not survive them being wrong.
//
// The failure this exists to close is not that they go unwritten. It is that
// they are written once, in prose, and then break somewhere else. The Element
// that would have falsified the assumption goes blocked, or slides past its
// date, and the Initiative page keeps the same face it had last week because
// nothing connects the two.
//
// So an assumption here carries what could falsify it, and the state of those
// things is read back onto the assumption. `shaken` is not a claim that the
// assumption is false — nobody but a person can say that. It is a claim that
// something the assumption depends on has stopped moving, which is exactly when
// somebody should go and look.
//
// Two kinds of thing can falsify one. An Element, when the assumption is about
// work: the work that would have tested it goes blocked or slides past its
// date. A Worker, when the assumption's subject is a person — "only one of us
// has done this before" is not a statement about any Element, and no Element's
// status can contradict it. What contradicts it is that person having no hours,
// which the board already records as an availability span. Both readings land
// on the same `shaken`, because from the Initiative's side they are the same
// sentence.
//
// Pure on purpose: no React, no Supabase, no clock of its own. `now` is an
// argument so a test does not have to wait for a due date to pass.
// =============================================================

import { toDateOnlyString } from '@/Function/shared/dateUtils';
import {
  awayDayCount,
  capacityOnDay,
  standingCapacity,
  type CapacitySpan,
  type CapacityWorker,
} from '@/Function/shared/workerCapacity';
import type { IntentKind } from '@/types/database';
import { isOpenStatus } from '@/Function/shared/completion';

/**
 * What marks an `intents` row as an assumption rather than a decision.
 *
 * Both hang off the Initiative's root Intent. This used to read `slug`, which
 * was free and meant something else — its documented job is naming a card for
 * cross-references, and a kind stored there is a kind nobody can look up.
 */
export function isAssumption(kind: IntentKind | null | undefined): boolean {
  return kind === 'assumption';
}

/** An Element bound to an assumption as something that could falsify it. */
export interface WatchInput {
  /** The `intent_bindings` row, so unlinking has something to delete. */
  bindingId: string;
  elementId: string;
  displayId: string | null;
  title: string;
  status: string | null;
  /** `yyyy-MM-dd`, or null when the Element carries no date. */
  dueDate: string | null;
  /** Where to go to look at it. Elements have no route of their own, so the
   *  Object they live in is the destination. */
  objectId: string | null;
  domainId: string | null;
}

export interface Watch extends WatchInput {
  blocked: boolean;
  overdue: boolean;
  /** Whole calendar days past the due date; null when it is not overdue. */
  daysOverdue: number | null;
}

/**
 * How far ahead an absence counts against an assumption.
 *
 * Four weeks from today, today included. The window is a horizon of action
 * rather than of interest: an assumption resting on one person is still
 * answerable while there is time to brief a second, and past a month the answer
 * stops being a backfill and becomes a different decision. An assumption row
 * carries no date of its own to measure against — unlike a decision, which has
 * a review horizon — so every row is read against the same window and the
 * reader learns one number instead of a rule.
 */
export const ABSENCE_WINDOW_DAYS = 28;

/** A Worker bound to an assumption whose subject is that person. */
export interface WorkerWatchInput {
  bindingId: string;
  workerId: string;
  name: string;
  role: string | null;
  /** The parts that decide a standing day. Null when the Worker has left the
   *  roster this Initiative can read, which is not the same as being away. */
  worker: CapacityWorker | null;
  /** Every availability span on record for them. */
  spans: readonly CapacitySpan[];
}

export interface WorkerWatch extends WorkerWatchInput {
  /** Days in the window they have no hours at all. */
  awayDays: number;
  /** Days from today to the first of those, 0 when it is today. Null when
   *  there is none in the window. */
  awayIn: number | null;
  /** `yyyy-MM-dd` of that first day, null when there is none. */
  awayFrom: string | null;
  away: boolean;
}

/** A CRM deal bound to an assumption whose subject is a customer or a
 *  counterpart: "the large customer renews". Read with the reader's rights.
 *  `read` says whether the deal could be read: not yet, not at all (the CRM
 *  failed), or not by this reader — none of which is "fine". */
export interface DealWatchInput {
  bindingId: string;
  dealId: string;
  label: string;
  read: 'ok' | 'loading' | 'failed' | 'hidden';
  outcome: 'open' | 'won' | 'lost' | null;
  /** The CRM's own reading of the deal. */
  atRisk: boolean;
  /** `yyyy-MM-dd`; for an open deal, the expected close. */
  closeDate: string | null;
  /** A won deal whose contract renewed or ended with no renewal started. */
  renewalOverdue: boolean;
}

export interface DealWatch extends DealWatchInput {
  /** What went wrong, worst first; null when the deal is fine or unreadable. */
  trouble: 'lost' | 'renewal overdue' | 'at risk' | 'close date passed' | null;
}

/** One `intents` row with `kind = 'assumption'`, plus what it watches. */
export interface AssumptionInput {
  id: string;
  /** The statement being taken as true. */
  title: string;
  /** What it costs when it stops being true. */
  cost: string | null;
  notedBy: string | null;
  /** ISO timestamp. */
  notedAt: string | null;
  orderIndex: number;
  watches: WatchInput[];
  workers: WorkerWatchInput[];
  deals?: DealWatchInput[];
}

export interface Assumption extends Omit<AssumptionInput, 'watches' | 'workers' | 'deals'> {
  watches: Watch[];
  workers: WorkerWatch[];
  deals: DealWatch[];
  /** Bound deals that went wrong. */
  troubled: number;
  blocked: number;
  overdue: number;
  /** Bound Workers with no hours somewhere in the window. */
  absent: number;
  /** Something this assumption depends on has stopped moving. */
  shaken: boolean;
  /** Nothing is bound to it, so nothing can ever contradict it. Reported
   *  rather than left silent: an assumption with no way to fail is not a safe
   *  assumption, it is an unwatched one. */
  unwatched: boolean;
}

const BLOCKED = 'blocked';

/** `yyyy-MM-dd` → whole days since the epoch. */
function dayNumber(day: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(day);
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(ms) ? null : Math.round(ms / 86_400_000);
}

/**
 * One Element's reading.
 *
 * Both signals are computed, not just the worse one: an Element that is blocked
 * *and* three weeks late is a different sentence from one that is merely
 * blocked, and collapsing them at this layer would make the difference
 * unrecoverable by the caller.
 *
 * Closed Elements report neither. A due date on a finished Element is not late,
 * and a cancelled one cannot block anything.
 */
export function evaluateWatch(input: WatchInput, now: Date): Watch {
  const closed = !isOpenStatus(input.status);
  const today = dayNumber(toDateOnlyString(now));
  const due = input.dueDate ? dayNumber(input.dueDate) : null;
  const late = !closed && today !== null && due !== null && due < today;
  return {
    ...input,
    blocked: !closed && input.status === BLOCKED,
    overdue: late,
    daysOverdue: late && today !== null && due !== null ? today - due : null,
  };
}

/**
 * One Worker's reading, over the fixed window above.
 *
 * The capacity curve is not recomputed here — `standingCapacity` and
 * `capacityOnDay` already answer "how many hours does this person have on this
 * day", overlapping spans and agent multipliers included, and the load chart
 * reads the same two. Away is `capacity <= 0`: no hours is the one state that
 * cannot be worked around by moving something, which is what makes it a
 * contradiction rather than a pressure.
 *
 * A Worker who has left the roster reports nothing. Their spans are unreadable
 * from here, and an absence inferred from missing rows would be a verdict drawn
 * from a failed lookup.
 */
export function evaluateWorkerWatch(input: WorkerWatchInput, now: Date): WorkerWatch {
  if (!input.worker) {
    return { ...input, awayDays: 0, awayIn: null, awayFrom: null, away: false };
  }
  const standing = standingCapacity(input.worker);
  // Walked as local calendar days, so "today" is the reader's today and a span
  // boundary cannot land a day out for anyone west of Greenwich.
  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days: string[] = [];
  for (let i = 0; i < ABSENCE_WINDOW_DAYS; i += 1) {
    days.push(toDateOnlyString(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  const capacities = days.map((day) => capacityOnDay(standing, input.spans, day));
  const first = capacities.findIndex((c) => c <= 0);
  return {
    ...input,
    awayDays: awayDayCount(capacities),
    awayIn: first === -1 ? null : first,
    awayFrom: first === -1 ? null : days[first],
    away: first !== -1,
  };
}

/**
 * One deal's reading. A lost deal, a contract past renewal with nothing
 * started, a deal the CRM rates at risk, an open deal past its close date —
 * each is the customer side of the plan moving away from what was assumed.
 * A deal the reader cannot see reports nothing, for the same reason a Worker
 * off the roster does.
 */
export function evaluateDealWatch(input: DealWatchInput, now: Date): DealWatch {
  if (input.read !== 'ok') return { ...input, trouble: null };
  const today = toDateOnlyString(now);
  const trouble = input.outcome === 'lost' ? 'lost'
    : input.renewalOverdue ? 'renewal overdue'
    : input.outcome === 'open' && input.atRisk ? 'at risk'
    : input.outcome === 'open' && input.closeDate !== null && input.closeDate < today ? 'close date passed'
    : null;
  return { ...input, trouble };
}

export function evaluateAssumption(input: AssumptionInput, now: Date): Assumption {
  const watches = input.watches.map((w) => evaluateWatch(w, now));
  const workers = input.workers.map((w) => evaluateWorkerWatch(w, now));
  const deals = (input.deals ?? []).map((d) => evaluateDealWatch(d, now));
  const blocked = watches.filter((w) => w.blocked).length;
  const overdue = watches.filter((w) => w.overdue).length;
  const absent = workers.filter((w) => w.away).length;
  const troubled = deals.filter((d) => d.trouble).length;
  return {
    ...input,
    watches,
    workers,
    deals,
    blocked,
    overdue,
    absent,
    troubled,
    shaken: blocked > 0 || overdue > 0 || absent > 0 || troubled > 0,
    unwatched: watches.length === 0 && workers.length === 0 && deals.length === 0,
  };
}

/**
 * Shaken first, then newest first.
 *
 * Only two bands. An assumption that is holding is not ranked against another
 * one that is holding — there is nothing to choose between them, and ordering
 * them by severity would invent a difference. The one distinction that earns a
 * band is "somebody needs to go and look at this".
 *
 * Within the shaken band the count of stopped watchers breaks the tie, because
 * an assumption with three of its four watchers down is further gone than one
 * with a single late Element.
 */
export function orderAssumptions(inputs: AssumptionInput[], now: Date): Assumption[] {
  return inputs
    .map((input) => evaluateAssumption(input, now))
    .sort((a, b) => {
      const band = (a.shaken ? 0 : 1) - (b.shaken ? 0 : 1);
      if (band !== 0) return band;
      if (a.shaken) {
        const hurt = b.blocked + b.overdue + b.absent + b.troubled - (a.blocked + a.overdue + a.absent + a.troubled);
        if (hurt !== 0) return hurt;
      }
      // Compared for equality before subtracting: both ranks are −Infinity when
      // neither carries a date, and subtracting those gives NaN, which makes
      // the whole comparator undefined and the order arbitrary.
      const na = notedRank(a);
      const nb = notedRank(b);
      if (na !== nb) return nb - na;
      if (a.orderIndex !== b.orderIndex) return a.orderIndex - b.orderIndex;
      return a.id.localeCompare(b.id);
    });
}

/** Undated assumptions sort after dated ones rather than jumping to the top. */
function notedRank(assumption: Assumption): number {
  if (!assumption.notedAt) return Number.NEGATIVE_INFINITY;
  const t = new Date(assumption.notedAt).getTime();
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}

export function countShaken(assumptions: Assumption[]): number {
  return assumptions.filter((a) => a.shaken).length;
}

/**
 * The line the assumption carries.
 *
 * It names what was watched, not the assumption: this surface cannot know
 * whether the assumption is false, only that what would have tested it has
 * stopped. So the sentence reports the observation and leaves the conclusion to
 * the reader.
 */
export function shakenLabel(assumption: Assumption): string {
  const parts: string[] = [];
  if (assumption.blocked > 0) parts.push(`${assumption.blocked} blocked`);
  if (assumption.overdue > 0) parts.push(`${assumption.overdue} overdue`);
  if (assumption.absent > 0) parts.push(`${assumption.absent} away`);
  if (assumption.troubled > 0) parts.push(`${assumption.troubled} deal${assumption.troubled === 1 ? '' : 's'} in trouble`);
  return parts.join(', ');
}

/** The short state a single watched Element is in, worst first. */
export function watchLabel(watch: Watch): string | null {
  if (watch.blocked) return 'Blocked';
  if (watch.overdue) return `${watch.daysOverdue}d overdue`;
  return null;
}

/**
 * The short state a single watched Worker is in.
 *
 * Two sentences, because they ask for different things. Away now says how much
 * of the window is already gone; away later says how long there is to arrange
 * something. Collapsing them into one count would hide which of the two the
 * reader is looking at.
 */
export function workerWatchLabel(watch: WorkerWatch): string | null {
  if (watch.awayIn === null) return null;
  return watch.awayIn === 0 ? `Away ${watch.awayDays}d` : `Away in ${watch.awayIn}d`;
}
