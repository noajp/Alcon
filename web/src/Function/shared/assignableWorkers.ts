// Who may be assigned follows the Space boundary; the server decides it
// (list_assignable_workers / worker_assignable). These are the pure pieces the
// client does with that answer: split a requested id list against it, and
// keep already-chosen Workers nameable when they fall outside it.

/** Split requested Worker ids into the ones the candidate list allows and the
 *  ones it does not. Order is kept, duplicates and blanks are dropped. */
export function partitionAssignable(
  requested: readonly string[],
  candidates: readonly { id: string }[],
): { assignable: string[]; skipped: string[] } {
  const allowed = new Set(candidates.map((c) => c.id));
  const seen = new Set<string>();
  const assignable: string[] = [];
  const skipped: string[] = [];
  for (const id of requested) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    (allowed.has(id) ? assignable : skipped).push(id);
  }
  return { assignable, skipped };
}

/** The candidate list plus any Worker already chosen that is missing from it
 *  (a value set before the boundary, or by someone in another Space), so the
 *  current value still renders by name. Candidates keep their order; extras
 *  follow, each once. */
export function withCurrentWorkers<W extends { id: string }>(
  candidates: readonly W[],
  current: readonly (W | null | undefined)[],
): W[] {
  const ids = new Set(candidates.map((c) => c.id));
  const extra: W[] = [];
  for (const w of current) {
    if (!w || ids.has(w.id)) continue;
    ids.add(w.id);
    extra.push(w);
  }
  return extra.length ? [...candidates, ...extra] : [...candidates];
}
