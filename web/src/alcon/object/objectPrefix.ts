// Object ID prefix suggestion.
//
// The DB trigger that backfills objects.prefix takes the first character of
// each whitespace token, so a CJK name like "TF-MED — 医療・防疫" becomes
// "T—医" and every element under it gets a display_id like "el_T—医-001" —
// unreadable as an ID and colliding with its sibling task forces ("T—航",
// "T—兵"). The trigger does respect an explicitly provided prefix, so
// createObject computes one here and sends it with the INSERT.

/** Longest prefix the suggestion will produce (before a uniquifying suffix). */
const MAX_BASE_LENGTH = 4

/** Fallback when the name yields no ASCII letters or digits at all. */
const FALLBACK_BASE = 'OBJ'

/**
 * Derive an ASCII ID prefix from an Object name, unique among `existing`.
 *
 * - Full-width letters and accented characters are folded to ASCII (NFKD).
 * - Multi-token names use token initials ("Ward East Wing" → WEW,
 *   "Phase 2" → P2); single-token names are truncated ("Marketing" → MAR).
 * - Names with no ASCII content fall back to OBJ.
 * - Collisions with `existing` get a numeric suffix (MED → MED2 → MED3 …).
 */
export function suggestObjectPrefix(name: string, existing: Iterable<string> = []): string {
  const tokens = name.normalize('NFKD').match(/[A-Za-z0-9]+/g) ?? []

  let base: string
  if (tokens.length === 0) {
    base = FALLBACK_BASE
  } else if (tokens.length === 1) {
    base = tokens[0].slice(0, 3)
  } else {
    base = tokens.map((t) => t[0]).join('').slice(0, MAX_BASE_LENGTH)
  }
  base = base.toUpperCase()

  const taken = new Set<string>()
  for (const p of existing) {
    if (p) taken.add(p.toUpperCase())
  }
  if (!taken.has(base)) return base
  for (let i = 2; ; i++) {
    const candidate = `${base}${i}`
    if (!taken.has(candidate)) return candidate
  }
}
