// Object ID prefix suggestion.
//
// The DB trigger that backfills objects.prefix takes the first character of
// each whitespace token, so a CJK name like "TF-MED — 医療・防疫" becomes
// "T—医" and every element under it gets a display_id like "el_T—医-001" —
// unreadable as an ID and colliding with its sibling task forces ("T—航",
// "T—兵"). The trigger does respect an explicitly provided prefix, so
// createObject computes one here and sends it with the INSERT.

/** Longest base the suggestion produces, before any uniquifying suffix. */
const DEFAULT_MAX_LENGTH = 4;

/** Used when the name yields no ASCII letters or digits at all. */
const FALLBACK_BASE = 'OBJ';

/**
 * Fold a name to the ASCII letters and digits it is built from.
 *
 * NFKD splits an accented letter into its base plus a combining mark, so the
 * marks are dropped before tokenising — otherwise "Zürich" would tokenise as
 * ["Zu", "rich"] and read as a two-word name. Letters with no decomposition
 * (Ø, Ł, Đ) have no ASCII form and simply drop out.
 */
function asciiTokens(name: string): string[] {
  return name.normalize('NFKD').replace(/\p{M}+/gu, '').match(/[A-Za-z0-9]+/g) ?? [];
}

/**
 * Derive an ASCII ID prefix from an Object name, unique among `existing`.
 *
 * Multi-token names use token initials ("Ward East Wing" → WEW, "Phase 2" →
 * P2); single-token names are truncated ("Marketing" → MAR). Names with no
 * ASCII content fall back to OBJ. Collisions with `existing` take a numeric
 * suffix (MED → MED2 → MED3 …), which is appended after the length cap, so a
 * heavily contended base can exceed `maxLength` by the width of the suffix.
 */
export function suggestObjectPrefix(
  name: string,
  existing: Iterable<string> = [],
  maxLength: number = DEFAULT_MAX_LENGTH,
): string {
  const tokens = asciiTokens(name);

  const base = (tokens.length === 0
    ? FALLBACK_BASE
    : tokens.length === 1
      ? tokens[0]
      : tokens.map((t) => t[0]).join('')
  ).slice(0, maxLength).toUpperCase();

  const taken = new Set<string>();
  for (const p of existing) {
    if (p) taken.add(p.toUpperCase());
  }
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}
