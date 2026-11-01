import type { LayoutId, Slide, SlideContent } from "./types";
import { emptyChart, formatValue, guessKind, guessUnit, parseNumber } from "./chart";
import { tx } from "@/ActivitySpace/sustainment/slides/kata/i18n";

export interface LayoutDef {
  id: LayoutId;
  name: string;
  desc: string;
  /** ページ内の論理として選べるか（表紙と結びは別枠） */
  logic: boolean;
  /** この型の出どころ */
  basis?: string;
}

export const LAYOUTS: LayoutDef[] = [
  { id: "compare", get name() { return tx("比較", "Comparison"); }, get desc() { return tx("同じ観点で並べて、1つを立たせる", "Line options up on the same criteria and make one stand out"); }, logic: true, basis: "Zelazny: item comparison" },
  { id: "premise", get name() { return tx("前提→帰結", "Premise → so what"); }, get desc() { return tx("事実を左に、言えることを右に", "Facts on the left, what follows on the right"); }, logic: true, basis: "Minto: inductive grouping" },
  { id: "claim3", get name() { return tx("主張＋根拠3つ", "Claim + 3 reasons"); }, get desc() { return tx("言いたいことを3つの根拠で支える", "Support one message with three reasons"); }, logic: true, basis: "Minto: Pyramid Principle (3 supporting points)" },
  { id: "issue", get name() { return tx("課題→打ち手", "Issue → action"); }, get desc() { return tx("課題ごとに、打ち手を対にする", "Pair each issue with its action"); }, logic: true, basis: "Consulting: issue → action" },
  { id: "steps", get name() { return tx("流れ", "Flow"); }, get desc() { return tx("段階を順に進める", "Move through stages in order"); }, logic: true, basis: "FT Visual Vocabulary: flow" },
  { id: "matrix", get name() { return tx("2×2", "2×2"); }, get desc() { return tx("2つの軸で位置づけ、1つの象限を立たせる", "Position on two axes and highlight one quadrant"); }, logic: true, basis: "BCG matrix / 2×2 positioning" },
  { id: "chart", get name() { return tx("グラフ", "Chart"); }, get desc() { return tx("見せたいこと（構成・順位・推移・分布・相関・増減）でグラフを選ぶ", "Pick a chart by what to show: share, ranking, trend, distribution, correlation, bridge"); }, logic: true, basis: "Zelazny, Say It With Charts + FT Visual Vocabulary" },
  { id: "summary", get name() { return tx("エグゼクティブサマリー", "Executive summary"); }, get desc() { return tx("結論と、それを支える要点を1枚に", "The answer and its supporting points on one page"); }, logic: true, basis: "Minto: governing thought / A4 one-page summary" },
  { id: "grid", get name() { return tx("一覧", "Grid"); }, get desc() { return tx("3〜12個を同じ重さで並べる（原則・地域・打ち手の一覧）", "Lay out 3–12 items of equal weight (principles, regions, levers)"); }, logic: true, basis: "Minto: MECE grouping" },
  { id: "kpi", get name() { return tx("数字を並べる", "Key numbers"); }, get desc() { return tx("大きな数字を2〜4個、意味と一緒に", "Two to four big numbers, each with what it means"); }, logic: true, basis: "Duarte / dashboard KPI tiles" },
  { id: "agenda", get name() { return tx("目次・中扉", "Agenda / divider"); }, get desc() { return tx("章を並べる。今の章を立たせれば中扉になる", "List the chapters; highlight one to make it a section divider"); }, logic: true, basis: "Consulting: tracker / section divider" },
  { id: "statement", get name() { return tx("一言と数字", "Headline + number"); }, get desc() { return tx("大きな一言と1つの数字で言い切る", "Say it with one big line and one number"); }, logic: true, basis: "Duarte: big idea, one number" },
  { id: "cover", get name() { return tx("表紙", "Cover"); }, get desc() { return tx("資料の名前と目的", "Title and purpose of the deck"); }, logic: false },
  { id: "closing", get name() { return tx("結び", "Close"); }, get desc() { return tx("決めてほしいこと・お願い", "What you need decided or asked"); }, logic: false },
  { id: "free", get name() { return tx("自由配置", "Freeform"); }, get desc() { return tx("型を使わず、置いたものだけで組む", "No template: only what is placed on the page"); }, logic: false },
];

export const LAYOUT_BY_ID = Object.fromEntries(LAYOUTS.map((l) => [l.id, l])) as Record<LayoutId, LayoutDef>;

/** 中身を見出しと本文の組に平たくする。どのレイアウトからでも取り出せる共通の形 */
export interface Atom {
  head: string;
  body: string;
}

export function atomsOf(slide: Slide): Atom[] {
  const c = slide.content;
  switch (slide.layout) {
    case "compare": {
      const x = c.compare!;
      // 列ごとに、行の値を短くつなぐ（長くなりすぎたら先頭の行だけ。元の表は残る）
      const cols = x.columns.map((col, ci) => {
        const parts = x.rows.map((r) => `${r.label}：${r.cells[ci] ?? ""}`);
        let body = parts.join("／");
        while (body.length > 64 && parts.length > 1) {
          parts.pop();
          body = parts.join("／");
        }
        return { head: col, body };
      });
      return cols;
    }
    case "premise": {
      const x = c.premise!;
      return [...x.premises.map((p) => ({ head: "", body: p })), { head: x.figure || "帰結", body: x.conclusion }];
    }
    case "claim3":
      return c.claim3!.points.map((p) => ({ ...p }));
    case "issue":
      return c.issue!.pairs.map((p) => ({ head: p.issue, body: p.action }));
    case "steps":
      return c.steps!.steps.map((p) => ({ ...p }));
    case "matrix":
      return c.matrix!.cells.map((p) => ({ ...p }));
    case "chart": {
      const x = c.chart!;
      const atoms = x.categories.map((cat, i) => ({ head: cat, body: formatValue(x.series[0]?.values[i] ?? 0, x.unit) }));
      return x.takeaway ? [...atoms, { head: "", body: x.takeaway }] : atoms;
    }
    case "summary":
      return c.summary!.points.map((p) => ({ head: p.head, body: p.body }));
    case "agenda":
      return c.agenda!.items.map((p) => ({ head: p.head, body: "" }));
    case "grid":
      return c.grid!.cards.map((p) => ({ ...p }));
    case "kpi":
      return c.kpi!.stats.map((p) => ({ head: p.value, body: p.note ? `${p.label}：${p.note}` : p.label }));
    case "statement":
      return [{ head: c.statement!.figure, body: c.statement!.lead }];
    case "cover":
      return [{ head: "", body: c.cover!.subtitle }];
    case "closing":
      return c.closing!.asks.map((a) => ({ head: "", body: a }));
    case "free":
      return [];
  }
}

/** 足りなければ空欄で埋める。多いぶんは削らない（上限は各レイアウトで決める） */
const pad = <T,>(xs: T[], n: number, make: (i: number) => T): T[] => {
  const out = xs.slice();
  while (out.length < n) out.push(make(out.length));
  return out;
};

const label = (a: Atom) => a.head || a.body.slice(0, 14);

/** 文の中の最初の数字らしい所（単位つき） */
function pickFigureLoose(t: string): string {
  return t.match(/[$¥€£]?\d[\d,.]*\s?(?:%|％|percent|兆|億|万|trillion|billion|million|[kKMBT]\b|倍|x\b)?/)?.[0]?.trim() ?? "";
}

/** 平たくした中身から、目的のレイアウトの中身を組み立てる */
export function buildContent(layout: LayoutId, atoms: Atom[]): SlideContent {
  const a = atoms.filter((x) => x.head || x.body);
  switch (layout) {
    case "compare": {
      const cols = pad(a, Math.max(2, Math.min(a.length, 4)), (i) => ({ head: `案 ${"ABCD"[i]}`, body: "" })).slice(0, 4);
      return {
        compare: {
          columns: cols.map(label),
          rows: [{ label: "要点", cells: cols.map((x) => x.body) }],
          highlight: Math.min(1, cols.length - 1),
          takeaways: [],
        },
      };
    }
    case "premise": {
      const last = a[a.length - 1];
      const prem = a.length > 1 ? a.slice(0, -1) : [];
      return {
        premise: {
          premises: pad(prem.map((x) => (x.head ? `${x.head}：${x.body}` : x.body)), 2, () => "").slice(0, 4),
          conclusion: last?.body ?? "",
          figure: last?.head ?? "",
        },
      };
    }
    case "claim3":
      return { claim3: { points: pad(a.map((x) => ({ head: label(x), body: x.head ? x.body : "" })), 3, () => ({ head: "", body: "" })).slice(0, 4) } };
    case "issue":
      return { issue: { pairs: pad(a.map((x) => ({ issue: x.head || x.body, action: x.head ? x.body : "" })), 3, () => ({ issue: "", action: "" })).slice(0, 5) } };
    case "steps":
      return { steps: { steps: pad(a.map((x) => ({ head: label(x), body: x.head ? x.body : "" })), 3, () => ({ head: "", body: "" })).slice(0, 5) } };
    case "matrix":
      return {
        matrix: {
          x: { low: "低い", high: "高い" },
          y: { low: "低い", high: "高い" },
          cells: pad(a.map((x) => ({ head: label(x), body: x.head ? x.body : "" })), 4, () => ({ head: "", body: "" })).slice(0, 4),
          highlight: 1,
        },
      };
    case "chart": {
      // 本文の数を拾ってグラフにする。数が無ければ見本の数で置き、あとで直してもらう
      const rows = a.filter((x) => x.head && parseNumber(x.body) !== null);
      if (rows.length < 2) return { chart: emptyChart() };
      const categories = rows.map((x) => x.head).slice(0, 12);
      const values = rows.map((x) => parseNumber(x.body) ?? 0).slice(0, 12);
      const unit = guessUnit(rows.map((x) => x.body));
      return { chart: { kind: guessKind(categories, values, unit), categories, series: [{ name: "", values }], unit, highlight: 0, takeaway: "" } };
    }
    case "summary":
      return { summary: { points: pad(a.map((x) => ({ head: label(x), body: x.head ? x.body : "", page: "" })), 3, () => ({ head: "", body: "", page: "" })).slice(0, 4) } };
    case "agenda":
      return { agenda: { items: pad(a.map((x) => ({ head: label(x), page: "" })), 3, () => ({ head: "", page: "" })).slice(0, 8), current: -1 } };
    case "grid":
      return { grid: { cards: pad(a.map((x) => ({ head: label(x), body: x.head ? x.body : "" })), 4, () => ({ head: "", body: "" })).slice(0, 12) } };
    case "kpi": {
      const stats = a.map((x) => {
        const [lab, ...note] = x.body.split(/[：:]\s*/);
        return { value: x.head || pickFigureLoose(x.body), label: (x.head ? lab : x.body).trim(), note: x.head ? note.join("：").trim() : "" };
      });
      return { kpi: { stats: pad(stats, 2, () => ({ value: "", label: "", note: "" })).slice(0, 4) } };
    }
    case "statement":
      return { statement: { figure: a[0]?.head ?? "", lead: a.map((x) => x.body).filter(Boolean).join("　") } };
    case "cover":
      return { cover: { subtitle: a[0]?.body ?? "", meta: "" } };
    case "closing":
      return { closing: { asks: pad(a.map((x) => (x.head ? `${x.head}：${x.body}` : x.body)), 2, () => "").slice(0, 5) } };
    case "free":
      return { free: {} };
  }
}

/**
 * ページ内の論理を切り替える。前に同じレイアウトで書いた中身があればそれを戻し、
 * 無ければ今の中身から組み立てる。元の中身は消さずに残すので、行き来しても失われない。
 */
export function switchLayout(slide: Slide, to: LayoutId): Slide {
  if (slide.layout === to) return slide;
  const kept = slide.content[to];
  const content: SlideContent = { ...slide.content, ...(kept ? {} : buildContent(to, atomsOf(slide))) };
  return { ...slide, layout: to, content };
}

/** 外から来たスライド（AI の出力など）の数の食い違いを直す。足りない項目は空欄で埋め、多すぎれば上限で切る */
export function normalizeSlide(slide: Slide): Slide {
  const c = { ...slide.content };
  const clamp = (n: number, max: number) => Math.max(0, Math.min(max, Number.isFinite(n) ? Math.round(n) : 0));
  if (c.matrix) {
    const cells = pad(c.matrix.cells ?? [], 4, () => ({ head: "", body: "" })).slice(0, 4);
    c.matrix = { ...c.matrix, cells, highlight: clamp(c.matrix.highlight, 3) };
  }
  if (c.compare) {
    const columns = (c.compare.columns ?? []).slice(0, 4);
    const rows = (c.compare.rows ?? []).slice(0, 6).map((r) => ({ label: r.label ?? "", cells: pad(r.cells ?? [], columns.length, () => "").slice(0, columns.length) }));
    c.compare = { ...c.compare, columns, rows, highlight: clamp(c.compare.highlight, Math.max(0, columns.length - 1)), takeaways: (c.compare.takeaways ?? []).slice(0, 4) };
  }
  if (c.claim3) c.claim3 = { points: (c.claim3.points ?? []).slice(0, 4) };
  if (c.steps) c.steps = { steps: (c.steps.steps ?? []).slice(0, 5) };
  if (c.issue) c.issue = { pairs: (c.issue.pairs ?? []).slice(0, 5) };
  if (c.closing) c.closing = { asks: (c.closing.asks ?? []).slice(0, 5) };
  if (c.premise) c.premise = { ...c.premise, premises: (c.premise.premises ?? []).slice(0, 4) };
  if (c.chart) {
    const cats = (c.chart.categories ?? []).slice(0, 12);
    const series = (c.chart.series ?? []).slice(0, 3).map((sr) => ({ name: sr.name ?? "", values: pad((sr.values ?? []).map((v) => (Number.isFinite(v) ? v : 0)), cats.length, () => 0).slice(0, cats.length) }));
    c.chart = { ...c.chart, categories: cats, series: series.length ? series : [{ name: "", values: cats.map(() => 0) }], highlight: Math.max(-1, Math.min(cats.length - 1, Math.round(c.chart.highlight ?? -1))), unit: c.chart.unit ?? "", takeaway: c.chart.takeaway ?? "" };
  }
  // ref（指すページの id）は残す。ページ番号は描くときに今の並びから数える
  const ref = (r: unknown) => (typeof r === "string" && r ? { ref: r } : {});
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as T[]) : []);
  if (c.agenda) {
    const items = arr<{ head?: unknown; page?: unknown; ref?: unknown }>(c.agenda.items).slice(0, 12);
    c.agenda = { items: items.map((p) => ({ head: str(p.head), page: str(p.page), ...ref(p.ref) })), current: Number.isFinite(Number(c.agenda.current)) ? Math.max(-1, Math.min(items.length - 1, Math.round(Number(c.agenda.current)))) : -1 };
  }
  if (c.grid) c.grid = { cards: arr<{ head?: unknown; body?: unknown }>(c.grid.cards).slice(0, 12).map((p) => ({ head: str(p.head), body: str(p.body) })) };
  if (c.kpi) c.kpi = { stats: arr<{ value?: unknown; label?: unknown; note?: unknown }>(c.kpi.stats).slice(0, 4).map((p) => ({ value: str(p.value), label: str(p.label), note: str(p.note) })) };
  if (c.summary) c.summary = { points: arr<{ head?: unknown; body?: unknown; page?: unknown; ref?: unknown }>(c.summary.points).slice(0, 4).map((p) => ({ head: str(p.head), body: str(p.body), page: str(p.page), ...ref(p.ref) })) };
  // 型の名前の欄が物でなければ（壊れたファイル）、空の中身にする
  if (c[slide.layout] !== undefined && (typeof c[slide.layout] !== "object" || c[slide.layout] === null)) delete c[slide.layout];
  if (!c[slide.layout]) Object.assign(c, buildContent(slide.layout, []));
  return { ...slide, content: c };
}

/** 大きな数字の文字の大きさ。4つ並べるときや「2% → 5%」のような長い数字は小さく（折り返さない） */
export function kpiSize(v: string, n: number): number {
  const len = [...v].length;
  if (n > 3) return len > 9 ? 34 : len > 5 ? 42 : 64;
  if (n === 3) return len > 9 ? 44 : len > 6 ? 54 : 80;
  return len > 9 ? 60 : 80;
}
