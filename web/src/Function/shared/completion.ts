// One definition of "how far along".
//
// A cancelled Element is not unfinished work: it left the plate. Counting it
// in the denominator made an Object with 2 done / 1 cancelled / 1 todo read
// 50% on its own page and 67% in the Strategy list that opens it
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

/**
 * Whether setting `next` takes an open Element off the plate — the moment the
 * client may stamp as its close before the audit trail is read back. An
 * Element already closed is not stamped (re-setting done must not read as
 * "done just now"); the read that follows settles any exact time. `previous`
 * is undefined when the caller does not know it (the Element is in no cache
 * it can read); that counts as a close, so a close the client did make is
 * never left out of the window.
 */
export function isClosingMove(previous: string | null | undefined, next: string | null | undefined): boolean {
  if (isOpenStatus(next)) return false;
  return previous === undefined || isOpenStatus(previous);
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

// When an Element was done (or closed). `updated_at` moves on any edit after completion,
// and the due date says when it was meant to be done, not when it was — so the
// moment comes from the audit trail: the status row the database trigger
// (record_element_status_change) writes as "<from> → <to>".

interface StatusActivityRow {
  element_id: string;
  kind: string;
  detail: string;
  created_at: string;
}

const DONE_ONLY: ReadonlySet<string> = new Set(['done']);

/** Whether an activity row records a move into one of `statuses`. */
function isMoveInto(
  row: { kind?: string | null; detail?: string | null },
  statuses: ReadonlySet<string>,
): boolean {
  if (row.kind !== 'status' || !row.detail) return false;
  const at = row.detail.lastIndexOf('→');
  return at >= 0 && statuses.has(row.detail.slice(at + 1).trim());
}

/** Whether an activity row records a move into done. */
export function isMoveIntoDone(row: { kind?: string | null; detail?: string | null }): boolean {
  return isMoveInto(row, DONE_ONLY);
}

/** Whether an activity row records a move off the plate (done or cancelled). */
export function isMoveIntoClosed(row: { kind?: string | null; detail?: string | null }): boolean {
  return isMoveInto(row, CLOSED_STATUSES);
}

/** Each Element's latest move into one of `statuses`, as an ISO instant. */
export function latestMoveInto(rows: readonly StatusActivityRow[], statuses: ReadonlySet<string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const row of rows) {
    if (!isMoveInto(row, statuses)) continue;
    const prev = out.get(row.element_id);
    if (!prev || Date.parse(row.created_at) > Date.parse(prev)) out.set(row.element_id, row.created_at);
  }
  return out;
}

/** Each Element's latest move into done, as an ISO instant. */
export function latestDoneAt(rows: readonly StatusActivityRow[]): Map<string, string> {
  return latestMoveInto(rows, DONE_ONLY);
}

/** Each Element's latest move into done or cancelled, as an ISO instant. */
export function latestClosedAt(rows: readonly StatusActivityRow[]): Map<string, string> {
  return latestMoveInto(rows, CLOSED_STATUSES);
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
