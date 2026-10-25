import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setLang } from "@/ActivitySpace/sustainment/slides/kata/i18n";
import { ISSUES, respondLocally } from "@/ActivitySpace/sustainment/slides/kata/model/chat";
import { reviewDeck, reviewSlide } from "@/ActivitySpace/sustainment/slides/kata/model/review";
import { SAMPLE_DECK } from "@/ActivitySpace/sustainment/slides/kata/model/seed";
import type { Slide } from "@/ActivitySpace/sustainment/slides/kata/model/types";

// 英語で表示しているときの、チャットの頼み方と赤入れの文
beforeAll(() => setLang("en"));
afterAll(() => setLang("ja"));

const ascii = (s: string) => !/[ぁ-んァ-ヶ一-龠]/.test(s);

describe("English chat commands", () => {
  it("Review this deck → red-pen notes in English", () => {
    const d = { ...SAMPLE_DECK, slides: SAMPLE_DECK.slides.map((s, i) => (i === 3 ? { ...s, title: "" } : s)) };
    const r = respondLocally(d, 0, "Review this deck");
    expect(r.deck).toBeUndefined();
    expect(r.reply).toMatch(/red-pen note/);
    expect(r.reply).toContain("The title is empty");
  });

  it("red-pen / check also review", () => {
    expect(respondLocally(SAMPLE_DECK, 0, "red-pen it").reply).toMatch(/Nothing to flag/);
    expect(respondLocally(SAMPLE_DECK, 0, "Check the deck").reply).toMatch(/Nothing to flag/);
  });

  it("Make this page a comparison / a 2×2", () => {
    const a = respondLocally(SAMPLE_DECK, 2, "Make this page a comparison");
    expect(a.deck!.slides[2].layout).toBe("compare");
    expect(ascii(a.reply)).toBe(true);
    expect(respondLocally(SAMPLE_DECK, 2, "Make this page a 2×2").deck!.slides[2].layout).toBe("matrix");
    expect(respondLocally(SAMPLE_DECK, 2, "Make this slide a matrix").deck!.slides[2].layout).toBe("matrix");
    expect(respondLocally(SAMPLE_DECK, 4, "Make this page three reasons").deck!.slides[4].layout).toBe("claim3");
    expect(respondLocally(SAMPLE_DECK, 4, "Make this page steps").deck!.slides[4].layout).toBe("steps");
    expect(respondLocally(SAMPLE_DECK, 4, "Make this page issue → action").deck!.slides[4].layout).toBe("issue");
    expect(respondLocally(SAMPLE_DECK, 4, "Make this page a premise").deck!.slides[4].layout).toBe("premise");
    expect(respondLocally(SAMPLE_DECK, 4, "Make this page a headline").deck!.slides[4].layout).toBe("statement");
  });

  it("Reorder answer first / SCR / sky rain umbrella / issue → cause", () => {
    expect(respondLocally(SAMPLE_DECK, 0, "Reorder answer first").deck!.storyline).toBe("pyramid");
    expect(respondLocally({ ...SAMPLE_DECK, storyline: "pyramid" }, 0, "Reorder as situation → complication → resolution").deck!.storyline).toBe("scr");
    expect(respondLocally({ ...SAMPLE_DECK, storyline: "pyramid" }, 0, "Reorder as SCR").deck!.storyline).toBe("scr");
    expect(respondLocally(SAMPLE_DECK, 0, "Reorder as sky rain umbrella").deck!.storyline).toBe("skyrain");
    expect(respondLocally(SAMPLE_DECK, 0, "Reorder as issue → cause").deck!.storyline).toBe("issue");
  });

  it("Condense to 6 slides / number words", () => {
    const r = respondLocally(SAMPLE_DECK, 3, "Condense to 6 slides");
    expect(r.deck!.slides).toHaveLength(6);
    expect(r.reply).toMatch(/^Condensed from 10 to 6/);
    expect(respondLocally(SAMPLE_DECK, 0, "Cut to five slides").deck!.slides).toHaveLength(5);
    expect(respondLocally(SAMPLE_DECK, 0, "shrink to twelve pages").deck).toBeUndefined();
  });

  it("Align terms", () => {
    const d = { ...SAMPLE_DECK, slides: SAMPLE_DECK.slides.map((s, i) => (i === 2 ? { ...s, title: "法人向けで稼ぐ" } : s)) };
    const skill = { id: "k", name: "House", enabled: true, terms: [{ from: "法人向け", to: "企業向け" }], banned: [], maxTitle: null };
    const r = respondLocally(d, 0, "Align terms", [skill]);
    expect(r.deck!.slides[2].title).toBe("企業向けで稼ぐ");
    expect(r.reply).toBe("Aligned 1 place to your My Skills terms.");
    expect(respondLocally(d, 0, "Unify terms", []).reply).toMatch(/Nothing to change/);
  });

  it("Delete this page", () => {
    const r = respondLocally(SAMPLE_DECK, 3, "Delete this page");
    expect(r.deck!.slides).toHaveLength(SAMPLE_DECK.slides.length - 1);
    expect(r.reply).toBe("Deleted 04.");
    expect(respondLocally(SAMPLE_DECK, 3, "remove this slide").deck!.slides).toHaveLength(SAMPLE_DECK.slides.length - 1);
  });

  it("Add a slide about X (at the end goes before the close)", () => {
    const r = respondLocally(SAMPLE_DECK, 2, "Add a slide about the first dinner plan at the end");
    const n = r.deck!.slides.length;
    expect(n).toBe(SAMPLE_DECK.slides.length + 1);
    expect(r.deck!.slides[n - 2].title).toBe("The first dinner plan");
    expect(r.deck!.slides[n - 1].layout).toBe("closing");
    const here = respondLocally(SAMPLE_DECK, 2, "Add a page on review cadence");
    expect(here.deck!.slides[here.current!].title).toBe("Review cadence");
  });

  it("issue framing accepts either language", () => {
    for (const x of ISSUES) {
      expect(ascii(x.ask)).toBe(true);
      expect(respondLocally(SAMPLE_DECK, 3, x.askEn).deck!.storyline).toBe(x.storyline);
      expect(respondLocally(SAMPLE_DECK, 3, x.askJa).deck!.storyline).toBe(x.storyline);
    }
  });

  it("help lists English examples", () => {
    const r = respondLocally(SAMPLE_DECK, 0, "hello");
    expect(r.reply).toContain("Make this page a comparison");
    expect(r.reply).toContain("Condense to 6 slides");
  });

  it("document → reply starts with Built", () => {
    const doc = "# Plan\n\n## Situation\nSales are flat.\n\n## Problem\nChurn is high.\n\n## Fix\nLaunch a loyalty program.\n";
    expect(respondLocally(SAMPLE_DECK, 0, doc).reply).toMatch(/^Built \d+ slides/);
  });
});

describe("English review", () => {
  const base: Slide = { id: "x", title: "", layout: "claim3", content: { claim3: { points: [{ head: "a", body: "b" }, { head: "c", body: "d" }] } } };

  it("reviewDeck texts are English", () => {
    const d = { ...SAMPLE_DECK, slides: SAMPLE_DECK.slides.slice(0, 5).map((s, i) => (i === 2 ? { ...s, title: "法人向けで稼ぐ構造にする" } : i === 3 ? { ...s, title: "企業向けプログラムを売る" } : s)) };
    const f = reviewDeck(d);
    expect(f.length).toBeGreaterThan(0);
    for (const x of f) expect(x.text).toMatch(/^[\x20-\x7e"“”…—→]|^"/);
    expect(f.some((x) => x.text.includes("Use one term per deck"))).toBe(true);
    expect(f.some((x) => x.text.includes("closing page"))).toBe(true);
  });

  it("flags English topic titles and questions, not messages", () => {
    expect(reviewSlide({ ...base, title: "Market overview" }).map((f) => f.kind)).toContain("語尾");
    expect(reviewSlide({ ...base, title: "Why does churn rise?" }).map((f) => f.kind)).toContain("語尾");
    expect(reviewSlide({ ...base, title: "Churn doubles after the second month" }).map((f) => f.kind)).not.toContain("語尾");
    expect(reviewSlide({ ...base, title: "Prices rose" }).map((f) => f.kind)).not.toContain("語尾");
  });

  it("English title length counts words", () => {
    const long = "We should expand into three new regional markets next year because demand is growing faster than our current capacity allows";
    expect(reviewSlide({ ...base, title: long }).find((f) => f.kind === "長さ")?.text).toMatch(/words/);
    const ok = "Expanding into three regional markets next year matches demand that is outgrowing our current capacity";
    expect(ok.length).toBeGreaterThan(60);
    expect(reviewSlide({ ...base, title: ok }).map((f) => f.kind)).not.toContain("長さ");
  });
});
