import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseProposedReadings, parseRunVerdict as webParseRunVerdict } from '@/Function/audit/auditModel';

const rv = await import(new URL('../../supabase/functions/_shared/runVerdict.ts', import.meta.url).pathname);
const { buildRunVerdict, parseRunVerdict } = rv;

const CHECK = { pass: true, gaps: [] as string[], model: 'claude-test', checkedAt: '2026-11-07T01:00:00Z', verifyStepIdx: 12, artifactIds: ['a1', 'a2'] };
const FAIL_CHECK = { ...CHECK, pass: false, gaps: ['件数が足りない', '出典がない'] };
const BASE = { lastCheck: null, checkAttempted: false, revisions: 0, finish: { outcome: 'completed' as const }, external: false };

describe('buildRunVerdict', () => {
  it('records a checked pass with its evidence', () => {
    const v = buildRunVerdict({ ...BASE, lastCheck: CHECK, checkAttempted: true, revisions: 1 });
    expect(v).toMatchObject({ v: 1, result: 'pass', source: 'verifier', model: 'claude-test', gaps: [], revisions: 1, checkedAt: CHECK.checkedAt, outcome: 'completed', reason: null });
    expect(v.evidence).toEqual({ verifyStepIdx: 12, artifactIds: ['a1', 'a2'] });
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
    { ...built, v: 2 },
    { ...built, v: undefined },
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
