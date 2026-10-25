import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import { setLang } from "@/ActivitySpace/sustainment/slides/kata/i18n";
import { planDeck, pickFigure, extractAsks, toClaim, sectionText } from "@/ActivitySpace/sustainment/slides/kata/model/planner";
import { isNumericHead } from "@/ActivitySpace/sustainment/slides/kata/model/figure";
import { SAMPLES, SAMPLES_EN, samplesFor } from "@/ActivitySpace/sustainment/slides/kata/model/samples";
import { SAMPLE_DECK, SAMPLE_DECK_EN, seedWorkspace } from "@/ActivitySpace/sustainment/slides/kata/model/seed";
import { reviewDeck } from "@/ActivitySpace/sustainment/slides/kata/model/review";
import type { Deck } from "@/ActivitySpace/sustainment/slides/kata/model/types";

const read = (f: string) => fs.readFileSync(`tests/slides/fixtures/${f}`, "utf8");
const words = (t: string) => t.trim().split(/\s+/).length;

function basicShape(d: Deck) {
  expect(d.slides[0].layout).toBe("cover");
  expect(d.slides[0].content.cover!.subtitle).not.toBe("");
  for (const s of d.slides) {
    expect(s.title.trim().length, s.layout).toBeGreaterThan(0);
    expect(words(s.title), s.title).toBeLessThanOrEqual(16);
    expect(s.title).not.toMatch(/[.。]$/);
    // 日本語の言い回しが混ざらない
    expect(JSON.stringify(s), s.title).not.toMatch(/[぀-ヿ一-鿿]/);
    expect(s.content[s.layout]).toBeDefined();
    if (s.content.premise) expect(s.content.premise.conclusion).not.toBe(s.title);
  }
}

beforeAll(() => setLang("en"));
afterAll(() => setLang("ja"));

describe("English samples", () => {
  it("samplesFor picks the list by language, and fixtures match the samples", () => {
    expect(samplesFor("ja")).toBe(SAMPLES);
    expect(samplesFor("en")).toBe(SAMPLES_EN);
    expect(SAMPLES_EN.map((s) => s.id)).toEqual(SAMPLES.map((s) => s.id));
    expect(SAMPLES_EN[0].text).toBe(read("minutes-en.md"));
    expect(SAMPLES_EN[1].text).toBe(read("pitch-en.md"));
    expect(SAMPLES_EN[2].text).toBe(read("memo-hr-en.txt"));
  });
});

describe("planner on English minutes", () => {
  let d: Deck;
  beforeAll(() => {
    d = planDeck(read("minutes-en.md"));
  });
  it("cover first, closing from next steps last, with compare and steps in between", () => {
    basicShape(d);
    expect(d.slides.length).toBeGreaterThanOrEqual(6);
    expect(d.slides.length).toBeLessThanOrEqual(14);
    expect(d.title).toBe("An invitation-only community built around what people love");
    expect(d.slides[0].content.cover!.subtitle).toMatch(/^Work out what value/);
    const close = d.slides.at(-1)!;
    expect(close.layout).toBe("closing");
    expect(close.source).toBe("Source: Next steps");
    expect(close.title).toMatch(/^Next, write down/);
    expect(d.slides.some((s) => s.layout === "compare")).toBe(true);
    expect(d.slides.some((s) => s.layout === "steps")).toBe(true);
  });
  it("skips meta, background and open questions; decisions become the summary", () => {
    expect(d.slides.some((s) => /Background|Open questions|What we built/.test(s.source ?? ""))).toBe(false);
    expect(d.slides[1].source).toBe("Source: Decisions");
    expect(d.slides[1].title).toMatch(/^An invitation-only place that brings together employees/);
  });
  it("titles are claims from conclusive bullets, not section headings", () => {
    const revenue = d.slides.find((s) => s.source === "Source: Revenue model (provisional)")!;
    expect(revenue.title).toBe("Membership fees alone are hard to scale");
    const positioning = d.slides.find((s) => s.source === "Source: Positioning against existing services")!;
    expect(positioning.layout).toBe("compare");
    expect(positioning.title).toBe("Existing services fall into two camps");
    const match = d.slides.find((s) => s.source === "Source: How we match people")!;
    expect(match.layout).toBe("steps");
    expect(match.title).toMatch(/^We match people on "adjacent passions"/);
  });
  it("source lines lead back to the section text", () => {
    const doc = read("minutes-en.md");
    expect(sectionText(doc, "Source: Problem")).toMatch(/^- Working adults/);
    for (const s of SAMPLE_DECK_EN.slides.filter((x) => x.source)) expect(sectionText(doc, s.source!), s.source).toBeTruthy();
  });
});

describe("planner on the English pitch", () => {
  let d: Deck;
  beforeAll(() => {
    d = planDeck(read("pitch-en.md"));
  });
  it("market table becomes big numbers with sources, traction leads with 62%, asks close", () => {
    basicShape(d);
    const market = d.slides.find((s) => s.title === "Addressable market is ¥46B/year")!;
    expect(market.layout).toBe("claim3");
    expect(market.source).toBe("Source: METI, Internal survey, Estimate");
    expect(market.content.claim3!.points.map((p) => p.head)).toEqual(["approx. 38,000 firms", "120/month", "¥46B/year"]);
    expect(market.content.claim3!.points.every((p) => isNumericHead(p.head))).toBe(true);
    const traction = d.slides.find((s) => s.source === "Source: Traction")!;
    expect(traction.content.statement?.figure).toBe("62%");
    expect(traction.title).toContain("62%");
    const problem = d.slides.find((s) => s.source === "Source: Problem")!;
    expect(problem.title).toBe("Small machine shops still receive 80% of quote requests by fax and phone");
    expect(problem.content.premise?.figure).toBe("80%");
    expect(d.slides.find((s) => s.source === "Source: Solution")!.layout).toBe("steps");
    const close = d.slides.at(-1)!;
    expect(close.layout).toBe("closing");
    expect(close.title).toBe("We want to raise ¥100M in a seed round");
    expect(close.content.closing!.asks).toHaveLength(2);
  });
});

describe("planner on the English memo without headings", () => {
  let d: Deck;
  beforeAll(() => {
    d = planDeck(read("memo-hr-en.txt"));
  });
  it("the First/Second/Third enumeration becomes three reasons", () => {
    basicShape(d);
    const claim = d.slides.find((s) => s.layout === "claim3")!;
    expect(claim.title).toBe("We are considering three measures");
    expect(claim.content.claim3!.points.map((p) => p.head)).toEqual(["Cut interviews to two rounds", "Pay a ¥300,000 bonus", "Publish a tech blog"]);
  });
  it("the decision sentence becomes the closing asks, and figures are picked", () => {
    const close = d.slides.at(-1)!;
    expect(close.layout).toBe("closing");
    expect(close.content.closing!.asks).toEqual(["Whether to raise the salary bands", "Whether to approve the referral bonus"]);
    expect(close.title).toBe("Decide whether to raise the salary bands and whether to approve the referral bonus");
    expect(d.slides.some((s) => s.content.statement?.figure === "1.3x")).toBe(true);
    expect(d.slides.some((s) => s.title === "Offer acceptance through agencies is low at 40%" && s.content.premise?.figure === "40%")).toBe(true);
    // 表紙のタイトルを1枚目で繰り返さない
    expect(d.slides.slice(1).some((s) => s.title === d.slides[0].title)).toBe(false);
  });
});

describe("planner on the English weekly report", () => {
  let d: Deck;
  beforeAll(() => {
    d = planDeck(read("weekly-en.md"));
  });
  it("A → B pairs become issues and actions, a change shows the later number, next week closes", () => {
    basicShape(d);
    const issue = d.slides.find((s) => s.layout === "issue")!;
    expect(issue.title).toBe("Two problems, each with an action");
    expect(issue.content.issue!.pairs).toHaveLength(2);
    expect(issue.content.issue!.pairs[0].action).toBe("Cut approval from two steps to one");
    expect(d.slides.some((s) => s.content.statement?.figure === "55%" && /^The rate of moving/.test(s.title))).toBe(true);
    expect(d.slides.at(-1)!.layout).toBe("closing");
  });
});

describe("English helpers", () => {
  it("pickFigure reads English figures", () => {
    expect(pickFigure("Revenue grew to $1.2M, up 3x")).toBe("3x");
    expect(pickFigure("We reached 4.6M users")).toBe("4.6M users");
    expect(pickFigure("We made 18 hires in 2026")).toBe("18 hires");
    expect(pickFigure("Conversion rose from 40% to 55%")).toBe("55%");
    expect(pickFigure("Budget of 1.3x, or ¥18M")).toBe("1.3x");
    expect(pickFigure("Around 120/month")).toBe("120/month");
    expect(pickFigure("We opened in 2026 with 12 pilot companies")).toBe("");
  });
  it("isNumericHead accepts English numbers and rejects words and years", () => {
    for (const t of ["62%", "$1.2M", "3x", "4.6M users", "18 hires", "1.3x", "120/month", "¥46B/year", "approx. 38,000 firms"]) expect(isNumericHead(t), t).toBe(true);
    for (const t of ["3 walls", "Romance", "Two of us", "In 2024"]) expect(isNumericHead(t), t).toBe(false);
  });
  it("toClaim trims English without Japanese rules", () => {
    expect(toClaim("Membership fees alone are hard to scale. Treat the community as proof.")).toBe("Membership fees alone are hard to scale");
    expect(toClaim("Concept: a place that turns hidden passions into work")).toBe("A place that turns hidden passions into work");
    expect(toClaim("We need a plan that covers hiring, onboarding, retention, compensation, culture and the long-term career paths of every engineer we bring in").split(" ").length).toBeLessThanOrEqual(16);
    expect(toClaim("Our users love this feature")).toBe("Our users love this feature");
  });
  it("extractAsks splits English decision sentences", () => {
    expect(extractAsks("We need you to decide on the budget cap, and the start date.")).toEqual(["The budget cap", "The start date"]);
    expect(extractAsks("We'd like approval for the Q3 launch plan.")).toEqual(["The Q3 launch plan"]);
  });
});

describe("English seed", () => {
  it("matches the Japanese deck slide for slide, reads cleanly and passes review", () => {
    expect(SAMPLE_DECK_EN.slides.map((s) => [s.id, s.layout])).toEqual(SAMPLE_DECK.slides.map((s) => [s.id, s.layout]));
    basicShape(SAMPLE_DECK_EN);
    expect(reviewDeck(SAMPLE_DECK_EN)).toEqual([]);
  });
  it("seedWorkspace returns the English workspace for en and Japanese by default", () => {
    const en = seedWorkspace(1000, "en");
    expect(en.files[0].name).toBe("Concept overview");
    expect(en.files[0].deck.slides[0].title).toBe(SAMPLE_DECK_EN.slides[0].title);
    expect(en.files[0].deck.sourceDoc!.text).toBe(SAMPLES_EN[0].text);
    expect(en.files[0].chat.every((m) => !/[぀-ヿ一-鿿]/.test(m.text))).toBe(true);
    const ja = seedWorkspace(1000);
    expect(ja.files[0].name).toBe("構想整理");
    expect(ja.files[0].deck.slides[0].title).toBe(SAMPLE_DECK.slides[0].title);
  });
});
