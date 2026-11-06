import { atomsOf } from "./layouts";
import type { Deck, Slide } from "./types";
import { tx } from "@/ActivitySpace/artifacts/slides/kata/i18n";

// 赤入れ。consulting-pptx-skill の規約のうち、機械で測れるものを移したもの。
// so what や MECE のような中身の指摘は、AI の読み手が受け持つ。

export type FindingKind = "語尾" | "長さ" | "空欄" | "用語" | "数" | "重複" | "構成" | "出典" | "量";

export interface Finding {
  slideId?: string;
  kind: FindingKind;
  text: string;
}

const TERM_GROUPS: string[][] = [
  ["企業向け", "法人向け"],
  ["ユーザー", "利用者"],
  ["顧客", "お客様"],
  ["会員", "メンバー"],
  ["面談", "面接"],
];

const NUM_WORD: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

function kanjiToNum(v: string): number {
  if (v === "十") return 10;
  if (v.length === 1) return NUM_WORD[v] ?? NaN;
  if (v[0] === "十") return 10 + (NUM_WORD[v[1]] ?? NaN);
  if (v.length === 2) return (NUM_WORD[v[0]] ?? NaN) * 10;
  return (NUM_WORD[v[0]] ?? NaN) * 10 + (NUM_WORD[v[2]] ?? NaN);
}

function countClaim(title: string): number | null {
  const m = title.match(/(?<![0-9０-９一二三四五六七八九十])([0-9０-９]+|[一二三四五六七八九十]+)(つ(?!目|に)|点(?!満)|段階|ステップ|の(理由|課題|打ち手|柱|観点|前提|根拠))/);
  if (!m) return null;
  const v = m[1];
  const n = /^[一二三四五六七八九十]+$/.test(v) ? kanjiToNum(v) : parseInt(v.replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0)), 10);
  return Number.isFinite(n) ? n : null;
}

/** 主に半角英数で書かれたタイトルか（英語の資料の判定） */
function mostlyAscii(t: string): boolean {
  const chars = [...t.replace(/\s/g, "")];
  if (!chars.length) return false;
  return chars.filter((c) => /[\u0000-\u00ff\u2010-\u2027]/.test(c)).length / chars.length > 0.8;
}

const wordsOf = (t: string) => t.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w));

/** 動詞らしい語（英語のタイトルが「言い切り」になっているかの手がかり） */
const EN_VERBISH =
  /^(is|are|was|were|be|been|has|have|had|do|does|did|can|could|will|would|should|must|may|might|need|needs|make|makes|drive|drives|grow|grows|cut|cuts|win|wins|lose|loses|beat|beats|lead|leads|show|shows|let|lets|keep|keeps|get|gets|go|goes|pay|pays|add|adds|fall|falls|rise|rises|hurt|hurts|start|starts|stop|stops)$|.(ed|es|s|ing)$/i;

function textOf(s: Slide): string {
  return [s.title, ...atomsOf(s).flatMap((a) => [a.head, a.body])].join(" ");
}

export function reviewSlide(s: Slide, maxTitle = 60): Finding[] {
  const out: Finding[] = [];
  const t = s.title.trim();
  const en = mostlyAscii(t);
  if (!t) out.push({ slideId: s.id, kind: "空欄", text: tx("タイトルが空です。このページで言いたい結論を一文で書く。", "The title is empty. State this page's conclusion in one sentence.") });
  if (/(です|ます|でしょう|ください)[。]?$/.test(t)) out.push({ slideId: s.id, kind: "語尾", text: tx("タイトルが「です・ます」で終わっている。言い切りの形にする。", "The title ends in polite form. Make it a firm statement.") });
  if (en) {
    const words = wordsOf(t).length;
    if (words > 16 && s.layout !== "agenda") out.push({ slideId: s.id, kind: "長さ", text: tx("タイトルが {n} 語。16 語以内に削り、1つのことだけを言う。", "The title is {n} words. Cut it to 16 or fewer and say one thing.", { n: words }) });
  } else if (t.length > maxTitle) {
    out.push({ slideId: s.id, kind: "長さ", text: tx("タイトルが {n} 字。{max} 字以内に削り、1つのことだけを言う。", "The title is {n} characters. Cut it to {max} or fewer and say one thing.", { n: t.length, max: maxTitle }) });
  }
  const headingLeft = !!t && (s.source === `元：${t}` || s.source === `Source: ${t}`);
  // 目次・中扉のタイトルは章の名前なので、言い切りの決まりは当てない
  const body = s.layout !== "cover" && s.layout !== "closing" && s.layout !== "agenda" && !headingLeft && !!t;
  if (body && !en && !/[るいたしだなすくうつぬむぶぐ]$|(ない|ある|する|へ|に|を|で|と|が|は|表れ|構造|場|層|組み)$/.test(t) && t.length < 14) {
    out.push({ slideId: s.id, kind: "語尾", text: tx("タイトルが見出し（名詞）になっている。何が言えるのかを書く。", "The title is a topic label, not a message. Say what it tells us.") });
  }
  if (body && en) {
    const ws = wordsOf(t);
    if (/[?？]$/.test(t)) out.push({ slideId: s.id, kind: "語尾", text: tx("タイトルが問いになっている。答えを言い切る。", "The title is a question. State the answer instead.") });
    else if (ws.length <= 3 && !ws.some((w) => EN_VERBISH.test(w.replace(/[^A-Za-z]/g, "")))) {
      out.push({ slideId: s.id, kind: "語尾", text: tx("タイトルが見出し（名詞）になっている。何が言えるのかを書く。", "The title is a topic label, not a message. Say what it tells us.") });
    }
  }
  if (headingLeft && s.layout !== "agenda") out.push({ slideId: s.id, kind: "語尾", text: tx("タイトルが元の見出しのまま。このページで何が言えるのかを一文で書く。", "The title is still the source heading. Say in one sentence what this page shows.") });
  if (s.layout === "premise" && s.content.premise && t && s.content.premise.conclusion.trim() === t) {
    out.push({ slideId: s.id, kind: "重複", text: tx("帰結がタイトルの繰り返しになっている。前提から言える「だから何か」を一言で書く。", "The conclusion just repeats the title. Write the so-what that follows from the premises.") });
  }
  const atoms = atomsOf(s);
  const empty = atoms.filter((a) => !a.head.trim() && !a.body.trim()).length;
  if (s.layout !== "cover" && atoms.length && empty === atoms.length) out.push({ slideId: s.id, kind: "空欄", text: tx("中身がまだ空。根拠か事実を入れる。", "The body is still empty. Add evidence or facts.") });
  else if (empty > 0 && s.layout !== "cover") out.push({ slideId: s.id, kind: "空欄", text: (empty === 1 ? tx("空いている欄が {n} か所ある。埋めるか、欄を減らす。", "{n} field is empty. Fill it or remove it.", { n: empty }) : tx("空いている欄が {n} か所ある。埋めるか、欄を減らす。", "{n} fields are empty. Fill them or remove them.", { n: empty })) });
  const n = countClaim(t);
  if (n !== null) {
    const items = s.layout === "premise" ? (s.content.premise?.premises ?? []).map((p) => ({ head: "", body: p })) : atoms;
    const have = items.filter((a) => a.head.trim() || a.body.trim()).length;
    if (have && have !== n) out.push({ slideId: s.id, kind: "数", text: tx("タイトルは「{n}」と言っているが、中身は {have} つ。数をそろえる。", "The title says {n}, but the body has {have}. Make the counts match.", { n, have }) });
  }
  return out;
}

/**
 * グラフと文字量の決まり。グラフには so what と出典（マッキンゼー流）、1枚の文字量は
 * 話す資料なら少なく、読む資料（Duarte の Slidedocs）なら多めまで許す。
 */
export function reviewChartsAndVolume(deck: Deck): Finding[] {
  const out: Finding[] = [];
  const read = deck.mode === "read";
  for (const s of deck.slides) {
    if (s.layout === "chart" && s.content.chart) {
      if (!s.content.chart.takeaway.trim()) out.push({ slideId: s.id, kind: "空欄", text: tx("グラフに so what が無い。このグラフから言えることを右に一文で書く。", "The chart has no so-what. Add one sentence on what it tells us.") });
      if (!s.source?.trim()) out.push({ slideId: s.id, kind: "出典", text: tx("グラフに出典が無い。数の出どころを下に書く。", "The chart has no source. Add where the numbers come from.") });
    }
    if (s.layout === "cover") continue;
    const text = [s.title, ...atomsOf(s).flatMap((a) => [a.head, a.body])].join(" ");
    const ascii = (text.match(/[\x20-\x7e]/g) ?? []).length / Math.max(1, text.length) > 0.7;
    const size = ascii ? text.split(/\s+/).filter(Boolean).length : text.replace(/\s/g, "").length;
    // 英語は語、日本語は字で数える。同じ議事録の日英の見本で、1語 ≒ 2.4字だったので上限もその比にそろえる
    const limit = ascii ? (read ? 200 : 100) : read ? 480 : 240;
    // 単位は表示言語ではなく、数えたもの（語か字か）で書く
    const amount = ascii ? tx("{n}語", "{n} words", { n: size }) : tx("{n}字", "{n} characters", { n: size });
    const lim = ascii ? tx("{n}語", "{n} words", { n: limit }) : tx("{n}字", "{n} characters", { n: limit });
    if (size > limit) {
      out.push({
        slideId: s.id,
        kind: "量",
        text: read
          ? tx("文字が多い（{size}）。読む資料でも{lim}までに削るか、2枚に分ける。", "Too much text ({size}). Even for a read-ahead deck, cut to {lim} or split the page.", { size: amount, lim })
          : tx("話す資料にしては文字が多い（{size}）。{lim}までに削るか、読む資料に切り替える。", "Too much text for a presented deck ({size}). Cut to {lim} or switch to a read-ahead deck.", { size: amount, lim }),
      });
    }
  }
  return out;
}

export function reviewDeck(deck: Deck, maxTitle = 60): Finding[] {
  const out: Finding[] = [...deck.slides.flatMap((s) => reviewSlide(s, maxTitle)), ...reviewChartsAndVolume(deck)];
  const all = deck.slides.map(textOf).join(" ");
  for (const group of TERM_GROUPS) {
    const used = group.filter((w) => all.includes(w));
    if (used.length > 1) {
      const where = deck.slides.find((s) => textOf(s).includes(used[1]));
      out.push({ slideId: where?.id, kind: "用語", text: tx("「{terms}」が混ざっている。1資料1用語にそろえる。", "\"{terms}\" are mixed. Use one term per deck.", { terms: used.join(tx("」と「", '" and "')) }) });
    }
  }
  const seen = new Map<string, string>();
  for (const s of deck.slides) {
    const key = s.title.trim();
    if (!key) continue;
    if (seen.has(key)) out.push({ slideId: s.id, kind: "重複", text: tx("同じタイトルのページが他にもある。1枚にまとめるか、言うことを変える。", "Another page has the same title. Merge them or change what one says.") });
    else seen.set(key, s.id);
  }
  if (deck.slides.length >= 4 && !deck.slides.some((s) => s.layout === "closing")) {
    out.push(
      deck.mode === "read"
        ? { kind: "構成", text: tx("最後に締めのページが無い。読み手にとっての示唆（だから自分たちはどうするか）で締める。", "There's no closing page. End with what it means for the reader (so what for us).") }
        : { kind: "構成", text: tx("最後に「決めてほしいこと」のページが無い。読み手に何を頼むかで締める。", "There's no closing page with the ask. End with what you need from the reader.") },
    );
  }
  return out;
}
