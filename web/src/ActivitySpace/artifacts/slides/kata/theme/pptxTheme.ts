import type { LookTokens } from "@/ActivitySpace/artifacts/slides/kata/model/types";
import { FONT_CHOICES, deriveTokens, mixHex } from "./custom";
import { contrast } from "./mix";
import { tx } from "@/ActivitySpace/artifacts/slides/kata/i18n";

// PowerPoint のテーマ（ppt/theme/theme1.xml）から、色と書体を読んで世界観にする。

const SLOTS = ["dk1", "lt1", "dk2", "lt2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6"] as const;
type Slot = (typeof SLOTS)[number];

export interface PptxTheme {
  colors: Partial<Record<Slot, string>>;
  majorFont: string;
  name: string;
}

export function parseThemeXml(xml: string): PptxTheme {
  const colors: Partial<Record<Slot, string>> = {};
  for (const slot of SLOTS) {
    const m = xml.match(new RegExp(`<a:${slot}>([\\s\\S]*?)</a:${slot}>`));
    if (!m) continue;
    const srgb = m[1].match(/srgbClr val="([0-9A-Fa-f]{6})"/);
    const sys = m[1].match(/lastClr="([0-9A-Fa-f]{6})"/);
    const v = srgb?.[1] ?? sys?.[1];
    if (v) colors[slot] = `#${v.toUpperCase()}`;
  }
  const major = xml.match(/<a:majorFont>([\s\S]*?)<\/a:majorFont>/)?.[1] ?? "";
  const jpan = major.match(/<a:font script="Jpan" typeface="([^"]*)"/)?.[1];
  const ea = major.match(/<a:ea typeface="([^"]*)"/)?.[1];
  const latin = major.match(/<a:latin typeface="([^"]*)"/)?.[1];
  const name = xml.match(/<a:theme [^>]*name="([^"]*)"/)?.[1] ?? tx("取り込んだテンプレート", "Imported template");
  return { colors, majorFont: jpan || ea || latin || "", name };
}

/** テーマの色と書体を、5要素のトークンに落とす */
export function tokensFromTheme(th: PptxTheme): LookTokens {
  const c = th.colors;
  const bg = c.lt1 ?? "#FFFFFF";
  let ink = c.dk1 ?? "#111111";
  if (contrast(ink, bg) < 4.5) ink = contrast("#111111", bg) > contrast("#FFFFFF", bg) ? "#111111" : "#FFFFFF";
  // 強調：地から見分けられる最初のアクセント
  const accents = (["accent1", "accent2", "accent3", "accent4", "accent5", "accent6"] as const).map((k) => c[k]).filter(Boolean) as string[];
  const accent = accents.find((a) => contrast(a, bg) > 1.6) ?? ink;
  // 数字の地：濃い2番目の色（dk2）が使えればそれ、だめなら強調か文字色
  const block = [c.dk2, accent, ink].find((x) => x && contrast(x, bg) > 3) ?? ink;
  const num = contrast(bg, block) > 3 ? bg : contrast("#FFFFFF", block) > contrast("#111111", block) ? "#FFFFFF" : "#111111";
  const f = /明朝|Mincho|Serif|セリフ/i.test(th.majorFont) ? FONT_CHOICES[2] : FONT_CHOICES[0];
  return deriveTokens({
    ground: { bg, ink, sub: mixHex(ink, bg, 0.38), line: mixHex(ink, bg, 0.82), dark: false },
    type: { display: f.display, weight: f.weight, body: FONT_CHOICES[0].display, tracking: f.tracking },
    accent: { accent, tint: mixHex(accent, bg, 0.82), onAccent: contrast("#111111", accent) > contrast("#FFFFFF", accent) ? "#111111" : "#FFFFFF" },
    number: { block, num },
    shape: { radius: 0 },
  });
}

/** .pptx / .potx のファイルからテーマを読む（ブラウザでもテストでも動く） */
export async function themeFromPptx(data: ArrayBuffer | Uint8Array): Promise<PptxTheme | null> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(data);
  const names = Object.keys(zip.files).filter((n) => /^ppt\/theme\/theme\d+\.xml$/.test(n)).sort();
  if (!names.length) return null;
  const xml = await zip.file(names[0])!.async("string");
  return parseThemeXml(xml);
}
