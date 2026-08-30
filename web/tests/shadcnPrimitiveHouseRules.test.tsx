/** @vitest-environment jsdom */
//
// `ui/input.tsx` and `ui/calendar.tsx` are shadcn-generated files that were
// hand-diverged from upstream to obey the house rule "入力フィールドに枠・リング・
// アウトライン禁止" (.claude/CLAUDE.md, DESIGN.md §5.3). Re-running the generator
// silently restores the upstream focus ring — a header comment asks people not
// to, but nothing enforced it.
//
// design-lint does not close this hole on its own: it is a ratchet against
// origin/main, so once a regenerated ring lands on main it becomes "inherited"
// and every later PR is allowed to keep it. These assertions fail loudly the
// first time the ring comes back.
//
// The other half of the rule is that the field must still be *visible*. It is
// visible because it carries no `bg-transparent`, which is precisely what makes
// `globals.css` @layer base give it a resting border. A regeneration that
// re-adds `bg-transparent` would produce a field with no frame and no fill —
// an invisible input. That is asserted too.

import { describe, expect, it, afterEach } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { Input } from '@/ui/input';
import { Calendar } from '@/ui/calendar';

afterEach(cleanup);

/** Ring / outline / focus-border utilities, in any variant position. */
const RING_UTILITIES = /(^|:)ring-|(^|:)outline-(?!none\b)|(?:focus|focus-visible|has-focus)[:-][^\s]*(?:ring|border)-/;

function classesOf(el: Element): string[] {
  return el.className.toString().split(/\s+/).filter(Boolean);
}

describe('ui/input.tsx keeps the house rules', () => {
  it('carries no ring, outline or focus-border utility', () => {
    const { container } = render(<Input placeholder="general" />);
    const offenders = classesOf(container.querySelector('input')!).filter((c) =>
      RING_UTILITIES.test(c),
    );
    expect(offenders).toEqual([]);
  });

  it('carries no shadow, which is a ring by another name', () => {
    const { container } = render(<Input />);
    const offenders = classesOf(container.querySelector('input')!).filter((c) =>
      /^shadow-/.test(c),
    );
    expect(offenders).toEqual([]);
  });

  it('does not opt out of the resting border globals.css gives form fields', () => {
    // `input:not(.bg-transparent)` in globals.css @layer base is what draws the
    // field. Adding `bg-transparent` back here makes the input invisible.
    const { container } = render(<Input />);
    expect(classesOf(container.querySelector('input')!)).not.toContain('bg-transparent');
  });

  it('shows focus as a background change', () => {
    const { container } = render(<Input />);
    const classes = classesOf(container.querySelector('input')!);
    expect(classes.some((c) => /^focus:bg-/.test(c))).toBe(true);
  });

  it('shows the invalid state as a background change, not a red border', () => {
    const { container } = render(<Input aria-invalid />);
    const classes = classesOf(container.querySelector('input')!);
    expect(classes.some((c) => /^aria-invalid:bg-/.test(c))).toBe(true);
    expect(classes.some((c) => /aria-invalid:(ring|border)-/.test(c))).toBe(false);
  });
});

describe('ui/calendar.tsx keeps the house rules', () => {
  it('gives the month/year dropdown a background, not a ring', () => {
    const { container } = render(<Calendar mode="single" captionLayout="dropdown" />);
    const select = container.querySelector('select');
    expect(select).not.toBeNull();

    const wrapper = select!.parentElement!;
    const classes = classesOf(wrapper);
    expect(classes.filter((c) => RING_UTILITIES.test(c))).toEqual([]);
    expect(classes.filter((c) => /^shadow-/.test(c))).toEqual([]);
    expect(classes.some((c) => /^has-focus:bg-/.test(c))).toBe(true);
    // Still legible as a control once the border is gone.
    expect(classes.some((c) => /^bg-/.test(c))).toBe(true);
  });
});
