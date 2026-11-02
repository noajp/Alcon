/**
 * @ mentions in comment composers: where an @ query is being typed, which
 * Workers it matches, and which people a finished comment names.
 *
 * Names may be Japanese (漢字・かな), and Japanese prose has no spaces, so an
 * @ counts as a mention after any character that could not be part of an
 * e-mail address's local part — "確認お願いします@中" opens the list,
 * "a@b.com" does not. A full-width ＠ (what a Japanese IME types) counts too.
 */

/** Characters that can sit right before the @ of an e-mail address. */
const EMAIL_LOCAL_CHAR = /[A-Za-z0-9._%+\-]/;
/** Characters a query cannot contain: whitespace, another @, and the
 *  punctuation that ends a name in prose. */
const QUERY_STOP = /[\s@＠、。，,!?！？「」『』（）()[\]:：]/;

export interface MentionQuery {
  /** Index of the @ (or ＠) in the text. */
  start: number;
  /** What has been typed after it. */
  query: string;
}

/** The @ query ending at the cursor, or null when the cursor is not in one.
 *  Pass the text up to the cursor. */
export function detectMentionQuery(textBeforeCursor: string): MentionQuery | null {
  let i = textBeforeCursor.length;
  while (i > 0) {
    const ch = textBeforeCursor[i - 1];
    if (ch === '@' || ch === '＠') break;
    if (QUERY_STOP.test(ch)) return null;
    i--;
  }
  if (i === 0) return null;
  const start = i - 1;
  const prev = start > 0 ? textBeforeCursor[start - 1] : '';
  if (prev && EMAIL_LOCAL_CHAR.test(prev)) return null;
  return { start, query: textBeforeCursor.slice(start + 1) };
}

/** Folds width and case so ｎａｋａｎｏ, Nakano and nakano compare equal. */
function fold(s: string): string {
  return s.normalize('NFKC').toLowerCase();
}

/**
 * How well `query` matches: 0 when the name (or one of its words) starts with
 * it, 1 when another field (e-mail) starts with it, 2 when any field contains
 * it, -1 when nothing does. An empty query matches everything at 0.
 */
export function mentionMatchRank(query: string, name: string, extra?: string | null): number {
  const q = fold(query);
  if (!q) return 0;
  const n = fold(name);
  const x = fold(extra ?? '');
  if (n.startsWith(q) || n.split(/\s+/).some((word) => word.startsWith(q))) return 0;
  if (x && x.startsWith(q)) return 1;
  if (n.includes(q) || (x && x.includes(q))) return 2;
  return -1;
}

/** The items that match `query`, best matches first; ties keep their order. */
export function rankMentionCandidates<T>(
  items: readonly T[],
  query: string,
  fields: (item: T) => { name: string; extra?: string | null },
): T[] {
  return items
    .map((item, index) => {
      const { name, extra } = fields(item);
      return { item, index, rank: mentionMatchRank(query, name, extra) };
    })
    .filter((r) => r.rank >= 0)
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((r) => r.item);
}

/** The text with the @ query at `at` replaced by `@<insert> `. */
export function insertMentionText(text: string, at: MentionQuery, insert: string): string {
  const before = text.slice(0, at.start);
  const after = text.slice(at.start + 1 + at.query.length);
  return `${before}@${insert} ${after}`;
}

/**
 * The user ids of the people a comment names with @<name>.
 *
 * - A name ends at whitespace, punctuation or the end of the text — not \b,
 *   which only knows ASCII word characters and misses Japanese names.
 * - An @ right after a character of an e-mail local part (info@nakano.jp,
 *   a URL's user@host) is not a mention, as in detectMentionQuery.
 * - The longest name wins: "@Takanori Nakano" names Takanori Nakano, not
 *   also a Worker called "Takanori".
 */
export function mentionedUserIds(
  text: string,
  workers: readonly { name: string; user_id?: string | null }[],
): string[] {
  const named = workers
    .filter((w): w is { name: string; user_id: string } => !!w.user_id && !!w.name)
    .slice()
    .sort((a, b) => b.name.length - a.name.length);
  const claimed: [number, number][] = [];
  const ids = new Set<string>();
  for (const w of named) {
    const name = w.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`[@＠]${name}(?=$|[\\s、。,.!?！？:：)）])`, 'g');
    for (const m of text.matchAll(re)) {
      const start = m.index;
      const end = start + m[0].length;
      if (start > 0 && EMAIL_LOCAL_CHAR.test(text[start - 1])) continue;
      if (claimed.some(([s, e]) => start < e && s < end)) continue;
      claimed.push([start, end]);
      ids.add(w.user_id);
    }
  }
  return Array.from(ids);
}
