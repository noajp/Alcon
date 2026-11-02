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

// When an Element was done. `updated_at` moves on any edit after completion,
// and the due date says when it was meant to be done, not when it was — so the
// moment comes from the audit trail: the status row the database trigger
// (record_element_status_change) writes as "<from> → <to>".

interface StatusActivityRow {
  element_id: string;
  kind: string;
  detail: string;
  created_at: string;
}

/** The status a status row moved to, or null for any other row. */
function statusMovedTo(row: StatusActivityRow): string | null {
  if (row.kind !== 'status') return null;
  const at = row.detail.lastIndexOf('→');
  return at < 0 ? null : row.detail.slice(at + 1).trim();
}

/** Each Element's latest move into done, as an ISO instant. */
export function latestDoneAt(rows: readonly StatusActivityRow[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const row of rows) {
    if (statusMovedTo(row) !== 'done') continue;
    const prev = out.get(row.element_id);
    if (!prev || Date.parse(row.created_at) > Date.parse(prev)) out.set(row.element_id, row.created_at);
  }
  return out;
}

/**
 * Elements that are done now and were last moved into done at or after
 * `since`. An Element with no recorded move into done is not counted: its
 * completion day is unknown, and guessing it from the due date or the last
 * edit is what made this number disagree with its label.
 */
export function countCompletedSince(
  elements: readonly { id: string; status?: string | null }[],
  doneAt: ReadonlyMap<string, string>,
  since: Date,
): number {
  const from = since.getTime();
  let n = 0;
  for (const el of elements) {
    if (el.status !== 'done') continue;
    const at = doneAt.get(el.id);
    if (at && Date.parse(at) >= from) n += 1;
  }
  return n;
}
