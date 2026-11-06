import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { reviewDeck, reviewSlide } from "@/ActivitySpace/artifacts/slides/kata/model/review";
import { SAMPLE_DECK } from "@/ActivitySpace/artifacts/slides/kata/model/seed";
import { compressDeck, respondLocally } from "@/ActivitySpace/artifacts/slides/kata/model/chat";
import { exportPptx } from "@/ActivitySpace/artifacts/slides/kata/export/pptx";
import { mixTokens } from "@/ActivitySpace/artifacts/slides/kata/theme/mix";
import { LOOK_BY_ID } from "@/ActivitySpace/artifacts/slides/kata/theme/looks";
import { effectiveRoles } from "@/ActivitySpace/artifacts/slides/kata/model/deck";
import type { Slide } from "@/ActivitySpace/artifacts/slides/kata/model/types";

const base: Slide = { id: "x", title: "", layout: "claim3", content: { claim3: { points: [{ head: "a", body: "b" }, { head: "c", body: "d" }] } } };

describe("review", () => {
  it("見本デッキは機械チェックで指摘ゼロ", () => {
    expect(reviewDeck(SAMPLE_DECK)).toEqual([]);
  });
  it("です・ます、空タイトル、数の不一致を拾う", () => {
    expect(reviewSlide({ ...base, title: "売上が伸びています" }).map((f) => f.kind)).toContain("語尾");
    expect(reviewSlide({ ...base, title: "" }).map((f) => f.kind)).toContain("空欄");
    expect(reviewSlide({ ...base, title: "伸ばすには3つの打ち手がある" }).map((f) => f.kind)).toContain("数");
  });
  it("用語ゆれと結びの欠落を拾う", () => {
    const d = { ...SAMPLE_DECK, slides: SAMPLE_DECK.slides.slice(0, 5).map((s, i) => (i === 2 ? { ...s, title: "法人向けで稼ぐ構造にする" } : i === 3 ? { ...s, title: "企業向けプログラムを売る" } : s)) };
    const kinds = reviewDeck(d).map((f) => f.kind);
    expect(kinds).toContain("用語");
    expect(kinds).toContain("構成");
  });
});

describe("chat", () => {
  it("枚数を指定して絞ると、表紙と結びが残る", () => {
    const d = compressDeck(SAMPLE_DECK, 6);
    expect(d.slides).toHaveLength(6);
    expect(d.slides[0].layout).toBe("cover");
    expect(d.slides.at(-1)!.layout).toBe("closing");
  });
  it("漢数字の枚数も読む", () => {
    expect(respondLocally(SAMPLE_DECK, 0, "五枚にまとめて").deck?.slides).toHaveLength(5);
    expect(respondLocally(SAMPLE_DECK, 0, "十二枚にまとめて").deck).toBeUndefined();
  });
  it("このページの型を変える・足す・消す", () => {
    const r = respondLocally(SAMPLE_DECK, 2, "このページを比較にして");
    expect(r.deck!.slides[2].layout).toBe("compare");
    const a = respondLocally(SAMPLE_DECK, 2, "最後に、価格の比較を1枚足して");
    expect(a.deck!.slides).toHaveLength(SAMPLE_DECK.slides.length + 1);
    expect(a.deck!.slides[a.current!].title).toContain("価格の比較");
    const del = respondLocally(SAMPLE_DECK, 2, "このページは消して");
    expect(del.deck!.slides).toHaveLength(SAMPLE_DECK.slides.length - 1);
  });
  it("議事録を流すと組み直す", () => {
    const md = fs.readFileSync("tests/slides/fixtures/minutes.md", "utf8");
    const r = respondLocally(SAMPLE_DECK, 0, md);
    expect(r.deck!.slides.length).toBeGreaterThan(5);
  });
});

describe("pptx", () => {
  it("全レイアウトを書き出せる", async () => {
    const cwd = process.cwd();
    const dir = fs.mkdtempSync("/tmp/kata-pptx-");
    process.chdir(dir);
    try {
      const t = mixTokens({ selected: ["noir", "sumi"], pins: {}, offset: 0 }, LOOK_BY_ID);
      await exportPptx(SAMPLE_DECK, t, effectiveRoles(SAMPLE_DECK), "test");
      const stat = fs.statSync(`${dir}/test.pptx`);
      expect(stat.size).toBeGreaterThan(20000);
    } finally {
      process.chdir(cwd);
    }
  }, 30000);
});

import { fitSize } from "@/ActivitySpace/artifacts/slides/kata/export/pptx";
describe("pptx fitSize", () => {
  it("短い文はそのまま、長い文は縮める", () => {
    expect(fitSize("短い", 300, 40, 20)).toBe(20);
    const long = "とても長い文章が続いている。".repeat(20);
    const s = fitSize(long, 300, 120, 20);
    expect(s).toBeLessThan(20);
    expect(s).toBeGreaterThanOrEqual(12);
  });
});
