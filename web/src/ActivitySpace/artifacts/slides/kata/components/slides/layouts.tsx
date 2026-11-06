"use client";

import type { CSSProperties } from "react";
import type { Slide } from "@/ActivitySpace/artifacts/slides/kata/model/types";
import { Ed, useSlideTx } from "./Editable";
import { kpiSize } from "@/ActivitySpace/artifacts/slides/kata/model/layouts";
import { ChartBody, SummaryBody } from "./ChartBody";
import { isNumericHead } from "@/ActivitySpace/artifacts/slides/kata/model/figure";
import { tx } from "@/ActivitySpace/artifacts/slides/kata/i18n";
import { useActiveFile } from "@/ActivitySpace/artifacts/slides/kata/store/useKata";
import { summaryPage } from "@/ActivitySpace/artifacts/slides/kata/model/deck";

const MONO = "var(--font-plex-mono), monospace";
const display: CSSProperties = {
  fontFamily: "var(--s-display)",
  fontWeight: "var(--s-weight)" as unknown as number,
  letterSpacing: "var(--s-tracking)",
};
const n2 = (i: number) => String(i + 1).padStart(2, "0");

export function Body({ slide }: { slide: Slide }) {
  switch (slide.layout) {
    case "cover":
      return <Cover slide={slide} />;
    case "statement":
      return <Statement slide={slide} />;
    case "compare":
      return <Compare slide={slide} />;
    case "premise":
      return <Premise slide={slide} />;
    case "claim3":
      return <Claim3 slide={slide} />;
    case "issue":
      return <Issue slide={slide} />;
    case "steps":
      return <Steps slide={slide} />;
    case "matrix":
      return <Matrix slide={slide} />;
    case "chart":
      return <ChartBody slide={slide} />;
    case "summary":
      return <SummaryBody slide={slide} />;
    case "agenda":
      return <Agenda slide={slide} />;
    case "grid":
      return <Grid slide={slide} />;
    case "kpi":
      return <Kpi slide={slide} />;
    case "closing":
      return <Closing slide={slide} />;
    case "free":
      return null;
  }
}

function Cover({ slide }: { slide: Slide }) {
  const c = slide.content.cover ?? { subtitle: "", meta: "" };
  return (
    <div style={{ position: "absolute", inset: 0, display: "grid", gridTemplateColumns: "minmax(0, 1fr) 380px" }}>
      <div style={{ padding: "72px 72px 64px 88px", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
        <Ed value={c.meta} path={["content", "cover", "meta"]} placeholder={tx("資料名・日付", "Deck name · date")} style={{ fontFamily: MONO, fontSize: 14, letterSpacing: "0.08em", color: "var(--s-sub)" }} />
        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <Ed
            as="h1"
            value={slide.title}
            path={["title"]}
            multiline
            placeholder={tx("資料のタイトル", "Deck title")}
            style={{ ...display, margin: 0, fontSize: slide.title.length > 22 ? 52 : 64, lineHeight: 1.25 }}
          />
          <div style={{ width: 72, height: 5, background: "var(--s-accent)", borderRadius: "var(--s-radius-pill)" }} />
          <Ed value={c.subtitle} path={["content", "cover", "subtitle"]} multiline placeholder={tx("この資料で伝えたいこと", "What this deck needs to say")} style={{ fontSize: 22, lineHeight: 1.6, color: "var(--s-sub)", maxWidth: 640 }} />
        </div>
      </div>
      <div style={{ background: "var(--s-block)", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", width: 260, height: 260, left: -130, top: 120, background: "var(--s-dot)", borderRadius: "var(--s-radius-pill)" }} />
        <div style={{ position: "absolute", right: 40, bottom: 40, display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-end" }}>
          {[160, 110, 70].map((w) => (
            <div key={w} style={{ width: w, height: 4, background: "var(--s-num)", opacity: 0.85 }} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Statement({ slide }: { slide: Slide }) {
  const c = slide.content.statement ?? { lead: "", figure: "" };
  return (
    <div style={{ display: "flex", gap: 48, width: "100%", alignItems: "stretch" }}>
      <div style={{ width: 420, flexShrink: 0, background: "var(--s-block)", borderRadius: "var(--s-radius)", display: "flex", alignItems: "center", justifyContent: "center", padding: 32 }}>
        <Ed value={c.figure} path={["content", "statement", "figure"]} placeholder={tx("数字か一言", "A number or a word")} style={{ ...display, fontSize: c.figure.length > 6 ? 56 : 88, lineHeight: 1.1, color: "var(--s-num)", textAlign: "center" }} />
      </div>
      <div style={{ flexGrow: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 18 }}>
        <Ed value={c.lead} path={["content", "statement", "lead"]} multiline placeholder={tx("言い切りを支える一文", "One line backing the claim")} style={{ fontSize: 26, lineHeight: 1.7, fontWeight: 500 }} />
      </div>
    </div>
  );
}

function Compare({ slide }: { slide: Slide }) {
  const c = slide.content.compare ?? { columns: [], rows: [], highlight: 0, takeaways: [] };
  const hasTake = c.takeaways.length > 0;
  const cols = `170px repeat(${Math.max(1, c.columns.length)}, minmax(0, 1fr))`;
  const fs = c.rows.length > 4 ? 16 : 18;
  return (
    <div style={{ display: "flex", gap: 44, width: "100%" }}>
      <div style={{ flexGrow: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <div style={{ display: "grid", gridTemplateColumns: cols, borderBottom: "2px solid var(--s-ink)" }}>
          <div />
          {c.columns.map((col, i) => (
            <Ed
              key={i}
              value={col}
              path={["content", "compare", "columns", i]}
              style={{ padding: "12px 16px", fontSize: 19, fontWeight: 700, background: i === c.highlight ? "var(--s-tint)" : undefined }}
            />
          ))}
        </div>
        {c.rows.map((r, ri) => (
          // 行は本文の高さいっぱいに広げる（下に空きを残さない）。ただし行が少ないときは広げすぎない
          <div key={ri} style={{ display: "grid", gridTemplateColumns: cols, borderBottom: ri === c.rows.length - 1 ? undefined : "1px solid var(--s-line)", flex: "1 1 0", maxHeight: 120, minHeight: "min-content" }}>
            <Ed value={r.label} path={["content", "compare", "rows", ri, "label"]} style={{ padding: "16px 8px 16px 0", fontSize: 16, color: "var(--s-sub)", fontWeight: 500 }} />
            {c.columns.map((_, ci) => (
              <Ed
                key={ci}
                value={r.cells[ci] ?? ""}
                path={["content", "compare", "rows", ri, "cells", ci]}
                placeholder="—"
                multiline
                style={{ padding: "16px", fontSize: fs, lineHeight: 1.55, background: ci === c.highlight ? "var(--s-tint)" : undefined, fontWeight: ci === c.highlight ? 600 : 400 }}
              />
            ))}
          </div>
        ))}
      </div>
      {hasTake ? (
        <div style={{ width: 300, flexShrink: 0, borderLeft: "1px solid var(--s-line)", paddingLeft: 32, display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ fontFamily: MONO, fontSize: 12, letterSpacing: "0.08em", color: "var(--s-sub)" }}>SO WHAT</div>
          {c.takeaways.map((t, i) => (
            <div key={i} style={{ display: "flex", gap: 12 }}>
              <span style={{ width: 6, height: 6, marginTop: 11, flexShrink: 0, background: "var(--s-accent)", borderRadius: "var(--s-radius-pill)", outline: "1px solid color-mix(in srgb, var(--s-ink) 25%, transparent)" }} />
              <Ed value={t} path={["content", "compare", "takeaways", i]} multiline style={{ fontSize: 18, lineHeight: 1.65 }} />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Premise({ slide }: { slide: Slide }) {
  const c = slide.content.premise ?? { premises: [], conclusion: "", figure: "" };
  return (
    <div style={{ display: "flex", gap: 32, width: "100%", alignItems: "stretch" }}>
      <div style={{ flexGrow: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 0, borderTop: "1px solid var(--s-line)" }}>
        {c.premises.map((p, i) => (
          <div key={i} style={{ display: "flex", gap: 24, padding: "26px 0", borderBottom: "1px solid var(--s-line)", alignItems: "baseline" }}>
            <span style={{ fontFamily: MONO, fontSize: 14, color: "var(--s-sub)", letterSpacing: "0.06em" }}>{n2(i)}</span>
            <Ed value={p} path={["content", "premise", "premises", i]} multiline placeholder={tx("前提となる事実", "A supporting fact")} style={{ fontSize: 22, lineHeight: 1.6 }} />
          </div>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", color: "var(--s-sub)" }}>
        <svg width="40" height="24" viewBox="0 0 40 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
          <path d="M2 12h32M26 4l8 8-8 8" />
        </svg>
      </div>
      <div style={{ width: 400, flexShrink: 0, background: "var(--s-block)", color: "var(--s-num)", borderRadius: "var(--s-radius)", padding: "40px 36px", display: "flex", flexDirection: "column", justifyContent: "center", gap: 20 }}>
        <div style={{ fontFamily: MONO, fontSize: 12, letterSpacing: "0.1em", opacity: 0.8 }}>THEREFORE</div>
        <Ed value={c.figure} path={["content", "premise", "figure"]} placeholder={tx("一言で", "In a word")} style={{ ...display, fontSize: 48, lineHeight: 1.15 }} />
        <Ed value={c.conclusion} path={["content", "premise", "conclusion"]} multiline placeholder={tx("だから言えること", "So what follows")} style={{ fontSize: 20, lineHeight: 1.6, fontWeight: 500 }} />
      </div>
    </div>
  );
}

function Claim3({ slide }: { slide: Slide }) {
  const pts = slide.content.claim3?.points ?? [];
  // 見出しが数字なら、数字を主役にする（市場規模・実績など）
  const numeric = pts.length > 0 && pts.every((p) => isNumericHead(p.head));
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.max(1, pts.length)}, minmax(0, 1fr))`, gap: 24, width: "100%", alignItems: "start", alignSelf: "center" }}>
      {pts.map((p, i) => (
        // カードは中身に合わせた高さ。言いたいことが短くても、間延びしない
        <div key={i} style={{ background: "var(--s-tint)", borderRadius: "var(--s-radius)", padding: "28px 30px 34px", display: "flex", flexDirection: "column", gap: 18, minHeight: 250 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontFamily: MONO, fontSize: 14, letterSpacing: "0.08em", color: "var(--s-sub)" }}>{n2(i)}</span>
            <span style={{ width: 10, height: 10, borderRadius: "var(--s-radius-pill)", background: "var(--s-block)", opacity: i === 0 ? 1 : 0.22 }} />
          </div>
          <div style={{ width: 32, height: 3, background: "var(--s-accent)", outline: "1px solid color-mix(in srgb, var(--s-ink) 12%, transparent)" }} />
          <Ed
            value={p.head}
            path={["content", "claim3", "points", i, "head"]}
            placeholder={tx("根拠の見出し", "Reason headline")}
            style={{ ...display, fontSize: numeric ? (p.head.length > 7 ? 46 : 60) : p.head.length > 12 ? 26 : 30, lineHeight: numeric ? 1.05 : 1.3 }}
          />
          <Ed value={p.body} path={["content", "claim3", "points", i, "body"]} multiline placeholder={tx("根拠の中身", "Reason details")} style={{ fontSize: 18, lineHeight: 1.7, color: "var(--s-sub)" }} />
        </div>
      ))}
    </div>
  );
}

function Issue({ slide }: { slide: Slide }) {
  const st = useSlideTx();
  const pairs = slide.content.issue?.pairs ?? [];
  const cols = "minmax(0, 1fr) 56px minmax(0, 1fr)";
  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", gap: 14 }}>
      <div style={{ display: "grid", gridTemplateColumns: cols, fontFamily: MONO, fontSize: 12, letterSpacing: "0.1em", color: "var(--s-sub)" }}>
        <span>ISSUE{st(" — 課題", "")}</span>
        <span />
        <span>ACTION{st(" — 打ち手", "")}</span>
      </div>
      {pairs.map((p, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: cols, alignItems: "stretch" }}>
          <Ed value={p.issue} path={["content", "issue", "pairs", i, "issue"]} multiline placeholder={tx("課題", "Issue")} style={{ border: "1px solid var(--s-line)", borderRadius: "var(--s-radius)", padding: "20px 22px", fontSize: 18, lineHeight: 1.6 }} />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", color: "var(--s-sub)" }}>
            <svg width="24" height="16" viewBox="0 0 24 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M1 8h19M14 2l6 6-6 6" />
            </svg>
          </div>
          <Ed value={p.action} path={["content", "issue", "pairs", i, "action"]} multiline placeholder={tx("打ち手", "Action")} style={{ background: "var(--s-tint)", borderRadius: "var(--s-radius)", padding: "20px 22px", fontSize: 18, lineHeight: 1.6, fontWeight: 500 }} />
        </div>
      ))}
    </div>
  );
}

function Steps({ slide }: { slide: Slide }) {
  const steps = slide.content.steps?.steps ?? [];
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.max(1, steps.length)}, minmax(0, 1fr))`, gap: 0, width: "100%", alignContent: "center" }}>
      {steps.map((s, i) => (
        <div key={i} style={{ display: "flex", flexDirection: "column", gap: 18, paddingRight: 28 }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <div style={{ width: 60, height: 60, flexShrink: 0, background: "var(--s-block)", color: "var(--s-num)", borderRadius: "var(--s-radius-pill)", display: "flex", alignItems: "center", justifyContent: "center", ...display, fontSize: 22 }}>{n2(i)}</div>
            {i < steps.length - 1 ? <div style={{ flexGrow: 1, height: 2, background: "var(--s-line)", marginLeft: 16 }} /> : null}
          </div>
          <Ed value={s.head} path={["content", "steps", "steps", i, "head"]} placeholder={tx("段階", "Step")} style={{ ...display, fontSize: 28, lineHeight: 1.3 }} />
          <Ed value={s.body} path={["content", "steps", "steps", i, "body"]} multiline placeholder={tx("この段階でやること", "What happens in this step")} style={{ fontSize: 17, lineHeight: 1.7, color: "var(--s-sub)" }} />
        </div>
      ))}
    </div>
  );
}

function Matrix({ slide }: { slide: Slide }) {
  const c = slide.content.matrix ?? { x: { low: "", high: "" }, y: { low: "", high: "" }, cells: [], highlight: 1 };
  const axis: CSSProperties = { fontFamily: MONO, fontSize: 12, letterSpacing: "0.06em", color: "var(--s-sub)" };
  return (
    <div style={{ display: "grid", gridTemplateColumns: "28px minmax(0, 1fr)", gridTemplateRows: "minmax(0, 1fr) 28px", width: "100%", gap: 10 }}>
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", alignItems: "center", paddingBlock: 4 }}>
        <Ed value={c.y.high} path={["content", "matrix", "y", "high"]} placeholder={tx("高", "High")} style={{ ...axis, writingMode: "vertical-rl" }} />
        <div style={{ flexGrow: 1, width: 2, background: "var(--s-line)", margin: "8px 0" }} />
        <Ed value={c.y.low} path={["content", "matrix", "y", "low"]} placeholder={tx("低", "Low")} style={{ ...axis, writingMode: "vertical-rl" }} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gridTemplateRows: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
        {c.cells.map((cell, i) => {
          const on = i === c.highlight;
          return (
            <div key={i} style={{ background: on ? "var(--s-block)" : "var(--s-tint)", color: on ? "var(--s-num)" : "var(--s-ink)", borderRadius: "var(--s-radius)", padding: "20px 24px", display: "flex", flexDirection: "column", gap: 8, minHeight: 0 }}>
              <Ed value={cell.head} path={["content", "matrix", "cells", i, "head"]} placeholder={tx("象限の名前", "Quadrant name")} style={{ ...display, fontSize: 22, lineHeight: 1.3 }} />
              <Ed value={cell.body} path={["content", "matrix", "cells", i, "body"]} multiline placeholder={tx("ここに入るもの", "What belongs here")} style={{ fontSize: 15, lineHeight: 1.6, opacity: on ? 0.92 : 0.78 }} />
            </div>
          );
        })}
      </div>
      <div />
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Ed value={c.x.low} path={["content", "matrix", "x", "low"]} placeholder={tx("低", "Low")} style={axis} />
        <div style={{ flexGrow: 1, height: 2, background: "var(--s-line)" }} />
        <Ed value={c.x.high} path={["content", "matrix", "x", "high"]} placeholder={tx("高", "High")} style={axis} />
      </div>
    </div>
  );
}

function Closing({ slide }: { slide: Slide }) {
  const st = useSlideTx();
  const asks = slide.content.closing?.asks ?? [];
  return (
    <div style={{ display: "flex", gap: 48, width: "100%" }}>
      <div style={{ flexGrow: 1, display: "flex", flexDirection: "column", justifyContent: "center", borderTop: "2px solid var(--s-ink)" }}>
        {asks.map((a, i) => (
          <div key={i} style={{ display: "flex", gap: 28, padding: "26px 0", borderBottom: "1px solid var(--s-line)", alignItems: "baseline" }}>
            <span style={{ ...display, fontSize: 40, lineHeight: 1, minWidth: 64 }}>{n2(i)}</span>
            <Ed value={a} path={["content", "closing", "asks", i]} multiline placeholder={tx("決めてほしいこと・お願い", "Decision or request")} style={{ fontSize: 24, lineHeight: 1.6, fontWeight: 500 }} />
          </div>
        ))}
      </div>
      <div style={{ width: 260, flexShrink: 0, background: "var(--s-accent)", color: "var(--s-on-accent)", borderRadius: "var(--s-radius)", padding: 32, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
        <div style={{ fontFamily: MONO, fontSize: 12, letterSpacing: "0.1em" }}>NEXT</div>
        <div style={{ ...display, fontSize: 36, lineHeight: 1.25, marginTop: 10 }}>{st("お願いしたいこと", "Our asks")}</div>
      </div>
    </div>
  );
}

function Agenda({ slide }: { slide: Slide }) {
  const c = slide.content.agenda ?? { items: [], current: -1 };
  const all = useActiveFile()?.deck.slides;
  const slides = all?.some((x) => x.id === slide.id) ? all : undefined;
  const divider = c.current >= 0;
  const rowH = c.items.length > 6 ? 58 : 70;
  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", justifyContent: "center", borderTop: "2px solid var(--s-ink)" }}>
      {c.items.map((it, i) => {
        const on = i === c.current;
        const dim = divider && !on;
        return (
          <div
            key={i}
            style={{
              display: "grid",
              gridTemplateColumns: "72px minmax(0, 1fr) 90px",
              alignItems: "center",
              minHeight: rowH,
              borderBottom: "1px solid var(--s-line)",
              background: on ? "var(--s-block)" : undefined,
              color: on ? "var(--s-num)" : dim ? "var(--s-sub)" : "var(--s-ink)",
              opacity: dim ? 0.55 : 1,
              paddingInline: on ? 20 : 0,
              borderRadius: on ? "var(--s-radius)" : undefined,
            }}
          >
            <span style={{ ...display, fontSize: 28, lineHeight: 1 }}>{n2(i)}</span>
            <Ed value={it.head} path={["content", "agenda", "items", i, "head"]} placeholder={tx("章の見出し", "Chapter")} style={{ ...display, fontSize: c.items.length > 6 ? 22 : 26, lineHeight: 1.35 }} />
            {it.ref ? (
              <span style={{ fontFamily: MONO, fontSize: 14, letterSpacing: "0.06em", textAlign: "right", opacity: 0.8 }}>{summaryPage(it, slides)}</span>
            ) : (
              <Ed value={it.page} path={["content", "agenda", "items", i, "page"]} placeholder="p." style={{ fontFamily: MONO, fontSize: 14, letterSpacing: "0.06em", textAlign: "right", opacity: 0.8 }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/** 一覧の列の数：4つまでは横一列、6つまで3列、7〜8は4列、9は3列、10以上は4列 */
function gridCols(n: number): number {
  return n <= 4 ? Math.max(2, n) : n <= 6 ? 3 : n <= 8 ? 4 : n === 9 ? 3 : 4;
}

function Grid({ slide }: { slide: Slide }) {
  const cards = slide.content.grid?.cards ?? [];
  const n = cards.length;
  const cols = gridCols(n);
  const dense = n > 6;
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: dense ? 14 : 20, width: "100%", alignContent: "center" }}>
      {cards.map((p, i) => (
        <div key={i} style={{ borderTop: "3px solid var(--s-accent)", background: "var(--s-tint)", borderRadius: "var(--s-radius)", padding: dense ? "14px 18px 16px" : "20px 24px 24px", display: "flex", flexDirection: "column", gap: dense ? 6 : 10 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
            <span style={{ fontFamily: MONO, fontSize: 12, letterSpacing: "0.08em", color: "var(--s-sub)" }}>{n2(i)}</span>
            {p.head || !p.body ? <Ed value={p.head} path={["content", "grid", "cards", i, "head"]} placeholder={tx("見出し", "Headline")} style={{ ...display, fontSize: n > 9 ? 17 : dense ? 19 : 23, lineHeight: 1.3 }} /> : null}
          </div>
          {/* 見出しの無いカードは、文をそのまま主役にする */}
          <Ed value={p.body} path={["content", "grid", "cards", i, "body"]} multiline placeholder={tx("中身", "Details")} style={p.head ? { fontSize: n > 9 ? 13 : dense ? 14 : 16, lineHeight: 1.6, color: "var(--s-sub)" } : { fontSize: dense ? 16 : 19, lineHeight: 1.55, fontWeight: 500 }} />
        </div>
      ))}
    </div>
  );
}

function Kpi({ slide }: { slide: Slide }) {
  const stats = slide.content.kpi?.stats ?? [];
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.max(1, stats.length)}, minmax(0, 1fr))`, gap: 0, width: "100%", alignItems: "stretch", alignSelf: "center" }}>
      {stats.map((p, i) => (
        <div key={i} style={{ display: "flex", flexDirection: "column", gap: 14, padding: "8px 32px 8px", borderLeft: i ? "1px solid var(--s-line)" : undefined, paddingLeft: i ? 32 : 0 }}>
          <Ed value={p.value} path={["content", "kpi", "stats", i, "value"]} placeholder={tx("数字", "Number")} style={{ ...display, fontSize: kpiSize(p.value, stats.length), lineHeight: 1.02, whiteSpace: "nowrap", color: i === 0 ? "var(--s-block)" : "var(--s-ink)" }} />
          <div style={{ width: 40, height: 4, background: "var(--s-accent)", borderRadius: "var(--s-radius-pill)" }} />
          <Ed value={p.label} path={["content", "kpi", "stats", i, "label"]} placeholder={tx("何の数字か", "What it measures")} style={{ fontSize: 21, lineHeight: 1.45, fontWeight: 600 }} />
          <Ed value={p.note} path={["content", "kpi", "stats", i, "note"]} multiline placeholder={tx("意味・比較", "What it means")} style={{ fontSize: 16, lineHeight: 1.6, color: "var(--s-sub)" }} />
        </div>
      ))}
    </div>
  );
}
