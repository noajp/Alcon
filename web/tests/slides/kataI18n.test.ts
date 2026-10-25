import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { KATA_TRANSLATIONS } from "@/ActivitySpace/sustainment/slides/kata/kataMessages";
import { MESSAGES } from "@/Function/i18n/messages";

// Slides の画面の文は tx("日本語", "English") で書く。韓国語・フランス語・スペイン語は
// 英語の文をキーに辞書から引くので、書いた英語がすべて辞書にあることを確かめる。
// ほかの画面と同じ意味の語（Cancel など）はアプリ共通の辞書にあればよい。
const ROOT = path.resolve(__dirname, "../../src/ActivitySpace/sustainment/slides/kata");

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return sources(p);
    // i18n.ts は tx の定義。説明の例文は数えない
    return /\.tsx?$/.test(e.name) && e.name !== "i18n.ts" ? [p] : [];
  });
}

const LITERAL = String.raw`("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')`;
const CALL = new RegExp(String.raw`\btx\(\s*${LITERAL}\s*,\s*${LITERAL}`, "g");

function unquote(literal: string): string {
  if (literal.startsWith('"')) return JSON.parse(literal) as string;
  const inner = literal.slice(1, -1).replace(/\\'/g, "'").replace(/"/g, '\\"');
  return JSON.parse(`"${inner}"`) as string;
}

const english = [
  ...new Set(
    sources(ROOT).flatMap((file) => [...fs.readFileSync(file, "utf8").matchAll(CALL)].map((m) => unquote(m[2]))),
  ),
];

describe("kata translations", () => {
  it("finds the tx calls", () => {
    expect(english.length).toBeGreaterThan(300);
  });

  for (const locale of ["ko", "fr", "es"] as const) {
    it(`every English string has a ${locale} translation`, () => {
      const missing = english.filter((en) => !(en in KATA_TRANSLATIONS[locale]) && !(en in MESSAGES[locale]));
      expect(missing).toEqual([]);
    });
  }

  it("keeps placeholders in every language", () => {
    const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const locale of ["ja", "ko", "fr", "es"] as const) {
      for (const [en, text] of Object.entries(KATA_TRANSLATIONS[locale])) {
        expect(names(text), `${locale}: ${en}`).toEqual(names(en));
      }
    }
  });
});
