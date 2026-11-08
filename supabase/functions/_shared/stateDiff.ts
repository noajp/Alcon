// The diff primitive (back-half B2; Muse_3 proposal #11): compare what a
// write intended with the state a read-back actually found, mechanically.
// A check that can be wrong in complicated ways is a second agent, not a
// check — so the comparison is deliberately small: field equality between
// an expected map and a read-back state map, nothing smarter. Pure: the
// executor (integrationTools.ts) and the tests read a diff the same way;
// the audit surfaces and B8's plan display reuse it later.

/** One field whose read-back value is not what the write intended. */
export interface DiffMismatch {
  field: string;
  expected: unknown;
  /** What the read-back carried for the field; undefined when it carried nothing. */
  actual: unknown;
}

/** Pure. JSON-value equality: object key order does not matter, array
 *  order does, and `undefined` equals only `undefined` (a missing field
 *  never silently equals a present null — the record keeps them apart). */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => jsonEqual(v, b[i]));
  }
  if (typeof a === "object") {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const keys = Object.keys(ao);
    if (keys.length !== Object.keys(bo).length) return false;
    return keys.every((k) => Object.prototype.hasOwnProperty.call(bo, k) && jsonEqual(ao[k], bo[k]));
  }
  return false;
}

/**
 * Pure. The mismatches between an expected state and an actual one, in
 * the expected map's field order. Only fields the expectation names are
 * judged — a read-back may carry far more than the write ever promised,
 * and none of that is a finding.
 */
export function diffExpect(expected: Record<string, unknown>, actual: Record<string, unknown>): DiffMismatch[] {
  const out: DiffMismatch[] = [];
  for (const [field, exp] of Object.entries(expected)) {
    const act = actual[field];
    if (!jsonEqual(exp, act)) out.push({ field, expected: exp, actual: act });
  }
  return out;
}

/**
 * Pure. A call result's text as the state it reports: a JSON object is
 * the state itself; anything else that is not empty is a bare payload
 * (a file's content read back raw is the common case) and stands as the
 * state's `content`; an empty answer carries no state at all.
 */
export function stateOfResult(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  if (!trimmed) return {};
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch { /* not JSON: the payload itself is the state */ }
  return { content: text };
}
