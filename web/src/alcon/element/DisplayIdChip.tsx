'use client';

// The one way a quotable display_id is drawn. Pairs with `displayIdOf()`:
// that decides what the id *is*, this decides how it looks — so a list row,
// a drag preview and a picker can't drift into calling the same id three
// different shapes.
//
// Truncates from the FRONT. `dir="rtl"` only flips which side the ellipsis
// lands on; the characters keep their reading order, because every id opens
// with an ASCII run (`el_` / `ELE_` / `sub_`) that pulls the whole string
// into one left-to-right bidi run. Front-truncation is the point: ids under
// one Object share their prefix and differ only in the trailing sequence
// number, so clipping the back makes separate rows read identically — the
// failure this component exists to prevent.
//
// The cap is row-relative, never a viewport breakpoint: list and detail
// columns move with the sidebar and the right rail, so a wide window still
// hands a row a narrow box. The full string stays in `title` for hover and
// copy, and detail surfaces still headline it for the touch case.

export function DisplayIdChip({
  id,
  size = 'sm',
  reserve = false,
}: {
  /** Straight from `displayIdOf()`; renders nothing when the row has no
   *  id yet, so no call site needs its own guard. */
  id: string | null | undefined;
  /** 12px in dense tables, 13px alongside body-sized rows. */
  size?: 'xs' | 'sm';
  /** Reserve a floor width so titles start at the same x down a long
   *  column. Dense tables want it; a lone chip in a card doesn't.
   *  7rem covers every object prefix currently in the database at this
   *  size — measured worst case `ELE_P1—こ-999` at 105px, against `el_`
   *  ids at 80px — so the two id conventions that coexist (`el_` and the
   *  one-character-longer `ELE_`) line up instead of sitting a few px
   *  apart. A longer prefix than any in use today grows past it rather
   *  than being clipped. Plain rem, not a percentage: the dense table
   *  puts this chip inside a `max-w-0` cell, and a percentage min-width
   *  against that indefinite basis resolves to 0 — the floor would
   *  silently do nothing — and for the same reason the cap next to it is
   *  a plain rem here too, so the two don't fight over an indefinite
   *  basis. The flex-row case keeps the row-relative cap. */
  reserve?: boolean;
}) {
  if (!id) return null;
  return (
    <span
      dir="rtl"
      title={id}
      className={`shrink-0 truncate tabular-nums text-muted-foreground/60 ${
        size === 'xs' ? 'text-xs' : 'text-[13px]'
      } ${reserve ? 'min-w-28 max-w-44' : 'max-w-[min(10rem,35%)]'}`}
    >
      {id}
    </span>
  );
}
