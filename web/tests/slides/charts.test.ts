import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { exportPptx } from "@/ActivitySpace/sustainment/slides/kata/export/pptx";
import { mixTokens } from "@/ActivitySpace/sustainment/slides/kata/theme/mix";
import { LOOK_BY_ID } from "@/ActivitySpace/sustainment/slides/kata/theme/looks";
import { effectiveRoles } from "@/ActivitySpace/sustainment/slides/kata/model/deck";
import { guessKind, parseNumber, waterfallSteps } from "@/ActivitySpace/sustainment/slides/kata/model/chart";
import { switchLayout } from "@/ActivitySpace/sustainment/slides/kata/model/layouts";
import { SAMPLE_DECK } from "@/ActivitySpace/sustainment/slides/kata/model/seed";
import type { ChartKind, Deck } from "@/ActivitySpace/sustainment/slides/kata/model/types";

describe("charts", () => {
  it("数を読む", () => {
    expect(parseNumber("3.8万社")).toBe(38000);
    expect(parseNumber("1,200")).toBe(1200);
    expect(parseNumber("$1.2M")).toBe(1200000);
    expect(parseNumber("▲3%")).toBe(-3);
    expect(parseNumber("なし")).toBeNull();
  });
  it("見せたいことを推す", () => {
    expect(guessKind(["2022", "2023", "2024"], [1, 2, 3], "")).toBe("line");
    expect(guessKind(["A", "B", "C"], [50, 30, 20], "%")).toBe("share");
    expect(guessKind(["A", "B", "C"], [5, 3, 1], "社")).toBe("bar");
    // 増減の橋は、間が符号つきの増減のときだけ（マイナスが1つあるだけでは順位のまま）
    expect(guessKind(["始", "増", "減"], [10, 3, -2], "", ["10", "+3", "-2"])).toBe("waterfall");
    expect(guessKind(["始", "増", "減"], [10, 3, -2], "")).toBe("bar");
  });
  it("増減の橋は終わりの合計を足す", () => {
    const st = waterfallSteps([100, 20, -30]);
    expect(st.at(-1)).toEqual({ start: 0, end: 90, delta: 90, total: true });
  });
  it("数のあるページはグラフに変換でき、戻せる", () => {
    const s = SAMPLE_DECK.slides.find((x) => x.layout === "compare")!;
    const pitchLike = { ...s, layout: "claim3" as const, content: { claim3: { points: [{ head: "国内", body: "3.8万社" }, { head: "単価", body: "月3万円" }, { head: "市場", body: "460億円" }] } } };
    const c = switchLayout(pitchLike, "chart");
    expect(c.content.chart!.categories).toEqual(["国内", "単価", "市場"]);
    expect(switchLayout(c, "claim3").content.claim3).toEqual(pitchLike.content.claim3);
  });
  it("6種類とサマリーを PowerPoint に書き出せる", async () => {
    const kinds: ChartKind[] = ["share", "bar", "line", "column", "scatter", "waterfall"];
    const deck: Deck = {
      title: "c",
      storyline: "scr",
      slides: [
        { id: "s", title: "要約", layout: "summary", content: { summary: { points: [{ head: "a", body: "b", page: "p.2" }] } } },
        ...kinds.map((k, i) => ({ id: `c${i}`, title: k, layout: "chart" as const, content: { chart: { kind: k, categories: ["A", "B", "C"], series: [{ name: "x", values: [3, 2, -1 * (k === "waterfall" ? 1 : -1)] }, { name: "y", values: [1, 2, 3] }], unit: "%", highlight: 0, takeaway: "t" } } })),
      ],
    };
    const dir = fs.mkdtempSync("/tmp/kata-ch-");
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      await exportPptx(deck, mixTokens({ selected: ["forest"], pins: {}, offset: 0 }, LOOK_BY_ID), effectiveRoles(deck), "ch");
      expect(fs.statSync(`${dir}/ch.pptx`).size).toBeGreaterThan(30000);
    } finally {
      process.chdir(cwd);
    }
  }, 30000);
});

import { mixWarnings } from "@/ActivitySpace/sustainment/slides/kata/theme/mix";
describe("色覚への配慮", () => {
  it("色味だけで分かれた強調色と数字の地を警告する", () => {
    const t = { ...LOOK_BY_ID.forest.tokens, accent: { ...LOOK_BY_ID.forest.tokens.accent, accent: "#D55E00" }, number: { block: "#009E73", num: "#FFFFFF" } };
    expect(mixWarnings(t).length).toBeGreaterThan(0);
    expect(mixWarnings(LOOK_BY_ID.universal.tokens)).toEqual([]);
  });
});

import { planDeck } from "@/ActivitySpace/sustainment/slides/kata/model/planner";
describe("プランナーとグラフ・サマリー", () => {
  it("時間の並びの数表は推移のグラフになる", () => {
    const d = planDeck("# 報告\n\n## 売上の推移\n- 売上は3年で倍になった\n\n| 年 | 売上 |\n|---|---|\n| 2022 | 120 |\n| 2023 | 180 |\n| 2024 | 240 |\n");
    const c = d.slides.find((s) => s.layout === "chart")!;
    expect(c.content.chart!.kind).toBe("line");
    expect(c.content.chart!.categories).toEqual(["2022", "2023", "2024"]);
  });
  it("7枚以上の資料は2枚目がエグゼクティブサマリー", () => {
    const d = planDeck(fs.readFileSync("tests/slides/fixtures/minutes.md", "utf8"));
    expect(d.slides.length).toBeGreaterThanOrEqual(7);
    expect(d.slides[1].layout).toBe("summary");
    for (const p of d.slides[1].content.summary!.points) {
      const n = Number(p.page.replace("p.", "")) - 1;
      expect(d.slides[n].title).toBe(p.head);
    }
  });
});
