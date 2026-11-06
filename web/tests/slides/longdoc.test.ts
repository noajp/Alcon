import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { intakeDocument, looksLikeLongDocument } from "@/ActivitySpace/artifacts/slides/kata/model/intake";
import { planDeck } from "@/ActivitySpace/artifacts/slides/kata/model/planner";
import { reviewDeck } from "@/ActivitySpace/artifacts/slides/kata/model/review";
import { summaryPage } from "@/ActivitySpace/artifacts/slides/kata/model/deck";
import { setLang } from "@/ActivitySpace/artifacts/slides/kata/i18n";

const raw = fs.readFileSync("tests/slides/fixtures/pdf-plan.txt", "utf8");

describe("PDF から写した長い文書を、見出しのある文章に直す", () => {
  const r = intakeDocument(raw);
  const md = r.markdown;
  it("目次とページ番号を除き、番号の見出しを章と節にする", () => {
    expect(r.title).toBe("Harbor City Mobility Plan");
    expect(md).not.toMatch(/\.{4,}/);
    expect(md).not.toMatch(/^iii$/m);
    expect(md).toMatch(/^## Why We Need a Plan$/m);
    expect(md).toMatch(/^### Where We Fell Short$/m);
    expect(md).toMatch(/^### Principles$/m);
    expect(md).toMatch(/^#### Downtown: Make Room for Buses$/m);
    expect(md).toMatch(/<!-- p\.4 -->/);
  });
  it("折れた行をつなぎ、「–」の箇条は見出しと本文に割る", () => {
    expect(md).toContain("Commute times in Harbor City have grown for a decade, and the bus network still follows routes drawn in 1987.");
    expect(md).toMatch(/^- Frequency First: A bus every ten minutes beats a perfect map\. We will run fewer routes, more often\.$/m);
  });
  it("印だけが先に並ぶ箇条と「; and」で続く並びを、1つずつの箇条にする", () => {
    for (const t of ["Frequent buses on the six busiest corridors;", "Safe, connected bike lanes in every district;", "Streets that put people before parking; and", "Fares that working families can afford."]) {
      expect(md).toContain(`- ${t}`);
    }
    // 並びのあとの文は、箇条ではなく本文に戻る
    expect(md).toMatch(/^The goal of this plan is to make the bus the fastest way across town\.$/m);
  });
  it("PDF らしい文章（ページ区切り）を見分ける。短い頼みや見出しのある文章は違う", () => {
    expect(looksLikeLongDocument(raw)).toBe(true);
    expect(looksLikeLongDocument("# Title\n\n## A\n- x\n## B\n- y\n## C\n- z")).toBe(false);
    expect(looksLikeLongDocument("make this a chart")).toBe(false);
  });
});

describe("長い文書は、章ごとに中扉を立てて組む", () => {
  setLang("en");
  const deck = planDeck(intakeDocument(raw).markdown);
  const layouts = deck.slides.map((s) => s.layout);
  it("表紙→サマリー→目次→章（中扉と本文）→数字", () => {
    expect(layouts.slice(0, 3)).toEqual(["cover", "summary", "agenda"]);
    const dividers = deck.slides.filter((s) => s.layout === "agenda" && s.content.agenda!.current >= 0);
    expect(dividers.map((d) => d.title)).toEqual(["Why We Need a Plan", "What We Want", "How We Get There"]);
    expect(deck.mode).toBe("read");
  });
  it("文書の目的を述べた文を、サマリーの統べる一文にする", () => {
    expect(deck.slides[1].title).toMatch(/^The goal of this plan is to make the bus the fastest way across town/);
  });
  it("目次のページ番号は、今の並びから数える", () => {
    const agenda = deck.slides[2].content.agenda!;
    const pages = agenda.items.map((it) => summaryPage(it, deck.slides));
    expect(pages).toEqual(agenda.items.map((it) => `p.${deck.slides.findIndex((s) => s.id === it.ref) + 1}`));
  });
  it("見出しつきの原則は一覧（grid）に、地区は一覧で全体を見せてから1枚ずつ", () => {
    const principles = deck.slides.find((s) => s.layout === "grid" && s.content.grid!.cards.some((c) => c.head === "Frequency First"));
    expect(principles).toBeTruthy();
    const overview = deck.slides.find((s) => s.layout === "grid" && s.content.grid!.cards.map((c) => c.head).join("|") === "Downtown|Eastside|Waterfront");
    expect(overview).toBeTruthy();
    // 「Downtown: Make Room for Buses」の後ろ半分は、その地区のページの主張になる
    expect(deck.slides.some((s) => s.title === "Make Room for Buses")).toBe(true);
  });
  it("並びの前置き（Our goals … are:）を、その一覧の主張にする", () => {
    const goals = deck.slides.find((s) => s.layout === "grid" && s.content.grid!.cards.some((c) => /Frequent buses/.test(c.head + c.body)));
    expect(goals?.title).toBe("Our goals for the next decade are");
  });
  it("数字で見る要点：変化は「前 → 後」で", () => {
    const kpi = deck.slides.find((s) => s.layout === "kpi")!;
    expect(kpi.content.kpi!.stats.map((x) => x.value)).toContain("22% → 15%");
  });
  it("出どころに PDF のページが付き、目次・中扉には言い切りの赤入れを出さない", () => {
    expect(deck.slides.some((s) => /, p\.\d+$/.test(s.source ?? ""))).toBe(true);
    const f = reviewDeck(deck).filter((x) => deck.slides.find((s) => s.id === x.slideId)?.layout === "agenda");
    expect(f).toEqual([]);
  });
  it("平らな議事録（入れ子もページも無い）は、今までどおり組む", () => {
    const flat = planDeck(fs.readFileSync("tests/slides/fixtures/minutes-en.md", "utf8"));
    expect(flat.slides.some((s) => s.layout === "agenda")).toBe(false);
  });
});

const real = `${process.env.HOME}/Documents/2025-National-Security-Strategy.pdf`;
describe.skipIf(!fs.existsSync(real))("実物の PDF（手元にあるときだけ）", () => {
  it("章と地域を読み取り、20枚前後に組む", async () => {
    const { pdfToText } = await import("@/ActivitySpace/artifacts/slides/kata/model/pdf");
    const { text } = await pdfToText(fs.readFileSync(real).buffer as ArrayBuffer);
    const deck = planDeck(intakeDocument(text).markdown);
    expect(deck.slides.length).toBeGreaterThanOrEqual(16);
    expect(deck.slides.length).toBeLessThanOrEqual(26);
    expect(deck.slides.filter((s) => s.layout === "agenda").length).toBe(5);
  }, 30000);
});

import { fromKataJson, toKataJson } from "@/ActivitySpace/artifacts/slides/kata/model/kataFile";
import { remapRefs } from "@/ActivitySpace/artifacts/slides/kata/model/deck";
import { respondLocally } from "@/ActivitySpace/artifacts/slides/kata/model/chat";

describe("レビューの指摘（取り込みの誤爆・ページの参照・壊れたファイル）", () => {
  it("折り返したマークダウンのメモや番号の箇条は、PDF の文として扱わない", () => {
    const md = ["# Q3 planning notes", "We met on Monday.", ...Array.from({ length: 22 }, (_, i) => `1. Ship item ${i} which is a long line that keeps going and going without stopping at`), ...Array.from({ length: 20 }, () => "* Owner: someone who wraps the line across more than fifty characters")].join("\n");
    expect(looksLikeLongDocument(md)).toBe(false);
    const ja = Array.from({ length: 45 }, (_, i) => `${"１２３４５６７８９"[i % 9]}．関係者に共有するべき内容がここに長く続いていて句点で終わらないままの行で`).join("\n");
    expect(looksLikeLongDocument(ja)).toBe(false);
  });
  it("最初の章にもページの印が付く", () => {
    const md = intakeDocument(raw).markdown;
    const i = md.indexOf("## Why We Need a Plan");
    expect(md.slice(0, i)).toMatch(/<!-- p\.1 -->\s*$/);
  });
  it("ファイルで開いても、サマリーと目次の参照（ref）と10章以上の目次が残る", () => {
    setLang("en");
    const deck = planDeck(intakeDocument(raw).markdown);
    const items = Array.from({ length: 10 }, (_, i) => ({ head: `Ch ${i}`, page: "", ref: deck.slides[3].id }));
    deck.slides[2] = { ...deck.slides[2], content: { agenda: { items, current: -1 } } };
    const back = fromKataJson(toKataJson("x", deck))!;
    expect(back.deck.slides[1].content.summary!.points.every((p) => !!p.ref)).toBe(true);
    expect(back.deck.slides[2].content.agenda!.items).toHaveLength(10);
    expect(back.deck.slides[2].content.agenda!.items[0].ref).toBe(deck.slides[3].id);
  });
  it("壊れたファイルでも投げずに開ける。負の offset は 0 にする", () => {
    const bad = JSON.stringify({ kata: 1, name: "b", deck: { title: "b", storyline: "scr", slides: [{ id: "a", title: "t", layout: "grid", content: { grid: { cards: "zz" } } }, { id: "b", title: "t", layout: "agenda", content: { agenda: { items: [null], current: 3 } } }, { id: "c", title: "t", layout: "statement", content: { statement: "oops" } }] }, mix: { selected: ["navy"], pins: [], offset: -1 } });
    const r = fromKataJson(bad)!;
    expect(r.deck.slides).toHaveLength(3);
    expect(r.deck.slides[0].content.grid!.cards).toEqual([]);
    expect(r.deck.slides[2].content.statement).toMatchObject({ lead: "", figure: "" });
    expect(r.mix!.offset).toBe(0);
  });
  it("複製で id を付け直すと、参照も付け直す", () => {
    const deck = planDeck(intakeDocument(raw).markdown);
    const map = new Map(deck.slides.map((s) => [s.id, `${s.id}_c`]));
    const slides = remapRefs(deck.slides.map((s) => ({ ...s, id: map.get(s.id)! })), map);
    for (const p of slides[1].content.summary!.points) expect(summaryPage(p, slides)).toMatch(/^p\.\d+$/);
  });
  it("頼みの枚数（ask）は章ごとに配り、サマリーの参照を切らさない。本文の「3ページ」は枚数として読まない", () => {
    setLang("en");
    const md = intakeDocument(raw).markdown;
    const r = respondLocally({ title: "", storyline: "scr", slides: [] }, 0, `${md}\n\n<!-- ask: make it in 10 slides -->`);
    expect(r.deck!.slides.length).toBeLessThanOrEqual(10);
    for (const p of r.deck!.slides[1].content.summary!.points) expect(summaryPage(p, r.deck!.slides)).toMatch(/^p\.\d+$/);
    expect(JSON.stringify(r.deck)).not.toContain("make it in 10 slides");
    const noAsk = respondLocally({ title: "", storyline: "scr", slides: [] }, 0, `${md}\n- The appendix runs about 3 pages`);
    expect(noAsk.deck!.slides.length).toBeGreaterThan(4);
  });
});
