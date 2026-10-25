import { newId } from "./id";
import type { Deck, Slide, StorylineId } from "./types";
import { firstSentence, governingThought, pickClaim, pickFigure, sectionToSlide, splitHead, splitSentences, toClaim, type Section } from "./planner";

// 長い文書（章が3つ以上ある戦略文書・報告書など）を資料にする。
// コンサルの組み方：表紙 → エグゼクティブサマリー → 目次 → 章ごとに中扉と本文 → 数字で見る要点。
// 1つの節は1枚。小見出しがたくさんある節は、まず一覧で全体を見せてから1枚ずつ。

const isLatin = (s: string) => /[A-Za-z]/.test(s) && !/[぀-ヿ㐀-鿿]/.test(s);
const FRONT = /^(?:foreword|preface|introduction letter|letter|前書き|はじめに|序文)$/i;
const GRID_MAX = 12;

export function isLongOutline(sections: Section[]): boolean {
  const chapters = sections.filter((s) => s.level === 2 && !FRONT.test(s.heading));
  // 章の下に節がある（入れ子の見出し）か、PDF のページの印がある文書だけ。平らな議事録は今までどおり
  const nested = sections.filter((s) => (s.level ?? 0) >= 3).length >= 2;
  const paged = sections.some((s) => s.page !== undefined);
  return chapters.length >= 3 && sections.length >= 8 && (nested || paged);
}

interface Unit {
  sec: Section;
  kids: Section[];
}
interface Chapter {
  head: Section;
  units: Unit[];
}

function chaptersOf(sections: Section[]): Chapter[] {
  const out: Chapter[] = [];
  let ch: Chapter | null = null;
  let unit: Unit | null = null;
  for (const s of sections) {
    const lv = s.level ?? 9;
    if (lv === 2) {
      ch = FRONT.test(s.heading) ? null : { head: s, units: [] };
      if (ch) out.push(ch);
      unit = null;
      continue;
    }
    if (!ch) continue;
    if (lv === 3 || !unit) {
      unit = { sec: s, kids: [] };
      ch.units.push(unit);
    } else unit.kids.push(s);
  }
  return out;
}

const hasBody = (s: Section) => s.items.length > 0 || s.paras.length > 0 || s.table.length > 0;
const item = (text: string) => ({ text, numbered: false, children: [] });

/** 見出しを短くする：「Western Hemisphere: The Trump Corollary…」→「Western Hemisphere」 */
function shortHead(h: string): string {
  const t = h.replace(/\s*[:：—–]\s.*$/, "").trim();
  return t || h;
}

/** 長い文を、句読点の切れ目で max 字までに縮める */
function clip(t: string, max: number): string {
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const at = Math.max(cut.lastIndexOf(", "), cut.lastIndexOf("、"), cut.lastIndexOf("; "), cut.lastIndexOf("—"));
  return (at > max * 0.55 ? cut.slice(0, at) : cut.replace(/\s+\S*$/, "")).replace(/[,;:—\s]+$/, "") + "…";
}

/** 節の要旨：段落の最初の文（無ければ最初の項目） */
function gist(s: Section, max = 120): string {
  const pool = [...s.paras, ...s.items.map((i) => i.text)];
  return pool.length ? clip(firstSentence(pool[0].replace(/^[^:]{2,60}:\s+/, "")), max) : "";
}

/** 段落だけの節は、文を拾って項目にする。数字のある文と言い切りの強い文を優先して3つまで */
function itemize(s: Section): Section {
  if (s.items.length || !s.paras.length) return s;
  const sentences = s.paras.length >= 2 ? s.paras.map((p) => firstSentence(p)) : splitSentences(s.paras[0]);
  const score = (t: string) => (pickFigure(t) ? 2 : 0) + (/\b(must|will|should|cannot|need)\b|べき|必要|する$/.test(t) ? 1 : 0) - (t.length > 220 ? 1 : 0);
  const top = sentences.length > 3 ? sentences.map((t, i) => ({ t, i, sc: score(t) })).sort((a, b) => b.sc - a.sc || a.i - b.i).slice(0, 3).sort((a, b) => a.i - b.i).map((x) => x.t) : sentences;
  return { ...s, items: top.map(item), paras: [] };
}

function gridSlide(title: string, cards: { head: string; body: string }[], source?: string): Slide {
  return { id: newId("s"), title, layout: "grid", source, content: { grid: { cards: cards.slice(0, GRID_MAX) } } };
}

function srcFor(s: Section): string | undefined {
  if (!s.heading) return undefined;
  const h = s.heading;
  const p = s.page ? (isLatin(h) ? `, p.${s.page}` : `（p.${s.page}）`) : "";
  return isLatin(h) ? `Source: ${h}${p}` : `元：${h}${p}`;
}

function unitSlides(u: Unit): Slide[] {
  const sec = itemize(u.sec);
  const source = srcFor(u.sec);
  // 小見出し（地域など）が3つ以上：まず一覧、続いて1つずつ
  const top = Math.min(...u.kids.map((x) => x.level ?? 9));
  const majors = u.kids.filter((k) => k.level === top);
  if (majors.length >= 3) {
    const lines = u.sec.paras.flatMap(splitSentences);
    const strong = lines.find((t) => /\bis to\b|とは.+ことだ/.test(t)) ?? lines.find((t) => /\b(?:must|cannot|will)\b|べき|しなければ/.test(t));
    // 本文の無い見出し（Districts）は、数と「それぞれに打ち手がある」で言い切る
    const noun = shortHead(u.sec.heading);
    const en = isLatin(noun);
    const counted = en ? `${(NUM_WORD[majors.length] ?? String(majors.length)).replace(/^./, (c) => c.toUpperCase())} ${noun.toLowerCase()}, each with its own priority` : `${noun}ごとに、打ち手の重点を変える`;
    const title = strong ? toClaim(strong) : hasBody(u.sec) ? pickClaim(sec) : counted;
    const overview = gridSlide(
      title,
      // 本文の無い見出し（Asia）は、その下の最初の小見出しの要旨を使う
      majors.map((k) => ({ head: shortHead(k.heading), body: gist(k, 110) || gist(u.kids[u.kids.indexOf(k) + 1] ?? k, 110) })),
      source,
    );
    return [overview, ...majors.map((k) => kidSlide(k, u.kids))];
  }
  // 小見出しが少なければ、項目として1枚にまとめる
  const merged: Section = u.kids.length ? { ...sec, items: [...sec.items, ...u.kids.map((k) => item(`${shortHead(k.heading)}: ${gist(k, 140)}`))] } : sec;
  return [toSlide(merged, source)];
}

/** 地域などの1枚。下にさらに小見出し（Enlist / Expand）があれば、それを根拠の見出しにする */
function kidSlide(k: Section, all: Section[]): Slide {
  const i = all.indexOf(k);
  const subs: Section[] = [];
  for (const x of all.slice(i + 1)) {
    if ((x.level ?? 9) <= (k.level ?? 9)) break;
    subs.push(x);
  }
  // 「Asia: Win the Economic Future, Prevent Military Confrontation」の後ろ半分は、その節の主張そのもの
  const claim = k.heading.match(/^[^:：]{2,40}[:：]\s*(.{8,})$/)?.[1]?.trim();
  const source = srcFor(k);
  if (subs.length >= 2 && subs.length <= 4) {
    const points = subs.map((x) => ({ head: shortHead(x.heading), body: gist(x, 150) }));
    return { id: newId("s"), title: claim ?? (k.paras.length ? toClaim(firstSentence(k.paras[0])) : toClaim(k.heading)), layout: "claim3", source, content: { claim3: { points } } };
  }
  const merged = subs.length ? { ...k, items: [...k.items, ...subs.map((x) => item(`${shortHead(x.heading)}: ${gist(x, 140)}`))] } : k;
  const slide = toSlide(itemize(merged), source);
  return claim ? { ...slide, title: claim } : slide;
}

const LABELED_ITEM = /^[^:：]{2,70}[:：]\s+\S/;
const NUM_WORD = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];

/** 項目がみな同じ言い出し（We want to …）なら、その言い出しを外す */
function stripCommonLead(texts: string[]): string[] {
  if (texts.length < 3 || !texts.every(isLatin)) return texts;
  const ws = texts.map((t) => t.split(/\s+/));
  let n = 0;
  while (n < 4 && ws.every((w) => w[n] && w[n].toLowerCase() === ws[0][n].toLowerCase())) n++;
  if (n < 2) return texts;
  return ws.map((w) => w.slice(n).join(" ").replace(/^[a-z]/, (c) => c.toUpperCase()));
}

const tidy = (t: string) => t.replace(/[;；]\s*(?:and|or)?\s*$/i, "").replace(/[.。]$/, "").trim();
const dropIncluding = (t: string) => t.replace(/,?\s*(?:including|such as|as follows|the following)\s*:?$/i, "").replace(/[：:]$/, "").trim();

function toSlide(s: Section, source?: string): Slide {
  const items = s.items.filter((i) => i.text.trim());
  const labeled = items.filter((i) => LABELED_ITEM.test(i.text)).length;
  const isLabeled = items.length > 0 && labeled >= items.length * 0.6;
  // 節の前置き（段落）の最初の文。「…including:」の並びの前置きは、そのまま主張にする
  const leadRaw = s.paras.length && s.paraFirst ? dropIncluding(firstSentence(s.paras[0])) : "";
  const lead = leadRaw ? dropIncluding(toClaim(leadRaw)) : "";
  // 3つちょうどの見出しつき項目は「主張＋根拠3つ」。それ以外の3つ以上は一覧で全部見せる
  if (items.length >= 3 && !s.table.length && !(items.length === 3 && isLabeled)) {
    const en = isLatin(items[0].text);
    const n = Math.min(items.length, GRID_MAX);
    const noun = shortHead(s.heading).toLowerCase();
    const countTitle = en ? `${(NUM_WORD[n] ?? String(n)).replace(/^./, (c) => c.toUpperCase())} ${noun} set the course` : `${shortHead(s.heading)}は${n}つ`;
    // 並びの直前の前置き（「…should prioritize:」）が、いちばん的確な主張になる。長すぎれば数で言う
    const introText = s.listIntro ? dropIncluding(firstSentence(s.listIntro.split(/(?<=[.。])\s+/).at(-1) ?? s.listIntro)) : "";
    const introWords = introText.split(/\s+/).length;
    const fits = (t: string) => !!t && (isLatin(t) ? t.split(/\s+/).length <= 16 : t.length <= 40);
    const title =
      (fits(introText) && introWords >= 4 ? toClaim(introText) : "") ||
      (isLabeled ? (fits(leadRaw) ? lead : countTitle) : "") ||
      lead ||
      pickClaim(s);
    // タイトルと同じことを言う項目は、カードに繰り返さない
    const same = (t: string) => toClaim(t).replace(/[.。]$/, "").toLowerCase() === title.replace(/[.。]$/, "").toLowerCase();
    const texts = stripCommonLead(items.map((i) => i.text).filter((t) => !same(t)));
    // 見出しの無い項目は、みな短ければ文をそのまま見出しに、1つでも長ければみな見出し無しの文として並べる（混ぜない）
    const wordsOf = (t: string) => (isLatin(t) ? t.split(/\s+/).length : t.length / 2.5);
    const allShort = texts.every((t) => LABELED_ITEM.test(t) || wordsOf(t) <= 14);
    const cards = texts.map((t) => {
      const m = t.match(/^([^:：]{2,70})[:：]\s+(.+)$/);
      if (m) return { head: m[1].trim(), body: clip(firstSentence(m[2]), 130) };
      return allShort ? { head: tidy(t), body: "" } : { head: "", body: clip(tidy(t), 170) };
    });
    return gridSlide(title, cards, source);
  }
  if (items.length === 3 && isLabeled && !s.table.length) {
    const points = items.map((i) => {
      const h = splitHead(i.text);
      return { head: h.head, body: clip(firstSentence(i.text.replace(/^[^:：]{2,70}[:：]\s+/, "")), 150) };
    });
    return { id: newId("s"), title: lead || pickClaim(s), layout: "claim3", source, content: { claim3: { points } } };
  }
  const slide = sectionToSlide(s);
  return { ...slide, title: lead && items.length ? lead : slide.title, source: source ?? slide.source };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 文書の中の大きな数字を拾う（比率・金額・倍率）。数字で見る要点に使う */
function keyNumbers(sections: Section[]): { value: string; label: string; note: string }[] {
  const seen = new Set<string>();
  const found: { value: string; label: string; note: string; rank: number }[] = [];
  for (const s of sections) {
    const texts = [...s.paras, ...s.items.map((i) => i.text)];
    for (const t of texts.flatMap(splitSentences)) {
      const v = pickFigure(t);
      if (!v || seen.has(v) || t.length > 260) continue;
      // 「2 percent to 5 percent」のような変化は「2% → 5%」にまとめる
      const change = t.match(/(\$?[\d.,]+\s?(?:percent|%|trillion|billion|million))\s+(?:in \d{4}\s+)?to\s+(\$?[\d.,]+\s?(?:percent|%|trillion|billion|million))/i);
      const value = change ? `${short(change[1])} → ${short(change[2])}` : short(v);
      const rank = change ? 0 : /percent|%/.test(v) ? 1 : /trillion|billion/.test(v) ? 2 : 4;
      if (rank > 2) continue;
      seen.add(v);
      // 「何の数字か」：数字の手前の言葉（短ければ）か、数字のあとの言葉（of GDP on defense）
      const first = change ? change[1] : v;
      const at = t.search(new RegExp(escapeRe(first)));
      const before = (at > 0 ? t.slice(0, at) : "")
        .replace(/[—–(,]\s*$/, "")
        .replace(/\b(?:down|up)?\s*(?:from|to|at|of|by|about|nearly|almost|over|some|roughly|perhaps|is|are|was|were|stood at|has|have|spend)\s*$/i, "")
        .trim();
      const afterFrom = change ? t.indexOf(change[2]) + change[2].length : at + v.length;
      const after = t
        .slice(afterFrom)
        .replace(/^[\s,]+/, "")
        .split(/[,;.—–(]/)[0]
        .split(/\s+/)
        .slice(0, 9)
        .join(" ")
        .trim();
      const beforeWords = before.split(/\s+/).filter(Boolean).length;
      const label = before && beforeWords <= 12 ? toClaim(before).replace(/[—–(,:\s]+$/, "") : after ? after.replace(/^./, (c) => c.toUpperCase()) : shortHead(s.heading);
      found.push({ value, label, note: clip(t, 150), rank });
    }
  }
  return found.sort((a, b) => a.rank - b.rank).slice(0, 4);
}
const short = (v: string) =>
  v
    .replace(/\s?percent\b/i, "%")
    .replace(/\s?trillion\b/i, "T")
    .replace(/\s?billion\b/i, "B")
    .replace(/\s?million\b/i, "M")
    .trim();

const PURPOSE_EN = /\b(?:(?:purpose|goal|aim|objective)s? of (?:this|our|the) (?:strategy|document|plan|report|paper)|(?:this|the) (?:strategy|document|plan|report) (?:is|aims|seeks)|overarching purpose)\b/i;
const PURPOSE_JA = /(本書|この戦略|本戦略|この計画|本報告|本稿).{0,12}(目的|ねらい|狙い)/;
const PURPOSE_STRONG = /\b(?:goal|purpose|aim|objective)s? of (?:this|our) (?:strategy|document|plan|report|paper)\b|(本書|この戦略|本戦略|この計画|本報告|本稿)の(目的|ねらい|狙い)/i;
function purposeSentence(sections: Section[]): string {
  const all = sections.flatMap((s) => [...s.paras, ...s.items.map((i) => i.text)].flatMap(splitSentences));
  // 「この戦略の目的は…」を先に、なければ「…が目的だ」のような文
  // 文の頭で目的を言う文（The goal of this plan is …）を優先する
  const strong = all.filter((x) => PURPOSE_STRONG.test(x)).sort((a, b) => a.search(PURPOSE_STRONG) - b.search(PURPOSE_STRONG));
  const t = strong[0] ?? all.find((x) => PURPOSE_EN.test(x) || PURPOSE_JA.test(x));
  return t ? toClaim(t) : "";
}

export function planLongDeck(title: string, sections: Section[], storyline: StorylineId, budget = 24): Deck {
  budget = Math.max(8, budget);
  const en = isLatin(title);
  const chapters = chaptersOf(sections);
  const today = new Date();
  const meta = en ? today.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : today.toISOString().slice(0, 10).replace(/-/g, ".");
  const cover: Slide = { id: newId("s"), title: toClaim(title), layout: "cover", content: { cover: { subtitle: "", meta } } };

  // 枚数は、章の分量に比べて配る（中身の多い章ほど枚数が多い）。多すぎれば中身の多い節を残す
  const fixed = 3 + chapters.length + 1;
  const textLen = (ch: Chapter) => [ch.head, ...ch.units.flatMap((u) => [u.sec, ...u.kids])].reduce((n, x) => n + x.paras.join("").length + x.items.map((i) => i.text).join("").length, 0);
  const totalLen = chapters.reduce((n, ch) => n + textLen(ch), 0) || 1;
  const chapterTitle = (ch: Chapter) => ch.head.heading.replace(/^(?:Introduction|はじめに)\s*[–—:-]\s*/i, "");
  const chapterSlides = chapters.map((ch) => {
    const allow = Math.max(1, Math.round(((budget - fixed) * textLen(ch)) / totalLen));
    const units = [...(hasBody(ch.head) ? [{ sec: ch.head, kids: [] }] : []), ...ch.units];
    let slides = units.flatMap(unitSlides);
    if (slides.length > allow) {
      const size = (x: Slide) => JSON.stringify(x.content).length;
      const keep = new Set([...slides].sort((a, b) => size(b) - size(a)).slice(0, allow));
      // 一覧（grid）は全体を見せるので必ず残す
      slides = slides.filter((x) => keep.has(x) || x.layout === "grid");
    }
    // ページの上の「役割」は、語る順番の型ではなく章の名前にする
    const role = shortHead(chapterTitle(ch)).replace(/[?？]$/, "");
    return slides.map((x) => ({ ...x, role }));
  });

  // 頼まれた枚数を超えていれば、ページの多い章から中身の少ないページを外す（各章の最初のページは残す）
  const nums0 = keyNumbers(sections);
  let withKpi = nums0.length >= 2;
  const total = () => 3 + chapters.length + chapterSlides.reduce((n, x) => n + x.length, 0) + (withKpi ? 1 : 0);
  const size = (x: Slide) => JSON.stringify(x.content).length;
  while (total() > budget) {
    const ch = chapterSlides.reduce((best, x) => (x.length > best.length ? x : best), chapterSlides[0]);
    if (ch && ch.length > 1) {
      const rest = ch.slice(1);
      const drop = rest.reduce((a, b) => (size(b) < size(a) ? b : a), rest[0]);
      ch.splice(ch.indexOf(drop), 1);
    } else if (withKpi) withKpi = false;
    else break;
  }

  const dividers: Slide[] = chapters.map((ch, i) => ({
    id: newId("s"),
    title: chapterTitle(ch),
    layout: "agenda",
    role: shortHead(chapterTitle(ch)).replace(/[?？]$/, ""),
    source: srcFor(ch.head),
    content: { agenda: { items: chapters.map((c) => ({ head: chapterTitle(c), page: "" })), current: i } },
  }));
  const n = chapters.length;
  const agenda: Slide = {
    id: newId("s"),
    title: en ? `The document in ${NUM_WORD[n] ?? n} chapters` : `${n}つの章で組み立てられている`,
    layout: "agenda",
    role: en ? "Agenda" : "目次",
    content: { agenda: { items: chapters.map((c) => ({ head: chapterTitle(c), page: "" })), current: -1 } },
  };
  const nums = nums0;
  const kpi: Slide | null =
    withKpi
      ? { id: newId("s"), title: en ? "The numbers the document leans on" : "数字で見る要点", layout: "kpi", role: en ? "Numbers" : "数字", content: { kpi: { stats: nums.map(({ value, label, note }) => ({ value, label, note })) } } }
      : null;

  const body: Slide[] = chapters.flatMap((_, i) => [dividers[i], ...chapterSlides[i]]);
  // サマリー：章ごとに、その章の最初の主張を要点にする（指すページは id で持つ）
  const points = chapters
    .map((ch, i) => ({ ch, x: chapterSlides[i][0] }))
    .filter((p) => p.x)
    .slice(0, 4)
    .map(({ ch, x }) => ({ head: x.title, body: shortHead(chapterTitle(ch)), page: "", ref: x.id }));
  const summary: Slide = { id: newId("s"), title: "", layout: "summary", role: en ? "Summary" : "要約", content: { summary: { points } } };
  const slides = [cover, summary, agenda, ...body, ...(kpi ? [kpi] : [])];
  // 統べる一文：文書が自分の目的を述べた文（「この戦略の目的は…」）があれば、それを使う
  const purpose = purposeSentence(sections);
  summary.title = purpose && !slides.some((x) => x.title === purpose) ? purpose : governingThought(slides, summary);
  cover.content.cover!.subtitle = summary.title.startsWith("Bottom line") || summary.title.startsWith("結論：") ? "" : summary.title;
  // 目次と中扉のページ番号（描くときに今の並びから数える）
  for (const x of [agenda, ...dividers]) x.content.agenda!.items = x.content.agenda!.items.map((it, i) => ({ ...it, page: `p.${slides.indexOf(dividers[i]) + 1}`, ref: dividers[i].id }));
  return { title: toClaim(title), storyline, mode: "read", slides };
}
