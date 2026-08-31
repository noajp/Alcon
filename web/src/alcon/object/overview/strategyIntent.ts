/**
 * Condensing a Campaign's `strategies.description` into the few lines the
 * Object Overview rail can show.
 *
 * The Overview rail already names the Campaign(s) an Object contributes to,
 * but a name alone doesn't answer "why does this Object exist" from the
 * Execution side. The Campaign's description does — it's where the win
 * condition and the success criteria are written. It's also far too long to
 * paste into a side rail.
 *
 * So we excerpt. Not by character count — cutting at "the first 200 chars"
 * lands mid-sentence and reads like a bug. Campaign descriptions are authored
 * as Markdown with `##` headings, so the document already tells us where its
 * own seams are, and we cut along them:
 *
 *   - the **lead** — everything before the first heading. This is the one-line
 *     statement of what the Campaign is, and it is almost always the single
 *     most useful sentence in the document.
 *   - the **intent sections** — the sections whose heading names a win
 *     condition or a success criterion (勝ち筋 / 成功条件 / Ways / Ends / …).
 *     Sections about process, staffing or status are skipped: from the
 *     Execution side the question is "what are we trying to win", not "how is
 *     the Campaign being run".
 *
 * Each section is reduced to its *first paragraph* — again a seam the author
 * put there, not one we invented. Anything still too long for the rail is
 * clamped visually by CSS, which degrades to an ellipsis at a line boundary
 * rather than mid-word.
 *
 * Deliberately no AI summarization: this runs client-side on data already in
 * memory, so opening an Object costs nothing extra and works offline.
 */

/** One excerpt drawn from a Campaign description. */
export interface StrategyIntentSection {
  /** The heading exactly as authored, or `null` for the lead paragraph. */
  heading: string | null;
  /** A single condensed paragraph of body text. Never empty. */
  body: string;
}

/**
 * Headings that answer "what are we trying to win, and how will we know".
 * Matched as case-insensitive substrings so `## 成功条件と現在地（2026-08-30
 * 時点）` still matches on `成功条件`, and `## Ways / how we win` on `ways`.
 */
const INTENT_HEADINGS = [
  // Japanese — the vocabulary Campaign descriptions are actually written in.
  '勝ち筋',
  '成功条件',
  '狙い',
  '目的',
  '意図',
  '方針',
  'ゴール',
  // Latin — Ends / Ways in the product's own strategy vocabulary, plus the
  // ordinary English a team might reach for instead.
  'ends',
  'ways',
  'win',
  'success',
  'goal',
  'objective',
  'outcome',
  'intent',
  'mission',
];

/** How many excerpts the rail will show for one Campaign. */
const MAX_SECTIONS = 3;

/**
 * A CJK character at the end of a line. Japanese prose wraps without spaces,
 * so when we rejoin the lines of a paragraph we must not insert one after a
 * CJK character or the sentence gains a visible gap. Covers CJK punctuation,
 * kana, unified ideographs and the halfwidth/fullwidth forms.
 */
const ENDS_WITH_CJK = /[　-鿿＀-￯]$/;

/** ATX heading: up to 3 leading spaces, 1–6 `#`, then the text. */
const HEADING_RE = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;

/**
 * Strip the inline Markdown that would otherwise show up as literal `**` in a
 * rail row, and drop leading list markers so a bulleted paragraph reads as
 * prose. Link text is kept and the URL dropped — a rail row can't be clicked
 * through to it anyway.
 */
function stripInlineMarkdown(line: string): string {
  return line
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
    .replace(/^\s*>\s?/, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/(?<!\*)\*(?!\s)([^*]+?)(?<!\s)\*(?!\*)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
}

/**
 * A line that is bold from end to end. Authors use these as sub-headings that
 * Markdown has no level left for — `**(1) … — 達成**` followed by the prose
 * that explains it. Markdown itself calls that one paragraph, but the author
 * clearly meant a seam, so we treat it as one: it ends the paragraph. Without
 * this the rail shows a claim welded to the sentence after it.
 */
const FULLY_BOLD_LINE = /^\s*\*\*[^*].*\*\*\s*$/;

/**
 * Reduce a section's raw lines to its first paragraph: the first run of
 * non-blank lines, joined into one line. Returns '' when the section has no
 * prose at all (a heading immediately followed by another heading).
 */
function firstParagraph(lines: string[]): string {
  const paragraph: string[] = [];
  for (const raw of lines) {
    const cleaned = stripInlineMarkdown(raw);
    if (!cleaned) {
      if (paragraph.length > 0) break;
      continue;
    }
    if (FULLY_BOLD_LINE.test(raw)) {
      // Ends the paragraph — after itself if it opens one, before itself if
      // it follows prose that already stands on its own.
      if (paragraph.length === 0) paragraph.push(cleaned);
      break;
    }
    paragraph.push(cleaned);
  }
  return paragraph
    .reduce((acc, part) => {
      if (!acc) return part;
      return acc + (ENDS_WITH_CJK.test(acc) ? '' : ' ') + part;
    }, '')
    .trim();
}

function matchesIntentHeading(heading: string): boolean {
  const lower = heading.toLowerCase();
  return INTENT_HEADINGS.some((k) => lower.includes(k));
}

/**
 * Excerpt the strategic intent from a Campaign description.
 *
 * Returns at most {@link MAX_SECTIONS} sections, in the order the author wrote
 * them, and an empty array when there is nothing to say. Callers treat the
 * empty array as "this Campaign has stated no intent" — a fact worth showing,
 * not a reason to render nothing.
 */
export function extractStrategyIntent(
  description: string | null | undefined,
): StrategyIntentSection[] {
  if (!description || !description.trim()) return [];

  // Split into (heading, lines) sections. The lead carries `heading: null`.
  const sections: { heading: string | null; lines: string[] }[] = [
    { heading: null, lines: [] },
  ];
  for (const line of description.replace(/\r\n?/g, '\n').split('\n')) {
    const m = HEADING_RE.exec(line);
    if (m) sections.push({ heading: m[2].trim(), lines: [] });
    else sections[sections.length - 1].lines.push(line);
  }

  const condensed = sections
    .map((s) => ({ heading: s.heading, body: firstParagraph(s.lines) }))
    .filter((s) => s.body.length > 0);
  if (condensed.length === 0) return [];

  const lead = condensed[0].heading === null ? condensed[0] : null;
  const intent = condensed.filter(
    (s) => s.heading !== null && matchesIntentHeading(s.heading),
  );

  // A description with no headings at all is just its lead paragraph.
  // A description whose headings all name process rather than intent still
  // deserves to say *something*, so fall back to its first section.
  const picked = lead ? [lead, ...intent] : intent;
  if (picked.length === 0) picked.push(condensed[0]);

  return picked.slice(0, MAX_SECTIONS);
}
