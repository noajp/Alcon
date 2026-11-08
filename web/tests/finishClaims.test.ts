import { describe, expect, it } from 'vitest';
import { hasUnconfirmed as webHasUnconfirmed, parseFinishDetail as webParseFinishDetail } from '@/Function/audit/auditModel';

const fc = await import(new URL('../../supabase/functions/_shared/finishClaims.ts', import.meta.url).pathname);
const def = await import(new URL('../../supabase/functions/_shared/definition.ts', import.meta.url).pathname);

const { checkFinishClaims, finishDetailOf, normalizeClaims, normalizeUnconfirmed, parseFinishDetail, hasUnconfirmed, RUN_RECORD_SOURCE } = fc;
const { parseDefinition, freshnessTableOf, DEFAULT_FRESHNESS } = def;

const NOW = Date.parse('2026-11-09T12:00:00Z');
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const FRESHNESS = freshnessTableOf(null); // the shipped defaults
const FACTS = { usedReads: true, freshness: FRESHNESS, now: NOW };

describe('normalizeClaims / normalizeUnconfirmed', () => {
  it('keeps stated facts and drops what is not one', () => {
    expect(normalizeClaims([
      { text: ' PR を作った ', source: RUN_RECORD_SOURCE },
      { text: '価格は 1,200 円', source: 'https://example.com/p', retrievedAt: iso(0), type: 'price' },
      { text: '' }, { noText: true }, 'x', null,
      { text: '出典なしの事実', source: 42, retrievedAt: '', type: null },
    ])).toEqual([
      { text: 'PR を作った', source: 'run-record', retrievedAt: null, type: null },
      { text: '価格は 1,200 円', source: 'https://example.com/p', retrievedAt: iso(0), type: 'price' },
      { text: '出典なしの事実', source: null, retrievedAt: null, type: null },
    ]);
    expect(normalizeClaims('nope')).toEqual([]);
    expect(normalizeUnconfirmed([' 在庫は未確認 ', '', 3, '担当者は未確認'])).toEqual(['在庫は未確認', '担当者は未確認']);
    expect(normalizeUnconfirmed(undefined)).toEqual([]);
  });
});

describe('checkFinishClaims — the mechanical gate', () => {
  it('accepts a finish whose claims are sourced and fresh', () => {
    const r = checkFinishClaims([
      { text: '候補は 12 件', source: 'https://example.com', retrievedAt: iso(5 * 60_000), type: null },
      { text: '価格は 1,200 円', source: 'https://example.com/p', retrievedAt: iso(10 * 60_000), type: 'price' },
    ], FACTS);
    expect(r).toEqual({ counts: { total: 2, sourced: 2, stale: 0 }, gaps: [] });
  });

  it('fails a claim of a created artifact with no source, naming the claim (the smoke flow)', () => {
    const r = checkFinishClaims([
      { text: 'PR #42 を作成した', source: null, retrievedAt: null, type: null },
    ], FACTS);
    expect(r.counts).toEqual({ total: 1, sourced: 0, stale: 0 });
    expect(r.gaps).toHaveLength(1);
    expect(r.gaps[0]).toContain('PR #42 を作成した');
    expect(r.gaps[0]).toContain('出典がありません');
  });

  it('accepts the same claim sourced from the run record, freshness-exempt', () => {
    const r = checkFinishClaims([
      { text: 'PR #42 を作成した', source: RUN_RECORD_SOURCE, retrievedAt: null, type: 'price' },
    ], FACTS);
    expect(r).toEqual({ counts: { total: 1, sourced: 1, stale: 0 }, gaps: [] });
  });

  it('fails a claim whose source is older than its type bound (the smoke flow)', () => {
    const r = checkFinishClaims([
      { text: '価格は 1,200 円', source: 'https://example.com/p', retrievedAt: iso(31 * 60_000), type: 'price' },
    ], FACTS);
    expect(r.counts).toEqual({ total: 1, sourced: 1, stale: 1 });
    expect(r.gaps[0]).toContain('価格は 1,200 円');
    expect(r.gaps[0]).toContain('鮮度');
  });

  it('treats a claim exactly at the bound as fresh, and one past it as stale', () => {
    const at = checkFinishClaims([{ text: 'p', source: 'u', retrievedAt: iso(30 * 60_000), type: 'price' }], FACTS);
    expect(at.counts.stale).toBe(0);
    const past = checkFinishClaims([{ text: 'p', source: 'u', retrievedAt: iso(30 * 60_000 + 1), type: 'price' }], FACTS);
    expect(past.counts.stale).toBe(1);
  });

  it('counts a typed claim with no usable retrievedAt as stale — freshness cannot be verified', () => {
    for (const retrievedAt of [null, 'not-a-date']) {
      const r = checkFinishClaims([{ text: '規約は改定済み', source: 'https://example.com/l', retrievedAt, type: 'legal' }], FACTS);
      expect(r.counts.stale).toBe(1);
      expect(r.gaps[0]).toContain('鮮度を確かめられません');
    }
    const future = checkFinishClaims([{ text: '規約', source: 'u', retrievedAt: new Date(NOW + 60 * 60_000).toISOString(), type: 'legal' }], FACTS);
    expect(future.counts.stale).toBe(1);
    expect(future.gaps[0]).toContain('未来');
    // Within clock-skew tolerance, a slightly future stamp is fresh.
    const skew = checkFinishClaims([{ text: '規約', source: 'u', retrievedAt: new Date(NOW + 60_000).toISOString(), type: 'legal' }], FACTS);
    expect(skew.counts.stale).toBe(0);
  });

  it('owes no sources when the run read nothing', () => {
    const r = checkFinishClaims([
      { text: '下書きを作った', source: null, retrievedAt: null, type: null },
    ], { ...FACTS, usedReads: false });
    expect(r).toEqual({ counts: { total: 1, sourced: 0, stale: 0 }, gaps: [] });
  });

  it('applies freshness by type name in either language, and no bound means no freshness duty', () => {
    // A Japanese type name for a shipped type still binds (価格 → price, 30 min).
    const ja = checkFinishClaims([{ text: '相場', source: 'u', retrievedAt: iso(60 * 60_000), type: '価格' }], FACTS);
    expect(ja.counts.stale).toBe(1);
    // An undeclared type owes presence only, however old its source is.
    const custom = checkFinishClaims([{ text: '天気は晴れ', source: 'u', retrievedAt: iso(365 * 24 * 60 * 60_000), type: '天気' }], FACTS);
    expect(custom).toEqual({ counts: { total: 1, sourced: 1, stale: 0 }, gaps: [] });
    // No type at all: presence only.
    const untyped = checkFinishClaims([{ text: '数えた', source: 'u', retrievedAt: iso(365 * 24 * 60 * 60_000), type: null }], FACTS);
    expect(untyped.counts.stale).toBe(0);
  });

  it('caps the findings it reports at five, keeping exact counts', () => {
    const claims = Array.from({ length: 8 }, (_, i) => ({ text: `事実 ${i}`, source: null, retrievedAt: null, type: null }));
    const r = checkFinishClaims(claims, FACTS);
    expect(r.counts.total).toBe(8);
    expect(r.gaps).toHaveLength(5);
  });
});

describe('definition freshness declarations', () => {
  it('ships the posture defaults: price 30m, availability 1d, org 30d, legal 7d', () => {
    expect(DEFAULT_FRESHNESS).toEqual({ price: 30 * 60_000, availability: 24 * 60 * 60_000, org: 30 * 24 * 60 * 60_000, legal: 7 * 24 * 60 * 60_000 });
    expect(freshnessTableOf(null)).toEqual(DEFAULT_FRESHNESS);
    expect(freshnessTableOf(parseDefinition('# 目的\nx\n'))).toEqual(DEFAULT_FRESHNESS);
  });

  it('overrides a shipped bound and declares a bound for its own type', () => {
    const d = parseDefinition('# 目的\nx\n# 条件\n- 価格の鮮度: 2時間まで\n- 天気の鮮度は 3 日\n');
    const table = freshnessTableOf(d);
    expect(table.price).toBe(2 * 60 * 60_000);
    expect(table['天気']).toBe(3 * 24 * 60 * 60_000);
    expect(table.legal).toBe(DEFAULT_FRESHNESS.legal); // untouched defaults stand
    // And the declared custom bound is what a claim of that type is judged by.
    const claim = { text: '天気は晴れ', source: 'u', retrievedAt: iso(4 * 24 * 60 * 60_000), type: '天気' };
    expect(checkFinishClaims([claim], { usedReads: true, freshness: table, now: NOW }).counts.stale).toBe(1);
    expect(checkFinishClaims([claim], FACTS).counts.stale).toBe(0);
  });

  it('reads English declarations too', () => {
    const d = parseDefinition('# Goal\nx\n# Conditions\n- freshness (stock): 12 hours\n');
    expect(freshnessTableOf(d).availability).toBe(12 * 60 * 60_000);
  });
});

describe('the sealed finish detail', () => {
  const detail = finishDetailOf({
    claims: [{ text: '価格は 1,200 円', source: 'https://example.com/p', retrievedAt: iso(0), type: 'price' }],
    unconfirmed: ['在庫は未確認'],
  });

  it('round-trips, on the server and in the web mirror', () => {
    expect(parseFinishDetail(detail)).toEqual(detail);
    expect(webParseFinishDetail(JSON.parse(JSON.stringify(detail)))).toEqual(detail);
    expect(parseFinishDetail(finishDetailOf({}))).toEqual({ claims: [], unconfirmed: [] });
  });

  it('rejects anything that is not exactly its shape — the same fixtures on both sides', () => {
    const bad: unknown[] = [
      null, 'x', [], {}, { claims: [] }, { claims: [], unconfirmed: 'x' },
      { claims: [{ text: 't', source: 3, retrievedAt: null, type: null }], unconfirmed: [] },
      { claims: [{ text: '', source: null, retrievedAt: null, type: null }], unconfirmed: [] },
      { claims: [], unconfirmed: [1] },
    ];
    for (const b of bad) {
      expect(parseFinishDetail(b)).toBeNull();
      expect(webParseFinishDetail(b)).toBeNull();
    }
  });

  it('marks a finish by its unconfirmed list — and only by it', () => {
    expect(hasUnconfirmed(detail)).toBe(true);
    expect(webHasUnconfirmed(detail)).toBe(true);
    expect(hasUnconfirmed({ claims: [], unconfirmed: [] })).toBe(false);
    expect(hasUnconfirmed(null)).toBe(false);
  });
});
