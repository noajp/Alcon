// A finish's facts, typed at the source: what the agent states as fact is a
// claim {text, source, retrievedAt, type}; what it could not confirm is a
// list it must fill, not a confession it may hide in prose. This file is
// the mechanical half of verification (the asymmetry the design buys
// accuracy with): code checks the claims' shape, their sources and their
// freshness BEFORE the verifier model is asked anything, and a failure
// here is a revision the model never gets to judge away. Pure — run-agent
// supplies the finish and the run's facts; the web mirror of the sealed
// record lives in web/src/Function/audit/auditModel.ts, pinned by tests.

import { freshnessLookupKey, type FreshnessTable } from "./definition.ts";

/** A claim whose source is the run's own record: it restates an action the
 *  run itself took, and the step log is its source — checked by reference,
 *  exempt from freshness (the record is current by construction). */
export const RUN_RECORD_SOURCE = "run-record";

export interface FinishClaim {
  /** The fact as stated, one line. */
  text: string;
  /** Where it came from: a URL, a document name, or RUN_RECORD_SOURCE. */
  source: string | null;
  /** When the agent retrieved it (ISO 8601), or null when it did not say. */
  retrievedAt: string | null;
  /** The fact's data type: price / availability / org / legal, or a type
   *  the definition's Conditions declare a freshness bound for. */
  type: string | null;
}

/** The finish as submitted, sealed onto the run at a terminal finish
 *  (agent_runs.finish_detail) and never updated afterwards. */
export interface FinishDetail {
  claims: FinishClaim[];
  /** What the agent could not confirm. Non-empty marks the finish; it
   *  never fails it — the Reviews filter is how a person finds these. */
  unconfirmed: string[];
}

const MAX_CLAIMS = 50;
const MAX_UNCONFIRMED = 20;
/** The findings a record keeps (the verifier's gaps cap the same way). */
export const MAX_CLAIM_GAPS = 5;
/** A retrievedAt this far ahead of now is not clock skew; it is wrong. */
const FUTURE_TOLERANCE_MS = 5 * 60_000;

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Pure. The finish call's claims argument, read tolerantly: entries
 *  without a stated fact are dropped, fields that are not strings become
 *  null — the check then judges what is actually there. */
export function normalizeClaims(raw: unknown): FinishClaim[] {
  if (!Array.isArray(raw)) return [];
  const out: FinishClaim[] = [];
  for (const e of raw) {
    if (!e || typeof e !== "object" || Array.isArray(e)) continue;
    const r = e as Record<string, unknown>;
    const text = str(r.text);
    if (!text) continue;
    out.push({ text: text.slice(0, 500), source: str(r.source), retrievedAt: str(r.retrievedAt), type: str(r.type) });
    if (out.length >= MAX_CLAIMS) break;
  }
  return out;
}

/** Pure. The finish call's unconfirmed argument, read tolerantly. */
export function normalizeUnconfirmed(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim().slice(0, 500)).slice(0, MAX_UNCONFIRMED);
}

/** Pure. The sealed record for a finish: its claims and unconfirmed list,
 *  exactly as submitted (the executor already normalized them). */
export function finishDetailOf(finish: { claims?: FinishClaim[]; unconfirmed?: string[] }): FinishDetail {
  return {
    claims: (finish.claims ?? []).map((c) => ({ ...c })),
    unconfirmed: [...(finish.unconfirmed ?? [])],
  };
}

export interface ClaimFacts {
  /** The run read the world: web search/fetch or an integration read. A
   *  finish that read nothing owes no sources. */
  usedReads: boolean;
  /** The effective freshness bounds (defaults overridden by the definition). */
  freshness: FreshnessTable;
  /** ms since epoch, when the finish is being judged. */
  now: number;
}

export interface ClaimCheck {
  counts: { total: number; sourced: number; stale: number };
  /** Mechanical findings, each naming the claim it is about (≤MAX_CLAIM_GAPS). */
  gaps: string[];
}

const shortText = (text: string) => (text.length > 60 ? `${text.slice(0, 60)}…` : text);

function ageText(ms: number): string {
  const d = 24 * 60 * 60_000;
  if (ms >= d) return `約 ${Math.round(ms / d)} 日`;
  if (ms >= 60 * 60_000) return `約 ${Math.round(ms / (60 * 60_000))} 時間`;
  return `約 ${Math.max(1, Math.round(ms / 60_000))} 分`;
}

/**
 * Pure. The mechanical judgement of a finish's claims — every condition
 * here is evaluable by code alone:
 *  1. Source presence: when the run read the world, every claim must carry
 *     a source ("run-record" counts — the step log is its source).
 *  2. Freshness: a claim whose type carries a bound must have a retrievedAt
 *     that parses, is not in the future, and is no older than the bound.
 *     "run-record" claims are exempt (checked by reference, above).
 * A claim with no type, or a type with no bound, owes presence only.
 */
export function checkFinishClaims(claims: readonly FinishClaim[], facts: ClaimFacts): ClaimCheck {
  const gaps: string[] = [];
  let sourced = 0;
  let stale = 0;
  const gap = (g: string) => { if (gaps.length < MAX_CLAIM_GAPS) gaps.push(g); };
  for (const claim of claims) {
    const hasSource = claim.source !== null;
    if (hasSource) sourced++;
    if (facts.usedReads && !hasSource) {
      gap(`主張「${shortText(claim.text)}」に出典がありません。Web や連携で調べた事実には、出典（URL や文書名、この実行の記録なら run-record）を付けてください。`);
    }
    if (claim.source === RUN_RECORD_SOURCE) continue;
    const bound = claim.type ? facts.freshness[freshnessLookupKey(claim.type)] : undefined;
    if (bound == null) continue;
    const typeLabel = claim.type as string;
    const at = claim.retrievedAt ? Date.parse(claim.retrievedAt) : Number.NaN;
    if (Number.isNaN(at)) {
      stale++;
      gap(`主張「${shortText(claim.text)}」には取得時刻がなく、鮮度を確かめられません（${typeLabel} の上限は ${ageText(bound)} です）。`);
      continue;
    }
    const age = facts.now - at;
    if (age < -FUTURE_TOLERANCE_MS) {
      stale++;
      gap(`主張「${shortText(claim.text)}」の取得時刻が未来になっています。`);
    } else if (age > bound) {
      stale++;
      gap(`主張「${shortText(claim.text)}」の出典は ${ageText(age)} 前のもので、鮮度の上限（${typeLabel}: ${ageText(bound)}）を超えています。新しい情報を取り直してください。`);
    }
  }
  return { counts: { total: claims.length, sourced, stale }, gaps };
}

/** Pure. Whether a sealed finish was born marked: it named things it could
 *  not confirm. The Reviews filter is this predicate over run records. */
export function hasUnconfirmed(detail: FinishDetail | null): boolean {
  return !!detail && detail.unconfirmed.length > 0;
}

/** Strict narrowing of the jsonb: anything that is not exactly this shape
 *  is not a finish detail (null), never a partially-read one. */
export function parseFinishDetail(raw: unknown): FinishDetail | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.claims) || !Array.isArray(r.unconfirmed)) return null;
  if (!r.unconfirmed.every((x) => typeof x === "string")) return null;
  const claims: FinishClaim[] = [];
  for (const e of r.claims) {
    if (!e || typeof e !== "object" || Array.isArray(e)) return null;
    const c = e as Record<string, unknown>;
    if (typeof c.text !== "string" || !c.text) return null;
    const nullable = (v: unknown) => v === null || typeof v === "string";
    if (!nullable(c.source) || !nullable(c.retrievedAt) || !nullable(c.type)) return null;
    claims.push({ text: c.text, source: c.source as string | null, retrievedAt: c.retrievedAt as string | null, type: c.type as string | null });
  }
  return { claims, unconfirmed: [...(r.unconfirmed as string[])] };
}
