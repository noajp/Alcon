'use client';

import type { AlconObjectWithChildren, CustomColumnWithValues, ElementWithDetails, Worker } from '@/hooks/useSupabase';
import type { SectionGroup } from '@/alcon/shared/listControls/sectionGroup';

// Stable empty defaults — destructuring `= []` inline would allocate a NEW
// array every render, which breaks ElementRow's React.memo (the prop ref
// changes each time) and re-renders every row on any parent update (e.g. a
// checkbox toggle on a 100-row list). Shared frozen constants keep the ref
// identity stable so only the changed row re-renders.
export const EMPTY_CUSTOM_COLUMNS: CustomColumnWithValues[] = [];

export const EMPTY_ELEMENT_TYPES: string[] = [];

export const EMPTY_WORKERS: Worker[] = [];

export const EMPTY_ELEMENT_IDS: string[] = [];

export const STATUS_OPTIONS: { value: ElementWithDetails['status']; label: string }[] = [
  { value: 'backlog', label: 'Backlog' },
  { value: 'todo', label: 'Todo' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'review', label: 'In Review' },
  { value: 'done', label: 'Done' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'cancelled', label: 'Cancelled' },
];

export type ElementUpdate = Partial<Pick<ElementWithDetails, 'status' | 'priority' | 'start_date' | 'due_date' | 'title' | 'type'>>;

export function parseDateOnly(value: string | null): Date | undefined {
  if (!value) return undefined;
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return undefined;
  const d = new Date(year, month - 1, day);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export function formatDateOnly(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatDateShort(value: string): string {
  const d = parseDateOnly(value);
  return d ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : value;
}

export interface ListSection {
  id: string;
  name: string;
  /** Optional icon rendered in the section band before the name (e.g.
   *  ObjectIcon for "Elements grouped by Object" sections). */
  icon?: React.ReactNode;
  /** Optional small label rendered after the count, faded out (e.g.
   *  "no parent Object" on the Domain-direct elements band). */
  subtitle?: string;
  objects: AlconObjectWithChildren[];
  elements?: ElementWithDetails[];
  /** Set when the band is a group bucket rather than an Object — which field
   *  the list is grouped by and which of its values this band holds. The add
   *  paths read it so a row created here inherits the value that put every
   *  other row in the band. Absent for Object bands and un-grouped lists. */
  group?: SectionGroup;
}

// The column layout (visibility / order / width) lives in `useListColumns`.
// Status & priority show inline in the row — the status mark and the
// priority chevrons — so they aren't columns. Type, Due date, Assignee, and
// every user-defined Property are columns the user can reorder, resize, and
// (where toggleable) show/hide.

// dnd-kit id prefixes — the shared DndContext routes drags by inspecting
// the active id. Header reorders, Object-row reorders, and Element-row
// reorders all live under one context and the prefix tells them apart.
export const HEADER_DRAG_PREFIX = 'col:';

export const OBJECT_DRAG_PREFIX = 'obj:';

// Blue insertion line drawn on a row that's the current drop target. An
// inset box-shadow (not a border) so it doesn't shift layout, applied to
// every <td> so the line runs unbroken across the row. The shadow VALUE is
// fed through an inherited `--drop-line` CSS variable set inline on the
// <tr> — Tailwind v4's arbitrary `shadow-[inset_0_-2px…]` mis-parses the
// negative offset, so we keep the class static and put the real CSS in the
// variable, which is plain CSS and reliable. `var(--primary)` is the app's
// Oxford-blue accent.
export const DROP_LINE_CLASS = '[&>td]:shadow-[var(--drop-line,0_0_transparent)]';

// While a row shows the drop line, square off its cells. The hover/selection
// pill rounds the 2nd/2nd-last cells (rounded-l/r-lg); left as-is, the inset
// box-shadow hugs that radius and the line's left end reads as a curve. The
// `!` wins over the rounding utilities regardless of class order.
export const DROP_LINE_SQUARE = '[&>td]:!rounded-none';

// Gray, slightly-thick (2px) insertion line — muted rather than the accent
// blue so it reads as a neutral "drops here" guide.
export function dropLineVar(edge: 'before' | 'after' | undefined): string | undefined {
  if (edge === 'before') return 'inset 0 2px 0 0 var(--muted-foreground)';
  if (edge === 'after') return 'inset 0 -2px 0 0 var(--muted-foreground)';
  return undefined;
}

// Row hover / selection highlight is a rounded pill on the data cells (2nd …
// 2nd-last). A single hovered/selected row reads as a full rounded chip.
export const ROW_ROUND_BASE = '[&>td:nth-child(2)]:rounded-l-lg [&>td:nth-last-child(2)]:rounded-r-lg';

// Object rows on the Objects list carry no trailing "+" column, so the pill
// runs all the way to the LAST cell (Elements) instead of stopping one short.
export const ROW_ROUND_TO_LAST = '[&>td:nth-child(2)]:rounded-l-lg [&>td:last-child]:rounded-r-lg';

// For a CONTIGUOUS block of selected rows, square off the corners that touch
// the neighbour so the block reads as one continuous pill instead of a stack
// of separate chips with notches between them. `selPrev`/`selNext` say whether
// the row immediately above / below is also selected.
export function selectionSquareClass(selPrev?: boolean, selNext?: boolean): string {
  let s = '';
  if (selPrev) s += ' [&>td:nth-child(2)]:!rounded-tl-none [&>td:nth-last-child(2)]:!rounded-tr-none';
  if (selNext) s += ' [&>td:nth-child(2)]:!rounded-bl-none [&>td:nth-last-child(2)]:!rounded-br-none';
  return s;
}

// ROW_ROUND_TO_LAST's counterpart — squares the last cell's corners instead.
export function selectionSquareClassToLast(selPrev?: boolean, selNext?: boolean): string {
  let s = '';
  if (selPrev) s += ' [&>td:nth-child(2)]:!rounded-tl-none [&>td:last-child]:!rounded-tr-none';
  if (selNext) s += ' [&>td:nth-child(2)]:!rounded-bl-none [&>td:last-child]:!rounded-br-none';
  return s;
}

// Element rows still scroll horizontally, so their sticky cells (priority +
// Name) must keep an OPAQUE background-color to mask columns sliding under.
// The row tint therefore can't just swap their background-color to a
// translucent blue — instead these paint the translucent tint as a
// background-IMAGE (a flat gradient) layered over the opaque bg-card, which
// composites to the exact same colour the non-sticky cells show.
// Selection tints match the non-sticky band below.
// non-sticky `bg-blue-500/15` band.
export const STICKY_TINT_SELECTED =
  // design-lint-ignore — preserve existing sticky selection tint during mechanical extraction.
  '[&>td.sticky:not(:first-child)]:bg-[linear-gradient(rgb(59_130_246/0.15),rgb(59_130_246/0.15))] dark:[&>td.sticky:not(:first-child)]:bg-[linear-gradient(rgb(96_165_250/0.2),rgb(96_165_250/0.2))] [&:hover>td.sticky:not(:first-child)]:bg-[linear-gradient(rgb(59_130_246/0.2),rgb(59_130_246/0.2))] dark:[&:hover>td.sticky:not(:first-child)]:bg-[linear-gradient(rgb(96_165_250/0.25),rgb(96_165_250/0.25))]';

export const STICKY_TINT_HOVER =
  '[&:hover>td.sticky:not(:first-child)]:bg-[linear-gradient(color-mix(in_oklab,var(--foreground)_6%,transparent),color-mix(in_oklab,var(--foreground)_6%,transparent))]';
