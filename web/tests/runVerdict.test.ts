import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseProposedReadings, parseRunVerdict as webParseRunVerdict } from '@/Function/audit/auditModel';

const rv = await import(new URL('../../supabase/functions/_shared/runVerdict.ts', import.meta.url).pathname);
const { buildRunVerdict, parseRunVerdict } = rv;

const CHECK = { pass: true, gaps: [] as string[], model: 'claude-test', checkedAt: '2026-11-07T01:00:00Z', verifyStepIdx: 12, artifactIds: ['a1', 'a2'] };
const FAIL_CHECK = { ...CHECK, pass: false, gaps: ['件数が足りない', '出典がない'] };
const CLAIM_CHECK = { counts: { total: 2, sourced: 1, stale: 0 }, gaps: ['主張「X」に出典がありません'] };
const BASE = { lastCheck: null, checkAttempted: false, revisions: 0, finish: { outcome: 'completed' as const }, external: false, claimCheck: CLAIM_CHECK };

describe('buildRunVerdict', () => {
  it('records a checked pass with its evidence', () => {
    const v = buildRunVerdict({ ...BASE, lastCheck: CHECK, checkAttempted: true, revisions: 1 });
    // v3 since the Evaluation PR3: new records are sealed as v3 (the
    // claim accounting below is unchanged from v2, and v1/v2 records
    // still parse exactly as written — see the parser pins below).
    expect(v).toMatchObject({ v: 3, result: 'pass', source: 'verifier', model: 'claude-test', gaps: [], revisions: 1, checkedAt: CHECK.checkedAt, outcome: 'completed', reason: null });
    expect(v.evidence).toEqual({ verifyStepIdx: 12, artifactIds: ['a1', 'a2'] });
  });

  it('carries the claim accounting on every record since v2, checked or not', () => {
    const v = buildRunVerdict({ ...BASE, lastCheck: CHECK, checkAttempted: true });
    expect(v.claims).toEqual({ total: 2, sourced: 1, stale: 0 });
    expect(v.claimGaps).toEqual(['主張「X」に出典がありません']);
    const u = buildRunVerdict({ ...BASE, checkAttempted: true });
    expect(u.claims).toEqual({ total: 2, sourced: 1, stale: 0 });
    expect(u.claimGaps).toEqual(['主張「X」に出典がありません']);
  });

  it('keeps a fail as a fail when the finish stood after the revision limit', () => {
    const v = buildRunVerdict({ ...BASE, lastCheck: FAIL_CHECK, checkAttempted: true, revisions: 2 });
    expect(v).toMatchObject({ result: 'fail', source: 'verifier', reason: 'revisions-exhausted', gaps: FAIL_CHECK.gaps, revisions: 2 });
  });

  it('says unchecked when the verifier could not answer', () => {
    expect(buildRunVerdict({ ...BASE, checkAttempted: true })).toMatchObject({ result: 'unchecked', source: 'none', reason: 'verify-unavailable', model: null, checkedAt: null });
  });

  it('says unchecked when no check was attempted', () => {
    expect(buildRunVerdict({ ...BASE, checkAttempted: false })).toMatchObject({ result: 'unchecked', source: 'none', reason: 'verify-unavailable' });
  });

  it('does not check partial or blocked finishes, whatever the last check said', () => {
    for (const outcome of ['partial', 'blocked'] as const) {
      const v = buildRunVerdict({ ...BASE, lastCheck: CHECK, checkAttempted: true, finish: { outcome } });
      expect(v).toMatchObject({ result: 'unchecked', source: 'none', reason: 'outcome-not-completed', outcome, gaps: [], checkedAt: null });
      expect(v.evidence).toEqual({ verifyStepIdx: null, artifactIds: [] });
    }
  });

  it('does not check runs on an external model', () => {
    const v = buildRunVerdict({ ...BASE, lastCheck: CHECK, external: true });
    expect(v).toMatchObject({ result: 'unchecked', source: 'none', reason: 'external-model' });
  });

  it('caps the gaps the record keeps at five', () => {
    const v = buildRunVerdict({ ...BASE, lastCheck: { ...FAIL_CHECK, gaps: ['1', '2', '3', '4', '5', '6', '7'] } });
    expect(v.gaps).toEqual(['1', '2', '3', '4', '5']);
  });
});

describe('parseRunVerdict', () => {
  const built = buildRunVerdict({ ...BASE, lastCheck: FAIL_CHECK, checkAttempted: true, revisions: 2 });

  it('round-trips a built record, on the server and in the web mirror', () => {
    expect(parseRunVerdict(built)).toEqual(built);
    expect(webParseRunVerdict(built)).toEqual(built);
    expect(parseRunVerdict(JSON.parse(JSON.stringify(built)))).toEqual(built);
  });

  const MALFORMED: unknown[] = [
    null, undefined, 'pass', [], {},
    { ...built, v: 4 },
    { ...built, v: undefined },
    { ...built, claims: undefined },
    { ...built, claims: null },
    { ...built, claims: { total: 2, sourced: 3, stale: 0 } },
    { ...built, claims: { total: 2, sourced: 1, stale: -1 } },
    { ...built, claims: { total: 2, sourced: 1.5, stale: 0 } },
    { ...built, claimGaps: undefined },
    { ...built, claimGaps: ['ok', 4] },
    { ...built, result: 'maybe' },
    { ...built, source: 'agent' },
    { ...built, model: 3 },
    { ...built, gaps: 'none' },
    { ...built, gaps: ['ok', 4] },
    { ...built, revisions: -1 },
    { ...built, revisions: 1.5 },
    { ...built, checkedAt: 0 },
    { ...built, outcome: 'done' },
    { ...built, reason: ' vibes' },
    { ...built, reason: 'unknown' },
    { ...built, evidence: null },
    { ...built, evidence: { verifyStepIdx: '3', artifactIds: [] } },
    { ...built, evidence: { verifyStepIdx: null, artifactIds: [1] } },
  ];

  it('rejects malformed shapes — the same fixtures on both sides', () => {
    for (const bad of MALFORMED) {
      expect(parseRunVerdict(bad)).toBeNull();
      expect(webParseRunVerdict(bad)).toBeNull();
    }
  });

  it('accepts the same valid shapes on both sides', () => {
    const valids = [
      built,
      buildRunVerdict({ ...BASE, lastCheck: CHECK, checkAttempted: true }),
      buildRunVerdict({ ...BASE, checkAttempted: true }),
      buildRunVerdict({ ...BASE, finish: { outcome: 'partial' } }),
      buildRunVerdict({ ...BASE, external: true }),
    ];
    for (const v of valids) {
      expect(webParseRunVerdict(v)).toEqual(parseRunVerdict(v));
      expect(parseRunVerdict(v)).not.toBeNull();
    }
  });

  it('still reads a v1 record exactly as it was written — no accounting invented', () => {
    const v1 = {
      v: 1, result: 'pass', source: 'verifier', model: 'claude-old', gaps: [], revisions: 0,
      checkedAt: '2026-11-01T01:00:00Z', outcome: 'completed', reason: null,
      evidence: { verifyStepIdx: 4, artifactIds: [] },
    };
    expect(parseRunVerdict(v1)).toEqual(v1);
    expect(webParseRunVerdict(v1)).toEqual(v1);
    expect(parseRunVerdict(v1)?.claims).toBeUndefined();
    // A v1 record carrying stray claim keys is still a v1 record.
    expect(parseRunVerdict({ ...v1, claims: 'junk', claimGaps: 3 })).toEqual(v1);
  });
});

describe('verdict verify accounting (B2)', () => {
  const TALLY = { checked: 3, ok: 1, mismatched: 1, unverified: 1 };

  it('seals the tally on a checked record and on an unchecked one alike', () => {
    const checked = buildRunVerdict({ ...BASE, lastCheck: CHECK, checkAttempted: true, verifyTally: TALLY });
    expect(checked.verify).toEqual(TALLY);
    const unchecked = buildRunVerdict({ ...BASE, checkAttempted: true, verifyTally: TALLY });
    expect(unchecked.verify).toEqual(TALLY);
  });

  it('carries nothing when no declared write ran (an empty or absent tally)', () => {
    expect(buildRunVerdict({ ...BASE, lastCheck: CHECK }).verify).toBeUndefined();
    expect(buildRunVerdict({ ...BASE, lastCheck: CHECK, verifyTally: { checked: 0, ok: 0, mismatched: 0, unverified: 0 } }).verify).toBeUndefined();
    expect(buildRunVerdict({ ...BASE, lastCheck: CHECK, verifyTally: null }).verify).toBeUndefined();
  });

  it('round-trips through both parsers, and rejects an inexact tally on both', () => {
    const built = buildRunVerdict({ ...BASE, lastCheck: CHECK, checkAttempted: true, verifyTally: TALLY });
    expect(parseRunVerdict(JSON.parse(JSON.stringify(built)))).toEqual(built);
    expect(webParseRunVerdict(JSON.parse(JSON.stringify(built)))).toEqual(built);
    for (const bad of [
      { ...built, verify: { checked: 3, ok: 2, mismatched: 1, unverified: 1 } }, // outcomes do not sum to the checks
      { ...built, verify: { checked: 3, ok: 1, mismatched: 1 } },
      { ...built, verify: { checked: -1, ok: 0, mismatched: 0, unverified: 0 } },
      { ...built, verify: 'lots' },
      { ...built, verify: null },
    ]) {
      expect(parseRunVerdict(bad)).toBeNull();
      expect(webParseRunVerdict(bad)).toBeNull();
    }
  });
});

describe('verdict corrections and inputs hash (B3)', () => {
  const ENVELOPE = {
    v: 1, unit: { kind: 'element', id: 'e1', title: '競合を調べる' }, verdict: 'fail', source: 'verifier',
    reason: ['件数が足りない'], evidence: { verifyStepIdx: 12, artifactIds: ['a1'] },
    scope: '直すのはこの Element の成果だけです。', attempt: 1, maxAttempts: 3,
  };

  it('seals the corrections and the inputs hash on a checked record and an unchecked one alike', () => {
    const checked = buildRunVerdict({ ...BASE, lastCheck: FAIL_CHECK, checkAttempted: true, revisions: 1, corrections: [ENVELOPE], inputsHash: 'h-sealed' });
    expect(checked.corrections).toEqual([ENVELOPE]);
    expect(checked.inputsHash).toBe('h-sealed');
    const unchecked = buildRunVerdict({ ...BASE, checkAttempted: true, corrections: [ENVELOPE], inputsHash: 'h-sealed' });
    expect(unchecked.corrections).toEqual([ENVELOPE]);
    expect(unchecked.inputsHash).toBe('h-sealed');
  });

  it('carries neither when the driver supplied none', () => {
    const v = buildRunVerdict({ ...BASE, lastCheck: CHECK, checkAttempted: true, corrections: [], inputsHash: null });
    expect(v.corrections).toBeUndefined();
    expect(v.inputsHash).toBeUndefined();
  });

  it('round-trips through both parsers, and rejects malformed fields on both', () => {
    const built = buildRunVerdict({ ...BASE, lastCheck: FAIL_CHECK, checkAttempted: true, revisions: 1, corrections: [ENVELOPE], inputsHash: 'h-sealed' });
    expect(parseRunVerdict(JSON.parse(JSON.stringify(built)))).toEqual(built);
    expect(webParseRunVerdict(JSON.parse(JSON.stringify(built)))).toEqual(built);
    for (const bad of [
      { ...built, inputsHash: 42 },
      { ...built, inputsHash: '' },
      { ...built, inputsHash: null },
      { ...built, corrections: 'two' },
      { ...built, corrections: null },
      { ...built, corrections: [{ ...ENVELOPE, attempt: 0 }] },
      { ...built, corrections: [{ ...ENVELOPE, source: 'agent' }] },
      { ...built, corrections: [{ ...ENVELOPE, evidence: { verifyStepIdx: -1, artifactIds: [] } }] },
      { ...built, corrections: [ENVELOPE, { nope: true }] },
    ]) {
      expect(parseRunVerdict(bad)).toBeNull();
      expect(webParseRunVerdict(bad)).toBeNull();
    }
  });

  it('a record written before B3 reads back with neither field invented', () => {
    const built = buildRunVerdict({ ...BASE, lastCheck: CHECK, checkAttempted: true });
    expect(parseRunVerdict(built)?.corrections).toBeUndefined();
    expect(webParseRunVerdict(built)?.inputsHash).toBeUndefined();
  });
});

describe('parseProposedReadings', () => {
  const good = [{ measureId: 'm1', value: 42, applied: true, appliedAt: '2026-11-07T02:00:00Z', appliedBy: 'u1', heldReason: null }];

  it('reads a well-formed record and an empty one', () => {
    expect(parseProposedReadings(good)).toEqual(good);
    expect(parseProposedReadings([])).toEqual([]);
    expect(parseProposedReadings(null)).toBeNull();
    expect(parseProposedReadings(undefined)).toBeNull();
  });

  it('rejects malformed entries as a whole', () => {
    expect(parseProposedReadings('x')).toBeNull();
    expect(parseProposedReadings([{ ...good[0], value: '42' }])).toBeNull();
    expect(parseProposedReadings([{ ...good[0], value: Number.NaN }])).toBeNull();
    expect(parseProposedReadings([{ ...good[0], heldReason: 'later' }])).toBeNull();
    expect(parseProposedReadings([{ ...good[0], applied: 'yes' }])).toBeNull();
    expect(parseProposedReadings([null])).toBeNull();
  });
});

describe('agent run verdict migration', () => {
  const migration = readFileSync(new URL('../../supabase/migrations/20261121090000_agent_run_verdict.sql', import.meta.url), 'utf8');

  it('adds both columns inside a to_regclass guard', () => {
    expect(migration).toContain("if to_regclass('public.agent_runs') is not null then");
    expect(migration).toContain('add column if not exists verdict jsonb');
    expect(migration).toContain('add column if not exists proposed_readings jsonb');
  });
});

describe('agent run finish detail migration', () => {
  const migration = readFileSync(new URL('../../supabase/migrations/20261130200000_agent_run_finish_detail.sql', import.meta.url), 'utf8');

  it('adds the finish_detail column inside a to_regclass guard, and nothing else', () => {
    expect(migration).toContain("if to_regclass('public.agent_runs') is not null then");
    expect(migration).toContain('add column if not exists finish_detail jsonb');
    expect(migration).not.toContain('create table');
  });
});

describe('verdict chain accounting (B10)', () => {
  it('seals the denial count only when the fence refused something', () => {
    const refused = buildRunVerdict({ ...BASE, lastCheck: CHECK, checkAttempted: true, chainDenied: 3 });
    expect(refused.chain).toEqual({ denied: 3 });
    const quiet = buildRunVerdict({ ...BASE, lastCheck: CHECK, checkAttempted: true, chainDenied: 0 });
    expect(quiet.chain).toBeUndefined();
    const unscoped = buildRunVerdict({ ...BASE, lastCheck: CHECK, checkAttempted: true });
    expect(unscoped.chain).toBeUndefined();
    // The block rides unchecked records too — a refusal count
    // describes the run's calls, not the verifier's answer.
    const unchecked = buildRunVerdict({ ...BASE, checkAttempted: true, chainDenied: 1 });
    expect(unchecked.chain).toEqual({ denied: 1 });
  });

  it('server and web parse the block identically; a malformed block refuses the record on both', () => {
    const built = buildRunVerdict({ ...BASE, lastCheck: CHECK, checkAttempted: true, chainDenied: 2 });
    expect(webParseRunVerdict(built)).toEqual(parseRunVerdict(built));
    expect(parseRunVerdict(built)?.chain).toEqual({ denied: 2 });
    for (const bad of [
      { ...built, chain: { denied: -1 } },
      { ...built, chain: { denied: 1.5 } },
      { ...built, chain: { denied: '2' } },
      { ...built, chain: {} },
      { ...built, chain: [] },
      { ...built, chain: 2 },
    ]) {
      expect(parseRunVerdict(bad)).toBeNull();
      expect(webParseRunVerdict(bad)).toBeNull();
    }
    // Older records carry no block and read unchanged.
    const older = buildRunVerdict({ ...BASE, lastCheck: CHECK, checkAttempted: true });
    expect(parseRunVerdict(older)?.chain).toBeUndefined();
    expect(webParseRunVerdict(older)).toEqual(parseRunVerdict(older));
  });
});

describe('verdict v3 scoring (Evaluation PR3)', () => {
  // The verifier scored one of the two declared items and both shown
  // artifacts — plus one artifact it was never shown, which code must
  // never seal (the record's evidence is the bound).
  const SCORED = {
    ...CHECK,
    checksItems: ['件数を満たす', '出典を付ける'],
    checks: [{ item: '件数を満たす', result: 'partial' }],
    deliverables: [
      { artifactId: 'a1', depth: 'thin', note: '見出しだけで中身がない' },
      { artifactId: 'a2', depth: 'substantial', note: '型どおりに揃っている' },
      { artifactId: 'a-never-shown', depth: 'empty', note: 'shown されていない' },
    ],
  };

  it('seals per-item results in declaration order; an unscored declared item derives to fail', () => {
    const v = buildRunVerdict({ ...BASE, lastCheck: SCORED, checkAttempted: true });
    expect(v.v).toBe(3);
    expect(v.checks).toEqual([
      { item: '件数を満たす', result: 'partial' },
      // 出典を付ける was declared but not scored: not satisfied —
      // fail, never pass (invented) and never partial (flattering).
      { item: '出典を付ける', result: 'fail' },
    ]);
  });

  it('seals depth only for artifacts in the check’s own evidence', () => {
    const v = buildRunVerdict({ ...BASE, lastCheck: SCORED, checkAttempted: true });
    expect(v.deliverables).toEqual([
      { artifactId: 'a1', depth: 'thin', note: '見出しだけで中身がない' },
      { artifactId: 'a2', depth: 'substantial', note: '型どおりに揃っている' },
    ]);
  });

  it('a checked finish with nothing declared and nothing shown seals empty blocks, not absent ones', () => {
    const v = buildRunVerdict({ ...BASE, lastCheck: CHECK, checkAttempted: true });
    expect(v.checks).toEqual([]);
    expect(v.deliverables).toEqual([]);
  });

  it('an unchecked v3 record carries neither block — nobody scored it', () => {
    for (const v of [
      buildRunVerdict({ ...BASE, checkAttempted: true }),
      buildRunVerdict({ ...BASE, finish: { outcome: 'partial' } }),
      buildRunVerdict({ ...BASE, external: true }),
    ]) {
      expect(v.v).toBe(3);
      expect(v.checks).toBeUndefined();
      expect(v.deliverables).toBeUndefined();
    }
  });

  it('round-trips through both parsers, and rejects malformed blocks on both', () => {
    const built = buildRunVerdict({ ...BASE, lastCheck: SCORED, checkAttempted: true });
    expect(parseRunVerdict(JSON.parse(JSON.stringify(built)))).toEqual(built);
    expect(webParseRunVerdict(JSON.parse(JSON.stringify(built)))).toEqual(built);
    for (const bad of [
      { ...built, checks: 'two' },
      { ...built, checks: null },
      { ...built, checks: [{ item: '件数を満たす', result: 'great' }] },
      { ...built, checks: [{ item: '', result: 'pass' }] },
      { ...built, checks: [{ item: '件数を満たす', result: 'pass' }, { item: '件数を満たす', result: 'fail' }] },
      { ...built, checks: [{ result: 'pass' }] },
      { ...built, deliverables: 'deep' },
      { ...built, deliverables: null },
      { ...built, deliverables: [{ artifactId: 'a1', depth: 'deep', note: 'x' }] },
      // a9 is not in this record's evidence: the verifier cannot have judged it.
      { ...built, deliverables: [{ artifactId: 'a9', depth: 'thin', note: 'x' }] },
      { ...built, deliverables: [{ artifactId: 'a1', depth: 'thin', note: 'x' }, { artifactId: 'a1', depth: 'empty', note: 'y' }] },
      { ...built, deliverables: [{ artifactId: 'a1', depth: 'thin', note: 3 }] },
      { ...built, deliverables: [{ artifactId: 'a1', depth: 'thin' }] },
    ]) {
      expect(parseRunVerdict(bad)).toBeNull();
      expect(webParseRunVerdict(bad)).toBeNull();
    }
  });

  it('v2 records still read exactly as written — no scoring invented, stray v3 keys dropped with the version', () => {
    const v2 = {
      v: 2, result: 'pass', source: 'verifier', model: 'claude-old', gaps: [], revisions: 0,
      checkedAt: '2026-11-05T01:00:00Z', outcome: 'completed', reason: null,
      evidence: { verifyStepIdx: 4, artifactIds: ['a1'] },
      claims: { total: 1, sourced: 1, stale: 0 }, claimGaps: [],
    };
    expect(parseRunVerdict(v2)).toEqual(v2);
    expect(webParseRunVerdict(v2)).toEqual(v2);
    expect(parseRunVerdict(v2)?.checks).toBeUndefined();
    const stray = { ...v2, checks: [{ item: 'x', result: 'pass' }], deliverables: [{ artifactId: 'a1', depth: 'thin', note: 'n' }] };
    expect(parseRunVerdict(stray)).toEqual(v2);
    expect(webParseRunVerdict(stray)).toEqual(v2);
  });
});
