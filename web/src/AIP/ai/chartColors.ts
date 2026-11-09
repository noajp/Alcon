import type { ChartSpec } from './chartSpec';

// A person's color choices on a chat chart. The chart spec (chartSpec.ts)
// is the model's data and carries no colors; what a person picks is an
// annotation on the message (CopilotMessage.chartColors), resolved here.
//
// The default family is built around the key color (the accent): the
// accent first, then it lifted toward the text color and sunk toward
// the card by turns — one family, far enough apart to tell slices
// apart, so a chart reads as part of the UI rather than a rainbow. The
// values are CSS expressions, not concrete colors; the PNG export
// resolves them against the live document before drawing.

/** The floating card a chat chart sits on — the Execution Chain
 *  cards' surface, verbatim (the ElementCard of PR 803). Shared here
 *  so the streaming placeholders in CopilotMessages match the settled
 *  chart without importing the (lazily loaded) renderer. */
export const CHART_CARD_CLASS =
  'rounded-lg border border-border bg-card shadow-[var(--shadow-island)] dark:bg-[var(--surface-rail)]';

const lift = (pct: number) => `color-mix(in oklab, var(--accent-default), var(--text-primary) ${pct}%)`;
const sink = (pct: number) => `color-mix(in oklab, var(--accent-default), var(--card) ${pct}%)`;
const CHART_THEME_COLORS = ['var(--accent-default)', lift(40), sink(35), lift(65), lift(20), sink(55)];

/** One thing on a chart a person can recolor: a series, or — on a pie,
 *  where the single series is drawn per category — one row. `key` is
 *  what an override is stored under; `index` picks the default color. */
export interface ChartColorSlot {
  key: string;
  label: string;
  index: number;
}

/** Pure. The chart's color slots, in draw order. Pie slots are keyed
 *  by the row's name — the person thinks "make December grey", not
 *  "make series 1 grey". This list is also the PNG legend's rows. */
export function chartSlots(spec: ChartSpec): ChartColorSlot[] {
  if (spec.type === 'pie') {
    return spec.data.map((row, i) => ({ key: row.name, label: row.name, index: i }));
  }
  return spec.series.map((key, i) => ({ key, label: key, index: i }));
}

/** Pure. The color a slot is drawn in: the person's stored hex for its
 *  key when there is one, else its place in the theme family. Keys in
 *  the record that no slot claims (a stale name from an edited answer)
 *  are never consulted, so they cannot break rendering. */
export function effectiveColor(
  overrides: Record<string, string> | undefined,
  key: string,
  index: number,
): string {
  const picked = overrides?.[key];
  return picked ? picked : CHART_THEME_COLORS[index % CHART_THEME_COLORS.length];
}

/** Pure. A chart's override record with one slot set (a hex) or cleared
 *  (null — back to the theme color). An empty record means all theme. */
export function withSlotColor(
  record: Record<string, string> | undefined,
  key: string,
  hex: string | null,
): Record<string, string> {
  const next = { ...(record ?? {}) };
  if (hex) next[key] = hex;
  else delete next[key];
  return next;
}

/** Pure. The PNG's file name before the download helper sanitises it:
 *  the chart's title, or "chart" when it has none. */
export function chartFileName(spec: ChartSpec): string {
  return `${spec.title?.trim() || 'chart'}.png`;
}
