// The font an Office file names, as a CSS stack that finds the same face —
// or the nearest in shape and width — on the viewer's machine. Office files
// name Windows fonts (游ゴシック, メイリオ, MS 明朝, Calibri…) that a Mac
// has under other names or not at all; falling back to whatever sans-serif
// is at hand changes the width of every line, so text wraps where the
// author's did not. Each named family maps to its own name first, then the
// macOS and cross-platform faces closest to it, ending in a Japanese
// fallback of the same kind (gothic or mincho) so CJK text keeps its shape.

const GOTHIC_JA = '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic", YuGothic, Meiryo';
const MINCHO_JA = '"Hiragino Mincho ProN", "Noto Serif JP", "Yu Mincho", YuMincho';

const STACKS: [RegExp, string][] = [
  [/^(yu gothic|游ゴシック)/i, `"Yu Gothic", YuGothic, "游ゴシック体", ${GOTHIC_JA}, sans-serif`],
  [/^(yu mincho|游明朝)/i, `"Yu Mincho", YuMincho, "游明朝体", ${MINCHO_JA}, serif`],
  [/^(meiryo|メイリオ)/i, `Meiryo, "メイリオ", ${GOTHIC_JA}, sans-serif`],
  [/^(ms ?p?gothic|ｍｓ ?ｐ?ゴシック|ms ?ui ?gothic)/i, `"MS PGothic", "MS Gothic", ${GOTHIC_JA}, sans-serif`],
  [/^(ms ?p?mincho|ｍｓ ?ｐ?明朝)/i, `"MS PMincho", "MS Mincho", ${MINCHO_JA}, serif`],
  [/^(biz ?ud|udデジタル)/i, `"BIZ UDPGothic", "BIZ UDGothic", ${GOTHIC_JA}, sans-serif`],
  [/^(hiragino|ヒラギノ)/i, `${GOTHIC_JA}, sans-serif`],
  [/^noto sans/i, `"Noto Sans JP", "Noto Sans", ${GOTHIC_JA}, sans-serif`],
  [/^noto serif/i, `"Noto Serif JP", "Noto Serif", ${MINCHO_JA}, serif`],
  [/^calibri/i, `Calibri, Carlito, "Segoe UI", "Helvetica Neue", Arial, ${GOTHIC_JA}, sans-serif`],
  [/^aptos/i, `Aptos, "Segoe UI", "Helvetica Neue", Arial, ${GOTHIC_JA}, sans-serif`],
  [/^arial narrow/i, `"Arial Narrow", "Helvetica Neue Condensed", "Roboto Condensed", "Arial", ${GOTHIC_JA}, sans-serif`],
  [/^(arial|helvetica)/i, `Arial, "Helvetica Neue", Helvetica, ${GOTHIC_JA}, sans-serif`],
  [/^segoe/i, `"Segoe UI", "Helvetica Neue", Arial, ${GOTHIC_JA}, sans-serif`],
  [/^(cambria|georgia)/i, `Cambria, Caladea, Georgia, ${MINCHO_JA}, serif`],
  [/^(times|century)/i, `"Times New Roman", Times, Century, ${MINCHO_JA}, serif`],
  [/^(consolas|courier|menlo|monaco)/i, `Consolas, Menlo, Monaco, "Courier New", monospace`],
];

/** Pure. A CSS font-family stack for a font name an Office file gives;
 *  null when the file names none (the view's own type applies). */
export function fontStack(name: string | null | undefined): string | null {
  if (!name) return null;
  const face = name.trim();
  const hit = STACKS.find(([re]) => re.test(face));
  if (hit) return hit[1];
  const quoted = `"${face.replace(/"/g, '')}"`;
  return /mincho|明朝|serif|roman/i.test(face) ? `${quoted}, ${MINCHO_JA}, serif` : `${quoted}, ${GOTHIC_JA}, sans-serif`;
}
