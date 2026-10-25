// =============================================================
// Initiative bus factor — the work nobody else is on.
//
// Load asks how full somebody is. This asks whether anybody else could take
// over. They are not the same reading and they do not come due at the same
// time: an overloaded Worker is fixed by moving work this week, a Worker who is
// the only one who knows something is fixed by hiring or teaching, which takes
// months. Folded into one number the slow one is invisible until it fires.
//
// It fires as a surprise. Two exercises produced the same shape — the only
// German speaker went on two weeks' leave and four of eight Elements stopped;
// the only person who had sat an accreditation before went into hospital for
// three. Both boards said afterwards that four things were blocked. Neither
// could be asked beforehand how many things would stop if one person left.
//
// Pure on purpose: no React, no Supabase, no clock of its own.
// =============================================================

import { toDateOnlyString } from '@/Function/shared/dateUtils';
import { translate } from '@/Function/i18n/I18nProvider';
import { ABSENCE_WINDOW_DAYS } from '@/ActivitySpace/strategy/initiative/initiativeAssumptionModel';
import {
  awayDayCount,
  dailyCapacity,
  type CapacitySpan,
  type CapacityWorker,
} from '@/Function/shared/workerCapacity';
import { isOpenStatus } from '@/Function/shared/completion';

/** The parts of an Element that decide whether it rests on one person. */
export interface BusElement {
  id: string;
  status: string | null;
  /** `yyyy-MM-dd`, or null when the Element carries no date. */
  dueDate: string | null;
  /**
   * Every Worker with a seat on this Element, whatever their role.
   *
   * Role is deliberately not filtered. The question is not who is accountable
   * but who has been inside the work: a reviewer or a collaborator has read it
   * and can be handed it, while an Element carrying one name leaves nothing
   * behind when that name goes. Reading only `role = 'assignee'` would also
   * mis-count every row where nobody set the role, since the column is
   * nullable — an absent role would read as an absent person.
   */
  workerIds: string[];
}

/** A Worker who might turn out to be the only one on something. */
export interface BusWorkerInput {
  id: string;
  name: string;
  /** The parts that decide a standing day. Null when the Worker is not on the
   *  roster this Initiative can read, which is not the same as being away. */
  worker: CapacityWorker | null;
  /** Every availability span on record for them. */
  spans: readonly CapacitySpan[];
}

export interface SoleHolder {
  workerId: string;
  name: string;
  /** Open Elements nobody else is on. */
  sole: number;
  /** 0..1 of the Initiative's open Elements. */
  share: number;
  /** Days in the window they have no hours at all. */
  awayDays: number;
  /** Days from today to the first of those, 0 when it is today. Null when
   *  there is none in the window. */
  awayIn: number | null;
  /** `yyyy-MM-dd` of that first day, null when there is none. */
  awayFrom: string | null;
  away: boolean;
  /** Their sole-held Elements whose due date lands on a day they have no
   *  hours. The one thing on this surface that is certain rather than likely:
   *  the date and the absence are both already written down. */
  dueWhileAway: number;
}

export interface InitiativeBusFactor {
  /** Open = not done, not cancelled. The denominator. */
  openTotal: number;
  /** Open Elements exactly one Worker is on. */
  single: number;
  /** Open Elements nobody is on — no sole holder to name, so they are held
   *  out of `single` rather than counted as depending on one person. */
  unstaffed: number;
  /** Every Worker who is the only person on at least one open Element,
   *  the ones with an absence coming first. */
  holders: SoleHolder[];
}

/** Not done, not cancelled — the work still on the Initiative's plate. */
function isOpen(el: BusElement): boolean {
  return isOpenStatus(el.status);
}

/** The window's local calendar days, today first. */
function windowDays(now: Date, length: number): Date[] {
  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days: Date[] = [];
  for (let i = 0; i < length; i += 1) {
    days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

/**
 * Who is alone on what.
 *
 * `elements` may be wider than the Initiative — the caller has already scoped it.
 * A Worker named on an Element but missing from `workers` still counts as a
 * second person on it: they exist, they are simply not one this Initiative can
 * read a calendar for, and treating them as absent would manufacture a bus
 * factor out of a failed lookup.
 *
 * The absence window is the assumptions pane's `ABSENCE_WINDOW_DAYS`. The
 * Initiative page should ask about the future with one horizon, so the reader
 * learns a single number rather than a rule about which surface uses which.
 */
export function computeBusFactor(
  elements: readonly BusElement[],
  workers: readonly BusWorkerInput[],
  now: Date,
): InitiativeBusFactor {
  const open = elements.filter(isOpen);

  // Distinct Workers, because one person can hold two rows on the same Element
  // — assignee and reviewer at once — and counting the rows would read that as
  // cover.
  const soleBy = new Map<string, BusElement[]>();
  let unstaffed = 0;
  let single = 0;
  for (const el of open) {
    const on = new Set(el.workerIds);
    if (on.size === 0) {
      unstaffed += 1;
      continue;
    }
    if (on.size > 1) continue;
    single += 1;
    const [workerId] = on;
    const held = soleBy.get(workerId);
    if (held) held.push(el);
    else soleBy.set(workerId, [el]);
  }

  const days = windowDays(now, ABSENCE_WINDOW_DAYS);
  const dayKeys = days.map(toDateOnlyString);
  const byId = new Map(workers.map((w) => [w.id, w]));

  const holders: SoleHolder[] = [];
  for (const [workerId, held] of soleBy) {
    const input = byId.get(workerId);
    const capacities = input?.worker ? dailyCapacity(input.worker, input.spans, days) : [];
    const first = capacities.findIndex((c) => c <= 0);
    // Only collisions inside the window are counted. A due date six months out
    // landing in a booked absence is real, but it is not this month's problem
    // and putting it in the same number would blunt the one that is.
    const noHours = new Set(dayKeys.filter((_, i) => capacities[i] <= 0));
    holders.push({
      workerId,
      name: input?.name ?? 'Unknown Worker',
      sole: held.length,
      share: open.length > 0 ? held.length / open.length : 0,
      awayDays: awayDayCount(capacities),
      awayIn: first === -1 ? null : first,
      awayFrom: first === -1 ? null : dayKeys[first],
      away: first !== -1,
      dueWhileAway: held.filter((el) => el.dueDate !== null && noHours.has(el.dueDate)).length,
    });
  }

  // Away first, then the biggest concentration. A sole holder who is here is a
  // standing condition answered over months by teaching somebody; a sole holder
  // who is leaving is a dated event answered this week. Ordering by size alone
  // would bury the one with a date on it.
  holders.sort(
    (a, b) =>
      Number(b.away) - Number(a.away) ||
      b.dueWhileAway - a.dueWhileAway ||
      b.sole - a.sole ||
      a.name.localeCompare(b.name),
  );

  return { openTotal: open.length, single, unstaffed, holders };
}

/**
 * The line a sole holder's row carries, or null when there is nothing dated to
 * say about them.
 *
 * Away now says how much of the window is already gone; away later says how
 * long there is to arrange something. They ask for different things, so they
 * are not collapsed into one count.
 */
export function holderAbsenceLabel(holder: SoleHolder): string | null {
  if (holder.awayIn === null) return null;
  return holder.awayIn === 0
    ? translate('Away {n}d', { n: holder.awayDays })
    : translate('Away in {n}d', { n: holder.awayIn });
}
