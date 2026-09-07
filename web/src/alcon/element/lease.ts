// What a row's lease means to a reader.
//
// The columns (claimed_by / claim_expires_at / branch, el_TRJ-012) say who
// took an Element and until when. This file turns that into what a surface
// may show — and, as important, what it must not: a lapsed lease is not a
// holder. Showing yesterday's token beside a title would put a dead session
// back in the "working on it" seat, which is the misreading el_OPS-013
// nearly suffered when the information wasn't on the row at all.
//
// Pure. `now` is a parameter so the same function serves a table that ticks
// once a minute and a test that never ticks. dimensions.ts deliberately has
// no clock (a bucket is a property of the row); expiry belongs here, in
// presentation, where "as of when you looked" is the question being asked.

import type { Element } from '@/types/database';

export interface LiveLease {
  holder: string;
  branch: string | null;
  expiresAt: string;
  /** Milliseconds until the lease lapses, never negative. */
  remainingMs: number;
}

type Leased = Pick<Element, 'claimed_by' | 'claim_expires_at' | 'branch'>;

/** The lease a reader may treat as current, or null when there is none. */
export function liveLease(el: Leased, now: number): LiveLease | null {
  if (!el.claimed_by || !el.claim_expires_at) return null;
  const expires = Date.parse(el.claim_expires_at);
  if (Number.isNaN(expires) || expires <= now) return null;
  return {
    holder: el.claimed_by,
    branch: el.branch ?? null,
    expiresAt: el.claim_expires_at,
    remainingMs: expires - now,
  };
}

/**
 * A holder token compact enough for a row, still distinct per session.
 *
 * Tokens are `<agent>@<worktree>` (ops/lease.mjs). The worktree half is what
 * tells two sessions of the same agent apart, so it can't be dropped — but a
 * 30-character directory name doesn't belong in a 13px row. Keep the agent,
 * keep the tail of the suffix (worktree names differ at the end: a random
 * hash, a slug), elide the middle. The full token always travels in `title`.
 */
export function holderLabel(token: string, keep = 8): string {
  const at = token.indexOf('@');
  if (at === -1) return token;
  const agent = token.slice(0, at);
  const suffix = token.slice(at + 1);
  if (suffix.length <= keep + 4) return token;
  return `${agent}@…${suffix.slice(-keep)}`;
}

/** "38m" / "1h 02m" / "<1m" — how long a lease has left, for a person. */
export function formatRemaining(ms: number): string {
  const totalMin = Math.floor(Math.max(0, ms) / 60_000);
  if (totalMin < 1) return '<1m';
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}
