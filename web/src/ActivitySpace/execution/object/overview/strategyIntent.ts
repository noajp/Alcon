/**
 * Condensing a Strategy's `strategies.description` into the few lines the
 * Object Overview rail can show.
 *
 * The Overview rail already names the Strategy(s) an Object contributes to,
 * but a name alone doesn't answer "why does this Object exist" from the
 * Execution side. The Strategy's description does — it's where the win
 * condition and the success criteria are written. It's also far too long to
 * paste into a side rail.
 *
 * So we excerpt. Not by character count: the two Strategies in the database
 * that have a description both open with framing rather than intent, so "the
 * first 200 characters" yields `【架空演習】ケストレル火山噴火…に対する多国籍
 * HADR 作戦` — a preamble that is neither the intent nor the success criteria,
 * cut mid-sentence. Strategy descriptions are authored as Markdown, so the
 * document already marks its own seams, and we cut along them:
 *
 *   - the **lead** — everything before the first heading. One sentence saying
 *     what the Strategy is; useful, but never the whole answer.
 *   - the **intent sections** — the sections whose heading names an end, a way
 *     of winning, or a success criterion (Ends / Ways / 勝ち筋 / 成功条件 …).
 *     `## Means（何を投入するか）` and `## 前提` are skipped: Means is the
 *     Execution layer the reader is already standing in, and from here the
 *     question is what we are trying to win, not how the Strategy is staffed.
 *
 * Within a section we keep only its opening block — again a seam the author
 * put there. A block is either one prose paragraph or one bullet list, and a
 * bullet list stays a list: both real descriptions state their Ends and
 * success criteria as bullets, and joining them into a paragraph welds
 * `…を被災 3 島へ届ける` to `D+8 以降、支援機能を…` with nothing between them.
 *
 * Deliberately no AI summarization: this runs client-side on data
 * `useStrategies` has already fetched, so opening an Object costs no extra
 * query and works offline.
 */

/** One excerpt drawn from a Strategy description. */
export interface StrategyIntentSection {
  /** The heading exactly as authored, or `null` for the lead paragraph. */
  heading: string | null;
  /**
   * The section's opening block: one entry per authored bullet, or a single
   * entry holding a prose paragraph. Never empty.
   */
  items: string[];
}

/**
 * Headings that answer "what are we trying to win, and how will we know".
 * Matched as case-insensitive substrings so `## 成功条件と現在地（2026-08-30
 * 時点）` matches on `成功条件` and `## Ends（何を達成するか）` on `ends`.
 */
const INTENT_HEADINGS = [
  // Japanese — the vocabulary these descriptions are actually written in.
  '勝ち筋',
  '成功条件',
  '狙い',
  '目的',
  '意図',
  '方針',
  'ゴール',
  // Latin — Ends / Ways in the product's own strategy vocabulary, plus the
  // ordinary English a team might reach for instead. `means` is deliberately
  // absent: Employment of Means is the Execution layer, not the intent.
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

/**
 * How many sections the rail shows for one Strategy, and how many bullets
 * within a section. Four sections is what the real descriptions need: a lead
 * plus `Ends` / `Ways` / `成功条件`. Dropping to three cost the success
 * criteria, which is half of what this card exists to show.
 */
const MAX_SECTIONS = 4;
const MAX_ITEMS = 3;

/**
 * A CJK character at the end of a line. Japanese prose wraps without spaces,
 * so when we rejoin the lines of one paragraph we must not insert one after a
 * CJK character or the sentence gains a visible gap. Covers CJK punctuation,
 * kana, unified ideographs and the halfwidth/fullwidth forms.
 */
const ENDS_WITH_CJK = /[　-鿿＀-￯]$/;

/** ATX heading: up to 3 leading spaces, 1–6 `#`, then the text. */
const HEADING_RE = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;

/** An unordered or ordered list item. */
const BULLET_RE = /^\s*(?:[-*+]|\d+[.)])\s+/;

/**
 * A line that is bold from end to end. Authors use these as sub-headings that
 * Markdown has no level left for — `**(1) … — 達成**` followed by the prose
 * that explains it. Markdown itself calls that one paragraph, but the author
 * clearly meant a seam, so we treat it as one. Without this the rail shows a
 * claim welded to the sentence after it.
 */
const FULLY_BOLD_LINE = /^\s*\*\*[^*].*\*\*\s*$/;

/**
 * Strip the inline Markdown that would otherwise show up as literal `**` in a
 * rail row, and drop the list marker so a bullet reads as a phrase. Link text
 * is kept and the URL dropped — a rail row can't be clicked through to it.
 */
function stripInlineMarkdown(line: string): string {
  return line
    .replace(BULLET_RE, '')
    .replace(/^\s*>\s?/, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/(?<!\*)\*(?!\s)([^*]+?)(?<!\s)\*(?!\*)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
}

/** Join the lines of one paragraph, respecting CJK's space-free wrapping. */
function joinParagraph(lines: string[]): string {
  return lines
    .reduce((acc, part) => {
      if (!acc) return part;
      return acc + (ENDS_WITH_CJK.test(acc) ? '' : ' ') + part;
    }, '')
    .trim();
}

/**
 * Reduce a section's raw lines to its opening block.
 *
 * A block is whichever comes first: a run of bullets (kept as separate items,
 * so a list still reads as a list) or a run of prose lines (joined into one
 * paragraph). Either way it ends at the first blank line. Returns an empty
 * array when the section has no prose at all.
 */
function openingBlock(lines: string[]): string[] {
  const items: string[] = [];
  const paragraph: string[] = [];
  let mode: 'unknown' | 'bullets' | 'prose' = 'unknown';

  for (const raw of lines) {
    const isBullet = BULLET_RE.test(raw);
    const cleaned = stripInlineMarkdown(raw);
    if (!cleaned) {
      // A blank line before anything started is just spacing under the
      // heading; after that it closes the block.
      if (mode === 'unknown') continue;
      break;
    }
    if (mode === 'unknown') mode = isBullet ? 'bullets' : 'prose';
    // A bullet list ends where the bullets stop, and prose ends where a
    // bullet begins — a change of form is a seam too.
    if (isBullet !== (mode === 'bullets')) break;

    if (mode === 'bullets') {
      items.push(cleaned);
      if (items.length === MAX_ITEMS) break;
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

  if (mode === 'bullets') return items;
  const joined = joinParagraph(paragraph);
  return joined ? [joined] : [];
}

function matchesIntentHeading(heading: string): boolean {
  const lower = heading.toLowerCase();
  return INTENT_HEADINGS.some((k) => lower.includes(k));
}

/**
 * Excerpt the strategic intent from a Strategy description.
 *
 * Returns at most {@link MAX_SECTIONS} sections, in the order the author wrote
 * them, and an empty array when there is nothing to say. Callers treat the
 * empty array as "this Strategy has stated no intent" — a fact worth showing,
 * not a reason to render nothing.
 */
export function extractStrategyIntent(
  description: string | null | undefined,
): StrategyIntentSection[] {
  if (!description || !description.trim()) return [];

  // Split into (heading, lines) sections. The lead carries `heading: null`.
  const raw: { heading: string | null; lines: string[] }[] = [
    { heading: null, lines: [] },
  ];
  for (const line of description.replace(/\r\n?/g, '\n').split('\n')) {
    const m = HEADING_RE.exec(line);
    if (m) raw.push({ heading: m[2].trim(), lines: [] });
    else raw[raw.length - 1].lines.push(line);
  }

  const condensed = raw
    .map((s) => ({ heading: s.heading, items: openingBlock(s.lines) }))
    .filter((s) => s.items.length > 0);
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
