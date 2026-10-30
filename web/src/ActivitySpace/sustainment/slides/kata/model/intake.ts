// 長い文書（PDF から抜いた文字など）を、プランナーが読めるマークダウンに整える。
// PDF の文字は、行が途中で折れ、ページ番号や目次が混ざり、見出しに印が無い。
// ここで行をつなぎ直し、番号の付いた見出し（I. / 1. / A.）と短い小見出しを見出しに、
// 「•」「o」の箇条を項目に戻す。ページは <!-- p.N --> の印で残し、出どころに使う。

export interface IntakeResult {
  markdown: string;
  title: string;
  /** 見出し（# の数で 2〜4）の数。長い文書かどうかの目安 */
  headings: number;
  pages: number;
}

const PAGE_NO = /^\s*(?:[-–—]\s*)?(?:[ivxlc]{1,6}|\d{1,3})(?:\s*[-–—])?\s*$/i;
const TOC_LINE = /(?:[.…·]\s?){4,}\s*\d{1,3}\s*$|_{4,}\s*\d{1,3}\s*$/;
const TOC_HEAD = /^\s*(?:table of contents|contents|目次)\s*$/i;
const ROMAN = /^(?:[IVX]{1,5})\.\s+(\S.*)$/;
const NUMBERED = /^(\d{1,2})\.\s+(\S.*)$/;
const LETTERED = /^([A-H])\.\s+(\S.*)$/;
const JA_HEAD = /^(?:第[一二三四五六七八九十0-9０-９]+[章節部]|[0-9０-９]+[.．]\s*[^0-9０-９])/;
const BULLET = /^\s*([•●▪■◆◦‣∙·*]|o(?=\s+[A-Z“"])|[-–](?=\s))\s*(.*)$/;
const SUB_BULLET = /^[◦o‣∙·]$/;
const END = /[.?!:;。？！：”"’)）]$/;

interface Line {
  text: string;
  page: number;
}

/** PDF の1ページ目の数（ページ区切り \f か、ページ番号だけの行から数える） */
function splitPages(text: string): Line[] {
  const pages = text.replace(/\r/g, "").split("\f");
  const out: Line[] = [];
  let printed: number | null = null;
  pages.forEach((p, pi) => {
    const lines = p.split("\n");
    // ページの下（か上）にあるページ番号を拾って、そのページの番号にする
    const tail = [...lines].reverse().find((l) => l.trim())?.trim();
    const head = lines.find((l) => l.trim())?.trim();
    const num = [tail, head].map((l) => l ?? "").find((l) => /^\d{1,3}$/.test(l));
    if (num) printed = Number(num);
    else if (printed !== null && pages.length > 1) printed += 1;
    const pageNo = num ? Number(num) : (printed ?? pi + 1);
    for (const raw of lines) {
      const t = raw.replace(/\s+$/, "").replace(/ /g, " ");
      if (!t.trim()) {
        out.push({ text: "", page: pageNo });
        continue;
      }
      // ページ番号だけの行は、ページ区切りのある文書でだけ外す（表の数字を消さない）
      if (pages.length > 1 && PAGE_NO.test(t) && (t.trim() === tail || t.trim() === head)) continue;
      out.push({ text: t.trim(), page: pageNo });
    }
    // ページの変わり目は空行として扱う。文の途中なら段落は切れない（空行は言い切りのあとだけ段落を切る）
    out.push({ text: "", page: pageNo });
  });
  return out;
}

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
const isLatin = (s: string) => /[A-Za-z]/.test(s) && !/[぀-ヿ㐀-鿿]/.test(s);

/** 短い小見出しらしい行（「Enlist」「Economics: The Ultimate Stakes」） */
function looksLikeSubhead(t: string, prevEnded: boolean, next: string | undefined): boolean {
  if (!prevEnded || !next) return false;
  if (END.test(t) && !/[?？]$/.test(t)) return false;
  if (BULLET.test(t)) return false;
  if (isLatin(t)) {
    const w = words(t);
    if (w > 9 || !/^[A-Z“"]/.test(t)) return false;
    // 大文字で始まる語が多い（タイトルの書き方）か、1〜2語
    const caps = t.split(/\s+/).filter((x) => /^[A-Z“"(]/.test(x)).length;
    return w <= 2 || caps / w >= 0.5;
  }
  return t.length <= 24 && !/[、。]/.test(t);
}

/** Term – definition の箇条を Term: definition にする（見出しと本文に割れるように） */
function labelDash(t: string): string {
  const m = t.match(/^([^–—:]{2,70}?)\s+[–—]\s*(.+)$/);
  if (!m) return t;
  const head = m[1].trim();
  if (isLatin(head) && words(head) > 9) return t;
  return `${head}: ${m[2].trim()}`;
}

export function intakeDocument(text: string): IntakeResult {
  const lines = splitPages(text);
  // 目次を除く（点線とページ番号で終わる行、「目次」の行）
  const body = lines.filter((l) => !TOC_LINE.test(l.text) && !TOC_HEAD.test(l.text));
  const lengths = body.map((l) => l.text.length).filter((n) => n > 20).sort((a, b) => a - b);
  const typical = lengths[Math.floor(lengths.length * 0.8)] ?? 80;

  const out: string[] = [];
  let title = "";
  let page = 0;
  let para: string[] = [];
  let bullet: { text: string; sub: boolean } | null = null;
  const pending: boolean[] = [];
  let unmarked = 0;
  let semiList = false;
  let seenJaChapter = false;
  let listIntro = false;
  let lastBulletSemi = false;
  let headings = 0;
  let seenChapter = false;
  // 番号の付いた直近の見出しの深さ。印の無い小見出しはその1つ下にする
  let numberedLevel = 2;
  let prevEnded = true;
  const mark = (p: number) => {
    if (p !== page) {
      page = p;
      out.push(`<!-- p.${p} -->`);
    }
  };
  const flushPara = () => {
    if (para.length) out.push(joinWrapped(para), "");
    para = [];
  };
  const flushBullet = () => {
    if (bullet) semiList = /;\s*(?:and|or)?$/.test(bullet.text);
    if (bullet) out.push(`${bullet.sub ? "  " : ""}- ${labelDash(bullet.text)}`);
    bullet = null;
  };
  const flush = () => {
    flushPara();
    flushBullet();
  };
  const heading = (level: number, t: string, p: number) => {
    flush();
    listIntro = false;
    lastBulletSemi = false;
    unmarked = 0;
    pending.length = 0;
    if (out.length && out[out.length - 1] !== "") out.push("");
    mark(p);
    out.push(`${"#".repeat(level)} ${t.trim()}`, "");
    headings++;
    prevEnded = true;
  };

  for (let i = 0; i < body.length; i++) {
    const { page: p } = body[i];
    let t = body[i].text;
    const prevLine = body.slice(0, i).reverse().find((l) => l.text)?.text ?? "";
    if (!t) {
      // 空行は段落の切れ目。ただし文の途中（ページの変わり目など）では切らない
      if (prevEnded || END.test(prevLine) || !(para.length || bullet)) {
        flush();
        prevEnded = true;
      }
      continue;
    }
    if (!title) {
      title = t;
      continue;
    }
    let next = body.slice(i + 1).find((l) => l.text)?.text;
    const short = t.length < typical * 0.92;
    // 番号の付いた見出しは、前の行が言い切りでなくても、短く句点で終わらなければ見出しとみなす
    const headish = prevEnded || (t.length < typical * 0.85 && !/[.;,]$/.test(t));
    // 見出しが2行に折れていれば、次の短い行をつなぐ
    if (
      /^(?:[IVX]{1,5}|\d{1,2}|[A-H])\.\s/.test(t) &&
      !END.test(t) &&
      next &&
      next.length < 40 &&
      words(next) <= 6 &&
      !BULLET.test(next) &&
      !/^(?:[IVX]{1,5}|\d{1,2}|[A-H])\.\s/.test(next) &&
      (/^[a-z]/.test(next) || /\b(?:of|to|the|and|for|in|on|what|a|an|with|from|at|by|or|how|why)$/i.test(t))
    ) {
      t = `${t} ${next}`;
      const j = body.findIndex((l, k) => k > i && l.text);
      body[j] = { ...body[j], text: "" };
      next = body.slice(j + 1).find((l) => l.text)?.text;
    }
    let m: RegExpMatchArray | null;
    if ((m = t.match(ROMAN)) && t.length < 110) {
      seenChapter = true;
      numberedLevel = 2;
      heading(2, m[1], p);
      continue;
    }
    if (headish && (m = t.match(NUMBERED)) && t.length < 90 && !END.test(t.replace(/[?？]$/, ""))) {
      numberedLevel = seenChapter ? 3 : 2;
      heading(numberedLevel, m[2], p);
      continue;
    }
    if (headish && (m = t.match(LETTERED)) && t.length < 110 && !/[.;]$/.test(t)) {
      numberedLevel = seenChapter ? 4 : 3;
      heading(numberedLevel, m[2], p);
      continue;
    }
    if (prevEnded && !isLatin(t) && JA_HEAD.test(t) && t.length <= 40) {
      // 「第1章」は章、「1. …」は章の中の節（章があれば）
      const chapter = /^第/.test(t);
      if (chapter) seenJaChapter = true;
      heading(chapter || !seenJaChapter ? 2 : 3, t.replace(/^[0-9０-９]+[.．]\s*/, ""), p);
      continue;
    }
    // 箇条の印だけが先に並び、文があとからまとめて来る PDF がある。印を数えておき、続く行を順に箇条にする
    const markOnly = t.match(/^[•●▪■◆◦‣∙·o]$/);
    if (markOnly) {
      flush();
      // 印より先に文が来て、もう箇条にしてあれば、その印は使い切ったものとして捨てる
      if (unmarked > 0) unmarked--;
      else pending.push(SUB_BULLET.test(markOnly[0]));
      continue;
    }
    // 「:」で終わる前置きのあとの、印の無い「…;」の並びも箇条にする
    if (!bullet && !BULLET.test(t) && (listIntro || lastBulletSemi) && prevEnded && !pending.length) {
      flush();
      mark(p);
      bullet = { text: t, sub: false };
      unmarked++;
      listIntro = false;
      lastBulletSemi = false;
      prevEnded = false;
      if (END.test(t)) {
        lastBulletSemi = /;\s*(?:and|or)?$/.test(t);
        flushBullet();
        prevEnded = true;
      }
      continue;
    }
    const b: RegExpMatchArray | null = t.match(BULLET) ?? (pending.length && (!bullet || END.test(bullet.text)) ? (["", pending[0] ? "o" : "•", t] as unknown as RegExpMatchArray) : null);
    if (b && !t.match(BULLET)) pending.shift();
    if (b) {
      flush();
      mark(p);
      listIntro = false;
      lastBulletSemi = false;
      bullet = { text: b[2], sub: SUB_BULLET.test(b[1]) };
      prevEnded = false;
      if (END.test(t) && short) {
        flushBullet();
        prevEnded = true;
      }
      continue;
    }
    const tiny = isLatin(t) && words(t) <= 3 && END.test(prevLine);
    if (seenChapter && looksLikeSubhead(t, prevEnded || tiny, next) && !bullet) {
      heading(Math.min(5, numberedLevel + 1), t, p);
      continue;
    }
    // 「;」で区切る並びの最後の項目は「.」で終わる。その次の行は本文に戻る
    if (bullet && /[.。]$/.test(bullet.text) && semiList) {
      flushBullet();
      semiList = false;
      prevEnded = true;
    }
    if (bullet) {
      bullet.text = joinWrapped([bullet.text, t]);
      // 「…; and」で終わる行も、その箇条の終わり（次の行は次の箇条）
      if ((END.test(t) && short) || /;\s*(?:and|or)$/.test(t)) {
        lastBulletSemi = unmarked > 0 && /;\s*(?:and|or)?$/.test(t);
        flushBullet();
        prevEnded = true;
      }
      continue;
    }
    if (!para.length) mark(p);
    para.push(t);
    // 「:」で終わる行は、続く並びの前置きなので段落を切る
    prevEnded = (END.test(t) && short) || /:$/.test(t);
    listIntro = /:$/.test(t);
    lastBulletSemi = false;
    if (!listIntro) unmarked = 0;
    if (prevEnded) flushPara();
  }
  flush();
  // 章の前（表紙・前書き）の段落は「前書き」の節にまとめる
  const md = out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  const firstHead = md.search(/^## /m);
  const front = firstHead > 0 ? md.slice(0, firstHead).trim() : "";
  const rest = firstHead > 0 ? md.slice(firstHead) : md;
  // 表紙の続き（「of the United States of America」）はタイトルにつなぐ。残りの表紙の文は、捨てずに前書きとして残す
  const frontLines = front.split("\n").filter((l) => l.trim() && !/^<!--/.test(l) && !/^#/.test(l));
  const cont = frontLines[0]?.match(/^(of|for|on|in|to|and)\b[^.]*?(?=\s+(?:January|February|March|April|May|June|July|August|September|October|November|December|\d{4})\b|$)/i)?.[0];
  if (cont) {
    title = `${title} ${cont.trim()}`;
    frontLines[0] = frontLines[0].slice(cont.length).trim();
  }
  const keep = frontLines.filter((l) => l.trim());
  const frontMd = keep.length ? `## ${isLatin(title) ? "Foreword" : "前書き"}\n\n${keep.join("\n\n")}\n\n` : "";
  // 最初の章の直前にあったページの印は、章の側に残す
  const lastMark = front.match(/<!-- p\.\d+ -->(?![\s\S]*<!-- p\.)/)?.[0];
  const restWithMark = lastMark && !rest.startsWith("<!--") ? `${lastMark}\n${rest}` : rest;
  return { markdown: `# ${title}\n\n${frontMd}${restWithMark}`.trim() + "\n", title, headings, pages: new Set(lines.map((l) => l.page)).size };
}

/** 折れた行をつなぐ。英語は空白で、日本語はそのまま。行末のハイフンはつなぐ */
function joinWrapped(parts: string[]): string {
  return parts.reduce((acc, cur) => {
    if (!acc) return cur;
    if (/[A-Za-z]-$/.test(acc) && /^[a-z]/.test(cur)) return acc.slice(0, -1) + cur;
    // 「non-」「Indo-」の行末の連結符は、次が大文字なら残してつなぐ
    if (/[A-Za-z]-$/.test(acc) && /^[A-Z]/.test(cur)) return acc + cur;
    if (/[぀-ヿ㐀-鿿、。]$/.test(acc) && /^[぀-ヿ㐀-鿿]/.test(cur)) return acc + cur;
    if (/[—–]$/.test(acc) || /^[—–]/.test(cur)) return acc + cur;
    return `${acc} ${cur}`;
  }, "");
}

/** 長い文書（PDF から写した文）らしいか。ページ区切りがあるか、マークダウンの印が無く行が折れている文章だけ。
 *  見出し（#）・箇条（- * ・ 1.）・表（|）のある普通のメモは、そのまま扱う */
export function looksLikeLongDocument(text: string): boolean {
  if (text.includes("\f")) return true;
  const lines = text.split("\n").filter((l) => l.trim());
  if (lines.length < 40) return false;
  if (lines.some((l) => /^\s*(?:#{1,6}\s|[-*+・]\s|\|)/.test(l))) return false;
  // 番号の箇条（1. / １．）が続くなら普通のメモ
  if (lines.filter((l) => /^\s*[0-9０-９]{1,2}[.．)、]\s*\S/.test(l)).length >= 3) return false;
  // 段落の途中で折れた行（句読点で終わらない長い行）が多い
  const wrapped = lines.filter((l) => l.length > 50 && !END.test(l.trim())).length;
  return wrapped / lines.length > 0.3;
}
