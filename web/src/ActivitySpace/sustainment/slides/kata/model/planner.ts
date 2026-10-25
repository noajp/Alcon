import { newId } from "./id";
import { tx } from "@/ActivitySpace/sustainment/slides/kata/i18n";
import type { Deck, Slide, StorylineId, SummaryContent } from "./types";
import { summaryPage } from "./deck";
import { consistentUnit, guessKind, guessUnit, parseNumber } from "./chart";
import { isLongOutline, planLongDeck } from "./longdoc";

// 手元のプランナー。API を使わずに、議事録や文章からデッキの骨組みを組む。
// 精度より「型どおりに組まれていること」を優先する。

interface Item {
  text: string;
  numbered: boolean;
  children: Item[];
}

export interface Section {
  /** 見出しの深さ（## なら 2）。長い文書を章と節に分けるのに使う */
  level?: number;
  /** 元の文書のページ（<!-- p.N --> の印から） */
  page?: number;
  /** 本文が段落から始まる（前置きの段落のあとに箇条が続く） */
  paraFirst?: boolean;
  /** 箇条の直前の「…:」の前置き（「Our broad policy for Europe should prioritize:」） */
  listIntro?: string;
  /** 「1つ目は…」の列挙から作った節。見出しが主張で、項目が根拠 */
  enumerated?: boolean;
  /** 見出しの無い文章の段落から作った節。見出しだけでも1枚にする */
  plainLead?: boolean;
  heading: string;
  items: Item[];
  table: string[][];
  paras: string[];
}

const BULLET = /^\s*(?:[-*・●◦]|\d+[.)．、])\s*/;
const NUMBERED = /^\s*\d+[.)．、]\s*/;

function cleanHeading(h: string): string {
  return h
    .replace(/^#+\s*/, "")
    .replace(/^\d+[.)．、]\s*/, "")
    .replace(/^(議事録|メモ|資料)[:：]\s*/, "")
    .replace(/^(Minutes|Meeting notes|Memo|Notes|Draft)\s*[:：]\s*/i, "")
    .trim();
}

/** 日本語（かな・漢字・全角）を含まない文。英語の規則で読む */
function isLatin(s: string): boolean {
  return /[A-Za-z]/.test(s) && !/[\u3000-\u30ff\u3400-\u9fff\uff00-\uffef]/.test(s);
}

const capFirst = (s: string) => s.replace(/^(["“'‘(]?)([a-z])/, (_, q: string, c: string) => q + c.toUpperCase());
const lowFirst = (s: string) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);
/** 出どころの書き方は、画面の言語ではなく見出しの言語に合わせる */
const srcOf = (h: string) => (isLatin(h) ? `Source: ${h}` : /[\u3000-\u30ff\u3400-\u9fff\uff00-\uffef]/.test(h) ? `元：${h}` : tx(`元：${h}`, `Source: ${h}`));

export function parseDoc(text: string): { title: string; sections: Section[] } {
  const lines = text.replace(/\r/g, "").split("\n");
  let title = "";
  const sections: Section[] = [];
  let cur: Section | null = null;
  let page: number | undefined;
  const start = (heading: string, level?: number) => {
    cur = { heading, items: [], table: [], paras: [], level, page };
    sections.push(cur);
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    const pm = line.match(/^<!--\s*p\.(\d+)\s*-->$/);
    if (pm) {
      page = Number(pm[1]);
      continue;
    }
    // そのほかの印（<!-- ask: … --> など）は本文にしない
    if (/^<!--.*-->$/.test(line.trim())) continue;
    if (/^#\s/.test(line) && !title) {
      title = cleanHeading(line);
      continue;
    }
    if (/^#{2,5}\s/.test(line)) {
      start(cleanHeading(line), line.match(/^#+/)![0].length);
      continue;
    }
    if (/^-{3,}$/.test(line.trim())) continue;
    if (!cur) start("");
    const c = cur as unknown as Section;
    if (/^\s*\|/.test(line)) {
      if (/^\s*\|[\s:|-]+\|\s*$/.test(line)) continue;
      c.table.push(line.trim().replace(/^\||\|$/g, "").split("|").map((x) => x.trim()));
      continue;
    }
    if (BULLET.test(line)) {
      const lastPara = c.paras[c.paras.length - 1];
      if (!c.listIntro && !c.items.length && lastPara && /[:：]$/.test(lastPara)) c.listIntro = lastPara.replace(/[:：]$/, "");
      const indent = raw.length - raw.trimStart().length;
      const item: Item = { text: line.replace(BULLET, "").trim(), numbered: NUMBERED.test(line), children: [] };
      const parent = c.items[c.items.length - 1];
      if (indent >= 2 && parent) parent.children.push(item);
      else c.items.push(item);
      continue;
    }
    if (!c.items.length && !c.paras.length && !c.table.length) c.paraFirst = true;
    c.paras.push(line.trim());
  }
  const filtered = sections.filter((s) => s.heading || s.items.length || s.table.length || s.paras.length);
  if (!title) {
    const first = filtered[0];
    const p0 = first?.paras[0] ?? "";
    title = first?.heading || (isLatin(p0) ? firstSentence(p0) : p0.slice(0, 24)) || tx("新しい資料", "Untitled deck");
  }
  // 見出しの無い文章は、段落ごとに節として扱う。「1つ目は…2つ目は…」の列挙は項目に割る
  if (filtered.length === 1 && !filtered[0].heading && filtered[0].paras.length > 2 && !filtered[0].items.length) {
    return { title, sections: filtered[0].paras.flatMap(paragraphToSections).map((x) => ({ ...x, plainLead: true })) };
  }
  return { title, sections: filtered };
}

const ENUM = /(?<=^|[。、，．!?！？\s])(?:(?:[1-9１-９一二三四五]|ひと|ふた|み)つ目(?:は|に|が)|第[一二三四五1-5]に|[①②③④⑤])[、，]?/g;

// 英語の列挙：文頭の「First, / Second, …」や「1) 2) 3)」
const ENUM_EN = /(?<=^|[.!?;:]\s+)(?:(?:First|Second|Third|Fourth|Fifth|Firstly|Secondly|Thirdly)\s*[,:]|[1-5]\))\s*/g;

function paragraphToSections(p: string): Section[] {
  let marks = [...p.matchAll(ENUM)];
  if (marks.length < 2 && isLatin(p)) marks = [...p.matchAll(ENUM_EN)];
  if (marks.length >= 2) {
    const lead = p.slice(0, marks[0].index).trim();
    const parts = marks.map((m, i) => {
      const t = p.slice(m.index! + m[0].length, i + 1 < marks.length ? marks[i + 1].index : undefined).trim().replace(/[。.]$/, "");
      return isLatin(t) ? capFirst(t) : t;
    });
    const head = splitSentences(lead);
    const leadSec: Section[] = head.length > 1 ? [{ heading: head[0], items: head.slice(1, -1).map((t) => ({ text: t, numbered: false, children: [] })), table: [], paras: [] }] : [];
    return [...leadSec, { enumerated: true, heading: head.at(-1) ?? "", items: parts.map((t) => ({ text: t, numbered: false, children: [] })), table: [], paras: [] }];
  }
  return [
    {
      heading: firstSentence(p),
      items: splitSentences(p).slice(1).map((t) => ({ text: t, numbered: false, children: [] })),
      table: [],
      paras: [],
    },
  ];
}

const FIGURE_JA = /[0-9０-９][0-9０-９,，.．]*\s*(?:万|億|千)?(?:%|％|人|円|倍|週間|日|か月|ヶ月|カ月|件|社|年|名|点|割)/;
// 英語の数字：$1.2M、¥46B/year、62%、3x、4.6M users、18 hires、120/month
const EN_NUM = "[0-9]+(?:[,.][0-9]+)*";
const EN_SCALE = "(?:[kKMB]|bn|million|billion|trillion)";
const EN_PER = "\\/(?:month|mo|year|yr|week|wk|day)\\b";
const EN_NOUN =
  "(?:users|customers|clients|companies|firms|factories|shops|hires|engineers|people|members|employees|staff|reworks|quotes|deals|orders|stores|downloads|days|weeks|months|years|hours|minutes|points|pts|times|percent)";
const FIGURE_EN = new RegExp(
  `(?:[$¥€£]${EN_NUM}(?:\\s?${EN_SCALE}\\b)?(?:${EN_PER})?|(?<![A-Za-z])${EN_NUM}(?:%|x\\b|×|${EN_PER}|\\s?${EN_SCALE}\\b(?:\\s${EN_NOUN}\\b)?|\\s${EN_NOUN}\\b))`,
);
const FIGURE = new RegExp(`(?:${FIGURE_JA.source}|${FIGURE_EN.source})`);

/** 文の中で一番目立たせたい数字（単位つき）を取り出す */
const UNIT_RANK: [RegExp, number][] = [
  [/(%|％|割|percent)$/, 0],
  [/(倍|[0-9]x|×)$/, 1],
  [/(億円|万円|円)$|^[$¥€£]/, 2],
];

export function pickFigure(...texts: string[]): string {
  const re = new RegExp(FIGURE.source, "g");
  const found: { v: string; rank: number; order: number }[] = [];
  texts.forEach((t, ti) => {
    for (const m of t.matchAll(re)) {
      const v = /[A-Za-z]{2}/.test(m[0]) ? m[0].replace(/\s+/g, " ") : m[0].replace(/\s+/g, "");
      const after = t.slice(m.index! + m[0].length, m.index! + m[0].length + 1);
      // 年（2026年）や日付（4月1日）は目立たせる数字にしない
      if (/^[0-9０-９]{4}年$/.test(v)) continue;
      if (/日$/.test(v) && /月[0-9０-９]+日$/.test(t.slice(0, m.index! + m[0].length))) continue;
      if (/年$/.test(v) && /^[0-9０-９]+月/.test(t.slice(m.index! + m[0].length))) continue;
      if (/^[0-9０-９]+点$/.test(v) && after === "満") continue;
      // 「40%から55%に」のような変化は、変わった後の数字を目立たせる
      const rest = t.slice(m.index! + m[0].length);
      const from =
        (rest.startsWith("から") && new RegExp(FIGURE.source).test(rest.slice(2, 16))) ||
        (/^\s+to\s/.test(rest) && new RegExp(FIGURE.source).test(rest.slice(0, 24)));
      const rank = (UNIT_RANK.find(([r]) => r.test(v))?.[1] ?? 3) + (from ? 0.5 : 0);
      found.push({ v, rank, order: ti * 1000 + m.index! });
    }
  });
  // タイトル（最初の文）にある数字を優先し、その中で 比率 → 倍率 → 金額 → その他 の順に目立たせる
  found.sort((a, b) => Number(a.order >= 1000) - Number(b.order >= 1000) || a.rank - b.rank || a.order - b.order);
  return found[0]?.v ?? "";
}

/** 文の中で一番強い数字の順位（小さいほど強い。数字が無ければ 9） */
function figureRank(t: string): number {
  const v = pickFigure(t);
  if (!v) return 9;
  return UNIT_RANK.find(([r]) => r.test(v))?.[1] ?? 3;
}

const ASK_JA = /(決めてほしい|決めていただきたい|承認(して|を)ほしい|判断してほしい|お願いしたい|お願いします|ご判断|ご承認)/;
const ASK_EN =
  /\b(?:need(?:s)? (?:you|the board|management|leadership|your)\b.{0,40}?\b(?:decide|decision|approve|approval|sign[- ]?off)|(?:would|'d|’d) like (?:your |the board's |a )?(?:approval|sign[- ]?off|decision)|(?:ask|asking) (?:you|the board|management) to (?:decide|approve)|what we need .{0,40}?\b(?:decide|approve|sign off)|please (?:decide|approve))/i;
const ASK = { test: (t: string) => ASK_JA.test(t) || (isLatin(t) && ASK_EN.test(t)) };

function extractAsksEn(sentence: string): string[] {
  let body = sentence.trim().replace(/[.!]+$/, "");
  const m =
    body.match(/^what\b.*?\b(?:is|are)\b[:,]?\s+(.+)$/i) ??
    body.match(/\b(?:to (?:decide|approve)(?: on)?|approval (?:for|of|on)|sign[- ]?off on|decide on|decision on|please (?:decide|approve)(?: on)?)\b[:,]?\s+(.+)$/i);
  if (m) body = m[1];
  return body
    .split(/,\s*(?:and\s+)?|;\s*|\s+and\s+(?=(?:whether|to|approv\w*|the|a|an|our|your|how|when|which|if)\b)/i)
    .map((x) => x.trim())
    .filter((x) => x.length >= 3 && !/^(thanks|thank you|please let|let us know)/i.test(x))
    .map(capFirst);
}

/** 「決めてほしいのは、AとB」のような一文から、頼みごとを取り出す */
export function extractAsks(sentence: string): string[] {
  if (isLatin(sentence)) return extractAsksEn(sentence);
  const body = sentence
    .replace(/^.*?(のは|ことは|事項は)[、，]?/, "")
    .replace(/[。.]$/, "")
    .replace(/(です|だ)$/, "");
  return body
    .split(/[、，]|(?<=(?:どうか|か|の承認|の判断))と/)
    .map((x) => x.trim().replace(/^と/, "").replace(/と$/, ""))
    .filter((x) => x.length >= 2 && !/^(よろしく|お願い)/.test(x));
}

// 英語の文の切れ目。略語（approx. / e.g. / vs.）では切らない
const EN_STOP = /(?<!\b(?:approx|e\.g|i\.e|vs|etc|Mr|Ms|Mrs|Dr|No|Inc|Ltd|Co|St|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec))(?<=[A-Za-z0-9%)"”'’][.!?]["”’]?)\s+(?=["“'‘(]?[A-Z0-9$¥€£])/;

export function splitSentences(p: string): string[] {
  return p
    .split(/(?<=[。！？!?])/)
    .flatMap((s) => (isLatin(s) ? s.split(EN_STOP) : [s]))
    .map((s) => s.trim())
    .filter(Boolean);
}

export function firstSentence(p: string): string {
  return splitSentences(p)[0] ?? p;
}

const PLAIN_FORM: [RegExp, string][] = [
  [/できます$/, "できる"],
  [/あります$/, "ある"],
  [/います$/, "いる"],
  [/なります$/, "なる"],
  [/します$/, "する"],
  [/ません$/, "ない"],
  [/でした$/, "だった"],
  [/ました$/, "た"],
  [/です$/, ""],
  [/ます$/, "る"],
];

const DANGLING = /\s+(?:and|or|but|the|a|an|to|of|for|with|in|on|at|by|from|that|which|as|so|than|its|their|our)$/i;

/** 英語のタイトル：ラベルと括弧書きを外し、1文に絞り、16語を超えたら読点で切る */
function toClaimEn(s: string): string {
  let t = s.trim();
  t = t.replace(/\s*\([^)]*\)/g, "");
  t = t.replace(/^[A-Za-z][\w '’&/-]{0,24}:\s+(?=\S)/, "");
  const first = firstSentence(t);
  if (words(first).length >= 3) t = first;
  t = t.replace(/[.。;:]+$/, "").trim();
  t = t.replace(/^(?:but|and|so|also|however),?\s+/i, "");
  if (/^["“][^"“”]*["”]$/.test(t)) t = t.slice(1, -1);
  if (words(t).length > 16) {
    // 「Since X, Y」のような前置きは外し、言い切りの側を残す
    const lead = t.match(/^((?:since|when|if|after|before|because|while|although|though|as|once|with|across|by|in|for|of|over|despite|given|unlike|compared)\b[^,]{0,80}),\s+(.+)$/i);
    if (lead && words(lead[2]).length >= 4) t = lead[2];
  }
  const ws = words(t);
  if (ws.length > 16) {
    const head = ws.slice(0, 16).join(" ");
    const at = head.search(/,\s[^,]*$/);
    t = at > 0 && words(head.slice(0, at)).length >= 6 ? head.slice(0, at) : head;
    while (DANGLING.test(t)) t = t.replace(DANGLING, "");
  }
  return capFirst(t.replace(/[,;:]$/, "").trim());
}

/** タイトルを結論の形に整える。ラベルと括弧書きを外し、1文に絞り、です・ますを外す */
export function toClaim(s: string): string {
  if (isLatin(s)) return toClaimEn(s);
  let t = s.trim();
  t = t.replace(/^[^「」：:]{1,10}[：:]\s*/, "");
  t = t.replace(/[（(][^）)]*[）)]/g, "");
  const first = firstSentence(t);
  if (first.length >= 10) t = first;
  t = t.replace(/[。．.]+$/, "").trim();
  if (/^「[^「」]*」$/.test(t)) t = t.slice(1, -1);
  for (const [re, to] of PLAIN_FORM) {
    if (re.test(t)) {
      t = t.replace(re, to);
      break;
    }
  }
  if (t.length > 52) {
    const cut = t.slice(0, 52);
    const at = Math.max(cut.lastIndexOf("、"), cut.lastIndexOf("，"));
    t = at > 20 ? cut.slice(0, at) : cut;
  }
  return t;
}

const CONCLUSIVE_JA = /(する|ある|ない|いる|べき|できる|なる|変える|つくる|作る|狙う|割れ|表れ|必要|重要|伸び|足り|組む|難しい|空いて)/;
const CONCLUSIVE_EN = new RegExp(
  "\\b(?:is|are|was|were|will|would|should|must|need|needs|can|cannot|can't|can’t|won't|won’t|don't|doesn't|isn't|aren't|wasn't|didn't|has|have|had|" +
    "grew|grow|grows|fell|fall|falls|rose|rise|rises|doubled|tripled|halved|cut|cuts|shows?|showed|drives?|drove|makes?|made|wins?|won|loses?|lost|" +
    "lacks?|lacking|takes?|took|requires?|reduces?|reduced|increased?|decreased?|improved?|outperforms?|beats?|fails?|failed|matters?|leads?|turns?|" +
    "comes?|came|receives?|received|causes?|caused|spends?|spent|uses?|used|gets?|got|sees?|saw|wants?|prefers?|depends?|struggles?|misses|missed|" +
    "accounts? for|exceeds?|exceeded|remains?|remained|stays?|stayed|becomes?|became|costs?|saves?|saved|earns?|earned|generates?|generated|keeps?|kept|" +
    "gives?|gave|offers?|brings?|brought|lets?|allows?|helps?|helped|stalls?|stalled|tends?|accepts?|chooses?|chose|feels?|felt|fits?|works?|worked|" +
    "happens?|happened|reads?|drafts?|sends?|sent|joins?|joined|churned|signed|converts?|converted|delivers?|delivered|reaches?|reached|serves?|served)\\b",
  "i",
);
// 文頭の動詞は命令形（「Cut interviews …」）なので主張と見なさない。主語つきの文（We match …）は主張
const IMPERATIVE =
  /^(?:deliver|use|build|create|aim|establish|make|take|run|cut|add|set|mix|include|keep|start|stop|launch|pay|publish|host|hire|sell|rent|partner|open|state|treat|write|list|arrange|turn|introduce|capture|discover|match|showcase|record|don't|do not|avoid|focus|move|test|try|ask|get|let|plan|bring|grow|reduce|increase|improve|raise|lower|invest|prioritize|review|check|consider|define|design|decide|agree|share|send|call|meet|talk|discuss|prepare|draft|find|secure|confirm|validate|follow)\b/i;
function conclusiveEn(t: string): boolean {
  const body = t.replace(/\s*\([^)]*\)/g, "").trim();
  if (/^(?:we|they|it|this|these|that|those|you|our \w+|their \w+)\s+(?!\w+ing\b)[a-z]\w*/i.test(body)) return true;
  if (IMPERATIVE.test(body)) return false;
  const re = new RegExp(CONCLUSIVE_EN.source, "gi");
  for (const m of body.matchAll(re)) if (m.index! > 0) return true;
  return false;
}
const CONCLUSIVE = { test: (t: string) => CONCLUSIVE_JA.test(t) || (isLatin(t) && conclusiveEn(t)) };
/** 「Label: 説明」の形の項目。英語では言い切りの文を先に探す */
const LABELED = /^[^:]{1,40}:\s/;

export function pickClaim(s: Section, prefer?: string): string {
  if (prefer && CONCLUSIVE.test(prefer)) return toClaim(prefer);
  const pool = [...s.items.map((i) => i.text), ...s.paras];
  const fits = (b: string) => (isLatin(b) ? b.length >= 20 && b.length <= 200 : b.length >= 12 && b.length <= 90);
  if (s.plainLead && isLatin(s.heading) && CONCLUSIVE.test(s.heading)) return toClaim(s.heading);
  const strong =
    pool.find((b) => isLatin(b) && !LABELED.test(b) && CONCLUSIVE.test(b) && fits(b)) ?? pool.find((b) => CONCLUSIVE.test(b) && fits(b));
  return toClaim(strong ?? (s.heading || pool[0] || ""));
}

// 英語の見出しを切る位置（この語の手前で切る）
const EN_BREAK = /^(?:and|to|for|with|by|in|on|at|so|because|while|through|from|via|but|when|after|before|until|into|rather|instead|than)$/i;
const noParen = (s: string) => s.replace(/\s*\([^)]*\)/g, "").trim();

function trimHead(h: string): string {
  let t = h.replace(/[,;:]$/, "").trim();
  // 引用符が閉じていなければ、開いた所の手前まで戻す
  if ((t.match(/["“”]/g) ?? []).length % 2) t = t.slice(0, t.search(/["“”][^"“”]*$/)).trim();
  t = t.replace(/[,;:]$/, "").trim();
  while (DANGLING.test(t)) t = t.replace(DANGLING, "");
  return t;
}

function splitHeadEn(b: string): { head: string; body: string } {
  const m = b.match(/^(.{1,44}?):\s+(.+)$/);
  if (m) return { head: capFirst(noParen(m[1])), body: capFirst(m[2].trim()) };
  const arrow = b.match(/^(.{1,36}?)\s*[→⇒]\s*(.+)$/);
  if (arrow) return { head: capFirst(arrow[1].trim()), body: capFirst(arrow[2].trim()) };
  const t = capFirst(b.replace(/[.。]$/, "").trim());
  const plain = noParen(t);
  const ws = words(plain);
  if (ws.length <= 6) return { head: plain, body: plain === t ? "" : t };
  const stop = plain.search(/(?:,|;|\s[—–])\s/);
  const before = stop > 0 ? words(plain.slice(0, stop)).length : 0;
  if (before >= 2 && before <= 7) return { head: trimHead(plain.slice(0, stop)), body: t };
  let cut = -1;
  for (let i = 2; i <= Math.min(6, ws.length - 1); i++) if (EN_BREAK.test(ws[i])) cut = i;
  return { head: trimHead(ws.slice(0, cut > 0 ? cut : 5).join(" ")) || ws.slice(0, 4).join(" "), body: t };
}

export function splitHead(b: string): { head: string; body: string } {
  if (isLatin(b)) return splitHeadEn(b);
  const m = b.match(/^(.{1,16}?)[：:](.+)$/);
  if (m) return { head: m[1].trim(), body: m[2].trim() };
  const arrow = b.match(/^(.{1,16}?)\s*[→⇒]\s*(.+)$/);
  if (arrow) return { head: arrow[1].trim(), body: arrow[2].trim() };
  const t = b.replace(/[。.]$/, "");
  if (t.length <= 16) return { head: t, body: "" };
  // 見出しは読点か助詞の切れ目で短くし、本文には全文を残す
  const comma = t.search(/[、，]/);
  if (comma >= 4 && comma <= 16) return { head: t.slice(0, comma), body: t };
  let cut = -1;
  for (const mm of t.matchAll(/[をにでとはが]/g)) if (mm.index! >= 4 && mm.index! <= 16) cut = mm.index!;
  return { head: cut > 0 ? t.slice(0, cut) : t.slice(0, 14), body: t };
}

// 締めの節の見出し。語尾で判定する（「導入予定のシステム」「今後の市場環境」は締めではない）
const CLOSING_RE = /((次の|ネクスト)?アクション(アイテム)?|ネクストステップ|次の一歩|宿題|お願い|やること|予定|進め方|スケジュール|対応|決めてほしいこと)$|^(来週|次週|来月|今後)(の|に)?(やること|予定|進め方|アクション|スケジュール|対応)?$/;
const CLOSING_EN =
  /^(?:(?:proposed |suggested )?next (?:steps?|actions?)|action items?|(?:our |the |key )?asks?|requests?|to-?dos?|follow-?ups?|what we need(?: from you)?|decisions? (?:needed|required|requested)|way forward|timeline|schedule|(?:next|upcoming|this coming) (?:week|month|quarter)(?:'s)?(?: plan| priorities| actions)?)$/i;
const CLOSING = {
  test: (h: string) => {
    const t = h.replace(/[（(][^）)]*[）)]$/, "").trim();
    return CLOSING_RE.test(t.replace(/(について|事項|一覧)$/, "").trim()) || CLOSING_EN.test(t.replace(/[.:]$/, ""));
  },
};
const SUMMARY_STRONG = /(決まったこと|結論|まとめ|要約|サマリ)|^(?:decisions?(?: made)?|what we decided|conclusions?|summary|executive summary|key takeaways|takeaways|tl;?dr|bottom line)$/i;
const SUMMARY_WEAK = /(コンセプト)|^concept\b/i;
const SKIP = /(未決|参加者|前提|プロフィール|作ったもの)|^(?:open (?:questions|issues|items)|unresolved|undecided|attendees|participants|background|assumptions|profiles?|about us|what we built|agenda)\b/i;
const META = /^(日時|参加|場所|目的|仮称|記録)[：:]|^(?:date|time|when|attendees|participants|present|location|venue|where|purpose|objective|goal|working name|codename|notes? taker|recorded by|minutes by)\s*:/i;
const PURPOSE = /^(目的[：:]|(?:purpose|objective|goal)\s*:)\s*/i;

const flat = (i: Item) =>
  !i.children.length
    ? i.text
    : isLatin(i.text)
      ? `${i.text} (${i.children.map((c) => c.text).join("; ")})`
      : `${i.text}（${i.children.map((c) => c.text).join("、")}）`;

const NUM_WORD = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

/** 「困っていることは2つあり、それぞれに打ち手を打つ」 */
function issueTitle(heading: string, n: number): string {
  const noun = isLatin(heading) && words(heading).length <= 3 ? heading.toLowerCase() : "issues";
  const plural = n === 1 ? noun.replace(/s$/, "") : /s$/.test(noun) ? noun : `${noun}s`;
  return tx(`${heading}は${n}つあり、それぞれに打ち手を打つ`, `${capFirst(NUM_WORD[n] ?? String(n))} ${plural}, each with an action`);
}

export function sectionToSlide(s: Section): Slide {
  const id = newId("s");
  const source = s.heading ? srcOf(s.heading) : undefined;
  const wholeFigure = new RegExp(`^(約|年|月|approx\\.?\\s|about\\s|~)?${FIGURE.source}$`, "i");
  const plainNumber = (v: string) => /^[-−▲+]?[\d０-９][\d０-９,，.．]*$/.test(v.trim());
  if (s.table.length >= 3 && (s.table[0].length >= 3 || s.table.slice(1).every((r) => wholeFigure.test((r[1] ?? "").trim()) || plainNumber(r[1] ?? "")))) {
    const [rawHead, ...rawRows] = s.table;
    // 出典の列は本文に並べず、ページの出どころに回す
    const srcCol = rawHead.findIndex((h, i) => i > 0 && /^(出典|ソース|出所|sources?)$/i.test(h));
    const head = srcCol > 0 ? rawHead.filter((_, i) => i !== srcCol) : rawHead;
    const rows = srcCol > 0 ? rawRows.map((r) => r.filter((_, i) => i !== srcCol)) : rawRows;
    const sources = srcCol > 0 ? [...new Set(rawRows.map((r) => r[srcCol]).filter(Boolean))] : [];
    const columns = head.slice(1, 4);
    // 見出しが名詞だけなら、数字の入った行から主張を起こす（例：狙える市場は年460億円）
    let title = pickClaim(s);
    if (!CONCLUSIVE.test(title) && columns.length === 1) {
      const key = rows.find((r) => /(狙える|合計|全体|総額|規模)|\b(addressable|total|overall|market size|TAM|SAM)\b/i.test(r[0])) ?? rows[rows.length - 1];
      if (key?.[1] && FIGURE.test(key[1])) title = isLatin(key[0]) ? `${capFirst(key[0])} is ${key[1]}` : `${key[0]}は${key[1]}`;
    }
    const src = sources.length ? tx("出典：{sources}", "Source: {sources}", { sources: sources.join(tx("、", ", ")) }) : source;
    // 値が全部数の表は、4行以上か時間の並びならグラフにする（ゼラズニー：メッセージ→比較→グラフ）
    const allNumeric = columns.length > 0 && rows.every((r) => columns.every((_, ci) => parseNumber(r[ci + 1] ?? "") !== null));
    // 列ごとに単位がそろっているときだけ（「$3M / 6 months / 200 users」は比べる表のまま）
    const sameUnits = columns.every((_, ci) => consistentUnit(rows.map((r) => r[ci + 1] ?? "")));
    if (allNumeric && sameUnits) {
      const categories = rows.map((r) => r[0]).slice(0, 12);
      const series = columns.map((name, ci) => ({ name, values: rows.slice(0, 12).map((r) => parseNumber(r[ci + 1] ?? "") ?? 0) }));
      const unit = guessUnit(rows.flatMap((r) => r.slice(1)));
      const kind0 = guessKind(categories, series[0].values, unit, rows.slice(0, 12).map((r) => r[1] ?? ""));
      if (rows.length >= 4 || kind0 === "line" || kind0 === "waterfall") {
        const kind = series.length > 1 && kind0 !== "line" ? "column" : kind0;
        const first = series[0].values;
        const highlight = kind === "line" ? first.length - 1 : first.indexOf(Math.max(...first));
        const takeaway = s.items[0] ? toClaim(s.items[0].text) : "";
        return { id, title, layout: "chart", source: src, content: { chart: { kind, categories, series, unit, highlight, takeaway } } };
      }
    }
    // 値が1列だけの表は、比較ではなく数字を大きく並べる
    if (columns.length === 1 && rows.length <= 4) {
      return { id, title, layout: "claim3", source: src, content: { claim3: { points: rows.map((r) => ({ head: r[1] ?? "", body: r[0] })) } } };
    }
    return {
      id,
      title,
      layout: "compare",
      source: src,
      content: {
        compare: {
          columns,
          rows: rows.slice(0, 5).map((r) => ({ label: r[0], cells: columns.map((_, i) => r[i + 1] ?? "") })),
          highlight: Math.min(1, columns.length - 1),
          takeaways: s.items.slice(0, 3).map((i) => toClaim(i.text)),
        },
      },
    };
  }
  if (s.enumerated && s.items.length >= 2) {
    const pts = s.items.slice(0, 4).map((i) => splitHead(i.text));
    return s.items.length === 3
      ? { id, title: toClaim(s.heading || pickClaim(s)), layout: "claim3", source, content: { claim3: { points: pts } } }
      : { id, title: toClaim(s.heading || pickClaim(s)), layout: "steps", source, content: { steps: { steps: pts } } };
  }
  const stepsParent = s.items.find((i) => i.children.filter((c) => c.numbered).length >= 3);
  if (stepsParent) {
    return {
      id,
      title: pickClaim(s, stepsParent.text),
      layout: "steps",
      source,
      content: { steps: { steps: stepsParent.children.slice(0, 5).map((c) => splitHead(c.text)) } },
    };
  }
  const topNumbered = s.items.filter((i) => i.numbered);
  if (topNumbered.length >= 3) {
    return { id, title: pickClaim(s), layout: "steps", source, content: { steps: { steps: topNumbered.slice(0, 5).map((i) => splitHead(i.text)) } } };
  }
  const cmpParent = s.items.find(
    (i) => i.children.length >= 2 && i.children.length <= 4 && i.children.every((c) => (isLatin(c.text) ? /^.{1,36}:\s/ : /^.{1,18}[：:]/).test(c.text)),
  );
  if (cmpParent) {
    const cols = cmpParent.children.map((c) => splitHead(c.text));
    const others = s.items.filter((i) => i !== cmpParent);
    return {
      id,
      title: pickClaim(s, cmpParent.text),
      layout: "compare",
      source,
      content: {
        compare: {
          columns: cols.map((c) => c.head),
          rows: [{ label: tx("特徴", "Features"), cells: cols.map((c) => c.body) }],
          highlight: cols.length >= 3 ? 1 : 0,
          takeaways: others.slice(0, 3).map((i) => toClaim(i.text)),
        },
      },
    };
  }
  // 「A → B」の対。右が数字だけなら推移（2.1% → 2.8%）なので打ち手の対にしない
  const figureOnly = new RegExp(`^(約|approx\\.?\\s|about\\s|~)?${FIGURE.source}$`, "i");
  const allPairs = s.items.filter((i) => {
    const parts = i.text.split(/[→⇒]/);
    if (parts.length !== 2) return false;
    const right = parts[1].trim().replace(/[。.]$/, "");
    // 両側に数字があり右が短ければ「現状3日 → 目標1日」のような推移
    const trend = FIGURE.test(parts[0]) && FIGURE.test(right) && right.length <= 16;
    return !figureOnly.test(right) && !trend;
  });
  if (allPairs.length >= 2) {
    const pairs = allPairs.slice(0, 5).map((i) => {
      const [a, b] = i.text.split(/[→⇒]/);
      return { issue: isLatin(a) ? capFirst(a.trim()) : a.trim(), action: isLatin(b) ? capFirst(b.trim()) : b.trim() };
    });
    const rest = s.items.filter((i) => !allPairs.includes(i));
    const topic = /(困|課題|問題|悩み|リスク|懸念)|\b(problems?|issues?|challenges?|pain points?|risks?|concerns?|blockers?|what's blocking us)\b/i.test(s.heading) && !rest.length;
    const head = topic ? issueTitle(s.heading, pairs.length) : pickClaim({ ...s, items: rest.length ? rest : s.items });
    return { id, title: toClaim(head), layout: "issue", source, content: { issue: { pairs } } };
  }
  const title = pickClaim(s);
  const items = s.items.filter((i) => toClaim(i.text) !== title);
  const pairish = items.filter((i) => allPairs.includes(i));
  if (pairish.length >= 2) {
    return {
      id,
      title,
      layout: "issue",
      source,
      content: { issue: { pairs: pairish.slice(0, 3).map((i) => { const [a, b] = i.text.split(/[→⇒]/); return { issue: isLatin(a) ? capFirst(a.trim()) : a.trim(), action: isLatin(b) ? capFirst(b.trim()) : b.trim() }; }) } },
    };
  }
  if (items.length >= 3) {
    return { id, title, layout: "claim3", source, content: { claim3: { points: items.slice(0, 3).map((i) => splitHead(flat(i))) } } };
  }
  if (items.length === 2) {
    const figure = pickFigure(title, ...items.map((i) => i.text));
    // 数字があれば「前提→帰結」で数字を立てる。無ければ2つの根拠として並べる（帰結に主張を繰り返さない）
    if (figure) return { id, title, layout: "premise", source, content: { premise: { premises: items.map(flat), conclusion: "", figure } } };
    return { id, title, layout: "claim3", source, content: { claim3: { points: items.map((i) => splitHead(flat(i))) } } };
  }
  const lead = (items[0] ? flat(items[0]) : s.paras.join(" ")).slice(0, 140);
  // 一言と数字：一番強い数字を持つ文をタイトルにして、大きな数字とタイトルを一致させる
  if (lead && figureRank(lead) < figureRank(title)) {
    const t2 = toClaim(lead);
    return { id, title: t2, layout: "statement", source, content: { statement: { lead: title, figure: pickFigure(t2) } } };
  }
  return { id, title, layout: "statement", source, content: { statement: { lead, figure: pickFigure(title, lead) } } };
}

export function planDeck(text: string, storyline: StorylineId = "scr", budget?: number): Deck {
  const { title, sections } = parseDoc(text);
  // 章（##）が3つ以上ある長い文書は、章ごとに中扉を立てて組む
  if (isLongOutline(sections)) return planLongDeck(title, sections, storyline, budget);
  const purpose = sections
    .flatMap((s) => s.items.map((i) => i.text))
    .find((b) => PURPOSE.test(b))
    ?.replace(PURPOSE, "");
  const today = new Date();
  const meta = tx(today.toISOString().slice(0, 10).replace(/-/g, "."), today.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }));
  const slides: Slide[] = [
    {
      id: newId("s"),
      title: toClaim(title),
      layout: "cover",
      content: { cover: { subtitle: purpose ? (isLatin(purpose) ? capFirst(purpose) : purpose) : "", meta } },
    },
  ];
  const summary = sections.find((s) => SUMMARY_STRONG.test(s.heading)) ?? sections.find((s) => SUMMARY_WEAK.test(s.heading));
  if (summary) {
    const texts = [...summary.items.map((i) => i.text), ...summary.paras];
    const first = (texts[0] ?? summary.heading)
      .replace(/^[^「」]{0,12}は「(.*)」$/, "$1")
      .replace(/^[^「」]{0,12}は「/, "「")
      .replace(/^[^"“”]{0,40}?\b(?:is|was|will be)\s+["“]([^"“”]*)["”]\.?$/i, "$1");
    const leads = texts.slice(1, 3).map((t) => toClaim(t));
    const lead = leads.every(isLatin) ? leads.map((t) => `${t}.`).join(" ") : leads.join("。");
    slides.push({ id: newId("s"), title: toClaim(first), layout: "statement", source: srcOf(summary.heading), content: { statement: { lead, figure: "" } } });
  }
  // 締めは最後に出てくるものを採る
  const closing = [...sections].reverse().find((s) => CLOSING.test(s.heading));
  // 締めの節が無ければ、「決めてほしい」系の文を集めて結びにする
  const askTexts: string[] = [];
  if (!closing) {
    for (const s of sections) {
      while (ASK.test(s.heading)) {
        askTexts.push(s.heading);
        s.heading = s.items.length ? s.items.shift()!.text : "";
      }
      s.items = s.items.filter((i) => {
        if (ASK.test(i.text)) {
          askTexts.push(i.text);
          return false;
        }
        return true;
      });
    }
  }
  const isMeta = (s: Section) => !s.heading && s.items.length > 0 && s.items.every((i) => META.test(i.text));
  const body = sections.filter((s) => s !== summary && s !== closing && !SKIP.test(s.heading) && !isMeta(s));
  for (const s of body.slice(0, 10)) {
    if (!s.items.length && !s.table.length && !s.paras.length && !(s.plainLead && s.heading)) continue;
    slides.push(sectionToSlide(s));
  }
  if (!closing && askTexts.length) {
    const asks = askTexts.flatMap(extractAsks).slice(0, 4);
    // 依頼が拾えなかったときも、本文の言語に合わせる
    const docEn = slides.length > 0 && isLatin(slides.map((x) => x.title).join(" "));
    const en = asks.length ? asks.every(isLatin) : docEn;
    const askTitle = !asks.length
      ? en
        ? "Decisions we need"
        : "決めてほしいこと"
      : en
        ? `Decide ${asks.slice(0, 2).map(lowFirst).join(" and ")}`
        : `${asks.slice(0, 2).join("と、")}を決めてほしい`;
    slides.push({
      id: newId("s"),
      title: toClaim(askTitle),
      layout: "closing",
      source: en ? "Source: requests in the text" : "元：本文の依頼",
      content: { closing: { asks } },
    });
  }
  // 表紙の副題：目的が書かれていなければ、要約か最初の主張を置く
  const cover = slides[0];
  // 英語の見出しの無いメモでは、最初の文が表紙と1枚目の両方に出がち。1枚目は本文の側を主張にする
  for (const x of slides.slice(1)) {
    const st = x.content.statement;
    if (x.title === cover.title && isLatin(x.title) && x.layout === "statement" && st?.lead) {
      const lead = x.title;
      x.title = toClaim(st.lead);
      x.content = { statement: { lead, figure: pickFigure(x.title, lead) } };
    }
  }
  if (cover.content.cover && !cover.content.cover.subtitle) {
    // 見出しのまま残ったタイトルや短い名詞は使わない。見つからなければ空のままにする
    const lead = slides.find((x, i) => i > 0 && x.layout !== "closing" && x.title.length >= 12 && x.title !== cover.title && x.source !== srcOf(x.title))?.title ?? "";
    cover.content.cover.subtitle = lead;
  }
  if (closing) {
    const asks = closing.table.length > 1 ? closing.table.slice(1).map((r) => r.slice(1).join(" ").trim() || r[0]) : closing.items.map((i) => i.text);
    const a0 = asks[0];
    const closeTitle = !a0
      ? tx("次の一歩を決める", "Agree on next steps")
      : isLatin(a0)
        ? /^(we|i|please)\b|\b(want|need|would like|'d like|’d like|ask|request)\b/i.test(a0)
          ? a0
          : `Next, ${lowFirst(a0.replace(/^(first|then|next|also|finally),\s*/i, ""))}`
        : /(たい|ほしい|欲しい|する|決める)$/.test(a0.replace(/[。.]$/, ""))
          ? a0
          : `次は、${a0.replace(/^[^、]{0,6}[、，]/, "")}`;
    slides.push({
      id: newId("s"),
      title: toClaim(closeTitle),
      layout: "closing",
      source: srcOf(closing.heading),
      content: { closing: { asks: asks.slice(0, 4) } },
    });
  }
  // 7枚以上なら、2枚目をエグゼクティブサマリー（A4一枚サマリー）にする：結論と、それを支える要点とページ
  if (slides.length >= 7 && slides[1]?.layout !== "summary") {
    const hasSummary = slides[1]?.layout === "statement" && slides[1].source?.includes(summary?.heading ?? "\u0000");
    const bodyStart = hasSummary ? 2 : 1;
    const body = slides.slice(bodyStart).filter((x) => x.layout !== "closing");
    const points = summaryPoints(body);
    const governing = governingThought(slides, hasSummary ? slides[1] : undefined);
    const sum: Slide = { id: hasSummary ? slides[1].id : newId("s"), title: governing, layout: "summary", source: hasSummary ? slides[1].source : undefined, content: { summary: { points }, ...(hasSummary ? { statement: slides[1].content.statement } : {}) } };
    if (hasSummary) slides[1] = sum;
    else slides.splice(1, 0, sum);
    // 控えの「p.N」は差し込んだ後の並びで書く（画面と書き出しでは ref から出し直す）
    sum.content.summary!.points = points.map((p) => ({ ...p, page: summaryPage(p, slides) }));
  }
  return { title: toClaim(title), storyline, slides };
}

/** サマリーの要点：本体から3つ（前・中・後ろ）拾い、指すページを id で持つ */
function summaryPoints(body: Slide[]): SummaryContent["points"] {
  const pick = [0.25, 0.6, 0.95].map((f) => body[Math.min(body.length - 1, Math.floor(f * (body.length - 1)))]).filter((x, i, a) => x && a.indexOf(x) === i);
  return pick.map((x) => ({ head: x.title, body: "", page: "", ref: x.id }));
}

/** サマリーのタイトル（統べる一文）。ほかのページのタイトルと同じ文は使わない */
export function governingThought(slides: Slide[], own?: Slide): string {
  const taken = new Set(slides.filter((x) => x !== own).map((x) => x.title.trim()));
  const ok = (t: string | undefined): t is string => !!t?.trim() && !taken.has(t.trim());
  const found = [own?.title, slides[0]?.content.cover?.subtitle, own?.content.statement?.lead].find(ok);
  if (found) return found;
  const head = slides[0]?.title ?? "";
  return isLatin(head) ? `Bottom line: ${head}` : `結論：${head}`;
}

/** 今の資料から、エグゼクティブサマリーを1枚作る（チャットの「サマリーを入れて」） */
export function summarySlide(slides: Slide[]): Slide {
  const body = slides.filter((x) => x.layout !== "cover" && x.layout !== "closing" && x.layout !== "summary");
  return { id: newId("s"), title: governingThought(slides), layout: "summary", content: { summary: { points: summaryPoints(body) } } };
}

/** チャットの一文から、足すページを1枚作る */
export function slideFromInstruction(text: string): Slide {
  const body = text
    .replace(/(を)?(1|一|１)?枚(足して|追加して|作って|入れて)(ください)?[。.]?$/, "")
    .replace(/^(最後に|あとで|次に)[、,]?/, "")
    .replace(/^(?:(?:finally|then|also|next),?\s*)?(?:please\s+)?(?:add|insert|create|make)\s+(?:a|one|1)\s+(?:new\s+)?(?:slide|page)\s*(?:(?:on|about|for|with|showing|that says)\s+)?/i, "")
    .replace(/\s*(?:at the end|to the end)?[.!]?$/i, "")
    .trim();
  return {
    id: newId("s"),
    title: toClaim(body || tx("新しいページ", "New page")),
    layout: "statement",
    source: tx("チャットの指示", "From chat"),
    content: { statement: { lead: "", figure: "" } },
  };
}

/** 元の文章から、見出しに当たる節の本文を取り出す（出どころを見せるため） */
export function sectionText(doc: string, heading: string, nth = 0): string | null {
  const h = heading
    .replace(/^(元|出典)：/, "")
    .replace(/^(Source|From)\s*:\s*/i, "")
    .replace(/(?:,\s*p\.\s?\d+|[（(]p\.\s?\d+[）)])$/, "")
    .replace(/^議事録\s*[0-9０-９]+[.．]?\s*/, "")
    .replace(/^Minutes\s*§?\s*[0-9]+[.．]?\s*/i, "")
    .trim();
  if (!h) return null;
  const lines = doc.replace(/\r/g, "").split("\n");
  const hits = lines.map((l, i) => (/^#{1,5}\s/.test(l) && cleanHeading(l) === h ? i : -1)).filter((i) => i >= 0);
  if (!hits.length) {
    // 見出しの無い文章だけ、その一文で始まる段落を返す（ゆるい部分一致はしない）
    if (lines.some((l) => /^#{1,4}\s/.test(l)) || h.length < 8) return null;
    const para = doc.split(/\n\s*\n/).find((p) => p.trim().startsWith(h) || p.includes(h + "。") || p.includes(h + "\n"));
    return para?.trim() ?? null;
  }
  const start = hits[Math.min(nth, hits.length - 1)];
  const level = lines[start].match(/^#+/)?.[0].length ?? 2;
  const body: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#+)\s/);
    if (m && m[1].length <= level) break;
    if (/^<!--.*-->$/.test(lines[i].trim())) continue;
    body.push(lines[i]);
  }
  return body.join("\n").trim();
}
