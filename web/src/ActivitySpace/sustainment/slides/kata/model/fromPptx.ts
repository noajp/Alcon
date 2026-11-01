import type { Deck as PptxDeck, DeckItem, DeckSlide, Para, Run, TextBody } from "@/Function/office/deckLayout";
import type { ChartData } from "@/Function/office/chartLayout";
import type { ChartContent, ChartKind, ColorRef, Deck, FontRef, Slide, SlideObject, TextStyle } from "./types";
import { newId } from "./id";

// PowerPoint のデッキを Slides のデッキにする。型には当てはめず、ページごとに
// 図形・文字・画像・表を元の位置のまま「自由配置」のページに置く（取り込んだ後は
// 置いたものとして動かし、打ち直せる）。大きさは 1280×720 に収まるよう縦横同じ倍率で
// 縮め、余りは中央に寄せる。グラフは数字ごと「グラフ」の型のページにする：グラフと
// 文字だけのページはそのページを、ほかの図形や画像もあるページは自由配置のページの
// 後ろに足す。Slides の置きものが持てないもの（回転・グラデーション・文字ごとの書式）は、
// 近いもの（塗りは最初の色、文字は段落の先頭の書式）にする。

const W = 1280;
const H = 720;

/** CSS の色（#rrggbb・rgba()・グラデーション）を #rrggbb に。透明や読めない色は null */
export function hexOf(css: string | null | undefined): `#${string}` | null {
  if (!css) return null;
  const hex = css.match(/#([0-9a-f]{6})\b/i);
  if (hex) return `#${hex[1].toLowerCase()}`;
  const rgb = css.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/i);
  if (!rgb || (rgb[4] !== undefined && Number(rgb[4]) < 0.05)) return null;
  return `#${[rgb[1], rgb[2], rgb[3]].map((v) => Math.min(255, Number(v)).toString(16).padStart(2, "0")).join("")}`;
}

const fontRef = (font: string | null): FontRef | undefined =>
  !font ? undefined : /mono|courier|consolas|menlo/i.test(font) ? "mono" : /mincho|明朝|serif|times|georgia|garamond|cambria/i.test(font) && !/sans/i.test(font) ? "serif" : undefined;

const runsOf = (body: TextBody) => body.paras.flatMap((p) => p.runs).filter((r) => r.text.trim());
const paraText = (p: Para) => (p.bullet ? `${p.bullet} ` : "") + p.runs.map((r) => r.text).join("");
const bodyText = (body: TextBody) => body.paras.map(paraText).join("\n").replace(/\s+$/, "");

/** 段落の先頭の文字の書式を、置きもの全体の書式にする */
function styleOf(body: TextBody, s: number): TextStyle {
  const r: Run | undefined = runsOf(body)[0];
  const align = body.paras.find((p) => p.runs.some((x) => x.text.trim()))?.align;
  const color = hexOf(r?.color);
  return {
    size: Math.max(6, Math.round(((r?.size ?? 18) * 4) / 3 * s)),
    ...(r?.bold ? { bold: true } : {}),
    ...(r?.italic ? { italic: true } : {}),
    ...(r?.underline ? { underline: true } : {}),
    ...(color ? { color } : {}),
    ...(fontRef(r?.font ?? null) ? { font: fontRef(r?.font ?? null) } : {}),
    ...(align === "center" || align === "right" ? { align } : {}),
  };
}

/** 文字の置きもの。縦の寄せ（中央・下）は、文字の高さを見積もって位置で表す */
function textObject(body: TextBody, box: { x: number; y: number; w: number; h: number }, s: number): SlideObject | null {
  const text = bodyText(body);
  if (!text.trim()) return null;
  const style = styleOf(body, s);
  const [it, ir, ib, il] = body.inset.map((v) => v * s);
  const x = box.x + il;
  const w = Math.max(8, box.w - il - ir);
  let y = box.y + it;
  let h = Math.max(8, box.h - it - ib);
  if (body.anchor !== "top") {
    const lines = text.split("\n").reduce((n, line) => n + Math.max(1, Math.ceil(([...line].length * (style.size ?? 24) * 0.6) / w)), 0);
    const need = Math.min(h, lines * (style.size ?? 24) * 1.4 + 8);
    y += body.anchor === "middle" ? (h - need) / 2 : h - need;
    h = need;
  }
  return { id: newId("o"), kind: "text", x, y, w, h, fill: "none", stroke: "none", strokeWidth: 0, text, textStyle: style };
}

const LINES = /^(line|straightConnector\d?|bentConnector\d|curvedConnector\d)$/;

function itemObjects(item: DeckItem, place: (x: number, y: number, w: number, h: number) => { x: number; y: number; w: number; h: number }, s: number): SlideObject[] {
  const box = place(item.x, item.y, item.w, item.h);
  switch (item.kind) {
    case "image":
      return [{ id: newId("o"), kind: "image", ...box, fill: "none", stroke: "none", strokeWidth: 0, src: item.src, ratio: box.w / Math.max(1, box.h) }];
    case "chart":
      // 置きものはグラフを持てない。グラフはグラフの型のページになるので、ここには場所と題だけ残す
      return [{ id: newId("o"), kind: "rect", ...box, fill: "none", stroke: "line", strokeWidth: 1, dash: true, text: item.chart.title ?? "Chart", textStyle: { size: Math.round(18 * s * 1.5) } }];
    case "table": {
      const out: SlideObject[] = [];
      let ty = item.y;
      for (const row of item.rows) {
        let tx = item.x;
        row.cells.forEach((cell, ci) => {
          const cw = item.cols.slice(ci, ci + cell.span).reduce((a, b) => a + b, 0);
          if (!cell.skip) {
            const b = place(tx, ty, cw, row.h);
            out.push({ id: newId("o"), kind: "rect", ...b, fill: hexOf(cell.fill) ?? "none", stroke: "line", strokeWidth: 1 });
            const t = textObject(cell.text, b, s);
            if (t) out.push(t);
          }
          tx += item.cols[ci] ?? 0;
        });
        ty += row.h;
      }
      return out;
    }
    case "shape": {
      const out: SlideObject[] = [];
      const stroke = item.stroke ? hexOf(item.stroke.color) : null;
      const sw = item.stroke ? Math.max(1, Math.round(item.stroke.width * s)) : 0;
      if (LINES.test(item.geom)) {
        if (!stroke) return [];
        // 線は (x,y) から (x+w,y+h) へ。裏返しは向きで表す。矢じりは終わりの側にしか描けないので、始まりだけにあれば逆向きに引く
        let [x1, y1, x2, y2] = [box.x, box.y, box.x + box.w, box.y + box.h];
        if (item.flipH) [x1, x2] = [x2, x1];
        if (item.flipV) [y1, y2] = [y2, y1];
        const arrow = item.stroke!.head || item.stroke!.tail;
        if (item.stroke!.head && !item.stroke!.tail) [x1, y1, x2, y2] = [x2, y2, x1, y1];
        return [{ id: newId("o"), kind: arrow ? "arrow" : "line", x: x1, y: y1, w: x2 - x1, h: y2 - y1, fill: "none", stroke, strokeWidth: sw, ...(item.stroke!.dash ? { dash: true } : {}) }];
      }
      const fill = hexOf(item.fill);
      if (fill || stroke) {
        const kind = item.geom === "ellipse" ? "ellipse" : "rect";
        const radius = item.geom === "roundRect" ? Math.round(Math.min(box.w, box.h) * ((item.adj.adj ?? 16667) / 100000)) : undefined;
        out.push({ id: newId("o"), kind, ...box, fill: fill ?? "none", stroke: stroke ?? "none", strokeWidth: stroke ? sw : 0, ...(item.stroke?.dash ? { dash: true } : {}), ...(radius ? { radius } : {}) });
      }
      const t = item.text ? textObject(item.text, box, s) : null;
      if (t) out.push(t);
      return out;
    }
  }
}

/** ページの主張（一覧に出す名前）：いちばん大きな文字の段。無ければ最初の文字 */
function titleOf(slide: DeckSlide, n: number): string {
  let best: { size: number; text: string } | null = null;
  for (const item of slide.items) {
    if (item.kind !== "shape" || !item.text) continue;
    const text = bodyText(item.text).split("\n").find((l) => l.trim())?.trim();
    const size = runsOf(item.text)[0]?.size ?? 0;
    if (text && (!best || size > best.size)) best = { size, text };
  }
  return best?.text.slice(0, 120) ?? `Slide ${n + 1}`;
}

const CHART_KIND: Record<ChartData["kind"], ChartKind> = {
  pie: "share", doughnut: "share", bar: "bar", column: "column", combo: "column", line: "line", area: "line", stock: "line", scatter: "scatter",
};
const num = (v: number | null) => (v != null && Number.isFinite(v) ? v : 0);

/** 純粋。読んだグラフを、グラフの型の中身にする（項目は12・系列は3まで。型の上限） */
export function chartContent(chart: ChartData, takeaway = ""): ChartContent {
  const kind = CHART_KIND[chart.kind];
  const categories = chart.categories.slice(0, 12);
  const series = kind === "scatter"
    // 相関は 0番目が横軸、1番目が縦軸。PowerPoint の散布図は横軸の値を項目に持つ
    ? [{ name: "x", values: categories.map((c) => Number(c) || 0) }, { name: chart.series[0]?.name ?? "", values: (chart.series[0]?.values ?? []).slice(0, categories.length).map(num) }]
    : chart.series.slice(0, kind === "share" ? 1 : 3).map((sr) => ({ name: sr.name, values: categories.map((_, i) => num(sr.values[i] ?? null)) }));
  return { kind, categories, series: series.length ? series : [{ name: "", values: categories.map(() => 0) }], unit: "", highlight: -1, takeaway };
}

/** 純粋。PowerPoint のデッキ（読んだもの）を、自由配置とグラフのページのデッキにする */
export function deckFromPptx(pptx: PptxDeck, title: string): Deck {
  const s = Math.min(W / pptx.width, H / pptx.height);
  const ox = (W - pptx.width * s) / 2;
  const oy = (H - pptx.height * s) / 2;
  const place = (x: number, y: number, w: number, h: number) => ({ x: Math.round(ox + x * s), y: Math.round(oy + y * s), w: Math.round(w * s), h: Math.round(h * s) });
  const slides: Slide[] = pptx.slides.flatMap((slide, n) => {
    const title = titleOf(slide, n);
    const charts = slide.items.filter((i): i is Extract<DeckItem, { kind: "chart" }> => i.kind === "chart");
    // グラフの型のページ。ページの題を主張に（無ければグラフの題）、ほかの文字は言えること（takeaway）に
    const titled = slide.items.some((i) => i.kind === "shape" && i.text && bodyText(i.text).trim());
    const texts = slide.items.flatMap((i) => (i.kind === "shape" && i.text ? [bodyText(i.text).trim()] : [])).filter((t) => t && !t.startsWith(title));
    const chartSlides: Slide[] = charts.map((c) => ({
      id: newId("s"), title: (titled ? title : c.chart.title?.trim()) || title, layout: "chart",
      content: { chart: chartContent(c.chart, texts.join(" ").slice(0, 200)) },
    }));
    const onlyText = slide.items.every((i) => i.kind === "chart" || (i.kind === "shape" && !hexOf(i.fill) && !(i.stroke && hexOf(i.stroke.color))));
    if (charts.length && onlyText) return chartSlides;
    const objects: SlideObject[] = [];
    // 背景：画像ならその画像、色なら全面の塗り（無ければ白。PowerPoint の既定）
    const bgImage = slide.background?.match(/url\("([^"]+)"\)/)?.[1];
    const full = { x: 0, y: 0, w: W, h: H };
    if (bgImage) objects.push({ id: newId("o"), kind: "image", ...full, fill: "none", stroke: "none", strokeWidth: 0, src: bgImage, ratio: W / H, behind: true });
    // design-lint-ignore — PowerPoint's own default page colour, kept as slide data (not a UI colour)
    else objects.push({ id: newId("o"), kind: "rect", ...full, fill: (hexOf(slide.background) ?? "#ffffff") as ColorRef, stroke: "none", strokeWidth: 0, behind: true });
    for (const item of slide.items) objects.push(...itemObjects(item, place, s));
    return [{ id: newId("s"), title, layout: "free", content: { free: {} }, objects } as Slide, ...chartSlides];
  });
  return { title, storyline: "scr", slides };
}
