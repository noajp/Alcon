import { inlineDeck } from "@/ActivitySpace/artifacts/slides/deckAssets";
import type { Deck, LookTokens, Slide } from "@/ActivitySpace/artifacts/slides/kata/model/types";
import { contrast } from "@/ActivitySpace/artifacts/slides/kata/theme/mix";
import { isNumericHead } from "@/ActivitySpace/artifacts/slides/kata/model/figure";
import { formatValue, waterfallSteps } from "@/ActivitySpace/artifacts/slides/kata/model/chart";
import { deckLang, summaryPage } from "@/ActivitySpace/artifacts/slides/kata/model/deck";
import { kpiSize } from "@/ActivitySpace/artifacts/slides/kata/model/layouts";
import { mixHex } from "@/ActivitySpace/artifacts/slides/kata/theme/custom";
import { hexColor, isLineKind, pptxFont } from "@/ActivitySpace/artifacts/slides/kata/model/objects";

const mixForPptx = (a: string, b: string, t: number) => mixHex(a, b, t);
import { roleLabel, tx, type Lang } from "@/ActivitySpace/artifacts/slides/kata/i18n";

const contrastOk = (t: LookTokens) => contrast(t.accent.accent, t.number.block) > 1.3;

// 画面と同じ 1280×720 の座標で組み、インチに直して PowerPoint の図形と文字にする。
// 文字はすべて編集できるまま残す。

const IN = (px: number) => px / 96;
const hex = (c: string) => c.replace("#", "").slice(0, 6).toUpperCase();

type Pptx = InstanceType<typeof import("pptxgenjs").default>;
type PSlide = ReturnType<Pptx["addSlide"]>;

interface Ctx {
  pptx: Pptx;
  s: PSlide;
  t: LookTokens;
  display: string;
  body: string;
  styles?: Slide["styles"];
  /** 資料の言語（スライドに刷る決まり文句に使う） */
  st: (ja: string, en: string) => string;
  lang: Lang;
  /** 資料の全ページ（サマリーの「p.N」を今の並びから出すため） */
  slides?: Slide[];
}

/** 箱に収まる文字の大きさを見積もる。全角1字を文字の大きさ分の幅として数え、行数×行の高さが箱を超えたら縮める */
export function fitSize(value: string, w: number, h: number, size: number, lineSpacing = 1.25, min = 0.6): number {
  const width = (ch: string) => (/[\u0000-\u00ff]/.test(ch) ? 0.55 : 1);
  let s = size;
  for (let i = 0; i < 12; i++) {
    const perLine = Math.max(1, Math.floor(w / s));
    let lines = 0;
    for (const para of (value || "").split("\n")) {
      const units = [...para].reduce((a, ch) => a + width(ch), 0);
      lines += Math.max(1, Math.ceil(units / perLine));
    }
    if (lines * s * lineSpacing <= h || s <= size * min) break;
    s = Math.max(size * min, s * 0.92);
  }
  return Math.round(s * 10) / 10;
}

function text(c: Ctx, value: string, x: number, y: number, w: number, h: number, o0: { key?: string; size: number; bold?: boolean; color?: string; font?: string; align?: "left" | "center" | "right"; valign?: "top" | "middle" | "bottom"; fill?: string; mono?: boolean; lineSpacing?: number; vertical?: boolean }) {
  // 画面で文字の見た目を変えていれば、それを当てる
  const over = o0.key ? c.styles?.[o0.key] : undefined;
  const o = over
    ? {
        ...o0,
        size: over.size ?? o0.size,
        bold: over.bold ?? o0.bold,
        color: (over.color && hexColor(over.color, c.t)) || o0.color,
        font: pptxFont(over.font, c.display, c.body) ?? o0.font,
        mono: over.font ? over.font === "mono" : o0.mono,
        align: over.align ?? o0.align,
      }
    : o0;
  c.s.addText(value || "", {
    italic: over?.italic,
    underline: over?.underline ? { style: "sng" } : undefined,
    x: IN(x),
    y: IN(y),
    w: IN(w),
    h: IN(h),
    fontSize: fitSize(value, w, h, o.size, o.lineSpacing ?? 1.25) * 0.75,
    bold: o.bold,
    color: hex(o.color ?? c.t.ground.ink),
    fontFace: o.mono ? "Consolas" : (o.font ?? c.body),
    align: o.align ?? "left",
    valign: o.valign ?? "top",
    fill: o.fill ? { color: hex(o.fill) } : undefined,
    margin: o.fill ? 10 : 0,
    lineSpacingMultiple: o.lineSpacing ?? 1.25,
    fit: "shrink",
    vert: o.vertical ? "eaVert" : undefined,
  });
}

function rect(c: Ctx, x: number, y: number, w: number, h: number, color: string, round = false) {
  c.s.addShape(round ? "roundRect" : "rect", {
    x: IN(x),
    y: IN(y),
    w: IN(w),
    h: IN(h),
    fill: { color: hex(color) },
    line: { type: "none" },
    // pptxgenjs の rectRadius はインチ。画面と同じく 24px で頭打ちにする
    rectRadius: round ? Math.min(IN(Math.min(c.t.shape.radius, 24)), IN(Math.min(w, h)) / 2) : undefined,
  });
}

function vline(c: Ctx, x: number, y: number, h: number, color: string, weight = 1) {
  c.s.addShape("line", { x: IN(x), y: IN(y), w: 0, h: IN(h), line: { color: hex(color), width: weight } });
}

function line(c: Ctx, x: number, y: number, w: number, color: string, weight = 1) {
  c.s.addShape("line", { x: IN(x), y: IN(y), w: IN(w), h: 0, line: { color: hex(color), width: weight } });
}

function chrome(c: Ctx, slide: Slide, i: number, role: string) {
  rect(c, 80, 62, 8, 8, c.t.accent.accent);
  text(c, `${String(i + 1).padStart(2, "0")}${role ? `  —  ${roleLabel(role, c.lang)}` : ""}`, 98, 56, 600, 20, { size: 13, color: c.t.ground.sub, mono: true });
  text(c, slide.title, 80, 84, 1080, 110, { key: "title", size: slide.title.length > 40 ? 34 : 38, bold: c.t.type.weight >= 600, font: c.display, lineSpacing: 1.2 });
  rect(c, 80, 200, 56, 4, c.t.accent.accent);
  if (slide.source) text(c, slide.source, 80, 668, 800, 20, { size: 12, color: c.t.ground.sub });
  text(c, String(i + 1).padStart(2, "0"), 1100, 668, 100, 20, { size: 12, color: c.t.ground.sub, mono: true, align: "right" });
}

const TOP = 240;
const BOTTOM = 650;

function body(c: Ctx, slide: Slide) {
  const k = slide.content;
  const H = BOTTOM - TOP;
  switch (slide.layout) {
    case "statement": {
      const x = k.statement!;
      rect(c, 80, TOP, 420, H, c.t.number.block, c.t.shape.radius > 0);
      text(c, x.figure, 100, TOP, 380, H, { key: "content.statement.figure", size: x.figure.length > 6 ? 56 : 88, bold: true, color: c.t.number.num, align: "center", valign: "middle", font: c.display });
      text(c, x.lead, 548, TOP, 652, H, { key: "content.statement.lead", size: 26, valign: "middle", lineSpacing: 1.5 });
      break;
    }
    case "compare": {
      const x = k.compare!;
      const hasTake = x.takeaways.length > 0;
      const tableW = hasTake ? 1120 - 344 : 1120;
      const n = Math.max(1, x.columns.length);
      const labelW = 170;
      const colW = (tableW - labelW) / n;
      const rowH = Math.min(84, (H - 52) / Math.max(1, x.rows.length));
      rect(c, 80 + labelW + colW * x.highlight, TOP, colW, 52 + rowH * x.rows.length, c.t.accent.tint);
      x.columns.forEach((col, i) => text(c, col, 80 + labelW + colW * i + 16, TOP + 12, colW - 24, 34, { key: `content.compare.columns.${i}`, size: 19, bold: true }));
      line(c, 80, TOP + 52, tableW, c.t.ground.ink, 2);
      x.rows.forEach((r, ri) => {
        const y = TOP + 52 + rowH * ri;
        text(c, r.label, 80, y + 14, labelW - 10, rowH - 20, { key: `content.compare.rows.${ri}.label`, size: 15, color: c.t.ground.sub, bold: true });
        r.cells.forEach((cell, ci) => text(c, cell, 80 + labelW + colW * ci + 16, y + 14, colW - 28, rowH - 20, { key: `content.compare.rows.${ri}.cells.${ci}`, size: x.rows.length > 4 ? 15 : 17, bold: ci === x.highlight }));
        if (ri < x.rows.length - 1) line(c, 80, y + rowH, tableW, c.t.ground.line);
      });
      if (hasTake) {
        const lx = 80 + tableW + 44;
        vline(c, lx - 12, TOP, H, c.t.ground.line);
        text(c, "SO WHAT", lx + 20, TOP, 280, 20, { size: 12, color: c.t.ground.sub, mono: true });
        x.takeaways.forEach((tk, i) => {
          rect(c, lx + 20, TOP + 44 + i * 96 + 9, 6, 6, c.t.accent.accent);
          text(c, tk, lx + 38, TOP + 36 + i * 96, 262, 88, { key: `content.compare.takeaways.${i}`, size: 17 });
        });
      }
      break;
    }
    case "premise": {
      const x = k.premise!;
      const rowH = H / Math.max(1, x.premises.length);
      line(c, 80, TOP, 640, c.t.ground.line);
      x.premises.forEach((p, i) => {
        text(c, String(i + 1).padStart(2, "0"), 80, TOP + rowH * i + 26, 40, 24, { size: 14, color: c.t.ground.sub, mono: true });
        text(c, p, 130, TOP + rowH * i + 20, 590, rowH - 30, { key: `content.premise.premises.${i}`, size: 22, valign: "middle" });
        line(c, 80, TOP + rowH * (i + 1), 640, c.t.ground.line);
      });
      text(c, "→", 740, TOP, 40, H, { size: 32, color: c.t.ground.sub, align: "center", valign: "middle" });
      rect(c, 800, TOP, 400, H, c.t.number.block, c.t.shape.radius > 0);
      text(c, "THEREFORE", 836, TOP + 44, 320, 20, { size: 12, color: c.t.number.num, mono: true });
      text(c, x.figure, 836, TOP + 80, 330, 120, { key: "content.premise.figure", size: 48, bold: true, color: c.t.number.num, font: c.display });
      text(c, x.conclusion, 836, TOP + 210, 330, H - 240, { key: "content.premise.conclusion", size: 20, color: c.t.number.num });
      break;
    }
    case "claim3": {
      const items = k.claim3!.points;
      const n = Math.max(1, items.length);
      const gap = 24;
      const w = (1120 - gap * (n - 1)) / n;
      const numeric = items.length > 0 && items.every((p) => isNumericHead(p.head));
      // 画面と同じく、カードの列を本文の高さの中央に置く
      const cardH = Math.max(...items.map((p) => Math.max(250, 86 + (numeric ? 70 : 84) + 14 + Math.min(H - (numeric ? 204 : 218), Math.max(60, Math.ceil(((p.body || "").length * 18) / (w - 60)) * 26 + 10)) + 34)));
      const TOP0 = TOP;
      const TOPc = TOP0 + Math.max(0, (H - cardH) / 2);
      items.forEach((p, i) => {
        const TOP = TOPc;
        const x = 80 + (w + gap) * i;
        const bodyH = Math.min(H - (numeric ? 204 : 218), Math.max(60, Math.ceil(((p.body || "").length * 18) / (w - 60)) * 26 + 10));
        rect(c, x, TOP, w, Math.max(250, 86 + (numeric ? 70 : 84) + 14 + bodyH + 34), c.t.accent.tint, c.t.shape.radius > 0);
        text(c, String(i + 1).padStart(2, "0"), x + 30, TOP + 28, 80, 20, { size: 14, color: c.t.ground.sub, mono: true });
        c.s.addShape(c.t.shape.radius >= 100 ? "ellipse" : "rect", { x: IN(x + w - 40), y: IN(TOP + 32), w: IN(10), h: IN(10), fill: { color: hex(c.t.number.block), transparency: i === 0 ? 0 : 78 }, line: { type: "none" } });
        rect(c, x + 30, TOP + 66, 32, 3, c.t.accent.accent);
        const hs = numeric ? (p.head.length > 7 ? 46 : 60) : p.head.length > 12 ? 26 : 30;
        const hh = numeric ? 70 : 84;
        text(c, p.head, x + 30, TOP + 86, w - 60, hh, { key: `content.claim3.points.${i}.head`, size: hs, bold: true, font: c.display });
        text(c, p.body, x + 30, TOP + 86 + hh + 14, w - 60, bodyH, { key: `content.claim3.points.${i}.body`, size: 18, color: c.t.ground.sub, lineSpacing: 1.45 });
      });
      break;
    }
    case "steps": {
      const items = k.steps!.steps;
      const n = Math.max(1, items.length);
      const gap = 24;
      const w = (1120 - gap * (n - 1)) / n;
      items.forEach((p, i) => {
        const x = 80 + (w + gap) * i;
        rect(c, x, TOP + 40, 60, 60, c.t.number.block, c.t.shape.radius > 0);
        if (i < n - 1) line(c, x + 76, TOP + 70, w - 76 + gap - 16, c.t.ground.line, 1.5);
        text(c, String(i + 1).padStart(2, "0"), x, TOP + 40, 60, 60, { size: 22, bold: true, color: c.t.number.num, align: "center", valign: "middle", font: c.display });
        text(c, p.head, x, TOP + 120, w, 70, { key: `content.steps.steps.${i}.head`, size: 28, bold: true, font: c.display });
        text(c, p.body, x, TOP + 196, w, H - 220, { key: `content.steps.steps.${i}.body`, size: 17, color: c.t.ground.sub, lineSpacing: 1.45 });
      });
      break;
    }
    case "issue": {
      const pairs = k.issue!.pairs;
      text(c, c.st("ISSUE — 課題", "ISSUE"), 80, TOP, 400, 20, { size: 12, color: c.t.ground.sub, mono: true });
      text(c, c.st("ACTION — 打ち手", "ACTION"), 668, TOP, 400, 20, { size: 12, color: c.t.ground.sub, mono: true });
      const rowH = (H - 36) / Math.max(1, pairs.length);
      pairs.forEach((p, i) => {
        const y = TOP + 34 + rowH * i;
        c.s.addShape("rect", { x: IN(80), y: IN(y), w: IN(532), h: IN(rowH - 14), fill: { color: hex(c.t.ground.bg) }, line: { color: hex(c.t.ground.line), width: 1 } });
        text(c, p.issue, 102, y + 10, 490, rowH - 34, { key: `content.issue.pairs.${i}.issue`, size: 18, valign: "middle" });
        text(c, "→", 612, y, 56, rowH - 14, { size: 20, color: c.t.ground.sub, align: "center", valign: "middle" });
        rect(c, 668, y, 532, rowH - 14, c.t.accent.tint);
        text(c, p.action, 690, y + 10, 490, rowH - 34, { key: `content.issue.pairs.${i}.action`, size: 18, bold: true, valign: "middle" });
      });
      break;
    }
    case "matrix": {
      const x = k.matrix!;
      const gx = 120;
      const gw = 1080;
      const gh = H - 40;
      const cw = (gw - 10) / 2;
      const ch = (gh - 10) / 2;
      x.cells.slice(0, 4).forEach((cell, i) => {
        const cx = gx + (i % 2) * (cw + 10);
        const cy = TOP + Math.floor(i / 2) * (ch + 10);
        const on = i === x.highlight;
        rect(c, cx, cy, cw, ch, on ? c.t.number.block : c.t.accent.tint, c.t.shape.radius > 0);
        text(c, cell.head, cx + 24, cy + 20, cw - 48, 34, { key: `content.matrix.cells.${i}.head`, size: 22, bold: true, color: on ? c.t.number.num : c.t.ground.ink, font: c.display });
        text(c, cell.body, cx + 24, cy + 62, cw - 48, ch - 80, { key: `content.matrix.cells.${i}.body`, size: 15, color: on ? c.t.number.num : c.t.ground.sub });
      });
      text(c, x.y.high, 80, TOP, 30, gh / 2 - 20, { size: 12, color: c.t.ground.sub, vertical: true });
      text(c, x.y.low, 80, TOP + gh / 2 + 20, 30, gh / 2 - 20, { size: 12, color: c.t.ground.sub, vertical: true, valign: "bottom" });
      vline(c, 95, TOP + gh / 2 - 16, 32, c.t.ground.line, 1.5);
      text(c, x.x.low, gx, TOP + gh + 12, 200, 20, { size: 12, color: c.t.ground.sub, mono: true });
      text(c, x.x.high, gx + gw - 200, TOP + gh + 12, 200, 20, { size: 12, color: c.t.ground.sub, mono: true, align: "right" });
      line(c, gx + 210, TOP + gh + 22, gw - 420, c.t.ground.line, 1.5);
      break;
    }
    case "chart": {
      const x = k.chart!;
      const cw = 760;
      // so what は右に
      vline(c, 80 + cw + 24, TOP, H, c.t.ground.line);
      text(c, "SO WHAT", 80 + cw + 52, TOP + 110, 300, 20, { size: 12, color: c.t.ground.sub, mono: true });
      text(c, x.takeaway, 80 + cw + 52, TOP + 138, 1200 - (80 + cw + 52), H - 150, { key: "content.chart.takeaway", size: 20, bold: true });
      const faint = mixForPptx(c.t.ground.ink, c.t.ground.bg, 0.8);
      const mid = mixForPptx(c.t.ground.ink, c.t.ground.bg, 0.55);
      // 項目や値が空のグラフは pptxgenjs が落ちるので、グラフの代わりに一言だけ置く
      if (!x.categories.length || !x.series.some((sr) => sr.values.length)) {
        text(c, tx("（グラフのデータがありません）", "(No chart data)"), 80, TOP + H / 2 - 14, cw, 28, { size: 16, color: c.t.ground.sub, align: "center" });
        break;
      }
      if (x.kind === "waterfall") {
        const steps = waterfallSteps(x.series[0]?.values ?? []);
        const labels = [...x.categories, c.st("合計", "Total")];
        const hi = Math.max(1, ...steps.flatMap((st) => [st.start, st.end]));
        const lo = Math.min(0, ...steps.flatMap((st) => [st.start, st.end]));
        const base = TOP + H - 40;
        const yy = (v: number) => base - ((v - lo) / (hi - lo || 1)) * (H - 80);
        const colW = cw / steps.length;
        steps.forEach((st, i) => {
          const bx = 80 + i * colW + colW * 0.18;
          const top = yy(Math.max(st.start, st.end));
          const h = Math.max(2, Math.abs(yy(st.start) - yy(st.end)));
          rect(c, bx, top, colW * 0.64, h, st.total ? c.t.number.block : st.delta >= 0 ? mid : faint);
          text(c, `${!st.total && st.delta > 0 ? "+" : ""}${formatValue(st.total ? st.end : st.delta, x.unit)}`, bx - 20, top - 26, colW * 0.64 + 40, 22, { size: 14, bold: st.total, align: "center" });
          text(c, labels[i] ?? "", bx - 20, base + 8, colW * 0.64 + 40, 22, { size: 13, color: c.t.ground.sub, align: "center" });
        });
        break;
      }
      const CT = c.pptx.ChartType;
      const colors = x.categories.map((_, i) => hex(x.highlight < 0 || i === x.highlight ? c.t.number.block : faint));
      const common = {
        x: IN(80), y: IN(TOP), w: IN(cw), h: IN(H),
        catAxisLabelColor: hex(c.t.ground.sub), valAxisLabelColor: hex(c.t.ground.sub), catAxisLabelFontSize: 11, valAxisLabelFontSize: 10,
        valGridLine: { style: "none" as const }, showLegend: x.series.length > 1, legendPos: "b" as const, legendFontSize: 11,
        dataLabelColor: hex(c.t.ground.ink), dataLabelFontSize: 12, catAxisLabelFontFace: c.body, valAxisLabelFontFace: c.body,
      };
      if (x.kind === "scatter") {
        const data = [{ name: x.series[0]?.name || "X", values: x.series[0]?.values ?? [] }, { name: x.series[1]?.name || "Y", values: x.series[1]?.values ?? [], labels: x.categories }];
        c.s.addChart(CT.scatter, data, { ...common, showLegend: false, lineSize: 0, lineDataSymbolSize: 10, chartColors: [hex(c.t.number.block)], showLabel: true, dataLabelFormatScatter: "custom" });
        break;
      }
      if (x.kind === "share") {
        const data = x.categories.map((cat, i) => ({ name: cat, labels: [""], values: [x.series[0]?.values[i] ?? 0] }));
        c.s.addChart(CT.bar, data, { ...common, barDir: "bar", barGrouping: "percentStacked", showLegend: true, showValue: true, chartColors: x.categories.map((_, i) => hex(i === x.highlight ? c.t.number.block : i % 2 ? faint : mid)), valAxisHidden: true, catAxisHidden: true });
        break;
      }
      const data = x.series.map((sr) => ({ name: sr.name || " ", labels: x.categories, values: sr.values }));
      if (x.kind === "line") {
        c.s.addChart(CT.line, data, { ...common, lineSize: 3, lineDataSymbolSize: 7, chartColors: [hex(c.t.number.block), mid, faint], valAxisHidden: false });
      } else {
        c.s.addChart(CT.bar, data, { ...common, barDir: x.kind === "bar" ? "bar" : "col", showValue: true, chartColors: x.series.length > 1 ? [hex(c.t.number.block), mid, faint] : colors, valAxisHidden: true, barGapWidthPct: 60, ...(x.kind === "bar" ? { catAxisOrientation: "maxMin" as never } : {}) });
      }
      break;
    }
    case "summary": {
      const pts = k.summary!.points;
      line(c, 80, TOP, 1120, c.t.ground.ink, 2);
      const rowH = Math.min(96, H / Math.max(1, pts.length));
      pts.forEach((p, i) => {
        const y = TOP + rowH * i;
        text(c, String(i + 1).padStart(2, "0"), 80, y + 18, 60, 34, { size: 26, bold: true, font: c.display });
        text(c, p.head, 150, y + 18, 380, rowH - 30, { key: `content.summary.points.${i}.head`, size: 20, bold: true });
        text(c, p.body, 560, y + 20, 560, rowH - 30, { key: `content.summary.points.${i}.body`, size: 17, color: c.t.ground.sub });
        text(c, summaryPage(p, c.slides), 1130, y + 22, 70, 20, { size: 12, color: c.t.ground.sub, mono: true, align: "right" });
        line(c, 80, y + rowH, 1120, c.t.ground.line);
      });
      break;
    }
    case "agenda": {
      const x = k.agenda!;
      const divider = x.current >= 0;
      line(c, 80, TOP, 1120, c.t.ground.ink, 2);
      const rowH = Math.min(70, H / Math.max(1, x.items.length));
      x.items.forEach((it, i) => {
        const y = TOP + rowH * i;
        const on = i === x.current;
        const col = on ? c.t.number.num : divider ? mixForPptx(c.t.ground.sub, c.t.ground.bg, 0.45) : c.t.ground.ink;
        if (on) rect(c, 80, y + 2, 1120, rowH - 4, c.t.number.block, c.t.shape.radius > 0);
        text(c, String(i + 1).padStart(2, "0"), on ? 100 : 80, y, 70, rowH, { size: 28, bold: true, font: c.display, color: col, valign: "middle" });
        text(c, it.head, on ? 172 : 152, y, 900, rowH, { key: `content.agenda.items.${i}.head`, size: x.items.length > 6 ? 22 : 26, bold: true, font: c.display, color: col, valign: "middle" });
        text(c, summaryPage(it, c.slides), 1090, y, 90, rowH, { size: 14, mono: true, color: col, align: "right", valign: "middle" });
        if (!on) line(c, 80, y + rowH, 1120, c.t.ground.line);
      });
      break;
    }
    case "grid": {
      const cards = k.grid!.cards;
      const n = cards.length;
      const cols = n <= 4 ? Math.max(2, n) : n <= 6 ? 3 : n <= 8 ? 4 : n === 9 ? 3 : 4;
      const rows = Math.ceil(n / cols);
      const gap = n > 6 ? 14 : 20;
      const w = (1120 - gap * (cols - 1)) / cols;
      const h = Math.min(220, (H - gap * (rows - 1)) / rows);
      const y0 = TOP + (H - (h * rows + gap * (rows - 1))) / 2;
      cards.forEach((p, i) => {
        const x = 80 + (w + gap) * (i % cols);
        const y = y0 + (h + gap) * Math.floor(i / cols);
        rect(c, x, y, w, h, c.t.accent.tint, c.t.shape.radius > 0);
        rect(c, x, y, w, 3, c.t.accent.accent);
        text(c, String(i + 1).padStart(2, "0"), x + 18, y + 16, 36, 20, { size: 12, mono: true, color: c.t.ground.sub });
        if (p.head) {
          text(c, p.head, x + 52, y + 12, w - 70, 52, { key: `content.grid.cards.${i}.head`, size: n > 9 ? 17 : n > 6 ? 19 : 23, bold: true, font: c.display });
          text(c, p.body, x + 18, y + 66, w - 36, h - 78, { key: `content.grid.cards.${i}.body`, size: n > 9 ? 13 : n > 6 ? 14 : 16, color: c.t.ground.sub, lineSpacing: 1.4 });
        } else {
          // 見出しの無いカードは、文をそのまま主役にする
          text(c, p.body, x + 52, y + 14, w - 70, h - 26, { key: `content.grid.cards.${i}.body`, size: n > 6 ? 16 : 19, bold: true, lineSpacing: 1.4 });
        }
      });
      break;
    }
    case "kpi": {
      const stats = k.kpi!.stats;
      const n = Math.max(1, stats.length);
      const w = 1120 / n;
      stats.forEach((p, i) => {
        const x = 80 + w * i;
        if (i) vline(c, x, TOP + 40, H - 80, c.t.ground.line);
        const px = i ? x + 32 : x;
        const ww = w - (i ? 56 : 32);
        text(c, p.value, px, TOP + 50, ww, 110, { key: `content.kpi.stats.${i}.value`, size: kpiSize(p.value, n), bold: true, font: c.display, color: i === 0 ? c.t.number.block : c.t.ground.ink, valign: "bottom" });
        rect(c, px, TOP + 176, 40, 4, c.t.accent.accent);
        text(c, p.label, px, TOP + 196, ww, 64, { key: `content.kpi.stats.${i}.label`, size: 21, bold: true });
        text(c, p.note, px, TOP + 266, ww, H - 290, { key: `content.kpi.stats.${i}.note`, size: 16, color: c.t.ground.sub, lineSpacing: 1.45 });
      });
      break;
    }
    case "closing": {
      const asks = k.closing!.asks;
      line(c, 80, TOP, 812, c.t.ground.ink, 2);
      const rowH = H / Math.max(1, asks.length);
      asks.forEach((a, i) => {
        text(c, String(i + 1).padStart(2, "0"), 80, TOP + rowH * i + 22, 70, 48, { size: 40, bold: true, font: c.display });
        text(c, a, 172, TOP + rowH * i + 20, 720, rowH - 30, { key: `content.closing.asks.${i}`, size: 24, bold: true, valign: "middle" });
        line(c, 80, TOP + rowH * (i + 1), 812, c.t.ground.line);
      });
      rect(c, 940, TOP, 260, H, c.t.accent.accent, c.t.shape.radius > 0);
      text(c, "NEXT", 972, BOTTOM - 120, 200, 20, { size: 12, color: c.t.accent.onAccent, mono: true });
      text(c, c.st("お願いしたいこと", "Our asks"), 972, BOTTOM - 96, 210, 80, { size: 36, bold: true, color: c.t.accent.onAccent, font: c.display });
      break;
    }
    default:
      break;
  }
}

function cover(c: Ctx, slide: Slide) {
  const x = slide.content.cover ?? { subtitle: "", meta: "" };
  rect(c, 900, 0, 380, 720, c.t.number.block);
  c.s.addShape(c.t.shape.radius >= 100 ? "ellipse" : "rect", { x: IN(770), y: IN(120), w: IN(260), h: IN(260), fill: { color: hex(contrastOk(c.t) ? c.t.accent.accent : c.t.accent.tint) }, line: { type: "none" } });
  text(c, x.meta, 88, 72, 700, 24, { key: "content.cover.meta", size: 14, color: c.t.ground.sub, mono: true });
  text(c, slide.title, 88, 300, 700, 200, { key: "title", size: slide.title.length > 22 ? 52 : 64, bold: true, font: c.display, valign: "bottom", lineSpacing: 1.15 });
  rect(c, 88, 528, 72, 5, c.t.accent.accent);
  text(c, x.subtitle, 88, 556, 660, 100, { key: "content.cover.subtitle", size: 22, color: c.t.ground.sub });
}

/** 自由に置いたもの。behind は型の文字の前に描く（後ろに回る） */
function objects(c: Ctx, slide: Slide, behind: boolean) {
  for (const o of slide.objects ?? []) {
    if (!!o.behind !== behind) continue;
    const fill = hexColor(o.fill, c.t);
    const stroke = hexColor(o.stroke, c.t);
    const lineOpt = stroke && o.strokeWidth > 0 ? { color: hex(stroke), width: o.strokeWidth * 0.75, dashType: o.dash ? ("dash" as const) : ("solid" as const) } : { type: "none" as const };
    if (isLineKind(o.kind)) {
      // 線は四角の対角で表す。向きは flipH / flipV で
      c.s.addShape("line", {
        x: IN(Math.min(o.x, o.x + o.w)),
        y: IN(Math.min(o.y, o.y + o.h)),
        w: IN(Math.abs(o.w)),
        h: IN(Math.abs(o.h)),
        flipH: o.w < 0,
        flipV: o.h < 0,
        line: { color: hex(stroke ?? c.t.ground.ink), width: Math.max(1, o.strokeWidth) * 0.75, dashType: o.dash ? "dash" : "solid", endArrowType: o.kind === "arrow" ? "triangle" : undefined },
      });
      continue;
    }
    if (o.kind === "image") {
      if (o.src) {
        // 画面と同じく枠いっぱいに切り抜く。元の縦横比で枠を覆う大きさを渡す
        const r = o.ratio && o.ratio > 0 ? o.ratio : o.w / o.h;
        const iw = Math.max(o.w, o.h * r);
        const ih = iw / r;
        c.s.addImage({ data: o.src, x: IN(o.x), y: IN(o.y), w: IN(iw), h: IN(ih), sizing: { type: "cover", w: IN(o.w), h: IN(o.h) } });
      }
      continue;
    }
    const ts = o.textStyle ?? {};
    const isText = o.kind === "text";
    const shape = o.kind === "ellipse" ? "ellipse" : o.kind === "rect" && (o.radius ?? 0) > 0 ? "roundRect" : "rect";
    const color = hexColor(ts.color, c.t) ?? (isText ? c.t.ground.ink : o.fill === "block" ? c.t.number.num : o.fill === "accent" ? c.t.accent.onAccent : c.t.ground.ink);
    c.s.addText(o.text ?? "", {
      shape,
      x: IN(o.x),
      y: IN(o.y),
      w: IN(o.w),
      h: IN(o.h),
      fill: fill ? { color: hex(fill) } : undefined,
      line: lineOpt,
      rectRadius: shape === "roundRect" ? Math.min(IN(o.radius ?? 0), IN(Math.min(o.w, o.h)) / 2) : undefined,
      fontSize: (ts.size ?? 24) * 0.75,
      fontFace: pptxFont(ts.font, c.display, c.body) ?? c.body,
      bold: ts.bold,
      italic: ts.italic,
      underline: ts.underline ? { style: "sng" } : undefined,
      color: hex(color),
      align: ts.align ?? (isText ? "left" : "center"),
      valign: isText ? "top" : "middle",
      margin: isText ? 3 : 12,
      lineSpacingMultiple: 1.3,
    });
  }
}

export async function exportPptx(deck: Deck, t: LookTokens, roles: string[], fileName: string) {
  // 保存先に移した画像は、ファイルに入れるため中身に戻す
  deck = await inlineDeck(deck);
  const { default: PptxGenJS } = await import("pptxgenjs");
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.title = deck.title;
  const serif = t.type.display.includes("serif") && !t.type.display.includes("sans-serif");
  const display = serif ? "Yu Mincho" : "Yu Gothic";
  deck.slides.forEach((slide, i) => {
    const s = pptx.addSlide();
    s.background = { color: hex(t.ground.bg) };
    const lang = deckLang(deck);
    const c: Ctx = { pptx, s, t, display, body: "Yu Gothic", styles: slide.styles, slides: deck.slides, lang, st: (ja, en) => (lang === "ja" ? ja : en) };
    objects(c, slide, true);
    if (slide.layout === "cover") cover(c, slide);
    else if (slide.layout !== "free") {
      chrome(c, slide, i, roles[i] ?? "");
      body(c, slide);
    }
    objects(c, slide, false);
  });
  await pptx.writeFile({ fileName: `${fileName || deck.title}.pptx` });
}
