// How many hours a Worker has on a given day.
//
// `workers.status` is one flag with no tense, so it cannot say "still here
// today, gone from the 5th through the 7th". Setting it to inactive erases
// someone who is working right now; leaving it active makes next week's plan
// a lie. Both readings are false, which is why the fact used to end up in
// prose in a comment where nothing could count it.
//
// The model here is that an absence is a *span whose capacity is a number*.
// Away for a week is capacity 0 for seven days; half-time is capacity 4.
// Leave is a case of capacity, not a second kind of thing beside it, so the
// load chart asks one question per day — "how many hours does this person
// have?" — instead of asking one question and then checking a flag.
//
// start_date and end_date are inclusive, which is how an absence is spoken:
// "away the 5th through the 7th" is three days off, not two.

import { toDateOnlyString } from '@/Function/shared/dateUtils';

/** Hours in a standing working day when nobody has said otherwise. */
export const DEFAULT_CAPACITY_PER_DAY = 8;

/**
 * An ai_agent's standing day, as a multiple of the human one — it runs work in
 * parallel, so the same wall-clock day holds more of it.
 */
export const AGENT_CAPACITY_MULTIPLIER = 2;

/** The parts of a Worker that decide a standing day. */
export type CapacityWorker = {
  type: 'human' | 'ai_agent' | 'robot';
  capacity_hours_per_day: number | null;
};

/** The parts of a worker_availability row that decide a day's capacity. */
export type CapacitySpan = {
  start_date: string;
  end_date: string;
  capacity_hours_per_day: number;
};

/**
 * The Worker's ordinary day, before any availability span applies.
 *
 * A per-Worker `capacity_hours_per_day` wins outright, agents included: it is
 * a number somebody wrote down about this Worker, while the ×2 is a guess
 * standing in for the absence of one. Doubling a value that was set on purpose
 * would make the stored number mean something other than what was typed.
 */
export function standingCapacity(worker: CapacityWorker): number {
  if (worker.capacity_hours_per_day != null) return worker.capacity_hours_per_day;
  if (worker.type === 'ai_agent') return DEFAULT_CAPACITY_PER_DAY * AGENT_CAPACITY_MULTIPLIER;
  return DEFAULT_CAPACITY_PER_DAY;
}

/**
 * Capacity on one day, given the Worker's standing day and every span that
 * could cover it.
 *
 * Overlapping spans take the smallest capacity. Each span is a separate
 * constraint on the same day, and a constraint does not stop applying because
 * a second one arrived: somebody on leave who is also rotated out is not more
 * available for having two reasons to be gone. Taking the minimum also keeps
 * the answer independent of the order the rows come back in.
 *
 * `day` is a 'YYYY-MM-DD' string, compared as a string — bare dates sort
 * lexicographically in that format, so no Date is constructed and no timezone
 * can shift a boundary by a day.
 */
export function capacityOnDay(
  standing: number,
  spans: readonly CapacitySpan[],
  day: string,
): number {
  let capacity = standing;
  for (const span of spans) {
    if (day < span.start_date || day > span.end_date) continue;
    if (span.capacity_hours_per_day < capacity) capacity = span.capacity_hours_per_day;
  }
  return capacity;
}

/** `capacityOnDay` across a window, in the order the days were given. */
export function dailyCapacity(
  worker: CapacityWorker,
  spans: readonly CapacitySpan[],
  days: readonly Date[],
): number[] {
  const standing = standingCapacity(worker);
  return days.map((d) => capacityOnDay(standing, spans, toDateOnlyString(d)));
}

/** Days in the window the Worker has no hours at all. */
export function awayDayCount(capacities: readonly number[]): number {
  let n = 0;
  for (const c of capacities) if (c <= 0) n += 1;
  return n;
}
