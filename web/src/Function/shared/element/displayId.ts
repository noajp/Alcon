// The one id a person can quote for an Element — `MED-001`, built from the
// owning Object's prefix. Every surface that names an Element (list row, drag
// preview, dependency tooltip, detail header) reads it through here, so a row
// and the tooltip pointing at that row can never call it two different things.
//
// The stored `display_id` carries an entity prefix (`ELE_` for Elements,
// `OBJ_` for Objects, plus the legacy lowercase `el_`). It says nothing a
// person reading the row doesn't already know from the surface they are
// looking at, so it never reaches the screen — what shows, and what a person
// quotes, is the Object prefix and the sequence number.
//
// `seq_number` is not an id. It restarts per Object, so two unrelated rows both
// answer to "004" and neither can be found from a comment or a SITREP.
//
// Sub-elements carry their own `sub_MED-001-01` in the same column and read
// through the same rule; `sub_` stays, because it is the only thing separating
// a sub-element's id from its parent's.

const ENTITY_PREFIX = /^(?:ELE|OBJ|el|obj)_/;

/** The quotable id, or null when the row has none yet. */
export function displayIdOf(row: { display_id?: string | null }): string | null {
  const id = row.display_id?.trim().replace(ENTITY_PREFIX, '');
  return id ? id : null;
}
