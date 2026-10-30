/** @vitest-environment jsdom */
//
// One status → one hue, and one place that says so.
//
// Measured on origin/main before this Element, by reading what each surface
// actually draws rather than what designTokens.ts claims:
//
//   status       designTokens   ElementProgressMark   CalendarView   ObjectTree   EditBuiltIn…
//   in_progress  #f59e0b        #816ee6               #3b82f6        #F59E0B      #f59e0b
//   review       #5793f0        #3d80b0               #a855f7        #3B82F6      #6366f1
//   done         #27a644        #279066               #22c55e        #10B981      #22c55e
//   blocked      #ce4a3b        #eab308               #ef4444        #EF4444      #ef4444
//
// Not five copies of one value that drifted in the last digit — five different
// hues. `in_progress` was orange in the Gantt, purple in every list row and
// blue on the calendar, and `blocked` was yellow in the row and red everywhere
// else. designTokens.ts was the declared source of truth and
// described none of the surfaces a user actually looks at.
//
// The mark won: it is the most-seen status surface in the app (~10 call sites,
// every list row, the status picker, the board, bulk actions), and its palette
// was the deliberate one. So its hues became --element-status-* in globals.css
// and every other surface now reads them back out.
//
// Three halves, because no one of them alone catches the regression:
//
//   1. Rendering half — the mark really does put the token class on the DOM
//      node. A constant that is exported but never reaches the element would
//      pass a source grep.
//   2. Token half — every var the tables reference is actually defined in
//      globals.css, and nothing later redefines it. This is the failure PR
//      #230 found on the radius scale: `@theme inline` silently overrode the
//      ":root per design spec" block, so the spec table stopped describing the
//      shipped product while still looking authoritative.
//   3. Source half — the converged files do not hand-roll a status palette
//      next to the shared one. Rendering the mark correctly proves nothing if
//      CalendarView still keeps its own `#a855f7`, and that is exactly the
//      regression to expect: the next surface gets written by copying a
//      neighbour.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, afterEach } from 'vitest';
import { cleanup, render } from '@testing-library/react';

import {
  STATUS,
  PRIORITY,
  SEMANTIC_COLORS,
  statusColor,
  statusTint,
  priorityColor,
  statusLabel,
} from '@/shared/designTokens';
import { ElementProgressMark } from '@/Function/shared/ElementProgressMark';
import { PriorityMark } from '@/Function/shared/PriorityMark';

afterEach(cleanup);

// vitest runs with `web/` as cwd (vitest.config.mts lives there).
const src = (rel: string) => readFileSync(resolve(process.cwd(), 'src', rel), 'utf8');

const GLOBALS = src('app/globals.css');

const STATUS_KEYS = Object.keys(STATUS) as (keyof typeof STATUS)[];
const PRIORITY_KEYS = Object.keys(PRIORITY) as (keyof typeof PRIORITY)[];

/** Every `var(--x)` name mentioned in a class string or an inline value. */
function varsIn(value: string): string[] {
  return [...value.matchAll(/var\(\s*(--[a-z0-9-]+)\s*\)/gi)].map((m) => m[1]);
}

/** Files that converged onto the shared tables in this Element. */
const CONVERGED = [
  'Function/shared/ElementProgressMark.tsx',
  'Function/shared/PriorityMark.tsx',
  'ActivitySpace/execution/element/gantt/GanttView.tsx',
  'ActivitySpace/sustainment/calendar/CalendarView.tsx',
  'Function/widget/widgets/KpiCardsWidget.tsx',
  'hooks/useDashboardData.ts',
];

// ---------------------------------------------------------------- rendering

describe('the shared marks draw the token, not a palette of their own', () => {
  function markClasses(status: string): string[] {
    const { container } = render(
      <ElementProgressMark status={status as never} progress={40} />,
    );
    return container.firstElementChild!.className.toString().split(/\s+/).filter(Boolean);
  }

  it('tints every status with exactly STATUS[key].color', () => {
    for (const key of STATUS_KEYS) {
      expect(markClasses(key)).toContain(STATUS[key].color);
      cleanup();
    }
  });

  it('puts no raw colour on the mark — every tint is a var()', () => {
    for (const key of STATUS_KEYS) {
      const colour = markClasses(key).filter((c) => /^text-/.test(c));
      expect(colour).toHaveLength(1);
      expect(colour[0]).toMatch(/^text-\[var\(--element-status-[a-z-]+\)\]$/);
      cleanup();
    }
  });

  it('tints the urgent priority mark with PRIORITY.urgent.color', () => {
    const { container } = render(<PriorityMark priority="urgent" />);
    const classes = container.querySelector('svg')!.getAttribute('class') ?? '';
    expect(classes.split(/\s+/)).toContain(PRIORITY.urgent.color);
    expect(classes).not.toMatch(/#[0-9a-f]{3,8}/i);
  });

  it('leaves low / medium / high shape-coded, not colour-coded', () => {
    // The chevron count carries the level in a row; only the chart codes these
    // by colour. Asserted so a later sweep does not "helpfully" tint them.
    for (const p of ['low', 'medium', 'high']) {
      const { container } = render(<PriorityMark priority={p} />);
      expect(container.querySelectorAll('svg')).toHaveLength(
        { low: 1, medium: 2, high: 3 }[p]!,
      );
      cleanup();
    }
  });
});

// ------------------------------------------------------------------- tokens

describe('the tables describe what globals.css actually ships', () => {
  it('defines every var the STATUS / PRIORITY / SEMANTIC tables reference', () => {
    const referenced = new Set<string>();
    for (const key of STATUS_KEYS) {
      const meta = STATUS[key];
      varsIn(`${meta.color} ${meta.bg} ${meta.dot}`).forEach((v) => referenced.add(v));
    }
    for (const key of PRIORITY_KEYS) {
      const meta = PRIORITY[key];
      varsIn(`${meta.color} ${meta.badgeBg}`).forEach((v) => referenced.add(v));
    }
    for (const group of [SEMANTIC_COLORS.status, SEMANTIC_COLORS.statusSubtle, SEMANTIC_COLORS.priority]) {
      Object.values(group).forEach((v) => varsIn(v).forEach((x) => referenced.add(x)));
    }

    const missing = [...referenced].filter(
      (name) => !new RegExp(`^\\s*${name}\\s*:`, 'm').test(GLOBALS),
    );
    expect(missing).toEqual([]);
  });

  it('lets no @theme block shadow an --element-status-* / --priority-* token', () => {
    // The radius scale's failure mode, guarded on the colour side: `@theme
    // inline` re-declares `--radius-sm/md/lg/xl` after :root sets them "per
    // design spec", so the spec block never reaches the page. Tailwind maps
    // `--color-<x>` onto the `<x>` utility namespace, so a `--color-element-…`
    // entry would do the same to these.
    for (const block of GLOBALS.matchAll(/@theme[^{]*\{([\s\S]*?)\n\}/g)) {
      expect(block[1]).not.toMatch(/--color-(element-status|priority)-/);
    }
  });

  it('keeps one hue per status across the class table and the inline table', () => {
    for (const key of STATUS_KEYS) {
      expect(varsIn(STATUS[key].color)).toEqual(varsIn(SEMANTIC_COLORS.status[key]));
      expect(varsIn(STATUS[key].dot)).toEqual(varsIn(SEMANTIC_COLORS.status[key]));
    }
    for (const key of PRIORITY_KEYS) {
      expect(varsIn(PRIORITY[key].color)).toEqual(varsIn(SEMANTIC_COLORS.priority[key]));
    }
  });

  it('hands inline-style callers a var(), never a bare hex', () => {
    for (const key of STATUS_KEYS) {
      expect(statusColor(key)).toMatch(/^var\(--element-status-[a-z-]+\)$/);
      expect(statusTint(key)).toMatch(/^var\(--element-status-[a-z-]+-subtle\)$/);
    }
    for (const key of PRIORITY_KEYS) {
      expect(priorityColor(key)).toMatch(/^var\(--priority-[a-z]+\)$/);
    }
    // Unknown / null falls back inside the table, so no call site needs its own
    // `?? '#A3A3A3'` — which is where three of the five palettes came from.
    expect(statusColor(null)).toBe(SEMANTIC_COLORS.status.todo);
    expect(statusColor('nonsense')).toBe(SEMANTIC_COLORS.status.todo);
    expect(priorityColor(undefined)).toBe(SEMANTIC_COLORS.priority.medium);
    expect(statusLabel('in_progress')).toBe(STATUS.in_progress.label);
  });
});

// ------------------------------------------------------------------- source

describe('no surface keeps a status palette of its own', () => {
  it('holds no hex on any line that names a status or priority key', () => {
    const KEY = /\b(backlog|todo|in_progress|review|done|blocked|cancelled|urgent|high|medium|low)\b/;
    const offenders: string[] = [];
    for (const rel of CONVERGED) {
      src(rel)
        .split('\n')
        .forEach((line, i) => {
          if (KEY.test(line) && /#[0-9a-fA-F]{3,8}\b/.test(line)) {
            offenders.push(`${rel}:${i + 1}  ${line.trim()}`);
          }
        });
    }
    expect(offenders).toEqual([]);
  });

  it('routes every converged file through the shared table', () => {
    for (const rel of CONVERGED) {
      expect(src(rel)).toMatch(/from '@\/shared\/designTokens'/);
    }
  });

  it('never concatenates an alpha suffix onto a token colour', () => {
    // `${SEMANTIC_COLORS.status.done}33` was live in GanttView: the value is
    // `var(--element-status-done)`, so the result is `var(…)33` — not a colour,
    // and the drag-preview ground painted nothing at all. `statusTint()` is the
    // way to get a translucent ground.
    for (const rel of CONVERGED) {
      expect(src(rel)).not.toMatch(/\}[0-9a-fA-F]{2}`/);
    }
  });

  it('leaves the user-chosen event palette alone', () => {
    // COLOR_PALETTE (ActivitySpace/sustainment/calendar/calendarColorPalette.ts) is a
    // picker of ten colours a user assigns to an Element by hand. It is not
    // a status ramp and must not be converged into one — `element.color`
    // deliberately overrides the status hue.
    const palette = src('ActivitySpace/sustainment/calendar/calendarColorPalette.ts');
    expect(palette).toMatch(/export const COLOR_PALETTE = \[/);
    const calendar = src('ActivitySpace/sustainment/calendar/CalendarView.tsx');
    expect(calendar).toMatch(/element\.color \|\| statusColor\(/);
  });
});
