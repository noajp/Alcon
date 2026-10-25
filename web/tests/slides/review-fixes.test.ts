import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import { detectLang, langFromPersisted, setLang } from "@/ActivitySpace/sustainment/slides/kata/i18n";
import { consistentUnit, guessKind, looksLikeBridge, unitOf, waterfallSteps } from "@/ActivitySpace/sustainment/slides/kata/model/chart";
import { looksLikeDocument, respondLocally } from "@/ActivitySpace/sustainment/slides/kata/model/chat";
import { moveSlide, summaryPage } from "@/ActivitySpace/sustainment/slides/kata/model/deck";
import { planDeck } from "@/ActivitySpace/sustainment/slides/kata/model/planner";
import { reviewChartsAndVolume } from "@/ActivitySpace/sustainment/slides/kata/model/review";
import { SAMPLE_DECK } from "@/ActivitySpace/sustainment/slides/kata/model/seed";
import type { Deck, Slide } from "@/ActivitySpace/sustainment/slides/kata/model/types";

// レビューで見つかった不具合の再発防止
afterEach(() => setLang("ja"));

const table = (head: string, rows: string[][]) => `| ${head} |\n|---|---|\n${rows.map((r) => `| ${r.join(" | ")} |`).join("\n")}`;

describe("1. waterfall bridge", () => {
  it("start / deltas / end does not double-count the end row", () => {
    const steps = waterfallSteps([100, 12, -7, 105]);
    expect(steps.map((s) => [s.start, s.end, s.total])).toEqual([
      [0, 100, true],
      [100, 112, false],
      [112, 105, false],
      [0, 105, true],
    ]);
  });
  it("start / deltas without an end row still gets a computed total", () => {
    const steps = waterfallSteps([100, 12, -7]);
    expect(steps).toHaveLength(4);
    expect(steps[3]).toMatchObject({ end: 105, total: true });
  });
  it("planner turns a bridge table into a waterfall ending at 105", () => {
    const doc = `# Q4 review\n\n## Revenue bridge\n\n${table("Item | Revenue", [["FY23", "100"], ["Price", "+12"], ["Volume", "-7"], ["FY24", "105"]])}\n`;
    const chart = planDeck(doc, "scr").slides.find((s) => s.layout === "chart")?.content.chart;
    expect(chart?.kind).toBe("waterfall");
    const steps = waterfallSteps(chart!.series[0].values);
    expect(steps[steps.length - 1].end).toBe(105);
    expect(steps.some((s) => s.end === 210)).toBe(false);
  });
  it("one negative segment alone is a bar, not a waterfall", () => {
    expect(guessKind(["East", "West", "North", "South"], [10, -3, 5, 8], "")).toBe("bar");
    expect(looksLikeBridge([10, -3, 5, 8], ["10", "-3", "5", "8"])).toBe(false);
    expect(guessKind(["A", "B", "C"], [5, 3, 8], "")).toBe("bar");
    expect(guessKind(["FY23", "Price", "Cost", "FY24"], [100, 12, 5, 117], "", ["100", "+12", "+5", "117"])).toBe("waterfall");
  });
});

describe("2. mixed units stay a comparison", () => {
  it("unitOf / consistentUnit", () => {
    expect(unitOf("$3M")).toBe("$");
    expect(unitOf("6 months")).toBe("month");
    expect(unitOf("12億円")).toBe("円");
    expect(consistentUnit(["$3M", "6 months", "200 users"])).toBe(false);
    expect(consistentUnit(["$3M", "$12M", "$1.2B", "$900K"])).toBe(true);
    expect(consistentUnit(["120", "-30", "4,000", "▲5"])).toBe(true);
  });
  it("planner keeps a $ / months / users table as compare", () => {
    const doc = `# Plan\n\n## What it takes\n\n${table("Metric | Plan A", [["Cost", "$3M"], ["Time", "6 months"], ["Reach", "200 users"], ["Partners", "4 firms"]])}\n`;
    const s = planDeck(doc, "scr").slides.find((x) => x.title.includes("What it takes") || x.source?.includes("What it takes"));
    expect(s?.layout).not.toBe("chart");
  });
});

describe("5. language defaults", () => {
  it("first launch follows navigator.language", () => {
    expect(detectLang("ja-JP")).toBe("ja");
    expect(detectLang("ja")).toBe("ja");
    expect(detectLang("en-US")).toBe("en");
    expect(detectLang(undefined)).toBe("en");
  });
  it("old saves without lang stay Japanese; fresh installs keep the detected default", () => {
    expect(langFromPersisted({}, "en")).toBe("ja");
    expect(langFromPersisted({ lang: "en" }, "ja")).toBe("en");
    expect(langFromPersisted(undefined, "en")).toBe("en");
  });
});

describe("6. English chat commands", () => {
  it("'Please add more detail to this slide' does not add a slide", () => {
    setLang("en");
    const r = respondLocally(SAMPLE_DECK, 2, "Please add more detail to this slide");
    expect(r.deck?.slides.length ?? SAMPLE_DECK.slides.length).toBe(SAMPLE_DECK.slides.length);
  });
  it("'Please add a new slide about pricing' still adds one", () => {
    setLang("en");
    const r = respondLocally(SAMPLE_DECK, 2, "Please add a new slide about pricing");
    expect(r.deck!.slides.length).toBe(SAMPLE_DECK.slides.length + 1);
    expect(r.deck!.slides[3].title).toMatch(/pricing/i);
  });
  it("a long English instruction is not a document", () => {
    const t =
      "Could you please go through this deck and make the wording on the market sizing slide a little tighter, keep the numbers as they are, and make sure the title says what the decision is rather than just naming the topic area";
    expect(t.length).toBeGreaterThan(220);
    expect(looksLikeDocument(t)).toBe(false);
    expect(looksLikeDocument(Array(90).fill("word").join(" "))).toBe(true);
  });
  it("make this a chart / グラフにして", () => {
    setLang("en");
    expect(respondLocally(SAMPLE_DECK, 2, "Make this a chart").deck!.slides[2].layout).toBe("chart");
    setLang("ja");
    expect(respondLocally(SAMPLE_DECK, 2, "グラフにして").deck!.slides[2].layout).toBe("chart");
  });
  it("add an executive summary / サマリーを入れて", () => {
    const deck: Deck = { ...SAMPLE_DECK, slides: SAMPLE_DECK.slides.filter((s) => s.layout !== "summary") };
    for (const [lang, cmd] of [["en", "Add an executive summary"], ["ja", "サマリーを入れて"]] as const) {
      setLang(lang);
      const r = respondLocally(deck, 3, cmd);
      expect(r.deck!.slides.length).toBe(deck.slides.length + 1);
      expect(r.deck!.slides[r.current!].layout).toBe("summary");
    }
  });
});

describe("7. executive summary", () => {
  const deck = planDeck(fs.readFileSync("tests/slides/fixtures/minutes-en.md", "utf8"), "scr");
  const sum = deck.slides.find((s) => s.layout === "summary") as Slide;
  it("its title is not another slide's title", () => {
    expect(sum).toBeTruthy();
    expect(deck.slides.filter((s) => s !== sum).map((s) => s.title)).not.toContain(sum.title);
  });
  it("page refs follow the slides when reordered", () => {
    const p = sum.content.summary!.points[0];
    expect(p.ref).toBeTruthy();
    const before = deck.slides.findIndex((s) => s.id === p.ref);
    expect(summaryPage(p, deck.slides)).toBe(`p.${before + 1}`);
    const moved = moveSlide(deck, before, deck.slides.length - 1);
    expect(summaryPage(p, moved.slides)).toBe(`p.${moved.slides.length}`);
    expect(summaryPage(p, deck.slides.filter((s) => s.id !== p.ref))).toBe("");
  });
});

describe("8. text volume is comparable across languages", () => {
  const vol = (lang: string) => reviewChartsAndVolume(planDeck(fs.readFileSync(`tests/slides/fixtures/${lang}`, "utf8"), "scr")).filter((f) => f.kind === "量").length;
  it("the Japanese and English minutes get the same number of volume notes", () => {
    expect(vol("minutes-en.md")).toBe(vol("minutes.md"));
  });
  it("the message names what was counted, not the UI language", () => {
    setLang("en");
    const slide = (title: string): Slide => ({ id: "x", title, layout: "statement", content: { statement: { lead: "", figure: "" } } });
    const ja = reviewChartsAndVolume({ title: "", storyline: "scr", slides: [slide("あ".repeat(260))] });
    expect(ja[0]?.text).toMatch(/characters/);
    const en = reviewChartsAndVolume({ title: "", storyline: "scr", slides: [slide(Array(120).fill("word").join(" "))] });
    expect(en[0]?.text).toMatch(/words/);
  });
});

describe("14. planner language follows the document", () => {
  it("English document under Japanese UI gets English sources", () => {
    setLang("ja");
    const deck = planDeck(fs.readFileSync("tests/slides/fixtures/minutes-en.md", "utf8"), "scr");
    const sources = deck.slides.map((s) => s.source).filter(Boolean) as string[];
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.some((s) => s.startsWith("元："))).toBe(false);
  });
});
