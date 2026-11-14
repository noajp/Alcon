/** @vitest-environment jsdom */
//
// The control geometry, guarded from both ends.
//
// Before `CONTROL` and this rewrite of `ui/button.tsx`, the 550 hand-written
// `<button>`s in `src/` were measured by parsing every opening tag. They
// carried 18 distinct heights, 9 radii, 10 type sizes, 8 horizontal paddings
// and 10 vertical ones — and only 191 of the 550 declared a height at all, so
// most rows of controls were sized by whatever padding each author picked.
// `ui/button.tsx` existed the whole time and was imported by 7 files.
//
// Three halves, because no one of them is sufficient:
//
//   1. Token half — `CONTROL` really is three steps, one radius, and the
//      button's classes really are built from it. A token block that the
//      primitive does not read is decoration.
//
//   2. Rendering half — `Button` puts that geometry on the DOM node, for every
//      size and every variant, and offers no fifth tier and no fourth step. A
//      constant exported but never reaching the element passes a source grep.
//
//   3. Source half — the surfaces this Element converged actually go through
//      the primitive, and no raw `<input type="date">` survives anywhere in
//      `src/`. Rendering correctly proves nothing if ListControls still
//      hand-rolls `w-[26px] h-[26px]` next to it, which is exactly the
//      regression to expect: the next toolbar button gets added by copying a
//      neighbour.
//
// What this file deliberately does NOT assert: that all 550 hand-written
// buttons are gone. They are not. This Element converged the toolbar triggers,
// the date surfaces and the dialog CTAs — the places the geometry drift was
// visible as a row of mismatched controls. The rest is a sweep, not a
// primitive, and locking it here would only produce a test that is disabled the
// first time someone adds a button in a hurry.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, afterEach } from 'vitest';
import { cleanup, render } from '@testing-library/react';

import { Button, buttonVariants } from '@/ui/button';
import { CONTROL } from '@/shared/designTokens';

afterEach(cleanup);

// vitest runs with `web/` as cwd (vitest.config.mts lives there).
const src = (rel: string) => readFileSync(resolve(process.cwd(), 'src', rel), 'utf8');
/** Source with comments removed — a rule must hold in the code, not in prose
 *  about the code (this file's own explanations quote the old strings). */
const code = (rel: string) => stripComments(src(rel));

function classesOf(el: Element): string[] {
  return el.className.toString().split(/\s+/).filter(Boolean);
}

function renderButton(props: React.ComponentProps<typeof Button> = {}) {
  render(<Button data-testid="b" {...props} />);
  return classesOf(document.querySelector('[data-testid="b"]')!);
}

// -------------------------------------------------------------------- tokens

describe('CONTROL is the one place the numbers live', () => {
  it('offers the same four steps for every axis', () => {
    const steps = ['xs', 'sm', 'md', 'lg'];
    for (const axis of ['height', 'square', 'padX', 'gap', 'text', 'icon'] as const) {
      expect(Object.keys(CONTROL[axis])).toEqual(steps);
    }
  });

  it('is 24 / 28 / 32px, and the icon-only step is the square of it', () => {
    expect([CONTROL.height.xs, CONTROL.height.sm, CONTROL.height.md]).toEqual([
      'h-6',
      'h-7',
      'h-8',
    ]);
    expect([CONTROL.square.xs, CONTROL.square.sm, CONTROL.square.md]).toEqual([
      'size-6',
      'size-7',
      'size-8',
    ]);
  });

  it('holds the radius constant across the steps', () => {
    // shadcn and Primer both keep radius fixed as size changes; three radii in
    // one row of controls is what reads as hand-assembled.
    expect(CONTROL.radius).toBe('rounded-md');
  });

  it('declares no vertical padding, because height is declared instead', () => {
    // 359 of the 550 hand-written buttons had no height at all and were sized
    // by py-*. A control whose height depends on its type size stops matching
    // its neighbour the moment the type scale moves.
    expect(Object.keys(CONTROL)).not.toContain('padY');
  });
});

// ----------------------------------------------------------------- rendering

describe('Button renders the CONTROL geometry', () => {
  const SIZES = ['xs', 'sm', 'md'] as const;

  it('takes its height, padding and type from CONTROL, not from literals', () => {
    for (const size of SIZES) {
      const classes = renderButton({ size });
      expect(classes).toContain(CONTROL.height[size]);
      expect(classes).toContain(CONTROL.padX[size]);
      expect(classes).toContain(CONTROL.text[size]);
      expect(classes).toContain(CONTROL.gap[size]);
      cleanup();
    }
  });

  it('makes an icon-only button the square of its own step', () => {
    for (const size of SIZES) {
      const classes = renderButton({ size: `icon-${size}` as 'icon-sm' });
      expect(classes).toContain(CONTROL.square[size]);
      // A square control must not also carry an x-padding: that is what turned
      // "26px icon button" into a 26×34 rectangle at several call sites.
      expect(classes.filter((c) => /^px-/.test(c))).toEqual([]);
      cleanup();
    }
  });

  it('carries one height per button — never two', () => {
    // `h-7` + `h-[26px]` in the same class string is undecidable by reading;
    // whichever Tailwind emits last wins.
    for (const size of [...SIZES, 'icon-xs', 'icon-sm', 'icon-md'] as const) {
      const heights = renderButton({ size }).filter((c) => /^(h-|size-)/.test(c));
      expect(heights).toHaveLength(1);
      cleanup();
    }
  });

  it('gives every size the same radius', () => {
    const radii = new Set<string>();
    for (const size of [...SIZES, 'icon-xs', 'icon-sm', 'icon-md'] as const) {
      renderButton({ size })
        .filter((c) => /^rounded/.test(c))
        .forEach((c) => radii.add(c));
      cleanup();
    }
    expect([...radii]).toEqual([CONTROL.actionRadius]);
  });

  it('offers four tiers and no fifth', () => {
    // `outline` and `link` are gone on purpose: a bordered tier duplicates
    // `secondary`, and a link is an <a>. Primer's four are the whole ladder.
    for (const variant of ['primary', 'secondary', 'ghost', 'danger'] as const) {
      expect(() => renderButton({ variant })).not.toThrow();
      cleanup();
    }
    const all = buttonVariants.toString();
    expect(all).not.toContain('outline:');
    for (const dead of ['outline', 'link', 'destructive', 'default']) {
      // The old vocabulary must not resolve to anything — a stale
      // `variant="outline"` should be a type error, not a silent no-op.
      const classes = renderButton({ variant: dead as 'ghost' });
      expect(classes.some((c) => /^bg-/.test(c) || c === 'bg-transparent')).toBe(false);
      cleanup();
    }
  });

  it('paints hover with a token that differs from the surface it sits on', () => {
    // Same measurement MenuShell records: in the light themes `--accent` and
    // the surface resolve to the same colour, so `hover:bg-accent` — shadcn's
    // default for both `ghost` and `outline` — paints nothing at all.
    const ghost = renderButton({ variant: 'ghost' }).join(' ');
    expect(ghost).toContain('hover:bg-[var(--surface-strong)]');
    expect(ghost).not.toContain('hover:bg-accent');
  });

  it('animates nothing itself, because globals.css already does', () => {
    // `button` gets `transition: background/color/border-color/opacity
    // var(--motion-fast)` from globals.css. shadcn's `transition-all` on top of
    // that animated width and height too, so a button whose label changed grew
    // visibly instead of snapping.
    const classes = renderButton().join(' ');
    expect(classes).not.toContain('transition-all');

    const globals = readFileSync(resolve(process.cwd(), 'src/app/globals.css'), 'utf8');
    expect(globals).toMatch(/button, a, input, select, textarea \{[\s\S]{0,200}--motion-fast/);
  });

  it('draws no ring or outline of its own on focus', () => {
    // Keyboard focus is the tint globals.css lays on every control; a ring
    // or outline here would frame the button on top of it.
    const classes = renderButton().join(' ');
    expect(classes).not.toMatch(/focus-visible:(ring|outline)-\S/);
  });

  it('distinguishes a trigger from a CTA by where the label sits', () => {
    // Primer: a button that opens something reads left-aligned; a button that
    // does something reads centred. `Sort ▾` and `Create` are not the same
    // object and should not have the same shape.
    expect(renderButton({ align: 'start' })).toContain('justify-start');
    cleanup();
    expect(renderButton({ align: 'center' })).toContain('justify-center');
  });
});

// -------------------------------------------------------------------- source

describe('the converged surfaces go through the primitive', () => {
  it('ListControls hand-rolls no toolbar trigger', () => {
    // The Sort, Filter and Display triggers were three separate
    // `w-[26px] h-[26px]` boxes — a size that exists nowhere else in the app —
    // and the direction toggles inside the Sort menu were 20px with a 4px
    // radius, inside rows whose every other corner is 6px.
    const text = code('Function/shared/listControls/ListControls.tsx');
    expect(text).not.toMatch(/w-\[26px\]/);
    expect(text).not.toMatch(/h-\[26px\]/);
    expect(text).toMatch(/<Button\b/);
  });

  it('the due-date filter leads with relative presets', () => {
    // The absolute picker is what you reach for after the
    // presets fail you, not the first thing offered.
    const text = code('Function/shared/listControls/ListControls.tsx');
    expect(text).toMatch(/<DueDateFilter\b/);
    expect(text).not.toMatch(/filter\.dueFrom \?\? ''/);
  });

  it('no raw <input type="date"> survives anywhere in src/', () => {
    // Nine of them across seven files: four visible native inputs rendering the
    // browser's own yyyy/mm/dd chrome, three `sr-only` ones hidden behind a
    // styled <label> so the widget only appeared on click, and two more in the
    // Element properties rows. The app already owned a themed Calendar and used
    // it in six other places — these were the leftovers.
    const offenders: string[] = [];
    for (const file of allTsx()) {
      if (stripComments(readFileSync(file, 'utf8')).includes('type="date"')) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the dialog CTAs stopped hand-painting their own red', () => {
    // Two delete confirmations carried `bg-destructive hover:bg-destructive/90
    // text-white` inline, which is the `danger` tier being re-invented at the
    // call site — and re-invented differently from ChannelDialog's, which used
    // `variant="destructive"`.
    for (const file of ['ActivitySpace/execution/object/ObjectDetailView.tsx']) {
      expect(code(file)).not.toMatch(/bg-destructive hover:bg-destructive/);
    }
  });
});

// --------------------------------------------------------------------- utils

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function allTsx(): string[] {
  const { readdirSync, statSync } = require('node:fs') as typeof import('node:fs');
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = resolve(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith('.tsx')) out.push(p);
    }
  };
  walk(resolve(process.cwd(), 'src'));
  return out;
}
