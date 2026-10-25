import type { Deck, Slide } from "./types";
import type { Finding } from "./review";
import { tx } from "@/ActivitySpace/sustainment/slides/kata/i18n";

// マイ・スキル：その人や会社の書き方の決まり。赤入れに効き、用語は一括でそろえられる。

export interface Skill {
  id: string;
  name: string;
  enabled: boolean;
  /** 「from」と書かずに「to」と書く */
  terms: { from: string; to: string }[];
  /** 使わない言葉 */
  banned: string[];
  /** タイトルの上限字数（空なら規約の 60 字） */
  maxTitle: number | null;
}

export const DEFAULT_SKILL: Skill = {
  id: "skill_house",
  name: "自分の書き方",
  enabled: true,
  terms: [{ from: "法人向け", to: "企業向け" }],
  banned: ["御社", "させていただく"],
  maxTitle: null,
};

function walkStrings<T>(x: T, fn: (s: string) => string): T {
  if (typeof x === "string") return fn(x) as T;
  if (Array.isArray(x)) return x.map((v) => walkStrings(v, fn)) as T;
  if (x && typeof x === "object") return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, walkStrings(v, fn)])) as T;
  return x;
}

/** 本文として読む文字（タイトルと中身だけ。役割・出どころ・id は対象外） */
function slideText(s: Slide): string {
  const parts: string[] = [];
  walkStrings({ title: s.title, content: s.content }, (t) => {
    parts.push(t);
    return t;
  });
  return parts.join(" ");
}

const escapeRe = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 使える用語の組（左右とも空でなく、同じでないもの） */
export function activeTerms(skills: Skill[]): { from: string; to: string }[] {
  return skills
    .filter((s) => s.enabled)
    .flatMap((s) => s.terms)
    .map((t) => ({ from: t.from.trim(), to: t.to.trim() }))
    .filter((t) => t.from && t.to && t.from !== t.to);
}

/** 置き換え先の語の中に入っている「from」は数えない（法人→法人顧客 で、法人顧客を見つけ続けないように） */
function hasStray(text: string, t: { from: string; to: string }): boolean {
  const masked = t.to.includes(t.from) ? text.split(t.to).join("\u0000") : text;
  return masked.includes(t.from);
}

export function reviewWithSkills(deck: Deck, skills: Skill[]): Finding[] {
  const out: Finding[] = [];
  for (const sk of skills.filter((x) => x.enabled)) {
    const terms = activeTerms([sk]);
    for (const s of deck.slides) {
      const text = slideText(s);
      for (const t of terms) {
        if (hasStray(text, t)) out.push({ slideId: s.id, kind: "用語", text: tx(`「${sk.name}」：「${t.from}」ではなく「${t.to}」と書く。`, `"${sk.name}": write "${t.to}", not "${t.from}".`) });
      }
      for (const w of sk.banned) {
        if (w && text.includes(w)) out.push({ slideId: s.id, kind: "語尾", text: tx(`「${sk.name}」：「${w}」は使わない。`, `"${sk.name}": don't use "${w}".`) });
      }
    }
  }
  return out;
}

/** 有効なスキルが決めたタイトルの上限（無ければ規約の 60 字） */
export function titleLimit(skills: Skill[]): number {
  const xs = skills.filter((s) => s.enabled && s.maxTitle).map((s) => s.maxTitle!);
  return xs.length ? Math.min(...xs) : 60;
}

/** 決めた用語にデッキ全体を置き換える。1回で置き換え、何度押しても同じ結果になる */
export function applyTerms(deck: Deck, skills: Skill[]): { deck: Deck; count: number } {
  const terms = activeTerms(skills);
  if (!terms.length) return { deck, count: 0 };
  // 置き換え先そのもの（すでに直っている語）を先に当てて素通しさせ、長い語から順に見る
  const keys = [...new Set([...terms.map((t) => t.to), ...terms.map((t) => t.from)])].sort((a, b) => b.length - a.length);
  const map = new Map(terms.map((t) => [t.from, t.to]));
  const re = new RegExp(keys.map(escapeRe).join("|"), "g");
  let count = 0;
  const fix = (str: string) =>
    str.replace(re, (m) => {
      const to = map.get(m);
      if (to === undefined || terms.some((t) => t.to === m)) return m;
      count++;
      return to;
    });
  const slides = deck.slides.map((s) => ({ ...s, title: fix(s.title), content: walkStrings(s.content, fix) }));
  return { deck: count ? { ...deck, slides } : deck, count };
}
