import type { LookTokens } from "@/ActivitySpace/sustainment/slides/kata/model/types";
import { tx } from "@/ActivitySpace/sustainment/slides/kata/i18n";
import { contrast } from "./mix";

// 自分の世界観をつくるための道具。画像の色から下書きを起こし、5要素のトークンに落とす。

export const FONT_CHOICES = [
  { id: "gothic", get name() { return tx("ゴシック", "Sans"); }, display: "var(--font-noto-sans), sans-serif", weight: 700, tracking: "0" },
  { id: "grotesk", get name() { return tx("グロテスク", "Grotesk"); }, display: "var(--font-inter), var(--font-noto-sans), sans-serif", weight: 800, tracking: "-0.02em" },
  { id: "mincho", get name() { return tx("明朝", "Serif"); }, display: "var(--font-noto-serif), serif", weight: 700, tracking: "0.01em" },
] as const;

type RGB = [number, number, number];

const toHex = ([r, g, b]: RGB) => "#" + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("").toUpperCase();
const fromHex = (h: string): RGB => {
  const x = h.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16)) as RGB;
};

function lightness([r, g, b]: RGB): number {
  return (Math.max(r, g, b) + Math.min(r, g, b)) / 510;
}
function saturation([r, g, b]: RGB): number {
  const mx = Math.max(r, g, b) / 255;
  const mn = Math.min(r, g, b) / 255;
  const l = (mx + mn) / 2;
  if (mx === mn) return 0;
  return l > 0.5 ? (mx - mn) / (2 - mx - mn) : (mx - mn) / (mx + mn);
}

export function mixHex(a: string, b: string, t: number): string {
  const x = fromHex(a);
  const y = fromHex(b);
  return toHex([0, 1, 2].map((i) => x[i] * (1 - t) + y[i] * t) as RGB);
}

/** 画素の並びから、地・文字・強調・数字の地を選ぶ。色を量子化して頻度で決める */
export function paletteFromPixels(pixels: RGB[]): LookTokens {
  const buckets = new Map<string, { sum: RGB; n: number }>();
  for (const [r, g, b] of pixels) {
    const key = `${r >> 4}-${g >> 4}-${b >> 4}`;
    const e = buckets.get(key) ?? { sum: [0, 0, 0] as RGB, n: 0 };
    e.sum = [e.sum[0] + r, e.sum[1] + g, e.sum[2] + b];
    e.n++;
    buckets.set(key, e);
  }
  const colors = [...buckets.values()]
    .map((e) => ({ c: [e.sum[0] / e.n, e.sum[1] / e.n, e.sum[2] / e.n] as RGB, n: e.n }))
    .sort((a, b) => b.n - a.n);
  const total = pixels.length || 1;
  const frequent = colors.filter((x) => x.n / total > 0.004);
  const pool = frequent.length ? frequent : colors;
  const bgC = pool[0]?.c ?? ([255, 255, 255] as RGB);
  const bg = toHex(bgC);
  const dark = lightness(bgC) < 0.35;
  // 文字：地との差が一番大きい、ある程度出てくる色
  const inkC = [...pool].sort((a, b) => contrast(toHex(b.c), bg) - contrast(toHex(a.c), bg))[0]?.c ?? (dark ? [255, 255, 255] : [17, 17, 17]);
  let ink = toHex(inkC);
  if (contrast(ink, bg) < 4.5) ink = dark ? "#F5F5F2" : "#141414";
  // 強調：彩度 × 出現の重みが一番高く、地から見分けられる色
  let accentC: RGB | undefined =
    [...pool]
      .filter((x) => contrast(toHex(x.c), bg) > 1.08 && saturation(x.c) > 0.25)
      .sort((a, b) => saturation(b.c) * Math.sqrt(b.n) - saturation(a.c) * Math.sqrt(a.n))[0]?.c;
  if (!accentC) accentC = fromHex(ink);
  const accent = toHex(accentC);
  // 数字の地：強調が濃ければ強調、薄ければ文字色
  const block = lightness(accentC) < 0.55 && contrast(accent, bg) > 2 ? accent : ink;
  const num = contrast(accent, block) > 3 ? accent : contrast(bg, block) > 3 ? bg : dark ? "#111111" : "#FFFFFF";
  return {
    ground: { bg, ink, sub: mixHex(ink, bg, 0.38), line: mixHex(ink, bg, 0.82), dark },
    type: { display: FONT_CHOICES[0].display, weight: 700, body: FONT_CHOICES[0].display, tracking: "0" },
    accent: { accent, tint: mixHex(accent, bg, 0.82), onAccent: contrast("#111111", accent) > contrast("#FFFFFF", accent) ? "#111111" : "#FFFFFF" },
    number: { block, num },
    shape: { radius: 0 },
  };
}

/** 地・文字・強調から、残りの色（補助・線・淡色）を導き直す */
export function deriveTokens(t: LookTokens): LookTokens {
  const { bg, ink } = t.ground;
  return {
    ...t,
    ground: { ...t.ground, sub: mixHex(ink, bg, 0.38), line: mixHex(ink, bg, 0.82), dark: contrast(bg, "#000000") < contrast(bg, "#FFFFFF") },
    accent: { ...t.accent, tint: mixHex(t.accent.accent, bg, 0.82), onAccent: contrast("#111111", t.accent.accent) > contrast("#FFFFFF", t.accent.accent) ? "#111111" : "#FFFFFF" },
  };
}
