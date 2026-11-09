import { describe, expect, it } from 'vitest';

// Definition tests (B14), the web display model
// (AIP/harness/definitionTestModel.ts): the body hash's web twin
// pinned against the server recipe (§12.15), the freshness axes
// (§12.16 — labels only, never a launch block), the constraint
// review's counts (§8.3), and the vanished-action courtesy (§5.4).
import {
  constraintTestSummary, definitionBodyHashWeb, fixtureExchangeCount,
  manifestActionsByIntegration, readTestVerdict, testFreshness, vanishedActions,
} from '@/AIP/harness/definitionTestModel';
import type { DefinitionTest } from '@/types/database';

const dt = await import(new URL('../../supabase/functions/_shared/definitionTests.ts', import.meta.url).pathname);

const test = (over: Partial<DefinitionTest> = {}): DefinitionTest => ({
  id: 't1', definition_id: 'd1', activity_space_id: 's1', name: 'T',
  fixture: { version: 1, exchanges: [] }, expected: { classification: 'completed' },
  source_run_id: 'r1', source_run_label: 'Run', source_run_status: 'completed',
  tainted: false, captured_by: 'u1', captured_at: '2026-11-09T00:00:00.000Z',
  last_result: null, last_run_id: null, last_run_at: null, last_body_hash: null,
  ...over,
});

const exchange = (integrationId: string, action: string) => ({
  seq: 1, integrationId, integrationName: 'Conn', action, kind: 'read',
  args: {}, argHash: 'h', volatileKeys: [], response: 'ok', isError: false,
});

const verdict = (outcome: 'pass' | 'fail') => ({
  outcome, classification: 'completed', expectedClassification: 'completed',
  consumed: 2, total: 2, divergences: [], at: '2026-11-09T01:00:00.000Z', escalation: null,
});

describe('definitionBodyHashWeb (§12.15 — the twin agrees with the server)', () => {
  it('matches _shared definitionBodyHash on plain, empty and Japanese bodies', async () => {
    for (const body of ['# 目的\nDo the thing.', '', '# 目的\n請求書を送る\n# 止める条件\n- 金額が違う']) {
      expect(await definitionBodyHashWeb(body)).toBe(await dt.definitionBodyHash(body));
    }
  });
});

describe('testFreshness (§12.16 — two axes, labels only)', () => {
  const now = new Date('2026-11-09T00:00:00.000Z');
  it('a 91-day-old fixture reads old; a 90-day-old does not', () => {
    expect(testFreshness(test({ captured_at: '2026-08-09T00:00:00.000Z' }), 'h', now).oldFixture).toBe(true);
    expect(testFreshness(test({ captured_at: '2026-08-11T00:00:00.000Z' }), 'h', now).oldFixture).toBe(false);
  });
  it('staleness of the body is its own axis, keyed on the result’s hash', () => {
    const f = testFreshness(test({ last_body_hash: 'old' }), 'new', now);
    expect(f.staleBody).toBe(true);
    expect(testFreshness(test({ last_body_hash: 'new' }), 'new', now).staleBody).toBe(false);
    expect(testFreshness(test(), 'new', now).staleBody).toBe(false);
  });
  it('the model returns no blocking verdict — freshness is display data', () => {
    const f = testFreshness(test({ captured_at: '2020-01-01T00:00:00.000Z', last_body_hash: 'x' }), 'y', now);
    expect(Object.keys(f).sort()).toEqual(['ageDays', 'oldFixture', 'staleBody']);
  });
});

describe('constraintTestSummary (§8.3 — counts against the current body)', () => {
  it('is null when the definition has no tests (absence is not a warning)', () => {
    expect(constraintTestSummary([], 'h')).toBeNull();
  });
  it('counts current-body pass/fail apart from older-version results', () => {
    const tests = [
      test({ id: 'a', last_result: verdict('pass'), last_body_hash: 'cur' }),
      test({ id: 'b', last_result: verdict('fail'), last_body_hash: 'cur' }),
      test({ id: 'c', last_result: verdict('pass'), last_body_hash: 'old' }),
      test({ id: 'd' }),
    ];
    expect(constraintTestSummary(tests, 'cur')).toEqual({ total: 4, passCurrent: 1, failCurrent: 1, oldVersion: 2 });
  });
});

describe('readTestVerdict (tolerant — a malformed record is no result)', () => {
  it('reads a stored verdict and its first divergence', () => {
    const v = readTestVerdict({ ...verdict('fail'), divergences: [{ kind: 'unexpected-call', action: 'x.y', detail: '' }] });
    expect(v?.outcome).toBe('fail');
    expect(v?.firstDivergence).toEqual({ kind: 'unexpected-call', action: 'x.y' });
  });
  it('returns null for anything else', () => {
    expect(readTestVerdict(null)).toBeNull();
    expect(readTestVerdict({ outcome: 'pass' })).toBeNull();
    expect(readTestVerdict('pass')).toBeNull();
  });
});

describe('vanishedActions (§5.4 — per connection, courtesy only)', () => {
  const rows = [
    { id: 'i1', manifest: { commands: [{ name: 'list', action: 'issues.list' }], aliases: { old_list: 'issues.list' } } },
    { id: 'i2', manifest: null },
  ];
  const actions = manifestActionsByIntegration(rows);
  const known = new Set(['i1', 'i2']);
  it('collects command actions and alias targets', () => {
    expect([...(actions.get('i1') ?? [])]).toEqual(['issues.list']);
    expect(actions.has('i2')).toBe(false);
  });
  it('flags an action its own connection’s manifest dropped', () => {
    const t1 = test({ fixture: { version: 1, exchanges: [exchange('i1', 'issues.get')] } });
    expect(vanishedActions(t1, actions, known)).toEqual(['issues.get']);
  });
  it('never flags manifest-less connections (Drive, raw HTTP), and flags a deleted connection', () => {
    const drive = test({ fixture: { version: 1, exchanges: [exchange('i2', 'drive.whatever')] } });
    expect(vanishedActions(drive, actions, known)).toEqual([]);
    const gone = test({ fixture: { version: 1, exchanges: [exchange('i9', 'issues.list')] } });
    expect(vanishedActions(gone, actions, known)).toEqual(['issues.list']);
  });
  it('counts the fixture’s exchanges', () => {
    expect(fixtureExchangeCount(test({ fixture: { version: 1, exchanges: [exchange('i1', 'a'), exchange('i1', 'b')] } }))).toBe(2);
    expect(fixtureExchangeCount(test({ fixture: null }))).toBe(0);
  });
});
