import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { fromKataJson } from "@/ActivitySpace/artifacts/slides/kata/model/kataFile";
import { reviewDeck } from "@/ActivitySpace/artifacts/slides/kata/model/review";
import { setLang } from "@/ActivitySpace/artifacts/slides/kata/i18n";
import { summaryPage } from "@/ActivitySpace/artifacts/slides/kata/model/deck";

// 見本の資料（examples/）が、開けて、赤入れに引っかからず、日本語版と英語版の構成がそろっていること
describe("見本：米国家安全保障戦略2025（日本語版・英語版）", () => {
  const ja = fromKataJson(fs.readFileSync("tests/slides/fixtures/nss-2025.ja.kata.json", "utf8"))!;
  const en = fromKataJson(fs.readFileSync("tests/slides/fixtures/nss-2025.en.kata.json", "utf8"))!;
  it("どちらも開ける", () => {
    expect(ja.deck.slides.length).toBeGreaterThan(15);
    expect(en.deck.slides.length).toBe(ja.deck.slides.length);
  });
  it("2つの言語で、ページの並びと型と出どころのページがそろう", () => {
    expect(en.deck.slides.map((s) => s.layout)).toEqual(ja.deck.slides.map((s) => s.layout));
    const pages = (d: typeof ja.deck) => d.slides.map((s) => s.source?.match(/p\.[\d–i, ]+$/)?.[0] ?? "");
    expect(pages(en.deck)).toEqual(pages(ja.deck));
  });
  it("サマリーと目次のページ番号は、指しているページを正しく数える", () => {
    for (const d of [ja.deck, en.deck]) {
      for (const p of d.slides[1].content.summary!.points) expect(summaryPage(p, d.slides)).toMatch(/^p\.\d+$/);
      for (const it of d.slides[2].content.agenda!.items) expect(summaryPage(it, d.slides)).toMatch(/^p\.\d+$/);
    }
  });
  it("赤入れで直すところが無い", () => {
    setLang("ja");
    expect(reviewDeck(ja.deck).map((f) => f.text)).toEqual([]);
    setLang("en");
    expect(reviewDeck(en.deck).map((f) => f.text)).toEqual([]);
  });
});
