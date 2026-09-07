// One definition of "how far along".
//
// A cancelled Element is not unfinished work: it left the plate. Counting it
// in the denominator made an Object with 2 done / 1 cancelled / 1 todo read
// 50% on its own page and 67% in the Initiative list that opens it
// (ELE_STR-024) — two answers to one question, at exactly the place a person
// compares them. Every progress bar, the KPI completion rate, the overdue
// filters beside them and the models' notion of "open" read this one set, so
// none of them can disagree about what is still on the plate.
//
// Pure. No React, no clock.

/** Statuses under which an Element is off the plate — for good or for nothing. */
const CLOSED_STATUSES: ReadonlySet<string> = new Set(['done', 'cancelled']);

export function isOpenStatus(status: string | null | undefined): boolean {
  return !CLOSED_STATUSES.has(status ?? '');
}

interface Completion {
  /** Elements marked done. */
  done: number;
  /** Elements that count — everything not cancelled. */
  total: number;
  /** 0–100; 0 when there is nothing to measure (callers that need to tell
   *  "empty" from "0%" check `total`). */
  pct: number;
}

export function completionOf(elements: readonly { status?: string | null }[]): Completion {
  let done = 0;
  let total = 0;
  for (const el of elements) {
    if (el.status === 'cancelled') continue;
    total += 1;
    if (el.status === 'done') done += 1;
  }
  return { done, total, pct: total > 0 ? Math.round((done / total) * 100) : 0 };
}
