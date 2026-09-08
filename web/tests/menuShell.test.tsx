/** @vitest-environment jsdom */
//
// The menu skeleton, guarded from both ends.
//
// Before `Function/shared/menu` existed, the twelve Radix menu surfaces in these
// six files were measured in Chrome against the compiled Tailwind bundle. They
// rendered seven different widths (128 / 140 / 160 / 170 / 180 / 200 / 240 /
// 288px), four surface paddings (0 / 4 / 6 / 8px), five row paddings and five
// row type sizes (10 / 11 / 12.5 / 13 / 14px). Nothing stopped a thirteenth
// surface from inventing an eighth width — every call site wrote its own
// geometry inline.
//
// Two halves, because either alone is a false positive waiting to happen:
//
//   1. Rendering half — MenuShell really does put one radius, one padding and
//      one of two widths on the DOM node, in both the Popover and the
//      DropdownMenu host. A constant that is exported but never reaches the
//      element would pass a source grep.
//
//   2. Source half — every menu in the covered files goes *through*
//      MenuShell. Rendering MenuShell correctly proves nothing if a caller
//      still hand-rolls `min-w-[140px]` next to it, and that is precisely the
//      regression to expect: the next menu gets added by copying a neighbour.
//
// Two deliberate exceptions, both named explicitly below so a later sweep does
// not "fix" them:
//
//   - ListTable's *cell* editors are Popovers but not menus. They host the
//     Calendar and the type picker and keep CELL_POPOVER_RADIUS on purpose so
//     the two row editors put their footer strip at the same spot.
//   - Radix's ContextMenu family (8 surfaces in ListTable) is untouched. Its
//     content lives in `ui/context-menu.tsx` and is shared with
//     ElementTableRow, NotesSidebar and FilesPane — converting ListTable's half
//     alone would make right-click menus disagree with each other, which is
//     worse than the disagreement being fixed. That is its own piece of work.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, afterEach } from 'vitest';
import { cleanup, render } from '@testing-library/react';

import {
  MenuShell,
  MenuSectionLabel,
  MENU_WIDTH,
  MENU_ROW,
  MENU_SECTION_LABEL,
} from '@/Function/shared/menu';
import { Popover } from '@/ui/popover';
import { DropdownMenu } from '@/ui/dropdown-menu';

afterEach(cleanup);

// vitest runs with `web/` as cwd (vitest.config.mts lives there).
const src = (rel: string) => readFileSync(resolve(process.cwd(), 'src', rel), 'utf8');

function classesOf(el: Element): string[] {
  return el.className.toString().split(/\s+/).filter(Boolean);
}

/** The menu-bearing files covered by this contract. */
const CONVERGED = [
  'Function/property/AddPropertyButton.tsx',
  'Function/shared/listControls/ListControls.tsx',
  'Function/widget/WidgetPicker.tsx',
  'Function/shared/listTable/ColumnHeaderMenu.tsx',
];

// ---------------------------------------------------------------- rendering

describe('MenuShell renders one skeleton', () => {
  const surfaceOf = (el: HTMLElement | null) => classesOf(el!);

  function popoverSurface(width?: 'standard' | 'wide') {
    render(
      <Popover open>
        <MenuShell width={width} data-testid="surface">
          <div>row</div>
        </MenuShell>
      </Popover>,
    );
    return surfaceOf(document.querySelector('[data-testid="surface"]'));
  }

  function dropdownSurface(width?: 'standard' | 'wide') {
    render(
      <DropdownMenu open>
        <MenuShell as="dropdown" width={width} data-testid="surface">
          <div>row</div>
        </MenuShell>
      </DropdownMenu>,
    );
    return surfaceOf(document.querySelector('[data-testid="surface"]'));
  }

  it('gives the Popover host and the DropdownMenu host the same geometry', () => {
    const pop = popoverSurface();
    cleanup();
    const ddm = dropdownSurface();

    const geometry = (cs: string[]) =>
      cs.filter((c) => /^(rounded-|p-|px-|py-|w-|min-w-|max-w-|max-h-)/.test(c)).sort();

    expect(geometry(pop)).toEqual(geometry(ddm));
    expect(geometry(pop)).toContain('rounded-md');
    expect(geometry(pop)).toContain('p-1');
    expect(geometry(pop)).toContain('w-56');
  });

  it('carries no width other than the two steps', () => {
    for (const [width, cls] of Object.entries(MENU_WIDTH)) {
      const classes = popoverSurface(width as 'standard' | 'wide');
      // `min-w-0` is not a width: it cancels DropdownMenuContent's own
      // `min-w-[8rem]` so the step is the only thing setting the width.
      const widths = classes.filter((c) => /^(w-|min-w-|max-w-)/.test(c) && c !== 'min-w-0');
      expect(widths).toEqual([cls]);
      cleanup();
    }
  });

  it('offers exactly two width steps', () => {
    expect(Object.values(MENU_WIDTH)).toEqual(['w-56', 'w-72']);
  });

  it('bounds its own height, so a facet list cannot grow without limit', () => {
    expect(popoverSurface().some((c) => /^max-h-/.test(c))).toBe(true);
  });

  it('marks itself so the Radix item re-type can find it', () => {
    // ui/dropdown-menu.tsx hardcodes `text-sm` (14px) on every item while every
    // hand-rolled row beside it is 13px. That re-type cannot be a Tailwind
    // variant — globals.css re-declares the font-size utilities *unlayered* for
    // `--fs`, and unlayered beats @layer utilities at any specificity. It is a
    // rule in globals.css keyed on this attribute, so both halves are asserted:
    // the attribute must be stamped, and the rule must still exist.
    render(
      <Popover open>
        <MenuShell data-testid="surface" />
      </Popover>,
    );
    const el = document.querySelector('[data-testid="surface"]')!;
    expect(el.getAttribute('data-menu-shell')).not.toBeNull();
    expect(classesOf(el)).toContain('text-[13px]');

    const globals = readFileSync(resolve(process.cwd(), 'src/app/globals.css'), 'utf8');
    expect(globals).toMatch(
      /\[data-menu-shell\] \[data-slot="dropdown-menu-item"\][\s\S]{0,200}font-size/,
    );
  });

  it('highlights rows with a token that actually differs from the surface', () => {
    // Measured in Chrome: in the light themes --accent and --popover are both
    // #ffffff, so `hover:bg-accent` (and shadcn's `focus:bg-accent` on menu
    // items) paints the surface onto the surface. --surface-strong is the token
    // whose job is to differ from the background.
    expect(MENU_ROW).toContain('hover:bg-[var(--surface-strong)]');
    expect(MENU_ROW).not.toContain('hover:bg-accent');

    const globals = readFileSync(resolve(process.cwd(), 'src/app/globals.css'), 'utf8');
    expect(globals).toMatch(
      /\[data-menu-shell\] \[data-slot="dropdown-menu-item"\]:focus[\s\S]{0,220}var\(--surface-strong\)/,
    );
  });

  it('renders one heading type, never uppercased', () => {
    render(<MenuSectionLabel data-testid="label">Properties</MenuSectionLabel>);
    const classes = classesOf(document.querySelector('[data-testid="label"]')!);
    expect(classes).not.toContain('uppercase');
    expect(classes).toContain('text-[11px]');
    expect(classes.filter((c) => /^(px-|py-|p-)/.test(c)).sort()).toEqual(['px-2', 'py-1']);
    // The heading is shorter than a row: it cannot be clicked, so it should not
    // look like something that can.
    expect(MENU_SECTION_LABEL).toContain('py-1');
    expect(MENU_ROW).toContain('py-1.5');
  });
});

// ------------------------------------------------------------------- source

describe('every menu in the converged files goes through MenuShell', () => {
  // ListTable's cell editors are Popovers but not menus: they host the
  // Calendar and the type picker and deliberately keep CELL_POPOVER_RADIUS.
  const CELL_EDITOR = /<PopoverContent[\s\S]{0,200}?CELL_POPOVER_RADIUS/;
  const menuSurfaces = [...CONVERGED, 'Function/shared/listTable/cells.tsx'];

  for (const file of menuSurfaces) {
    it(`${file} has no hand-rolled menu surface`, () => {
      const text = src(file);
      const withoutCellEditors = text.replace(new RegExp(CELL_EDITOR, 'g'), '');
      expect(withoutCellEditors).not.toMatch(/<DropdownMenuContent\b/);
      expect(withoutCellEditors).not.toMatch(/<PopoverContent\b/);
    });

    it(`${file} lets MENU_WIDTH decide how wide its menus are`, () => {
      // The main source of the old drift was `min-w-[Npx]` at the call site: it
      // lets the content set the width, so neighbouring menus never line up.
      // A MenuShell may be given classes, but never a width.
      const overrides = src(file).match(/<MenuShell[^>]*className=(["`])[^"`]*\1/g) ?? [];
      const withWidth = overrides.filter((m) => /\b(w-|min-w-|max-w-)\S/.test(m));
      expect(withWidth).toEqual([]);
    });
  }

  it('leaves the ListTable cell editors alone', () => {
    // Guards the exception from being "fixed" by a later sweep: these three
    // popovers are matched to the Calendar surface on purpose.
    expect(src('Function/shared/listTable/cells.tsx').match(/CELL_POPOVER_RADIUS/g)?.length).toBe(4);
  });
});

describe('the section heading is used, not just exported', () => {
  for (const file of CONVERGED) {
    it(`${file} routes group headings through MenuSectionLabel`, () => {
      // `DropdownMenuLabel` renders at 14px unless every call site retypes it,
      // which is exactly how three of these files ended up at 10px and two at
      // 11px. There is one heading component now.
      expect(src(file)).not.toMatch(/<DropdownMenuLabel\b/);
    });
  }

  it('every converged file takes its headings from the shared component', () => {
    const withHeadings = CONVERGED.filter((f) => /MenuSectionLabel/.test(src(f)) || (/FieldVisibility/.test(src(f)) && /MenuSectionLabel/.test(src('Function/property/FieldVisibility.tsx'))));
    expect(withHeadings).toEqual(CONVERGED);
  });
});
