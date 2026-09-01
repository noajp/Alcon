// =============================================================
// Campaign assumptions — the things being taken as true, and whether they
// still are.
//
// A Campaign rests on statements nobody plans to verify: one person speaks the
// language, the existing line runs on whatever is left over, the vendor ships
// in March. They are not risks and not decisions — they are the ground the plan
// is standing on, and the plan does not survive them being wrong.
//
// The failure this exists to close is not that they go unwritten. It is that
// they are written once, in prose, and then break somewhere else. The Element
// that would have falsified the assumption goes blocked, or slides past its
// date, and the Campaign page keeps the same face it had last week because
// nothing connects the two.
//
// So an assumption here carries the Elements that could falsify it, and the
// state of those Elements is read back onto the assumption. `shaken` is not a
// claim that the assumption is false — nobody but a person can say that. It is
// a claim that something the assumption depends on has stopped moving, which is
// exactly when somebody should go and look.
//
// Pure on purpose: no React, no Supabase, no clock of its own. `now` is an
// argument so a test does not have to wait for a due date to pass.
// =============================================================

import { toDateOnlyString } from '@/alcon/shared/dateUtils';
import type { IntentKind } from '@/types/database';

/**
 * What marks an `intents` row as an assumption rather than a decision.
 *
 * Both hang off the Campaign's root Intent. This used to read `slug`, which
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

/** One `intents` row with `slug = 'assumption'`, plus what it watches. */
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
}

export interface Assumption extends Omit<AssumptionInput, 'watches'> {
  watches: Watch[];
  blocked: number;
  overdue: number;
  /** Something this assumption depends on has stopped moving. */
  shaken: boolean;
  /** Nothing is bound to it, so nothing can ever contradict it. Reported
   *  rather than left silent: an assumption with no way to fail is not a safe
   *  assumption, it is an unwatched one. */
  unwatched: boolean;
}

/** Statuses that take an Element out of play — neither can shake anything. */
const CLOSED = new Set(['done', 'cancelled']);

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
  const closed = CLOSED.has(input.status ?? '');
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

export function evaluateAssumption(input: AssumptionInput, now: Date): Assumption {
  const watches = input.watches.map((w) => evaluateWatch(w, now));
  const blocked = watches.filter((w) => w.blocked).length;
  const overdue = watches.filter((w) => w.overdue).length;
  return {
    ...input,
    watches,
    blocked,
    overdue,
    shaken: blocked > 0 || overdue > 0,
    unwatched: watches.length === 0,
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
 * Within the shaken band the count of stopped Elements breaks the tie, because
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
        const hurt = b.blocked + b.overdue - (a.blocked + a.overdue);
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
 * It names the Elements, not the assumption: this surface cannot know whether
 * the assumption is false, only that what would have tested it has stopped. So
 * the sentence reports the observation and leaves the conclusion to the reader.
 */
export function shakenLabel(assumption: Assumption): string {
  const parts: string[] = [];
  if (assumption.blocked > 0) parts.push(`${assumption.blocked} blocked`);
  if (assumption.overdue > 0) parts.push(`${assumption.overdue} overdue`);
  return parts.join(', ');
}

/** The short state a single watched Element is in, worst first. */
export function watchLabel(watch: Watch): string | null {
  if (watch.blocked) return 'Blocked';
  if (watch.overdue) return `${watch.daysOverdue}d overdue`;
  return null;
}
