"use client";

import type { ChartContent, Slide } from "@/ActivitySpace/sustainment/slides/kata/model/types";
import { formatValue, waterfallSteps } from "@/ActivitySpace/sustainment/slides/kata/model/chart";
import { summaryPage } from "@/ActivitySpace/sustainment/slides/kata/model/deck";
import { useActiveFile } from "@/ActivitySpace/sustainment/slides/kata/store/useKata";
import { tx } from "@/ActivitySpace/sustainment/slides/kata/i18n";
import { Ed, useSlideTx } from "./Editable";

// グラフのページ。立たせる項目は「数字の地」の濃い色、それ以外は文字色を薄くした色にして、
// 色味ではなく明るさの差で見分けられるようにする（色覚の多様性への配慮）。

const W = 760;
const H = 340;
const MONO = "var(--font-plex-mono), monospace";
const FAINT = "color-mix(in srgb, var(--s-ink) 20%, var(--s-bg))";
const MID = "color-mix(in srgb, var(--s-ink) 45%, var(--s-bg))";
const SERIES = ["var(--s-block)", MID, FAINT];

function fill(i: number, hl: number) {
  return hl < 0 || i === hl ? "var(--s-block)" : FAINT;
}

/** 系列（最大3つ）と、0を含む値の幅。マイナスは0の線より下（左）に描く */
function grouped(c: ChartContent) {
  const series = c.series.slice(0, 3);
  const all = series.flatMap((s) => s.values);
  const lo = Math.min(0, ...all);
  const hi = Math.max(0, ...all, lo === 0 ? 1 : 0);
  const color = (si: number, i: number) => (series.length > 1 ? SERIES[si] : fill(i, c.highlight));
  return { series, lo, hi, color };
}

/** 系列が2つ以上のときの凡例（PowerPoint の書き出しと同じく、名前と色の対応を出す） */
function Legend({ c, x, y }: { c: ChartContent; x: number; y: number }) {
  const st = useSlideTx();
  const series = c.series.slice(0, 3);
  if (series.length < 2) return null;
  const names = series.map((s, si) => s.name || st(`系列${si + 1}`, `Series ${si + 1}`));
  // 各凡例の左端を先に出しておく（描画中に変数を書き換えない）
  const lefts = names.map((_, i) => x + names.slice(0, i).reduce((a, n) => a + 34 + n.length * 9, 0));
  return (
    <g>
      {series.map((_, si) => {
        const name = names[si];
        const gx = lefts[si];
        return (
          <g key={si}>
            <rect x={gx} y={y - 11} width={14} height={14} fill={SERIES[si]} />
            <text x={gx + 20} y={y + 1} fontSize={13} fill="var(--s-sub)">
              {name}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function Bar({ c }: { c: ChartContent }) {
  const { series, lo, hi, color } = grouped(c);
  const k = Math.max(1, series.length);
  const n = Math.max(1, c.categories.length);
  const top = k > 1 ? 30 : 0;
  const row = Math.min(56 + (k - 1) * 18, (H - top) / n);
  const left = 180 + (lo < 0 ? 70 : 0);
  const span = W - left - 90;
  const x = (v: number) => left + ((v - lo) / (hi - lo || 1)) * span;
  const x0 = x(0);
  const barH = (row * 0.64) / k;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={tx("順位のグラフ", "Ranking chart")}>
      <Legend c={c} x={left} y={16} />
      {lo < 0 ? <line x1={x0} x2={x0} y1={top} y2={H} stroke="var(--s-line)" strokeWidth={2} /> : null}
      {c.categories.map((cat, i) => {
        const y = top + i * row + (H - top - row * n) / 2;
        return (
          <g key={i}>
            <text x={180 - 14} y={y + row / 2 + 6} textAnchor="end" fontSize={17} fill="var(--s-ink)" fontWeight={i === c.highlight ? 700 : 400}>
              {cat}
            </text>
            {series.map((s, si) => {
              const v = s.values[i] ?? 0;
              const by = y + row * 0.18 + si * barH;
              const w = Math.abs(x(v) - x0);
              const neg = v < 0;
              return (
                <g key={si}>
                  <rect x={neg ? x0 - Math.max(2, w) : x0} y={by} width={Math.max(2, w)} height={barH} fill={color(si, i)} rx={0} />
                  <text x={neg ? x0 - w - 8 : x0 + w + 10} y={by + barH / 2 + 6} textAnchor={neg ? "end" : "start"} fontSize={k > 1 ? 14 : 17} fill="var(--s-ink)" fontWeight={i === c.highlight ? 700 : 500} style={{ fontFamily: "var(--s-display)" }}>
                    {formatValue(v, c.unit)}
                  </text>
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}

function Column({ c }: { c: ChartContent }) {
  const { series, lo, hi, color } = grouped(c);
  const k = Math.max(1, series.length);
  const n = Math.max(1, c.categories.length);
  const top = k > 1 ? 64 : 40;
  const bottom = H - 44;
  const y = (v: number) => top + ((hi - v) / (hi - lo || 1)) * (bottom - top - (lo < 0 ? 24 : 0));
  const base = y(0);
  const colW = (W - 40) / n;
  const w = (colW * 0.64) / k;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={tx("大きさのグラフ", "Column chart")}>
      <Legend c={c} x={20} y={18} />
      <line x1={20} x2={W - 20} y1={base} y2={base} stroke="var(--s-line)" strokeWidth={2} />
      {c.categories.map((cat, i) => {
        const gx = 20 + i * colW + colW * 0.18;
        return (
          <g key={i}>
            {series.map((s, si) => {
              const v = s.values[i] ?? 0;
              const bx = gx + si * w;
              const h = Math.abs(y(v) - base);
              const neg = v < 0;
              return (
                <g key={si}>
                  <rect x={bx} y={neg ? base : base - h} width={w} height={h} fill={color(si, i)} />
                  <text x={bx + w / 2} y={neg ? base + h + 18 : base - h - 10} textAnchor="middle" fontSize={k > 1 ? 13 : 16} fill="var(--s-ink)" fontWeight={i === c.highlight ? 700 : 500}>
                    {formatValue(v, c.unit)}
                  </text>
                </g>
              );
            })}
            <text x={gx + (w * k) / 2} y={bottom + 26} textAnchor="middle" fontSize={15} fill="var(--s-sub)">
              {cat}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function Line({ c }: { c: ChartContent }) {
  const all = c.series.flatMap((s) => s.values);
  const max = Math.max(1, ...all);
  const min = Math.min(0, ...all);
  const n = Math.max(2, c.categories.length);
  const left = 30;
  const right = 110;
  const top = 30;
  const base = H - 44;
  const x = (i: number) => left + (i * (W - left - right)) / (n - 1);
  const y = (v: number) => base - ((v - min) / (max - min || 1)) * (base - top);
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={tx("推移のグラフ", "Line chart")}>
      <line x1={left} x2={W - right} y1={base} y2={base} stroke="var(--s-line)" strokeWidth={2} />
      {c.categories.map((cat, i) => (
        <text key={i} x={x(i)} y={base + 26} textAnchor="middle" fontSize={15} fill="var(--s-sub)">
          {cat}
        </text>
      ))}
      {c.series.map((s, si) => {
        const pts = s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ");
        const last = s.values.length - 1;
        const color = SERIES[si] ?? FAINT;
        return (
          <g key={si}>
            <polyline points={pts} fill="none" stroke={color} strokeWidth={si === 0 ? 4 : 3} strokeDasharray={si === 2 ? "6 6" : undefined} />
            {s.values.map((v, i) => (
              <circle key={i} cx={x(i)} cy={y(v)} r={i === c.highlight || i === last ? 6 : 3.5} fill={color} />
            ))}
            {last >= 0 ? (
              <text x={x(last) + 12} y={y(s.values[last]) + 6} fontSize={17} fontWeight={700} fill="var(--s-ink)" style={{ fontFamily: "var(--s-display)" }}>
                {formatValue(s.values[last], c.unit)}
                {s.name ? <tspan fontSize={13} fontWeight={400} fill="var(--s-sub)">{`  ${s.name}`}</tspan> : null}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

function Share({ c }: { c: ChartContent }) {
  const v = (c.series[0]?.values ?? []).map((x) => Math.max(0, x));
  const sum = v.reduce((a, b) => a + b, 0) || 1;
  const barY = 120;
  const barH = 90;
  // 各区切りの左端を先に出しておく（描画中に変数を書き換えない）
  const lefts = v.map((_, i) => v.slice(0, i).reduce((a, b) => a + b, 0) / sum * W);
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={tx("構成のグラフ", "Part-to-whole chart")}>
      {c.categories.map((cat, i) => {
        const w = (v[i] / sum) * W;
        const x = lefts[i];
        const on = i === c.highlight;
        const color = on ? "var(--s-block)" : i % 2 ? FAINT : MID;
        const pct = Math.round((v[i] / sum) * 100);
        return (
          <g key={i}>
            <rect x={x} y={barY} width={Math.max(0, w - 3)} height={barH} fill={color} />
            {w > 70 ? (
              <text x={x + 12} y={barY + barH / 2 + 9} fontSize={on ? 28 : 22} fontWeight={800} fill={on ? "var(--s-num)" : "var(--s-ink)"} style={{ fontFamily: "var(--s-display)" }}>
                {`${pct}%`}
              </text>
            ) : null}
            <text x={x + 2} y={barY + barH + 34} fontSize={15} fill={on ? "var(--s-ink)" : "var(--s-sub)"} fontWeight={on ? 700 : 400}>
              {w > 40 ? cat : ""}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function Scatter({ c }: { c: ChartContent }) {
  const xs = c.series[0]?.values ?? [];
  const ys = c.series[1]?.values ?? c.series[0]?.values ?? [];
  const pad = 40;
  // 下限も値から決める（マイナスや、0から離れた値の集まりでも枠に収める）
  const bounds = (v: number[]) => {
    const lo0 = Math.min(...v, 0);
    const hi0 = Math.max(...v, 1);
    const minV = v.length ? Math.min(...v) : 0;
    const lo = minV > 0 && minV > hi0 * 0.5 ? minV - (hi0 - minV) * 0.1 : lo0;
    return { lo, hi: hi0 > lo ? hi0 : lo + 1 };
  };
  const bx = bounds(xs);
  const by = bounds(ys);
  const px = (v: number) => pad + ((v - bx.lo) / (bx.hi - bx.lo)) * (W - pad * 2 - 60);
  const py = (v: number) => H - pad - ((v - by.lo) / (by.hi - by.lo)) * (H - pad * 2);
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={tx("相関のグラフ", "Scatter chart")}>
      <line x1={pad} x2={W - pad} y1={H - pad} y2={H - pad} stroke="var(--s-line)" strokeWidth={2} />
      <line x1={pad} x2={pad} y1={pad} y2={H - pad} stroke="var(--s-line)" strokeWidth={2} />
      <text x={W - pad} y={H - pad + 28} textAnchor="end" fontSize={14} fill="var(--s-sub)">
        {c.series[0]?.name ?? ""}
      </text>
      <text x={pad + 8} y={pad - 10} fontSize={14} fill="var(--s-sub)">
        {c.series[1]?.name ?? ""}
      </text>
      {c.categories.map((cat, i) => (
        <g key={i}>
          <circle cx={px(xs[i] ?? 0)} cy={py(ys[i] ?? 0)} r={i === c.highlight ? 11 : 8} fill={fill(i, c.highlight)} />
          <text x={px(xs[i] ?? 0) + 14} y={py(ys[i] ?? 0) + 5} fontSize={14} fill="var(--s-ink)" fontWeight={i === c.highlight ? 700 : 400}>
            {cat}
          </text>
        </g>
      ))}
    </svg>
  );
}

function Waterfall({ c }: { c: ChartContent }) {
  const st = useSlideTx();
  const v = c.series[0]?.values ?? [];
  const steps = waterfallSteps(v);
  const labels = [...c.categories.slice(0, v.length), st("合計", "Total")];
  const hi = Math.max(1, ...steps.flatMap((s) => [s.start, s.end]));
  const lo = Math.min(0, ...steps.flatMap((s) => [s.start, s.end]));
  const base = H - 44;
  const top = 30;
  const y = (val: number) => base - ((val - lo) / (hi - lo || 1)) * (base - top);
  const colW = (W - 20) / steps.length;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={tx("増減のグラフ", "Waterfall chart")}>
      <line x1={10} x2={W - 10} y1={y(0)} y2={y(0)} stroke="var(--s-line)" strokeWidth={2} />
      {steps.map((s, i) => {
        const x = 10 + i * colW + colW * 0.18;
        const w = colW * 0.64;
        const y1 = y(Math.max(s.start, s.end));
        const h = Math.max(2, Math.abs(y(s.start) - y(s.end)));
        const color = s.total ? "var(--s-block)" : s.delta >= 0 ? MID : FAINT;
        return (
          <g key={i}>
            <rect x={x} y={y1} width={w} height={h} fill={color} stroke={!s.total && s.delta < 0 ? "var(--s-ink)" : undefined} strokeDasharray={!s.total && s.delta < 0 ? "4 3" : undefined} />
            <text x={x + w / 2} y={y1 - 10} textAnchor="middle" fontSize={15} fontWeight={s.total ? 700 : 500} fill="var(--s-ink)">
              {`${!s.total && s.delta > 0 ? "+" : ""}${formatValue(s.total ? s.end : s.delta, c.unit)}`}
            </text>
            <text x={x + w / 2} y={base + 26} textAnchor="middle" fontSize={14} fill="var(--s-sub)">
              {labels[i] ?? ""}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function ChartBody({ slide }: { slide: Slide }) {
  const c = slide.content.chart;
  if (!c) return null;
  const Chart = { bar: Bar, column: Column, line: Line, share: Share, scatter: Scatter, waterfall: Waterfall }[c.kind] ?? Bar;
  return (
    <div style={{ display: "flex", gap: 40, width: "100%", alignItems: "center" }}>
      <div style={{ width: W, flexShrink: 0 }}>
        <Chart c={c} />
      </div>
      <div style={{ flexGrow: 1, borderLeft: "1px solid var(--s-line)", paddingLeft: 28, display: "flex", flexDirection: "column", gap: 14, alignSelf: "stretch", justifyContent: "center" }}>
        <div style={{ fontFamily: MONO, fontSize: 12, letterSpacing: "0.08em", color: "var(--s-sub)" }}>SO WHAT</div>
        <Ed value={c.takeaway} path={["content", "chart", "takeaway"]} multiline placeholder={tx("このグラフから言えること", "What this chart tells us")} style={{ fontSize: 20, lineHeight: 1.6, fontWeight: 500 }} />
      </div>
    </div>
  );
}

export function SummaryBody({ slide }: { slide: Slide }) {
  const pts = slide.content.summary?.points ?? [];
  // 「p.N」は今の並びから出す（このページが開いている資料のものなら）
  const all = useActiveFile()?.deck.slides;
  const slides = all?.some((x) => x.id === slide.id) ? all : undefined;
  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", borderTop: "2px solid var(--s-ink)" }}>
      {pts.map((p, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "56px minmax(0, 0.9fr) minmax(0, 1.4fr) 80px", gap: 20, alignItems: "baseline", padding: "18px 0", borderBottom: "1px solid var(--s-line)" }}>
          <span style={{ fontFamily: "var(--s-display)", fontWeight: "var(--s-weight)" as unknown as number, fontSize: 26 }}>{String(i + 1).padStart(2, "0")}</span>
          <Ed value={p.head} path={["content", "summary", "points", i, "head"]} placeholder={tx("要点", "Key point")} style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.45 }} />
          <Ed value={p.body} path={["content", "summary", "points", i, "body"]} multiline placeholder={tx("根拠をひとこと", "Supporting evidence")} style={{ fontSize: 17, lineHeight: 1.65, color: "var(--s-sub)" }} />
          {p.ref ? (
            <span style={{ fontFamily: MONO, fontSize: 13, color: "var(--s-sub)", textAlign: "right" }}>{summaryPage(p, slides)}</span>
          ) : (
            <Ed value={p.page} path={["content", "summary", "points", i, "page"]} placeholder="p." style={{ fontFamily: MONO, fontSize: 13, color: "var(--s-sub)", textAlign: "right" }} />
          )}
        </div>
      ))}
    </div>
  );
}
