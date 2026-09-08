'use client';

import { Check } from 'lucide-react';
import { LABEL_PALETTE } from './labelColor';
import { MENU_ROW } from './menu';

// The rows of every "pick a colour for this label" menu. Three surfaces open
// one — the label chip, the label picker's create step, and Settings › Labels
// — and a palette that differs by one row between them is a bug, so the rows
// are written once and the callers supply only the surface (a MenuShell) and
// what to do with the pick.
export function LabelPaletteRows({
  selected,
  onPick,
}: {
  selected?: string | null;
  onPick: (colorKey: string) => void;
}) {
  return (
    <>
      {LABEL_PALETTE.map((p) => (
        <button
          key={p.key}
          type="button"
          role="menuitemradio"
          aria-checked={selected === p.key}
          onClick={() => onPick(p.key)}
          className={`${MENU_ROW} justify-between focus-visible:bg-[var(--surface-strong)]`}
        >
          <span className="flex min-w-0 items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: p.hex }} />
            <span className="truncate">{p.label}</span>
          </span>
          {selected === p.key && <Check size={13} className="shrink-0 text-muted-foreground" />}
        </button>
      ))}
    </>
  );
}
