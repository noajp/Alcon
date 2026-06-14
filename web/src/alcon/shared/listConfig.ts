// listConfig — single source of truth for each entity's DEFAULT row columns.
//
// "Which columns show on a row out of the box" used to be scattered:
//   - Element lists : DEFAULT_VISIBLE in useListColumns ('type','due_date')
//   - My Elements   : MY_DEFAULT_VISIBLE ('type','due_date','objects')
//   - Object list   : a Set('elements','progress') inside ObjectsView
// They now all read from here, so the defaults are decided in one place.
//
// Built-in columns are CODE-defined (no DB rows — every Element/Object has them
// implicitly). Custom Properties (the custom_columns table) are appended after
// these at runtime, per scope. So the column "+" menu is just
// [these built-ins] + [whatever custom Properties exist] — nothing is
// pre-seeded in the database.

// ── Element row ────────────────────────────────────────────────────────────
// 'type' is always-on (non-toggleable); the rest are default-visible but
// hideable from the column menu. My Elements layers its cross-Object 'objects'
// column on top of this (see MyElementsView).
export const ELEMENT_DEFAULT_VISIBLE: string[] = ['type', 'due_date', 'assignee'];

// ── Object row ───────────────────────────────────────────────────────────────
// Type leads (leftmost) to match the Element lists. 'sub' (subelement count)
// ships hidden. 'lead' is the Object's responsible Worker (objects.lead_id).
export const OBJECT_DEFAULT_VISIBLE: string[] = ['type', 'due_date', 'lead', 'progress', 'elements'];
