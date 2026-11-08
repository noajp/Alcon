// The scrub: a distilled candidate that carries a secret is dropped
// whole. Never redacted — a masked memory still tells the next reader
// (and the next run's model) that a secret lived here, and a memory
// whose value was a credential has no other value worth keeping. The
// structural defence is upstream (the distillation digest holds only
// step titles, the finish and the verdict's gaps — never raw tool
// I/O, response bodies or attachment text); this pattern check is the
// floor beneath it, not a proof, in the same place as the G4 guide
// validation. Pure and deterministic, so the candidate validation
// (memoryDistill.ts) and the tests share the one judgement.

export interface ScrubHit { pattern: string; excerpt: string }
export interface ScrubResult { clean: boolean; hits: ScrubHit[] }

interface Rule { name: string; re: RegExp }

const RULES: readonly Rule[] = [
  // A credential assignment: api_key = …, password: …, token "…" —
  // the value is what makes it a secret, so a bare word never trips it.
  { name: "credential-assignment", re: /\b(?:api[\s_-]?key|apikey|secret|password|passwd|pwd|token|access[\s_-]?token|refresh[\s_-]?token|auth[\s_-]?token|private[\s_-]?key)\b["']?\s*[:=]\s*["']?[A-Za-z0-9_\-./+]{8,}["']?/i },
  // An Authorization header, quoted or bare.
  { name: "authorization-header", re: /\bauthorization\b\s*[:=]\s*["']?(?:bearer|basic|token)\s+[A-Za-z0-9_\-./+=]{8,}/i },
  { name: "bearer-token", re: /\bbearer\s+[A-Za-z0-9_\-./+=]{16,}/i },
  // The well-known key shapes.
  { name: "aws-access-key", re: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/ },
  { name: "github-token", re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/ },
  { name: "api-key-shape", re: /\bsk-[A-Za-z0-9_\-]{16,}\b/ },
  { name: "jwt", re: /\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\b/ },
  { name: "private-key-block", re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: "url-credentials", re: /[a-z][a-z0-9+.-]*:\/\/[^\s/:@]{1,64}:[^\s/@]{4,}@/i },
  // A one-time code, named as one: six digits next to the words for it.
  { name: "otp-code", re: /(?:ワンタイム|確認コード|認証コード|検証コード|one[\s-]?time|otp|verification code|passcode)[^\d]{0,24}\b\d{4,8}\b/i },
];

/** Shannon entropy of a string, bits per character. */
function entropy(text: string): number {
  const counts = new Map<string, number>();
  for (const ch of text) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let h = 0;
  for (const n of counts.values()) {
    const p = n / text.length;
    h -= p * Math.log2(p);
  }
  return h;
}

/**
 * A long unbroken run of mixed-case letters and digits is how a raw
 * key or token looks when it arrives without its label: 32+ chars,
 * entropy above 4.2 bits/char, and at least one letter and one digit.
 * Hex alone (hashes, ids) and words alone stay under the bar.
 */
function highEntropyHit(text: string): ScrubHit | null {
  for (const m of text.matchAll(/[A-Za-z0-9+/=_-]{32,}/g)) {
    const s = m[0];
    if (!/[A-Za-z]/.test(s) || !/\d/.test(s)) continue;
    if (/^[0-9a-f]+$/i.test(s)) continue; // a hash or id, not a secret
    if (entropy(s) > 4.2) return { pattern: "high-entropy", excerpt: s.slice(0, 12) + "…" };
  }
  return null;
}

/** Pure. Judges one text (a candidate's title, gist or body). */
export function scrubText(text: string): ScrubResult {
  const hits: ScrubHit[] = [];
  for (const rule of RULES) {
    const m = rule.re.exec(text);
    if (m) hits.push({ pattern: rule.name, excerpt: m[0].slice(0, 24) });
  }
  const ent = highEntropyHit(text);
  if (ent) hits.push(ent);
  return { clean: hits.length === 0, hits };
}

/** Pure. Judges a whole candidate: any tainted field drops it whole. */
export function scrubCandidate(c: { title: string; gist: string; body: string }): ScrubResult {
  const hits: ScrubHit[] = [];
  for (const field of [c.title, c.gist, c.body]) hits.push(...scrubText(field).hits);
  return { clean: hits.length === 0, hits };
}
