// The one id a person can quote for an Element — `ELE_MED-001`, built from the
// owning Object's prefix. Every surface that names an Element (list row, drag
// preview, dependency tooltip, detail header) reads it through here, so a row
// and the tooltip pointing at that row can never call it two different things.
//
// `seq_number` is not an id. It restarts per Object, so two unrelated rows both
// answer to "004" and neither can be found from a comment or a SITREP.
//
// Sub-elements carry their own `sub_MED-001-01` in the same column and read
// through the same rule.

/** The quotable id, or null when the row has none yet. */
export function displayIdOf(row: { display_id?: string | null }): string | null {
  const id = row.display_id?.trim();
  return id ? id : null;
}
