import { describe, expect, it } from "vitest";
import { applyTerms, reviewWithSkills, type Skill } from "@/ActivitySpace/artifacts/slides/kata/model/skill";
import { SAMPLE_DECK } from "@/ActivitySpace/artifacts/slides/kata/model/seed";

const sk: Skill = { id: "a", name: "社内", enabled: true, terms: [{ from: "会員", to: "メンバー" }], banned: ["食卓"], maxTitle: 30 };

describe("skill", () => {
  it("決めた規則で赤入れが出る", () => {
    const f = reviewWithSkills(SAMPLE_DECK, [sk]);
    expect(f.some((x) => x.text.includes("メンバー"))).toBe(true);
    expect(f.some((x) => x.text.includes("食卓"))).toBe(true);
    expect(reviewWithSkills(SAMPLE_DECK, [{ ...sk, enabled: false }])).toEqual([]);
  });
  it("用語を一括でそろえ、id とレイアウトは変えない", () => {
    const { deck, count } = applyTerms(SAMPLE_DECK, [sk]);
    expect(count).toBeGreaterThan(0);
    expect(JSON.stringify(deck)).not.toContain("会員");
    expect(deck.slides.map((s) => s.id)).toEqual(SAMPLE_DECK.slides.map((s) => s.id));
    expect(deck.slides.map((s) => s.layout)).toEqual(SAMPLE_DECK.slides.map((s) => s.layout));
  });
});

import { respondLocally } from "@/ActivitySpace/artifacts/slides/kata/model/chat";
describe("chat × skill", () => {
  it("「用語をそろえて」でスキルの用語に直す", () => {
    const r = respondLocally(SAMPLE_DECK, 0, "用語をそろえて", [sk]);
    expect(JSON.stringify(r.deck)).not.toContain("会員");
  });
});

import { paletteFromPixels } from "@/ActivitySpace/artifacts/slides/kata/theme/custom";
import { contrast } from "@/ActivitySpace/artifacts/slides/kata/theme/mix";
import { reviewDeck } from "@/ActivitySpace/artifacts/slides/kata/model/review";
import { titleLimit } from "@/ActivitySpace/artifacts/slides/kata/model/skill";

describe("スキルのレビュー指摘の再発防止", () => {
  const deck = { ...SAMPLE_DECK, slides: SAMPLE_DECK.slides.map((s, i) => (i === 2 ? { ...s, title: "法人の課題と法人顧客の声", role: "要約" } : s)) };
  it("置き換え先に元の語が入っていても、何度押しても同じ", () => {
    const k: Skill = { ...sk, terms: [{ from: "法人", to: "法人顧客" }] };
    const a = applyTerms(deck, [k]);
    expect(a.count).toBe(1);
    expect(a.deck.slides[2].title).toBe("法人顧客の課題と法人顧客の声");
    const b = applyTerms(a.deck, [k]);
    expect(b.count).toBe(0);
    expect(reviewWithSkills(a.deck, [k]).filter((f) => f.kind === "用語")).toEqual([]);
  });
  it("置き換え先が空の用語は使わず、役割や出どころは書き換えない", () => {
    expect(applyTerms(deck, [{ ...sk, terms: [{ from: "法人", to: "" }] }]).count).toBe(0);
    const r = applyTerms(deck, [{ ...sk, terms: [{ from: "要約", to: "サマリー" }, { from: "議事録", to: "記録" }] }]);
    expect(r.deck.slides[2].role).toBe("要約");
    expect(r.deck.slides[2].source).toBe(deck.slides[2].source);
  });
  it("タイトルの上限はスキルで変えられ、二重に指摘しない", () => {
    const long = { ...deck, slides: [{ ...deck.slides[1], title: "あ".repeat(55) + "する" }] };
    expect(reviewDeck(long, titleLimit([{ ...sk, maxTitle: 80 }])).filter((f) => f.kind === "長さ")).toEqual([]);
    expect(reviewDeck(long, titleLimit([{ ...sk, maxTitle: 40 }])).filter((f) => f.kind === "長さ")).toHaveLength(1);
  });
  it("1色だけの画像でも、強調色が地に埋もれない", () => {
    const t = paletteFromPixels(Array.from({ length: 500 }, () => [0, 0, 0] as [number, number, number]));
    expect(contrast(t.accent.accent, t.ground.bg)).toBeGreaterThan(3);
  });
});
