// What one more Element does to the Worker who takes it.
//
// The load chart could already answer this, but only for whoever went and
// looked. Put the one German speaker on all four missions and the board stayed
// quiet through every click; the quarter came out at 230 hours against 172 and
// nothing said so until someone opened Workload afterwards.
//
// The arithmetic here is the one the chart draws — an Element's hours spread
// evenly across the days it spans, compared against `workerCapacity`'s number
// for each of those days — taken while the assignment is being made instead of
// after. Nothing here refuses anything. A company that knows it is overloading
// someone assigns them anyway, because there is nobody else; the board's job is
// not to stop that, it is to stop being silent about it.

import { fromDateOnlyString, toDateOnlyString } from '@/alcon/shared/dateUtils';
import {
  capacityOnDay,
  standingCapacity,
  type CapacitySpan,
  type CapacityWorker,
} from '@/alcon/shared/workerCapacity';

/** An inclusive run of calendar days, both ends 'YYYY-MM-DD'. */
export type DaySpan = { start: string; end: string };

/** The parts of an Element that decide what it costs and when it costs it. */
export type LoadElement = {
  id: string;
  start_date: string | null;
  due_date: string | null;
  estimated_hours: number | null;
  priority: string | null;
  status: string | null;
};

/**
 * Statuses that stop costing anything, on and after the day they are read.
 *
 * Matches the `CLOSED` set `initiativeAssumptionModel` uses for the same
 * question — a watch on a done or cancelled Element has nothing left to
 * report either.
 */
const CLOSED_STATUSES = new Set(['done', 'cancelled']);

/**
 * Whether an Element's load still counts on `day`.
 *
 * Only today and later are cleared for a closed Element. Yesterday's chart is
 * a record of what was actually booked that day, and an Element finishing this
 * afternoon does not rewrite this morning's reading — the load chart would
 * otherwise get lighter every time something is checked off, with the same
 * week showing a different total depending on when it is looked at. Today
 * itself counts as "later": the day is not booked history until it has
 * passed, and closing something frees the rest of today the moment it closes.
 */
export function countsOnDay(element: Pick<LoadElement, 'status'>, day: string, today: string): boolean {
  return day < today || !CLOSED_STATUSES.has(element.status ?? '');
}

/**
 * What an unestimated Element is taken to cost, read off its priority.
 *
 * A guess, and a poor one — but the alternative is treating unestimated work as
 * weightless, which makes a Worker holding twenty unestimated Elements read as
 * idle.
 */
const HOURS_BY_PRIORITY: Record<string, number> = {
  urgent: 8,
  high: 4,
  medium: 2,
  low: 1,
};

/** Hours for an Element with neither an estimate nor a recognised priority. */
export const DEFAULT_ELEMENT_HOURS = 2;

/**
 * A ceiling on how many days one Element is walked over.
 *
 * Dates are typed by hand and a slipped digit in the year turns a loop over a
 * fortnight into one over four millennia. Ten years is past the point where a
 * day-by-day capacity reading means anything, so the walk stops there rather
 * than freezing the menu that opened it.
 */
export const MAX_SPAN_DAYS = 3660;

/** Total hours the Element is taken to cost. */
export function elementHours(element: LoadElement): number {
  if (element.estimated_hours != null) return element.estimated_hours;
  return HOURS_BY_PRIORITY[element.priority ?? 'medium'] ?? DEFAULT_ELEMENT_HOURS;
}

/**
 * The days an Element occupies, or null when it carries no date at all.
 *
 * One date standing alone is a single day: an Element due the 12th with no
 * start is work on the 12th, not work of unknown extent. Reversed dates are
 * read in the order that makes a span, so a mistyped pair still says something
 * rather than collapsing to nothing.
 */
export function elementSpan(element: LoadElement): DaySpan | null {
  const from = dayOf(element.start_date) ?? dayOf(element.due_date);
  const to = dayOf(element.due_date) ?? dayOf(element.start_date);
  if (!from || !to) return null;
  return from <= to ? { start: from, end: to } : { start: to, end: from };
}

/** Every day in the span, inclusive of both ends. */
export function daysInSpan(span: DaySpan): string[] {
  const cursor = fromDateOnlyString(span.start);
  const last = fromDateOnlyString(span.end);
  if (!cursor || !last) return [];
  const days: string[] = [];
  while (cursor <= last && days.length < MAX_SPAN_DAYS) {
    days.push(toDateOnlyString(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

/** Hours the Element puts on each of its days. */
export function hoursPerDay(element: LoadElement): number {
  const span = elementSpan(element);
  if (!span) return 0;
  const days = daysInSpan(span).length;
  return days === 0 ? 0 : elementHours(element) / days;
}

/** The reading taken at the moment of assigning. */
export type AssignmentReading = {
  /** The window the Element occupies — everything below is inside it. */
  span: DaySpan;
  /** Hours the Element adds to each day of that window. */
  perDay: number;
  /** Contiguous runs inside the window where the Worker has no hours at all. */
  awayRuns: DaySpan[];
  /** Days in the window with no hours at all. */
  awayDays: number;
  /** Days the Worker is over capacity once this Element is added. */
  overDays: number;
  /** Days that were already over before it — so "this one tips it" is sayable. */
  overDaysBefore: number;
  /** Hours over capacity on the worst day, 0 when no day is over. */
  worstOver: number;
};

/**
 * How the Worker's window looks with this Element on it.
 *
 * Null when the Element carries no dates: capacity is a question about a
 * period, and an Element with no period cannot be asked it. Saying "fine" there
 * would report the absence of dates as the absence of load.
 *
 * The Element is removed from `committed` by id before anything is counted —
 * reopening the menu on an Element the Worker already holds must not charge
 * them for it twice.
 */
export function readAssignment(args: {
  worker: CapacityWorker;
  spans: readonly CapacitySpan[];
  /** Everything else this Worker is already holding. */
  committed: readonly LoadElement[];
  element: LoadElement;
  /** 'YYYY-MM-DD', so a closed Element already stops counting today. */
  today: string;
}): AssignmentReading | null {
  const { worker, spans, committed, element, today } = args;
  const span = elementSpan(element);
  if (!span) return null;

  const days = daysInSpan(span);
  const standing = standingCapacity(worker);
  const perDay = hoursPerDay(element);

  const before = committedHours(committed.filter((c) => c.id !== element.id), days, today);

  const awayRuns: DaySpan[] = [];
  let awayDays = 0;
  let overDays = 0;
  let overDaysBefore = 0;
  let worstOver = 0;

  for (let i = 0; i < days.length; i++) {
    const capacity = capacityOnDay(standing, spans, days[i]);
    if (capacity <= 0) {
      awayDays += 1;
      const open = awayRuns[awayRuns.length - 1];
      if (open && open.end === days[i - 1]) open.end = days[i];
      else awayRuns.push({ start: days[i], end: days[i] });
    }
    if (before[i] > capacity) overDaysBefore += 1;
    const after = before[i] + perDay;
    if (after > capacity) {
      overDays += 1;
      const over = after - capacity;
      if (over > worstOver) worstOver = over;
    }
  }

  return { span, perDay, awayRuns, awayDays, overDays, overDaysBefore, worstOver };
}

/**
 * Elements whose due date lands on a day this Worker has no hours.
 *
 * The load chart already draws these as a band over a hatched stretch, which
 * says that something collides without saying what. This returns the list, so
 * the collision can be read as names and moved.
 */
export function dueWhileAway<T extends LoadElement>(
  worker: CapacityWorker,
  spans: readonly CapacitySpan[],
  elements: readonly T[],
): { element: T; day: string }[] {
  const standing = standingCapacity(worker);
  const out: { element: T; day: string }[] = [];
  for (const element of elements) {
    const day = dayOf(element.due_date);
    if (!day) continue;
    if (capacityOnDay(standing, spans, day) > 0) continue;
    out.push({ element, day });
  }
  out.sort((a, b) => a.day.localeCompare(b.day));
  return out;
}

/**
 * Elements due inside one booked period, earliest first.
 *
 * Asked of a period rather than of the Worker, because that is how it is read:
 * next to the row saying "away the 5th through the 7th", the work that falls
 * inside those dates. Any period qualifies, not only the ones that go to zero —
 * a due date landing in a half-time week is worth seeing too.
 */
export function elementsDueInSpan<T extends LoadElement>(
  period: { start_date: string; end_date: string },
  elements: readonly T[],
): T[] {
  return elements
    .filter((element) => {
      const day = dayOf(element.due_date);
      return day !== null && day >= period.start_date && day <= period.end_date;
    })
    .sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? ''));
}

/** Hours already booked on each of `days`, from everything the Worker holds. */
function committedHours(elements: readonly LoadElement[], days: readonly string[], today: string): number[] {
  const hours = new Array<number>(days.length).fill(0);
  if (days.length === 0) return hours;
  const first = days[0];
  const last = days[days.length - 1];

  for (const element of elements) {
    const span = elementSpan(element);
    if (!span) continue;
    if (span.end < first || span.start > last) continue;
    const perDay = hoursPerDay(element);
    if (perDay === 0) continue;
    for (let i = 0; i < days.length; i++) {
      if (days[i] >= span.start && days[i] <= span.end && countsOnDay(element, days[i], today)) {
        hours[i] += perDay;
      }
    }
  }
  return hours;
}

/** The calendar day a date column names, with any time part dropped. */
function dayOf(value: string | null | undefined): string | null {
  if (!value) return null;
  const day = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}
