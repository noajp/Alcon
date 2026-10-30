import type { ChartContent, ChartKind } from "./types";
import { tx } from "@/ActivitySpace/sustainment/slides/kata/i18n";

// グラフは「何を見せたいか」から選ぶ（ゼラズニー『Say It With Charts』の5つの比較と、FT Visual Vocabulary の分類）。

export interface ChartPurpose {
  kind: ChartKind;
  /** 見せたいこと */
  readonly label: string;
  readonly hint: string;
  readonly basis: string;
}

export const CHART_PURPOSES: ChartPurpose[] = [
  { kind: "share", get label() { return tx("構成（全体の内訳）", "Part-to-whole"); }, get hint() { return tx("全体のうち何割か", "What share of the whole"); }, basis: "Zelazny: component / FT: part-to-whole" },
  { kind: "bar", get label() { return tx("順位（項目の比較）", "Ranking"); }, get hint() { return tx("どれが大きいか、並べて比べる", "Which is biggest, side by side"); }, basis: "Zelazny: item / FT: ranking" },
  { kind: "line", get label() { return tx("推移（時系列）", "Change over time"); }, get hint() { return tx("時間とともにどう変わったか", "How it moved over time"); }, basis: "Zelazny: time series / FT: change over time" },
  { kind: "column", get label() { return tx("分布・大きさ", "Distribution & magnitude"); }, get hint() { return tx("範囲ごとの数、大きさの違い", "Counts per range, size differences"); }, basis: "Zelazny: frequency / FT: distribution, magnitude" },
  { kind: "scatter", get label() { return tx("相関（2つの関係）", "Correlation"); }, get hint() { return tx("2つの量が連動しているか", "Do two measures move together"); }, basis: "Zelazny: correlation / FT: correlation" },
  { kind: "waterfall", get label() { return tx("増減（要因の分解）", "Deviation & bridge"); }, get hint() { return tx("始まりから終わりまで、何が足し引きしたか", "What added and subtracted from start to end"); }, basis: "FT: deviation / consulting waterfall" },
];
/** 「3.8万」「1,200」「62%」「$1.2M」などを数に読む */
export function parseNumber(raw: string): number | null {
  const t = raw.replace(/[,，\s]/g, "").replace(/[０-９．]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0));
  const m = t.match(/[-−▲]?\d+(?:\.\d+)?/);
  if (!m) return null;
  let v = parseFloat(m[0].replace(/[−▲]/, "-"));
  const after = t.slice((m.index ?? 0) + m[0].length);
  if (/^兆/.test(after)) v *= 1e12;
  else if (/^億/.test(after)) v *= 1e8;
  else if (/^万/.test(after)) v *= 1e4;
  else if (/^千/.test(after)) v *= 1e3;
  else if (/^[Bb]/.test(after)) v *= 1e9;
  else if (/^[Mm](?![a-z])/.test(after)) v *= 1e6;
  else if (/^[Kk](?![a-z])/.test(after)) v *= 1e3;
  return v;
}

/** 数の並びから、自然な単位を拾う（%・倍・円 など） */
export function guessUnit(cells: string[]): string {
  const joined = cells.join(" ");
  const m = joined.match(/(%|％|倍|億円|万円|円|件|社|人|名|pt|x)/);
  return m ? m[1].replace("％", "%") : "";
}

const TIME_LIKE = /^(FY|CY|Q[1-4]|H[12])?\s*'?\d{2,4}(年度?|年|月|期|Q[1-4])?$|^\d{1,2}月$|^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i;

/** 1つのセルの単位だけを取り出す（数・符号・桁の語を除く）。「$3M」→「$」、「6 months」→「month」、「12億円」→「円」 */
export function unitOf(cell: string): string {
  return cell
    .replace(/[０-９．，]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0))
    .replace(/^\s*(約|およそ|approx\.?|about|around|~|≈)\s*/i, "")
    .replace(/[-−▲△+＋]?\d[\d,.]*\s*(兆|億|万|千|[BbMmKk](?![A-Za-z]))?/g, "")
    .replace(/％/g, "%")
    .trim()
    .toLowerCase()
    .replace(/\b([a-z]{3,})s\b/g, "$1")
    .replace(/\s+/g, " ");
}

/** 列の中で単位がそろっているか（そろっていない数の並びは、グラフではなく比較の表のまま） */
export function consistentUnit(cells: string[]): boolean {
  return new Set(cells.filter((c) => c.trim()).map(unitOf)).size <= 1;
}

const SIGNED = /^\s*[-−▲△+＋]/;

/** 終わりの行が「始まり＋間の増減」に合っているか（端数の丸めは2%まで許す） */
function endsAsTotal(values: number[]): boolean {
  if (values.length < 3) return false;
  const first = values[0];
  const last = values[values.length - 1];
  const mid = values.slice(1, -1).reduce((a, b) => a + b, 0);
  return Math.abs(last - (first + mid)) <= 0.02 * Math.max(1, Math.abs(first), Math.abs(last));
}

/** 増減の橋に見えるか。始まり（と終わり）が水準、間が増減のときだけ。raw は元のセルの文字（符号を見る） */
export function looksLikeBridge(values: number[], raw?: string[]): boolean {
  if (values.length < 2) return false;
  const mid = values.slice(1, -1);
  const midSigned = !!raw && raw.length === values.length && raw.slice(1, -1).every((r) => SIGNED.test(r));
  // 始まり・増減…・終わり（終わりが始まり＋増減の合計に合う）
  if (endsAsTotal(values) && mid.some((v) => v !== 0) && (midSigned || mid.some((v) => v < 0))) return true;
  // 始まり・増減…（終わりの行が無く、合計はこちらで出す）
  return !!raw && raw.length === values.length && values.length >= 3 && !SIGNED.test(raw[0]) && raw.slice(1).every((r) => SIGNED.test(r));
}

/** 表（項目と数）からグラフの種類を推す。時間なら推移、合計が100前後の%なら構成、橋に見えれば増減、それ以外は順位 */
export function guessKind(categories: string[], values: number[], unit: string, raw?: string[]): ChartKind {
  if (categories.length >= 3 && categories.every((c) => TIME_LIKE.test(c.trim()))) return "line";
  const sum = values.reduce((a, b) => a + b, 0);
  if (unit === "%" && sum > 90 && sum < 110 && values.every((v) => v >= 0)) return "share";
  if (looksLikeBridge(values, raw)) return "waterfall";
  return "bar";
}

export function emptyChart(): ChartContent {
  return { kind: "bar", categories: ["A", "B", "C"], series: [{ name: "", values: [3, 2, 1] }], unit: "", highlight: 0, takeaway: "" };
}

/** 増減の橋：始まり（0番目）から、間の増減を積んで終わりを出す。
 *  最後の値が「始まり＋増減の合計」に合うときは、それを終わりの水準として扱い、合計を足さない */
export function waterfallSteps(values: number[]): { start: number; end: number; delta: number; total: boolean }[] {
  const out: { start: number; end: number; delta: number; total: boolean }[] = [];
  const hasEnd = endsAsTotal(values);
  let run = 0;
  values.forEach((v, i) => {
    if (hasEnd && i === values.length - 1) return;
    if (i === 0) {
      out.push({ start: 0, end: v, delta: v, total: true });
      run = v;
    } else {
      out.push({ start: run, end: run + v, delta: v, total: false });
      run += v;
    }
  });
  // 終わりの行があれば、その値（表に書かれた水準）をそのまま置く
  const end = hasEnd ? values[values.length - 1] : run;
  out.push({ start: 0, end, delta: end, total: true });
  return out;
}

export function formatValue(v: number, unit: string): string {
  const abs = Math.abs(v);
  const s = abs >= 100 ? Math.round(v).toLocaleString() : String(Math.round(v * 10) / 10);
  return unit ? `${s}${unit}` : s;
}
