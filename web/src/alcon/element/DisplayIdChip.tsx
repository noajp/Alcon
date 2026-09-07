'use client';

// The one way a quotable display_id is drawn. Pairs with `displayIdOf()`:
// that decides what the id *is*, this decides how it looks — so a list row,
// a sub-element row and a drag preview can't drift into three shapes.
//
// Truncates from the FRONT. `dir="rtl"` only flips which side the ellipsis
// lands on; the characters keep their reading order, because an id is made
// only of strong left-to-right characters (Latin, CJK, digits) that pull the
// whole string into one left-to-right bidi run. Selection and copy take DOM order and
// are unaffected. Front-truncation is the point: ids under one Object share
// their prefix and differ only in the trailing sequence number, so clipping
// the back makes separate rows read identically — the failure this
// component exists to prevent.
//
// `dir="rtl"` also flips what `text-align: start` means, which would float a
// short id to the right of a reserved box and leave the prefixes — the part
// a person scans — as the ragged edge. `text-left` pins them back. It costs
// nothing when the id overflows, because then the ellipsis side is decided
// by `direction`, not by alignment.
//
// Not for every id on screen: where the id belongs to the prose of a
// wrapping row rather than to a column of its own, it should stay inside
// the text's own span (see InitiativeRiskWidget). A `shrink-0` chip next to
// siblings that can't shrink makes the title absorb the whole deficit.

export function DisplayIdChip({
  id,
  size = 'sm',
  fit = 'row',
}: {
  /** Straight from `displayIdOf()`; renders nothing when the row has no
   *  id yet, so no call site needs its own guard. */
  id: string | null | undefined;
  /** 12px in dense tables, 13px alongside body-sized rows. */
  size?: 'xs' | 'sm';
  /** How the chip is allowed to take space.
   *  - `row`: cap relative to the row. A viewport breakpoint can't see how
   *    wide the row is — list and detail columns move with the sidebar and
   *    the right rail, so a wide window still hands a row a narrow box.
   *  - `column`: reserve a floor so titles start at the same x down a long
   *    column, capped so one outlier can't run away. 5rem clears every
   *    object prefix in the database at this size once the entity prefix is
   *    off the front (worst case `P1—こ-999`, ~75px); the 9rem ceiling is far
   *    enough out that nothing real reaches it, and a hypothetical longer
   *    prefix front-truncates rather than widening the column. Plain rem
   *    because a column wants one width, not one per row.
   *  - `full`: never truncate. For surfaces with no hover to fall back on,
   *    like the drag preview, where a clipped id can't be recovered. */
  fit?: 'row' | 'column' | 'full';
}) {
  if (!id) return null;
  const FIT = {
    row: 'max-w-[min(10rem,35%)] truncate',
    column: 'min-w-20 max-w-36 truncate text-left',
    full: '',
  }[fit];
  return (
    <span
      dir="rtl"
      title={id}
      className={`shrink-0 tabular-nums text-muted-foreground/60 ${
        size === 'xs' ? 'text-xs' : 'text-[13px]'
      } ${FIT}`}
    >
      {id}
    </span>
  );
}
