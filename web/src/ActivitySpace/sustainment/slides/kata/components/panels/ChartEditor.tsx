"use client";

import clsx from "clsx";
import { Plus, Trash2 } from "lucide-react";
import { useKata } from "@/ActivitySpace/sustainment/slides/kata/store/useKata";
import { updateSlide } from "@/ActivitySpace/sustainment/slides/kata/model/deck";
import { CHART_PURPOSES, parseNumber } from "@/ActivitySpace/sustainment/slides/kata/model/chart";
import type { ChartContent, Slide } from "@/ActivitySpace/sustainment/slides/kata/model/types";
import { tx } from "@/ActivitySpace/sustainment/slides/kata/i18n";

/** グラフのページの中身を直す。種類は「何を見せたいか」から選ぶ */
export function ChartEditor({ slide }: { slide: Slide }) {
  const editDeck = useKata((s) => s.editDeck);
  const c = slide.content.chart;
  if (!c) return null;
  const set = (fn: (c: ChartContent) => ChartContent) =>
    editDeck((d) => updateSlide(d, slide.id, (s) => ({ ...s, content: { ...s.content, chart: fn(s.content.chart!) } })));
  const multi = c.kind === "line" || c.kind === "column" || c.kind === "scatter";
  const seriesCount = c.kind === "scatter" ? 2 : c.series.length;

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-1.5">
        <h3 className="text-[12px] font-semibold">{tx("何を見せたいか", "What do you want to show?")}</h3>
        <p className="text-[11px] leading-relaxed text-k-ink-3">{tx("ゼラズニーの5つの比較と FT Visual Vocabulary に沿って、グラフの種類が決まります。", "Following Zelazny's five comparisons and the FT Visual Vocabulary, this picks the chart type.")}</p>
        <div className="grid grid-cols-2 gap-1.5">
          {CHART_PURPOSES.map((p) => (
            <button
              key={p.kind}
              type="button"
              aria-pressed={c.kind === p.kind}
              title={`${p.hint} — ${p.basis}`}
              onClick={() =>
                set((x) => {
                  const n = x.categories.length;
                  const series = p.kind === "scatter" && x.series.length < 2 ? [...x.series, { name: tx("縦軸", "Y"), values: Array(n).fill(0) }] : x.series;
                  return { ...x, kind: p.kind, series };
                })
              }
              className={clsx("flex flex-col gap-0.5 rounded-lg p-2 text-left", c.kind === p.kind ? "bg-k-chosen ring-2 ring-k-ink" : "ring-1 ring-k-line hover:ring-k-ink-3")}
            >
              <span className="text-[12px] font-semibold">{p.label}</span>
              <span className="text-[10px] text-k-ink-3">{p.hint}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className="text-[12px] font-semibold">{tx("数", "Data")}</h3>
          <label className="flex items-center gap-2 text-[11px] text-k-ink-2">
            {tx("単位", "Unit")}
            <input defaultValue={c.unit} key={`u-${c.unit}`} onBlur={(e) => set((x) => ({ ...x, unit: e.target.value.trim() }))} className="h-7 w-16 rounded-md border border-k-line-strong bg-k-panel px-2 text-[12px]" />
          </label>
        </div>
        <div className="flex flex-col gap-1">
          <div className="grid gap-1.5 text-[10px] text-k-ink-3" style={{ gridTemplateColumns: `minmax(0,1.4fr) repeat(${seriesCount}, minmax(0,1fr)) 24px 24px` }}>
            <span>{c.kind === "scatter" ? tx("点の名前", "Point") : tx("項目", "Item")}</span>
            {Array.from({ length: seriesCount }, (_, si) => (
              <input
                key={`s-${si}-${c.series[si]?.name ?? ""}`}
                defaultValue={c.series[si]?.name ?? ""}
                placeholder={c.kind === "scatter" ? (si === 0 ? tx("横軸", "X") : tx("縦軸", "Y")) : tx("系列{n}", "Series {n}", { n: si + 1 })}
                aria-label={tx("系列の名前", "Series name")}
                onBlur={(e) => set((x) => ({ ...x, series: x.series.map((s, j) => (j === si ? { ...s, name: e.target.value } : s)) }))}
                className="h-6 rounded border border-transparent bg-transparent px-1 text-[10px] hover:border-k-line"
              />
            ))}
            <span title={tx("立たせる", "Highlight")}>★</span>
            <span />
          </div>
          {c.categories.map((cat, i) => (
            <div key={`${i}-${cat}`} className="grid items-center gap-1.5" style={{ gridTemplateColumns: `minmax(0,1.4fr) repeat(${seriesCount}, minmax(0,1fr)) 24px 24px` }}>
              <input
                defaultValue={cat}
                aria-label={tx("項目名", "Item name")}
                onBlur={(e) => set((x) => ({ ...x, categories: x.categories.map((v, j) => (j === i ? e.target.value : v)) }))}
                className="h-8 min-w-0 rounded-md border border-k-line-strong bg-k-panel px-2 text-[12px]"
              />
              {Array.from({ length: seriesCount }, (_, si) => (
                <input
                  key={`${si}-${c.series[si]?.values[i] ?? 0}`}
                  defaultValue={String(c.series[si]?.values[i] ?? 0)}
                  inputMode="decimal"
                  aria-label={tx("値", "Value")}
                  onBlur={(e) => {
                    const v = parseNumber(e.target.value) ?? 0;
                    set((x) => ({ ...x, series: x.series.map((s, j) => (j === si ? { ...s, values: s.values.map((old, k) => (k === i ? v : old)) } : s)) }));
                  }}
                  className="h-8 min-w-0 rounded-md border border-k-line-strong bg-k-panel px-2 text-right font-mono text-[12px]"
                />
              ))}
              <input type="radio" name={`hl-${slide.id}`} checked={c.highlight === i} onChange={() => set((x) => ({ ...x, highlight: i }))} aria-label={tx("この項目を立たせる", "Highlight this item")} className="h-4 w-4 accent-[var(--k-ink)]" />
              <button
                type="button"
                aria-label={tx("この行を消す", "Remove row")}
                disabled={c.categories.length <= 2}
                onClick={() => set((x) => ({ ...x, categories: x.categories.filter((_, j) => j !== i), series: x.series.map((s) => ({ ...s, values: s.values.filter((_, j) => j !== i) })), highlight: x.highlight === i ? -1 : x.highlight > i ? x.highlight - 1 : x.highlight }))}
                className="flex h-6 w-6 items-center justify-center rounded text-k-ink-3 hover:text-k-danger disabled:opacity-25"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={c.categories.length >= 12}
            onClick={() => set((x) => ({ ...x, categories: [...x.categories, tx("項目{n}", "Item {n}", { n: x.categories.length + 1 })], series: x.series.map((s) => ({ ...s, values: [...s.values, 0] })) }))}
            className="flex h-8 items-center gap-1.5 rounded-md px-2 text-[12px] text-k-ink-2 hover:bg-k-hover hover:text-k-ink disabled:opacity-30"
          >
            <Plus size={13} /> {tx("行を足す", "Add row")}
          </button>
          {multi && c.kind !== "scatter" ? (
            <button
              type="button"
              disabled={c.series.length >= 3}
              onClick={() => set((x) => ({ ...x, series: [...x.series, { name: tx("系列{n}", "Series {n}", { n: x.series.length + 1 }), values: x.categories.map(() => 0) }] }))}
              className="flex h-8 items-center gap-1.5 rounded-md px-2 text-[12px] text-k-ink-2 hover:bg-k-hover hover:text-k-ink disabled:opacity-30"
            >
              <Plus size={13} /> {tx("系列を足す", "Add series")}
            </button>
          ) : null}
          <button type="button" onClick={() => set((x) => ({ ...x, highlight: -1 }))} className="ml-auto h-8 rounded-md px-2 text-[11px] text-k-ink-3 hover:bg-k-hover hover:text-k-ink">
            {tx("立たせない", "No highlight")}
          </button>
        </div>
      </section>
    </div>
  );
}
