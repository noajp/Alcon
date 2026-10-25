'use client';

// THE menu skeleton. Every Radix popover/dropdown that behaves like a menu
// goes through `MenuShell` — there is no second place to write a menu surface.
//
// Why this file exists: the twelve menu surfaces in ListControls,
// AddPropertyButton, WidgetAddMenu, ObjectsView, ListTable were
// measured in Chrome (compiled Tailwind, light theme) before it was written.
// What the numbers actually said:
//
//   radius   6px on all twelve. The "three radii" were a mirage — `rounded-md`
//            was already unanimous. The only 12px surfaces are the ListTable
//            *cell* editors (CELL_POPOVER_RADIUS), which are deliberately
//            matched to the date-picker popover and are not menus. So this
//            file does not change any radius; it removes the place where a
//            fourth one could be introduced.
//   width    seven distinct values — 128 / 140 / 160 / 170 / 180 / 200 / 240 /
//            288. Two toolbar buttons that sit 6px apart (Sort, Filter) opened
//            240px and 288px surfaces.
//   padding  four — 0px (Filter/Display/Sort), 4px (the seven Radix
//            dropdowns), 6px (AddPropertyButton), 8px (cell editor).
//   rows     five paddings and five type sizes: 10 / 11 / 12.5 / 13 / 14px.
//            Radix `DropdownMenuItem` renders `text-sm` = 14px while every
//            hand-rolled row next to it is 13px or 12.5px.
//   headings three type sizes — 10px (WidgetAddMenu / ObjectsView),
//            11px (AddPropertyButton / Sort / ListTable), 14px (bare
//            `DropdownMenuLabel`), across six different heights.
//
// So the convergence below is: one radius, one surface padding, two widths,
// one row, one heading.
//
// The Filter panel additionally had no max-height at all — it grew without
// bound as Workers and Objects were added. `MENU_SHELL_BASE` caps every
// surface, which is why the cap lives here and not at one call site.

import * as React from 'react';

import { cn } from '@/lib/utils';
import { DropdownMenuContent } from '@/ui/dropdown-menu';
import { PopoverContent } from '@/ui/popover';

/**
 * The two width steps. Two, and only two — a third is a sign that the *content*
 * needs restructuring, not that the scale needs another rung.
 *
 * `standard` (224px) is the single-column step: value pickers, facet lists,
 * Sort, column menus. It also happens to be the exact inner width of the
 * AppSidebar (240px − px-2), so a sidebar menu lines up with
 * its full-width trigger without asking for the trigger width by name.
 *
 * `wide` (288px) is only for panels with label + right-aligned control rows —
 * Display's Grouping/Ordering selects and Filter's date range — and for the
 * widget picker, whose rows carry a name and a one-line description.
 */
export const MENU_WIDTH = {
  standard: 'w-56',
  wide: 'w-72',
} as const;

export type MenuWidth = keyof typeof MENU_WIDTH;

/**
 * Everything a menu surface is, minus its width.
 *
 * `text-[13px]` types the surface, but it does NOT reach Radix's
 * `DropdownMenuItem`, which carries its own `text-sm` (14px). The obvious fix
 * — a `[&_[data-slot=dropdown-menu-item]]:text-[13px]` variant here — was
 * written, compiled, and measured in Chrome: the item still rendered at 14px.
 * The reason is that `globals.css` re-declares every font-size utility
 * *unlayered* so the user's Preferences → Font size (`--fs`) multiplies them,
 * and an unlayered `.text-sm` beats any rule in `@layer utilities` no matter
 * how specific. The re-type therefore lives beside that block in `globals.css`,
 * keyed on the `data-menu-shell` attribute this component stamps below. Do not
 * "restore" it as a Tailwind variant; it renders nothing.
 */
export const MENU_SHELL_BASE = [
  'rounded-md',
  'p-1',
  // Cancels the `min-w-[8rem]` DropdownMenuContent ships with, so the width
  // step is the only thing deciding how wide a menu is.
  'min-w-0',
  'max-h-[min(70vh,480px)] overflow-y-auto',
  'text-[13px]',
].join(' ');

/**
 * The one row. `px-2` inside the shell's `p-1` puts the label at 12px from the
 * surface edge — the same x the old `px-3`-in-a-`p-0`-surface rows sat at, so
 * adopting this moves no text sideways.
 *
 * Rows that need a trailing check or hint add `justify-between`; rows nested
 * under an expanded facet add `pl-7`. Nothing else should be overridden.
 *
 * The highlight is `--surface-strong`, not `--accent`, and that is measured,
 * not stylistic. In the light themes `--accent` and `--popover` both resolve to
 * the same white. The value below is a measurement being reported, not a
 * colour being used — naming it is the whole argument for this token choice.
 * design-lint-ignore
 * `#ffffff`: `hover:bg-accent` — and Radix's own `focus:bg-accent` — paints the
 * surface colour onto the surface and shows nothing at all. `--surface-strong`
 * is the token whose documented job (DESIGN.md §1.4) is to differ from the
 * background, with the theme deciding whether that means lighter or darker.
 * `globals.css` re-points the Radix items inside a MenuShell at the same token,
 * so hovering a hand-rolled row and hovering a Radix row look identical.
 */
export const MENU_ROW =
  'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-[var(--surface-strong)]';

/**
 * The one divider. `-mx-1` cancels the shell's padding so the hairline still
 * reaches both edges — a divider that stops 4px short reads as a mistake.
 * Reserve it for the two places a divider earns its keep: below a search
 * field, and above a footer that resets or destroys. Group breaks inside a
 * list are whitespace, not rules.
 *
 * Add `mx-0` when the divider sits inside a nested scroll box rather than
 * directly under the shell — there the negative margin is wider than the box
 * and raises a horizontal scrollbar.
 */
export const MENU_SEPARATOR = '-mx-1 my-1 h-px bg-border/60';

/**
 * The one heading. Sentence case, never uppercase (.claude/CLAUDE.md 禁止事項)
 * — the hierarchy is carried by weight and colour. Shorter than a row on
 * purpose: a heading you cannot click should not be as tall as one you can.
 */
export const MENU_SECTION_LABEL = 'px-2 py-1 text-[11px] font-medium text-muted-foreground';

type MenuShellOwnProps = { width?: MenuWidth };

type MenuShellProps =
  | ({ as?: 'popover' } & MenuShellOwnProps & React.ComponentProps<typeof PopoverContent>)
  | ({ as: 'dropdown' } & MenuShellOwnProps & React.ComponentProps<typeof DropdownMenuContent>);

/**
 * A menu surface. Renders the Radix content element for whichever primitive is
 * hosting it, so the skeleton cannot drift between Popover-based and
 * DropdownMenu-based menus.
 */
export function MenuShell(props: MenuShellProps) {
  const { as = 'popover', width = 'standard', className, ...rest } = props as MenuShellProps & {
    as?: 'popover' | 'dropdown';
    className?: string;
  };
  const shell = cn(MENU_SHELL_BASE, MENU_WIDTH[width], className);

  if (as === 'dropdown') {
    return (
      <DropdownMenuContent
        data-menu-shell=""
        className={shell}
        {...(rest as React.ComponentProps<typeof DropdownMenuContent>)}
      />
    );
  }
  return (
    <PopoverContent
      data-menu-shell=""
      className={shell}
      {...(rest as React.ComponentProps<typeof PopoverContent>)}
    />
  );
}

/** A group heading inside a MenuShell. */
export function MenuSectionLabel({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="menu-section-label"
      className={cn(MENU_SECTION_LABEL, className)}
      {...props}
    />
  );
}
