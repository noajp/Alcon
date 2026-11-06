import { newId } from "./id";
import type { ColorRef, FontRef, LookTokens, ObjectKind, Slide, SlideObject, TextStyle } from "./types";
import type { CSSProperties } from "react";
import { tx } from "@/ActivitySpace/artifacts/slides/kata/i18n";

// 型の上に自由に置くもの（文字・図形・線・画像）と、文字の見た目の上書き。
// 色は世界観の色の名前で持つ。世界観を混ぜ直しても、置いたものが浮かない。

const SLIDE_W = 1280;
const SLIDE_H = 720;

export const COLOR_REFS: Exclude<ColorRef, `#${string}`>[] = ["ink", "sub", "accent", "tint", "block", "num", "bg", "line", "none"];

export const colorLabel = (c: ColorRef): string =>
  (
    {
      ink: tx("文字", "Ink"),
      sub: tx("補足", "Muted"),
      accent: tx("強調", "Accent"),
      tint: tx("淡い強調", "Tint"),
      block: tx("数字の地", "Block"),
      num: tx("数字", "Number"),
      bg: tx("地", "Background"),
      line: tx("罫線", "Rule"),
      onAccent: tx("強調の上の文字", "On accent"),
      none: tx("なし", "None"),
    } as Record<string, string>
  )[c] ?? c;

/** 画面で使う色（CSS）。世界観の色は CSS 変数で、混ぜ直すと追従する */
export function cssColor(c: ColorRef | undefined): string | undefined {
  if (!c || c === "none") return undefined;
  if (c.startsWith("#")) return c;
  const v = c === "onAccent" ? "on-accent" : c;
  return `var(--s-${v})`;
}

/** 書き出しで使う色（#RRGGBB）。無しは null */
export function hexColor(c: ColorRef | undefined, t: LookTokens): string | null {
  if (!c || c === "none") return null;
  if (c.startsWith("#")) return c;
  const map: Record<string, string> = {
    ink: t.ground.ink,
    sub: t.ground.sub,
    line: t.ground.line,
    bg: t.ground.bg,
    accent: t.accent.accent,
    tint: t.accent.tint,
    onAccent: t.accent.onAccent,
    block: t.number.block,
    num: t.number.num,
  };
  return map[c] ?? null;
}

export const FONT_REFS: FontRef[] = ["display", "body", "sans", "serif", "mono"];
export const fontLabel = (f: FontRef): string =>
  ({ display: tx("見出し", "Heading"), body: tx("本文", "Body"), sans: "Sans", serif: tx("明朝", "Serif"), mono: "Mono" })[f];

function cssFont(f: FontRef | undefined): string | undefined {
  switch (f) {
    case "display":
      return "var(--s-display)";
    case "body":
      return "var(--s-body)";
    case "sans":
      return "var(--font-inter), var(--font-noto-sans), sans-serif";
    case "serif":
      return "var(--font-noto-serif), serif";
    case "mono":
      return "var(--font-plex-mono), monospace";
    default:
      return undefined;
  }
}

/** 書き出し（PowerPoint）での書体名 */
export function pptxFont(f: FontRef | undefined, display: string, body: string): string | undefined {
  switch (f) {
    case "display":
      return display;
    case "body":
      return body;
    case "sans":
      return "Arial";
    case "serif":
      return "Yu Mincho";
    case "mono":
      return "Consolas";
    default:
      return undefined;
  }
}

/** 文字の見た目の上書きを CSS に直す */
export function textStyleCss(s: TextStyle | undefined): CSSProperties {
  if (!s) return {};
  const out: CSSProperties = {};
  const font = cssFont(s.font);
  if (font) out.fontFamily = font;
  if (s.size) out.fontSize = s.size;
  if (s.bold !== undefined) out.fontWeight = s.bold ? 700 : 400;
  if (s.italic) out.fontStyle = "italic";
  if (s.underline) out.textDecoration = "underline";
  const color = cssColor(s.color);
  if (color) out.color = color;
  if (s.align) out.textAlign = s.align;
  return out;
}

export const isLineKind = (k: ObjectKind) => k === "line" || k === "arrow";

/** 置くものの既定。真ん中に、世界観の色で */
export function makeObject(kind: ObjectKind, extra: Partial<SlideObject> = {}): SlideObject {
  const base = { id: newId("o"), kind, strokeWidth: 2 } as const;
  switch (kind) {
    case "text":
      return { ...base, x: 440, y: 320, w: 400, h: 80, fill: "none", stroke: "none", text: tx("テキスト", "Text"), textStyle: { size: 28 }, ...extra };
    case "rect":
      return { ...base, x: 490, y: 260, w: 300, h: 200, fill: "tint", stroke: "none", radius: 8, ...extra };
    case "ellipse":
      return { ...base, x: 540, y: 260, w: 200, h: 200, fill: "accent", stroke: "none", ...extra };
    case "line":
      return { ...base, x: 440, y: 360, w: 400, h: 0, fill: "none", stroke: "ink", strokeWidth: 3, ...extra };
    case "arrow":
      return { ...base, x: 440, y: 360, w: 400, h: 0, fill: "none", stroke: "accent", strokeWidth: 4, ...extra };
    case "image":
      return { ...base, x: 440, y: 210, w: 400, h: 300, fill: "none", stroke: "none", ...extra };
  }
}

const clampN = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** 外から来た（保存されていた）置きものの食い違いを直す */
export function normalizeObject(o: Partial<SlideObject>): SlideObject | null {
  const kinds: ObjectKind[] = ["text", "rect", "ellipse", "line", "arrow", "image"];
  if (!o || !kinds.includes(o.kind as ObjectKind)) return null;
  const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  const base = makeObject(o.kind as ObjectKind);
  const line = isLineKind(base.kind);
  return {
    ...base,
    ...o,
    id: typeof o.id === "string" && o.id ? o.id : base.id,
    x: clampN(num(o.x, base.x), -SLIDE_W, SLIDE_W * 2),
    y: clampN(num(o.y, base.y), -SLIDE_H, SLIDE_H * 2),
    w: line ? clampN(num(o.w, base.w), -SLIDE_W * 2, SLIDE_W * 2) : clampN(num(o.w, base.w), 4, SLIDE_W * 2),
    h: line ? clampN(num(o.h, base.h), -SLIDE_H * 2, SLIDE_H * 2) : clampN(num(o.h, base.h), 4, SLIDE_H * 2),
    strokeWidth: clampN(num(o.strokeWidth, base.strokeWidth), 0, 40),
  } as SlideObject;
}

export function addObject(slide: Slide, o: SlideObject): Slide {
  return { ...slide, objects: [...(slide.objects ?? []), o] };
}

export function updateObject(slide: Slide, id: string, patch: (o: SlideObject) => SlideObject): Slide {
  return { ...slide, objects: (slide.objects ?? []).map((o) => (o.id === id ? patch(o) : o)) };
}

export function removeObject(slide: Slide, id: string): Slide {
  return { ...slide, objects: (slide.objects ?? []).filter((o) => o.id !== id) };
}

/** 少しずらして複製する */
export function duplicateObject(slide: Slide, id: string): { slide: Slide; id: string | null } {
  const src = (slide.objects ?? []).find((o) => o.id === id);
  if (!src) return { slide, id: null };
  const copy = { ...src, id: newId("o"), x: src.x + 24, y: src.y + 24, textStyle: src.textStyle ? { ...src.textStyle } : undefined };
  return { slide: addObject(slide, copy), id: copy.id };
}

/** 重なりの順を変える。front：一番手前（型の文字の上）、back：一番奥（型の文字の後ろ） */
export function reorderObject(slide: Slide, id: string, to: "front" | "back" | "forward" | "backward"): Slide {
  const list = slide.objects ?? [];
  const i = list.findIndex((o) => o.id === id);
  if (i < 0) return slide;
  const o = list[i];
  const rest = list.filter((x) => x.id !== id);
  if (to === "front") return { ...slide, objects: [...rest, { ...o, behind: false }] };
  if (to === "back") return { ...slide, objects: [{ ...o, behind: true }, ...rest] };
  const j = clampN(to === "forward" ? i + 1 : i - 1, 0, list.length - 1);
  rest.splice(j, 0, o);
  return { ...slide, objects: rest };
}

/** 動かす（矢印キー・ドラッグ） */
export function moveBy(o: SlideObject, dx: number, dy: number): SlideObject {
  return { ...o, x: Math.round(o.x + dx), y: Math.round(o.y + dy) };
}

export type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw" | "start" | "end";

/** 取っ手を引いて大きさを変える。keep：縦横比を保つ（Shift） */
export function resizeBy(o: SlideObject, h: Handle, dx: number, dy: number, keep = false): SlideObject {
  if (isLineKind(o.kind)) {
    if (h === "start") return { ...o, x: Math.round(o.x + dx), y: Math.round(o.y + dy), w: Math.round(o.w - dx), h: Math.round(o.h - dy) };
    if (h === "end") {
      let w = o.w + dx;
      let hh = o.h + dy;
      // Shift：水平・垂直・45度に揃える
      if (keep) {
        const ang = Math.atan2(hh, w);
        const snap = Math.round(ang / (Math.PI / 4)) * (Math.PI / 4);
        const len = Math.hypot(w, hh);
        w = Math.cos(snap) * len;
        hh = Math.sin(snap) * len;
      }
      return { ...o, w: Math.round(w), h: Math.round(hh) };
    }
    return o;
  }
  let { x, y, w, h: hh } = o;
  if (h.includes("e")) w += dx;
  if (h.includes("s")) hh += dy;
  if (h.includes("w")) {
    x += dx;
    w -= dx;
  }
  if (h.includes("n")) {
    y += dy;
    hh -= dy;
  }
  if (keep && h.length === 2 && o.w > 0 && o.h > 0) {
    const ratio = o.w / o.h;
    const nh = w / ratio;
    if (h.includes("n")) y += hh - nh;
    hh = nh;
  }
  const MIN = 8;
  if (w < MIN) {
    if (h.includes("w")) x -= MIN - w;
    w = MIN;
  }
  if (hh < MIN) {
    if (h.includes("n")) y -= MIN - hh;
    hh = MIN;
  }
  return { ...o, x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(hh) };
}

/** 動かしている間の吸着：スライドの中心・余白の線と、ほかの置きものの端と中心に寄せる */
export function snapMove(o: SlideObject, others: SlideObject[], threshold = 6): { o: SlideObject; guides: { x?: number; y?: number } } {
  const box = bounds(o);
  const xs = [80, SLIDE_W / 2, SLIDE_W - 80];
  const ys = [56, SLIDE_H / 2, SLIDE_H - 44];
  for (const p of others) {
    const b = bounds(p);
    xs.push(b.x, b.x + b.w / 2, b.x + b.w);
    ys.push(b.y, b.y + b.h / 2, b.y + b.h);
  }
  const pick = (cands: number[], edges: number[]) => {
    let best: { d: number; to: number; at: number } | null = null;
    for (const c of cands)
      for (const e of edges) {
        const d = Math.abs(c - e);
        if (d <= threshold && (!best || d < best.d)) best = { d, to: c - e, at: c };
      }
    return best;
  };
  const bx = pick(xs, [box.x, box.x + box.w / 2, box.x + box.w]);
  const by = pick(ys, [box.y, box.y + box.h / 2, box.y + box.h]);
  return { o: moveBy(o, bx?.to ?? 0, by?.to ?? 0), guides: { x: bx?.at, y: by?.at } };
}

/** 置きものが占める四角（線は端点から） */
function bounds(o: SlideObject): { x: number; y: number; w: number; h: number } {
  if (!isLineKind(o.kind)) return { x: o.x, y: o.y, w: o.w, h: o.h };
  return { x: Math.min(o.x, o.x + o.w), y: Math.min(o.y, o.y + o.h), w: Math.abs(o.w), h: Math.abs(o.h) };
}

/** 文字のパスをキーにする */
export const styleKey = (path: (string | number)[]) => path.join(".");

/** 型の文字の見た目を上書きする。空になった上書きは消す */
export function setTextStyle(slide: Slide, key: string, patch: Partial<TextStyle> | null): Slide {
  const styles = { ...(slide.styles ?? {}) };
  if (patch === null) delete styles[key];
  else {
    const next: TextStyle = { ...(styles[key] ?? {}), ...patch };
    for (const k of Object.keys(next) as (keyof TextStyle)[]) if (next[k] === undefined) delete next[k];
    if (Object.keys(next).length) styles[key] = next;
    else delete styles[key];
  }
  return { ...slide, styles: Object.keys(styles).length ? styles : undefined };
}
