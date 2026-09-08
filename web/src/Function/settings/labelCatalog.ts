// A Domain's label catalogue, derived rather than stored.
//
// There is no labels table. A label exists because some Element carries the
// string in `elements.labels`, or because `domains.label_colors` remembers a
// colour for the name — and both sides count: an Element can carry a label no
// colour was ever picked for, and a colour can outlive the last Element that
// used it, or precede the first. This module joins the two sides into one list
// and plans the writes that keep them together when a label is renamed or
// deleted. Nothing here touches the network, so the arithmetic is testable.

export interface LabelUsageRow {
  id: string;
  labels: string[];
}

export interface LabelEntry {
  name: string;
  /** Elements in the Domain carrying the label. 0 means "colour entry only". */
  count: number;
  /** Palette key from domains.label_colors, or null when none was picked. */
  colorKey: string | null;
}

/** domains.label_colors — label name → palette key. */
export type LabelColors = Record<string, string>;

/** One Element's labels after a rename or delete. */
export interface LabelWrite {
  id: string;
  labels: string[];
}

export const normalizeLabelName = (raw: string): string => raw.trim();

const sameName = (raw: string, name: string) => normalizeLabelName(raw) === name;

// Case-insensitive first so "bug" sits next to "Bug"; a plain code-unit
// comparison breaks the tie so the order is stable between renders and
// across environments (`localeCompare`'s case ordering is ICU/locale-
// dependent — Node's default collation sorts "bug" before "Bug", which
// reads as random next to a case-insensitive primary sort).
const compareNames = (a: string, b: string) =>
  a.localeCompare(b, undefined, { sensitivity: 'base' }) || (a < b ? -1 : a > b ? 1 : 0);

/**
 * Every label the Domain knows, with how many Elements carry it. A label an
 * Element lists twice counts that Element once; a name only the colour map
 * knows comes back with count 0.
 */
export function buildLabelCatalog(rows: readonly LabelUsageRow[], colors: LabelColors): LabelEntry[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const seen = new Set<string>();
    for (const raw of row.labels) {
      const name = normalizeLabelName(raw);
      if (!name || seen.has(name)) continue;
      seen.add(name);
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  for (const name of Object.keys(colors)) {
    if (name && !counts.has(name)) counts.set(name, 0);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count, colorKey: colors[name] ?? null }))
    .sort((a, b) => compareNames(a.name, b.name));
}

/** The rows carrying `name`. */
export function elementsWithLabel(rows: readonly LabelUsageRow[], name: string): LabelUsageRow[] {
  return rows.filter((r) => r.labels.some((l) => sameName(l, name)));
}

/**
 * One Element's labels with `from` renamed to `to`. When the Element already
 * carries `to`, the two collapse into one — the earlier position wins.
 */
export function renameLabelIn(labels: readonly string[], from: string, to: string): string[] {
  const out: string[] = [];
  for (const raw of labels) {
    const next = sameName(raw, from) ? to : raw;
    if (!out.some((existing) => sameName(existing, normalizeLabelName(next)))) out.push(next);
  }
  return out;
}

/** One Element's labels without `name`. */
export function removeLabelFrom(labels: readonly string[], name: string): string[] {
  return labels.filter((l) => !sameName(l, name));
}

/** The Element writes a rename needs — only the rows that carry `from`. */
export function planLabelRename(rows: readonly LabelUsageRow[], from: string, to: string): LabelWrite[] {
  return elementsWithLabel(rows, from).map((r) => ({ id: r.id, labels: renameLabelIn(r.labels, from, to) }));
}

/** The Element writes a delete needs — only the rows that carry `name`. */
export function planLabelRemove(rows: readonly LabelUsageRow[], name: string): LabelWrite[] {
  return elementsWithLabel(rows, name).map((r) => ({ id: r.id, labels: removeLabelFrom(r.labels, name) }));
}

/**
 * The colour map after renaming `from` to `to`. The colour follows the name —
 * unless `to` already has one, in which case the rename is a merge into an
 * existing label and that label keeps its own colour.
 */
export function renameLabelColor(colors: LabelColors, from: string, to: string): LabelColors {
  const next = { ...colors };
  if (from === to) return next;
  const moved = next[from];
  delete next[from];
  if (moved !== undefined && !(to in next)) next[to] = moved;
  return next;
}

/** Which keys a rename actually gives a new value, for a caller building
 *  `diffColorPatch`'s `touchedKeys` (ELE_QLT-032 review). Mirrors
 *  `renameLabelColor`'s own condition for moving the colour exactly
 *  (`moved !== undefined && !(to in next)`, i.e. `from` has one to move
 *  AND `to` doesn't already have one) — not just the second half of it.
 *  Getting only the `to`-side half right still names `to` as touched when
 *  `from` had no colour to begin with, and `diffColorPatch` would then
 *  read that as an explicit removal of `to` this rename never intended,
 *  the same silent-clobber shape as leaving it unconditional. `to` only
 *  belongs here when the rename is the actual reason it has a colour. */
export function renameTouchedColorKeys(colors: LabelColors, from: string, to: string): string[] {
  return from in colors && !(to in colors) ? [from, to] : [from];
}

/** The colour map without `name`. */
export function removeLabelColor(colors: LabelColors, name: string): LabelColors {
  const next = { ...colors };
  delete next[name];
  return next;
}

/**
 * Put `keys` back to what `snapshot` had, leaving every other key as it is
 * now — the rollback of an optimistic edit that touched only those keys, which
 * must not also undo whatever a later edit did to the rest of the map.
 */
export function restoreColorKeys(
  current: LabelColors,
  snapshot: LabelColors,
  keys: readonly string[],
): LabelColors {
  const next = { ...current };
  for (const key of keys) {
    if (key in snapshot) next[key] = snapshot[key];
    else delete next[key];
  }
  return next;
}

/** A colour-map patch expressed as only what changed: keys to set (or
 *  overwrite) and keys to drop. This is what actually reaches the database —
 *  see `saveColors` in `useLabelCatalog.ts` — instead of the whole map,
 *  because writing the whole map is what let a write elsewhere (a single
 *  colour pick from an Element's detail panel, ELE_QLT-032) get silently
 *  undone by a Settings save that started from an older snapshot and knows
 *  nothing about it. Restricting the write to `touchedKeys` means Settings
 *  only ever asserts opinions about the labels it actually changed. */
export interface LabelColorPatch {
  set: LabelColors;
  remove: string[];
}

/** Derives a patch from the map a rename/delete/pick already produced
 *  (`colorsAfter`) and the keys that operation is known to have touched.
 *  A touched key present in `colorsAfter` is a set; a touched key absent
 *  from it was deleted (renamed away, or explicitly removed). */
export function diffColorPatch(
  colorsAfter: LabelColors,
  touchedKeys: readonly string[],
): LabelColorPatch {
  const set: LabelColors = {};
  const remove: string[] = [];
  for (const key of touchedKeys) {
    if (key in colorsAfter) set[key] = colorsAfter[key];
    else remove.push(key);
  }
  return { set, remove };
}

/**
 * Why `name` cannot become a new label of this catalogue, or null when it can.
 *
 * The existence check is case-insensitive on purpose, even though rename/
 * delete elsewhere in this module match by exact string: creating "Bug" here
 * while "bug" already exists would produce two catalogue rows that the rest
 * of the app (ElementDetailView's label picker) treats as one and the same
 * label, silently diverging the two surfaces. Two exact-case variants can
 * still exist from data written before this check — e.g. a label typed
 * inconsistently across Elements — and rename is exactly how a Domain
 * reconciles that once it's noticed; only *creating a new* collision here is
 * blocked.
 */
export function newLabelProblem(name: string, entries: readonly LabelEntry[]): string | null {
  if (!name) return 'Give the label a name.';
  if (entries.some((e) => e.name.toLowerCase() === name.toLowerCase())) return `“${name}” already exists.`;
  return null;
}

export function formatElementCount(count: number): string {
  return count === 1 ? '1 Element' : `${count} Elements`;
}

/** The usage cell of a catalogue row. */
export function formatLabelCount(count: number): string {
  return count === 0 ? 'Unused' : formatElementCount(count);
}
