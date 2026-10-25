import type { Slide } from "./types";

// ページの中の項目を1つ足す・1つ減らす。レイアウトごとに上限と下限を持つ。

export type ItemAxis = "item" | "row" | "column";

const LIMITS: Record<string, { min: number; max: number }> = {
  premise: { min: 1, max: 4 },
  claim3: { min: 2, max: 4 },
  issue: { min: 1, max: 5 },
  steps: { min: 2, max: 5 },
  closing: { min: 1, max: 5 },
  grid: { min: 2, max: 12 },
  kpi: { min: 1, max: 4 },
  agenda: { min: 1, max: 8 },
  row: { min: 1, max: 6 },
  column: { min: 2, max: 4 },
};

export function itemAxes(slide: Slide): ItemAxis[] {
  if (slide.layout === "compare") return ["row", "column"];
  if (["premise", "claim3", "issue", "steps", "closing", "grid", "kpi", "agenda"].includes(slide.layout)) return ["item"];
  return [];
}

export function itemCount(slide: Slide, axis: ItemAxis): number {
  const c = slide.content;
  if (axis === "row") return c.compare?.rows.length ?? 0;
  if (axis === "column") return c.compare?.columns.length ?? 0;
  switch (slide.layout) {
    case "premise":
      return c.premise?.premises.length ?? 0;
    case "claim3":
      return c.claim3?.points.length ?? 0;
    case "issue":
      return c.issue?.pairs.length ?? 0;
    case "steps":
      return c.steps?.steps.length ?? 0;
    case "closing":
      return c.closing?.asks.length ?? 0;
    case "grid":
      return c.grid?.cards.length ?? 0;
    case "kpi":
      return c.kpi?.stats.length ?? 0;
    case "agenda":
      return c.agenda?.items.length ?? 0;
    default:
      return 0;
  }
}

export function canChange(slide: Slide, axis: ItemAxis, delta: 1 | -1): boolean {
  const lim = LIMITS[axis === "item" ? slide.layout : axis];
  if (!lim) return false;
  const n = itemCount(slide, axis);
  return delta > 0 ? n < lim.max : n > lim.min;
}

export function changeItems(slide: Slide, axis: ItemAxis, delta: 1 | -1): Slide {
  if (!canChange(slide, axis, delta)) return slide;
  const next = changeItemsRaw(slide, axis, delta);
  if (delta > 0 || !slide.styles) return next;
  // 減らした項目（最後の1つ）の文字の上書きは捨てる。あとで足した空の項目に前の見た目が付かないように
  const n = itemCount(slide, axis) - 1;
  const gone = new RegExp(`^content\\.${slide.layout}\\.[a-z]+\\.${axis === "column" ? "\\d+\\.cells\\." : ""}${n}(\\.|$)|^content\\.compare\\.columns\\.${axis === "column" ? n : -1}$`);
  const styles = Object.fromEntries(Object.entries(slide.styles).filter(([k]) => !gone.test(k)));
  return { ...next, styles: Object.keys(styles).length ? styles : undefined };
}

function changeItemsRaw(slide: Slide, axis: ItemAxis, delta: 1 | -1): Slide {
  const c = slide.content;
  const grow = <T,>(xs: T[], blank: T) => (delta > 0 ? [...xs, blank] : xs.slice(0, -1));
  if (axis === "row" && c.compare) {
    return { ...slide, content: { ...c, compare: { ...c.compare, rows: grow(c.compare.rows, { label: "", cells: c.compare.columns.map(() => "") }) } } };
  }
  if (axis === "column" && c.compare) {
    const cmp = c.compare;
    const columns = grow(cmp.columns, "");
    const rows = cmp.rows.map((r) => ({ ...r, cells: delta > 0 ? [...r.cells, ""] : r.cells.slice(0, columns.length) }));
    return { ...slide, content: { ...c, compare: { ...cmp, columns, rows, highlight: Math.min(cmp.highlight, columns.length - 1) } } };
  }
  switch (slide.layout) {
    case "premise":
      return { ...slide, content: { ...c, premise: { ...c.premise!, premises: grow(c.premise!.premises, "") } } };
    case "claim3":
      return { ...slide, content: { ...c, claim3: { points: grow(c.claim3!.points, { head: "", body: "" }) } } };
    case "issue":
      return { ...slide, content: { ...c, issue: { pairs: grow(c.issue!.pairs, { issue: "", action: "" }) } } };
    case "steps":
      return { ...slide, content: { ...c, steps: { steps: grow(c.steps!.steps, { head: "", body: "" }) } } };
    case "closing":
      return { ...slide, content: { ...c, closing: { asks: grow(c.closing!.asks, "") } } };
    case "grid":
      return { ...slide, content: { ...c, grid: { cards: grow(c.grid!.cards, { head: "", body: "" }) } } };
    case "kpi":
      return { ...slide, content: { ...c, kpi: { stats: grow(c.kpi!.stats, { value: "", label: "", note: "" }) } } };
    case "agenda": {
      const items = grow(c.agenda!.items, { head: "", page: "" });
      return { ...slide, content: { ...c, agenda: { items, current: Math.min(c.agenda!.current, items.length - 1) } } };
    }
    default:
      return slide;
  }
}

/** 比較で立たせる列、2×2 で立たせる象限を変える */
export function setHighlight(slide: Slide, col: number): Slide {
  if (slide.layout === "matrix" && slide.content.matrix) return { ...slide, content: { ...slide.content, matrix: { ...slide.content.matrix, highlight: col } } };
  if (!slide.content.compare) return slide;
  return { ...slide, content: { ...slide.content, compare: { ...slide.content.compare, highlight: col } } };
}
