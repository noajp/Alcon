import { describe, expect, it } from 'vitest';

// Constraint drafts (B6, _shared/constraintDrafts.ts): the learning
// edge. These tests pin the design's own acceptance where code can:
//   - a seeded cluster of 3 outcomes with the same gap signature
//     produces exactly one draft with those outcome ids as evidence
//     (clustersOf + draftPlanOf, and the derivation shell end to end);
//   - a cluster whose evidence includes externally sourced content
//     is dropped whole, never cleaned (the taint rule);
//   - activation's tamper case is pinned at the hash level here
//     (an edited target body changes its version and binding hash)
//     and at the SQL level in constraintDraftsMigration.test.ts
//     (the RPC compares the stamped snapshot and refuses);
//   - after activation the constraint text reaches the splitter's
//     brief (strategyConstraintSection — the section plan-initiative
//     injects); before activation the section is empty;
//   - the effect rule flags, never retires.
const cd = await import(new URL('../../supabase/functions/_shared/constraintDrafts.ts', import.meta.url).pathname);
const snap = await import(new URL('../../supabase/functions/_shared/heartbeatSnapshot.ts', import.meta.url).pathname);
const def = await import(new URL('../../supabase/functions/_shared/definition.ts', import.meta.url).pathname);

const NOW = new Date('2026-11-09T00:00:00.000Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

// The mechanical templates, exactly as checkFinishClaims writes them.
const MISSING_SOURCE = '主張「売上高」に出典がありません。Web や連携で調べた事実には、出典（URL や文書名、この実行の記録なら run-record）を付けてください。';
const STALE = '主張「単価」 の出典は 約 40 日 前のもので、鮮度の上限（price: 約 30 日）を超えています。新しい情報を取り直してください。';

type Fact = {
  id: string; runId: string; spaceId: string;
  definitionId: string | null; strategyId: string | null;
  humanSignal: 'accepted' | 'rejected' | 'rework' | 'none';
  finishedAt: string; tainted: boolean;
  gaps: string[]; claimGaps: string[];
  corrections: { source: 'mechanical' | 'verifier'; reason: string[] }[];
  rejections: { integrationId: string | null; tool: string; noted: boolean }[];
  connectorIds: string[];
};
let seq = 0;
const fact = (over: Partial<Fact> = {}): Fact => {
  seq += 1;
  return {
    id: `o${seq}`, runId: `r${seq}`, spaceId: 's1',
    definitionId: 'd1', strategyId: null, humanSignal: 'none',
    finishedAt: daysAgo(2), tainted: false,
    gaps: [], claimGaps: [], corrections: [], rejections: [], connectorIds: [],
    ...over,
  };
};
const noChecks = new Map<string, readonly string[]>();

describe('signatures', () => {
  it('classifies the mechanical templates by their own class', () => {
    expect(cd.claimGapClassOf(MISSING_SOURCE)).toBe('missing-source');
    expect(cd.claimGapClassOf('主張「X」には取得時刻がなく、鮮度を確かめられません（price の上限は 約 30 分 です）。')).toBe('freshness-unverifiable');
    expect(cd.claimGapClassOf('主張「X」の取得時刻が未来になっています。')).toBe('freshness-future');
    expect(cd.claimGapClassOf(STALE)).toBe('stale-source');
    expect(cd.claimGapClassOf('何か別の指摘')).toBeNull();
    expect(cd.gapSignatureOf(MISSING_SOURCE, [])).toBe('claim:missing-source');
  });

  it('matches a gap to the definition’s check item when it names one', () => {
    expect(cd.gapSignatureOf('出典を明記する点が欠けている', ['出典を明記する', '数値を検算する']))
      .toBe('check:出典を明記する');
  });

  it('normalizes away the concrete fact a gap names', () => {
    const a = cd.gapSignatureOf('「売上高」の出典が 2026-10-01 時点のもので古い', []);
    const b = cd.gapSignatureOf('「利益率」の出典が 2026-11-02 時点のもので古い', []);
    expect(a).toBe(b);
    expect(a).toContain('出典が');
    expect(cd.gapSignatureOf('「」', [])).toBeNull();
  });

  it('a rejection signature is the action identity + note presence', () => {
    expect(cd.rejectionSignatureOf({ integrationId: 'i1', tool: 'send_email', noted: true })).toBe('reject:i1:send_email:noted');
    expect(cd.rejectionSignatureOf({ integrationId: null, tool: 'send_email', noted: false })).toBe('reject:none:send_email:silent');
  });

  it('a mechanical correction takes its claim class; a verifier one its gap signature', () => {
    expect(cd.correctionSignatureOf(MISSING_SOURCE, 'mechanical', [])).toBe('claim:missing-source');
    expect(cd.correctionSignatureOf('出典を明記する点が欠けている', 'verifier', ['出典を明記する'])).toBe('check:出典を明記する');
  });
});

describe('clustersOf — stage 1 (code only)', () => {
  it('the design acceptance: 3 outcomes, one signature → exactly one cluster with those ids as evidence', () => {
    const facts = [fact(), fact(), fact()].map((f) => ({ ...f, gaps: ['集計期間の明記がない'] }));
    const { clusters, taintedDropped } = cd.clustersOf(facts, noChecks);
    expect(taintedDropped).toBe(0);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toMatchObject({ scope: 'definition', targetId: 'd1', derivedFrom: 'verifier_gap', withSignature: 3, windowOutcomes: 3 });
    expect(clusters[0].evidenceOutcomeIds).toEqual(facts.map((f) => f.id).sort());
    const plan = cd.draftPlanOf(clusters, []);
    expect(plan).toHaveLength(1);
    expect(plan[0].evidenceOutcomeIds).toEqual(clusters[0].evidenceOutcomeIds);
  });

  it('below 3 outcomes the system stays silent', () => {
    const facts = [fact({ gaps: ['集計期間の明記がない'] }), fact({ gaps: ['集計期間の明記がない'] })];
    expect(cd.clustersOf(facts, noChecks).clusters).toEqual([]);
  });

  it('the baseline is the signature’s rate over the target’s window', () => {
    const facts = [
      ...[fact(), fact(), fact()].map((f) => ({ ...f, gaps: ['集計期間の明記がない'] })),
      ...[fact(), fact(), fact(), fact(), fact(), fact()].map((f) => ({ ...f, gaps: [] })),
    ];
    const { clusters } = cd.clustersOf(facts, noChecks);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].windowOutcomes).toBe(9);
    expect(clusters[0].baselineRate).toBe(0.3333);
  });

  it('a tainted outcome drops its whole cluster, not just itself', () => {
    const facts = [fact(), fact(), fact({ tainted: true })].map((f) => ({ ...f, gaps: ['集計期間の明記がない'] }));
    const { clusters, taintedDropped } = cd.clustersOf(facts, noChecks);
    expect(clusters).toEqual([]);
    expect(taintedDropped).toBe(1);
  });

  it('a rejection cluster needs ≥2 outcomes with human signals', () => {
    const rej = { integrationId: 'i1', tool: 'send_email', noted: true };
    const silent = [fact({ rejections: [rej] }), fact({ rejections: [rej] }), fact({ rejections: [rej] })];
    expect(cd.clustersOf(silent, noChecks).clusters).toEqual([]);
    const spoken = [
      fact({ rejections: [rej], humanSignal: 'rejected' }),
      fact({ rejections: [rej], humanSignal: 'rejected' }),
      fact({ rejections: [rej] }),
    ];
    const { clusters } = cd.clustersOf(spoken, noChecks);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toMatchObject({ derivedFrom: 'rejection_cluster', signature: 'reject:i1:send_email:noted', signalledCount: 2 });
  });

  it('one outcome’s signal counts once, however many entries it contributes', () => {
    const rej = { integrationId: 'i1', tool: 'send_email', noted: true };
    const facts = [
      fact({ rejections: [rej, rej], humanSignal: 'rejected' }),
      fact({ rejections: [rej] }),
      fact({ rejections: [rej] }),
    ];
    expect(cd.clustersOf(facts, noChecks).clusters).toEqual([]);
  });

  it('a repeated correction clusters as its own kind', () => {
    const facts = [fact(), fact(), fact()].map((f) => ({
      ...f, corrections: [{ source: 'mechanical' as const, reason: [MISSING_SOURCE] }],
    }));
    const { clusters } = cd.clustersOf(facts, noChecks);
    const corr = clusters.find((c: { derivedFrom: string }) => c.derivedFrom === 'correction_pattern');
    expect(corr).toMatchObject({ signature: 'claim:missing-source', withSignature: 3 });
  });

  it('one definition’s cluster is never drafted twice as a strategy cluster', () => {
    const facts = [fact(), fact(), fact()].map((f) => ({ ...f, strategyId: 'st1', gaps: ['集計期間の明記がない'] }));
    const { clusters } = cd.clustersOf(facts, noChecks);
    expect(clusters.map((c: { scope: string }) => c.scope)).toEqual(['definition']);
  });

  it('a signature spanning two definitions stands as a strategy cluster', () => {
    const facts = [
      fact({ strategyId: 'st1', gaps: ['集計期間の明記がない'] }),
      fact({ strategyId: 'st1', definitionId: 'd2', gaps: ['集計期間の明記がない'] }),
      fact({ strategyId: 'st1', gaps: ['集計期間の明記がない'] }),
    ];
    const { clusters } = cd.clustersOf(facts, noChecks);
    const strat = clusters.find((c: { scope: string }) => c.scope === 'strategy');
    expect(strat).toMatchObject({ targetId: 'st1', withSignature: 3 });
  });
});

describe('draftPlanOf — the queue’s restraint', () => {
  const cluster = (targetId: string, over: Record<string, unknown> = {}) => ({
    clusterKey: `definition:${targetId}:verifier_gap:gap:x`, spaceId: 's1', scope: 'definition' as const,
    targetId, derivedFrom: 'verifier_gap' as const, signature: 'gap:x',
    evidenceOutcomeIds: ['a', 'b', 'c'], withSignature: 3, windowOutcomes: 9, baselineRate: 0.3333,
    signalledCount: 0, sampleTexts: [], connectorIds: [], ...over,
  });

  it('an open draft on the target blocks a second lesson', () => {
    const open = [{ scope: 'definition' as const, targetDefinitionId: 'd1', targetStrategyId: null }];
    expect(cd.draftPlanOf([cluster('d1')], open)).toEqual([]);
    expect(cd.draftPlanOf([cluster('d2')], open)).toHaveLength(1);
  });

  it('two clusters on one target: the strongest takes the slot', () => {
    const weak = cluster('d1', { clusterKey: 'k-weak', withSignature: 3 });
    const strong = cluster('d1', { clusterKey: 'k-strong', withSignature: 5, signature: 'gap:y' });
    const plan = cd.draftPlanOf([strong, weak], []);
    expect(plan).toHaveLength(1);
    expect(plan[0].clusterKey).toBe('k-strong');
  });

  it('the per-Space cap counts drafts already open', () => {
    expect(cd.draftPlanOf([cluster('d1')], [], new Map([['s1', 10]]))).toEqual([]);
    expect(cd.draftPlanOf([cluster('d1')], [], new Map([['s1', 9]]))).toHaveLength(1);
  });
});

describe('hashes — the stored-trust gate', () => {
  it('an edited target body changes its version and its binding hash', async () => {
    const v1 = await cd.constraintTargetVersionOf({ kind: 'definition', body: '# 目的\nA' });
    const v2 = await cd.constraintTargetVersionOf({ kind: 'definition', body: '# 目的\nA（編集後）' });
    expect(v1).not.toBe(v2);
    const b1 = await cd.constraintBindingHash({ scope: 'definition', targetId: 'd1', targetVersion: v1, connectorIds: ['i2', 'i1'] });
    const b2 = await cd.constraintBindingHash({ scope: 'definition', targetId: 'd1', targetVersion: v2, connectorIds: ['i1', 'i2'] });
    expect(b1).not.toBe(b2);
    // The connector set is a set: order does not move the hash.
    const b3 = await cd.constraintBindingHash({ scope: 'definition', targetId: 'd1', targetVersion: v1, connectorIds: ['i1', 'i2'] });
    expect(b1).toBe(b3);
  });

  it('the structure hash binds text + scope', async () => {
    const h1 = await cd.constraintStructureHash('出典を併記すること', 'definition');
    expect(h1).toBe(await cd.constraintStructureHash('出典を併記すること', 'definition'));
    expect(h1).not.toBe(await cd.constraintStructureHash('出典を併記すること', 'strategy'));
    expect(h1).not.toBe(await cd.constraintStructureHash('出典を必ず併記すること', 'definition'));
  });

  it('the snapshot is the body verbatim (what the RPC compares)', () => {
    expect(cd.targetSnapshotOf({ kind: 'definition', body: 'BODY' })).toBe('BODY');
    expect(cd.targetSnapshotOf({ kind: 'strategy', name: 'S', description: null })).toBe('S\n');
  });
});

describe('validateConstraintText — the phraser’s output, judged by code', () => {
  it('accepts one clean imperative sentence', () => {
    expect(cd.validateConstraintText('出典は URL と取得時刻を併記すること')).toBe('出典は URL と取得時刻を併記すること');
  });

  it('refuses secret-shaped, multi-line, and stub text', () => {
    expect(cd.validateConstraintText('token は sk-abcdef0123456789 を使うこと')).toBeNull();
    expect(cd.validateConstraintText('一行目\n二行目も書くこと')).toBeNull();
    expect(cd.validateConstraintText('短い')).toBeNull();
    expect(cd.validateConstraintText(42)).toBeNull();
  });
});

describe('the landing — where the text enters planning', () => {
  const active = [{ id: 'c1', draftId: 'd1111111-2222', text: '出典は URL と取得時刻を併記すること', signature: 'claim:missing-source', derivedFrom: 'verifier_gap' as const, activatedAt: '2026-11-08T00:00:00.000Z' }];

  it('before activation the splitter’s section is empty; after, it carries the text with provenance', () => {
    expect(cd.strategyConstraintSection([])).toBe('');
    const section = cd.strategyConstraintSection(active);
    expect(section).toContain('出典は URL と取得時刻を併記すること');
    expect(section).toContain('claim:missing-source');
    expect(section).toContain('2026-11-08');
  });

  it('the definition projection appends; the stored body is never rewritten', () => {
    const body = '# 目的\n請求書を送る';
    const effective = cd.effectiveDefinitionText(body, active);
    expect(effective.startsWith(body)).toBe(true);
    expect(effective).toContain('## 制約');
    expect(effective).toContain('出典は URL と取得時刻を併記すること');
    expect(cd.effectiveDefinitionText(body, [])).toBe(body);
  });

  it('the parser reads a body’s own 制約 section (the landing’s other half)', () => {
    const parsed = def.parseDefinition('# 目的\nX\n\n# 制約\n- 出典を併記する\n- 価格は当日中に確かめる\n\n# 進め方\n1. 送る');
    expect(parsed.constraints).toEqual(['出典を併記する', '価格は当日中に確かめる']);
    expect(parsed.sections.constraints).toContain('出典を併記する');
    expect(parsed.sections.procedure).toContain('送る');
  });
});

describe('effectOf — the scoreboard', () => {
  const under = (n: number, withSig: number) => Array.from({ length: n }, (_, i) => ({ outcomeId: `u${i}`, carriesSignature: i < withSig }));

  it('below 5 under-constraint outcomes it is still measuring', () => {
    const r = cd.effectOf({ baselineRate: 0.4, under: under(4, 4), prior: null, now: NOW });
    expect(r.status).toBe('measuring');
  });

  it('a rate that has not fallen below baseline is ineffective — flagged at exactly the boundary', () => {
    expect(cd.effectOf({ baselineRate: 0.4, under: under(5, 2), prior: null, now: NOW }).status).toBe('ineffective'); // 0.4 == baseline
    expect(cd.effectOf({ baselineRate: 0.4, under: under(5, 3), prior: null, now: NOW }).status).toBe('ineffective'); // worse
  });

  it('a fallen rate is improving, and established only after it holds 7 days', () => {
    const first = cd.effectOf({ baselineRate: 0.4, under: under(5, 1), prior: null, now: NOW });
    expect(first.status).toBe('improving');
    expect(first.firstImprovingAt).toBe(NOW.toISOString());
    const sixDays = cd.effectOf({ baselineRate: 0.4, under: under(6, 1), prior: { status: 'improving', firstImprovingAt: NOW.toISOString() }, now: new Date(NOW.getTime() + 6 * 86_400_000) });
    expect(sixDays.status).toBe('improving');
    const sevenDays = cd.effectOf({ baselineRate: 0.4, under: under(6, 1), prior: { status: 'improving', firstImprovingAt: NOW.toISOString() }, now: new Date(NOW.getTime() + 7 * 86_400_000) });
    expect(sevenDays.status).toBe('established');
  });

  it('slipping back above baseline clears the established clock', () => {
    const r = cd.effectOf({
      baselineRate: 0.4, under: under(8, 4),
      prior: { status: 'established', firstImprovingAt: daysAgo(20) }, now: NOW,
    });
    expect(r.status).toBe('ineffective');
    expect(r.firstImprovingAt).toBeNull();
  });
});

describe('activeConstraintIdsAt — the collector’s evidence stamp', () => {
  const rows = [
    { id: 'c1', scope: 'definition' as const, targetDefinitionId: 'd1', targetStrategyId: null, activatedAt: '2026-11-01T00:00:00.000Z', retiredAt: null },
    { id: 'c2', scope: 'strategy' as const, targetDefinitionId: null, targetStrategyId: 'st1', activatedAt: '2026-11-01T00:00:00.000Z', retiredAt: '2026-11-05T00:00:00.000Z' },
  ];
  it('judges activation and retirement at the run’s own start', () => {
    expect(cd.activeConstraintIdsAt(rows, { definitionId: 'd1', strategyId: 'st1', createdAt: '2026-11-03T00:00:00.000Z' })).toEqual(['c1', 'c2']);
    expect(cd.activeConstraintIdsAt(rows, { definitionId: 'd1', strategyId: 'st1', createdAt: '2026-11-06T00:00:00.000Z' })).toEqual(['c1']);
    expect(cd.activeConstraintIdsAt(rows, { definitionId: 'd1', strategyId: 'st1', createdAt: '2026-10-31T00:00:00.000Z' })).toEqual([]);
    expect(cd.activeConstraintIdsAt(rows, { definitionId: 'dX', strategyId: null, createdAt: '2026-11-03T00:00:00.000Z' })).toEqual([]);
  });
});

describe('the heartbeat surface and the conversational offer', () => {
  it('one signal per draft, fingerprinted by draft id + state', () => {
    const [s] = cd.constraintDraftSignals([{ id: 'cd1', text: '出典は URL と取得時刻を併記すること', targetName: '請求書の送付', createdAt: daysAgo(2), expiresAt: daysAgo(-5) }]);
    expect(s.kind).toBe('constraint_review');
    expect(snap.fingerprintOf(s)).toBe('constraint:cd1:awaiting_review');
    expect(s.label).toContain('請求書の送付');
    expect(snap.HEARTBEAT_KIND_LABEL.constraint_review).toBe('制約ドラフトの審査待ち');
    const first = snap.buildHeartbeatSnapshot([s], { now: NOW, thresholdHours: 24, previousFingerprints: [] });
    expect(first.candidates.map((c: { signalId: string }) => c.signalId)).toEqual(['constraint:cd1:awaiting_review']);
    const second = snap.buildHeartbeatSnapshot([s], { now: NOW, thresholdHours: 24, previousFingerprints: ['constraint:cd1:awaiting_review'] });
    expect(second.candidates).toEqual([]);
  });

  it('the offer is made once, for the first never-offered draft', () => {
    const drafts = [
      { id: 'a', text: 'X の制約', targetName: 'D1', offeredAt: daysAgo(1) },
      { id: 'b', text: 'Y の制約', targetName: 'D2', offeredAt: null },
    ];
    const c = cd.constraintOfferCandidate(drafts);
    expect(c?.id).toBe('b');
    expect(cd.constraintOfferText(c!).length).toBeGreaterThan(0);
    expect(cd.constraintOfferText(c!)).toContain('Y の制約');
    expect(cd.constraintOfferCandidate([{ ...drafts[1], offeredAt: daysAgo(0) }])).toBeNull();
  });
});

// ── The derivation + effect shells over an in-memory store ───────────

type Row = Record<string, unknown>;
interface Store {
  run_outcomes: Row[]; agent_runs: Row[]; agent_actions: Row[]; agent_run_steps: Row[];
  definitions: Row[]; strategies: Row[]; constraint_drafts: Row[];
  definition_revision_candidates: Row[]; planning_constraints: Row[];
}

type Filter = { col: string; op: 'eq' | 'in' | 'gte' | 'lt' | 'like'; val?: unknown };
const matches = (row: Row, f: Filter): boolean => {
  const v = row[f.col];
  switch (f.op) {
    case 'eq': return v === f.val;
    case 'in': return (f.val as unknown[]).includes(v as never);
    case 'gte': return typeof v === 'string' && typeof f.val === 'string' && v >= f.val;
    case 'lt': return typeof v === 'string' && typeof f.val === 'string' && v < f.val;
    case 'like': return typeof v === 'string' && typeof f.val === 'string' && v.startsWith(f.val.replace(/%$/, ''));
  }
};

function fakeAdmin(store: Store) {
  let gen = 0;
  const from = (table: keyof Store) => {
    const rows = store[table];
    let op: 'select' | 'insert' | 'update' = 'select';
    let payload: Row | null = null;
    const filters: Filter[] = [];
    const orders: { col: string; ascending: boolean }[] = [];
    let limitN: number | null = null;
    const applyFilters = (list: Row[]) => list.filter((r) => filters.every((f) => matches(r, f)));
    const run = (): { data: unknown; error: unknown } => {
      if (op === 'select') {
        let out = applyFilters([...rows]);
        for (const o of orders) out.sort((a, b) => String(a[o.col]).localeCompare(String(b[o.col])) * (o.ascending ? 1 : -1));
        if (limitN !== null) out = out.slice(0, limitN);
        return { data: out, error: null };
      }
      if (op === 'insert') {
        const row = payload as Row;
        if (table === 'constraint_drafts') {
          const clash = rows.some((r) => (r.status === 'draft' || r.status === 'awaiting_review')
            && ((row.target_definition_id != null && r.target_definition_id === row.target_definition_id)
              || (row.target_strategy_id != null && r.target_strategy_id === row.target_strategy_id)));
          if (clash) return { data: null, error: { code: '23505', message: 'duplicate key' } };
        }
        rows.push({ id: `gen${++gen}`, created_at: daysAgo(0), updated_at: daysAgo(0), ...row });
        return { data: null, error: null };
      }
      const hit = applyFilters(rows);
      for (const r of hit) Object.assign(r, payload as Row);
      return { data: hit, error: null };
    };
    const q: Record<string, unknown> = {
      select: () => q,
      in: (col: string, val: unknown) => { filters.push({ col, op: 'in', val }); return q; },
      gte: (col: string, val: unknown) => { filters.push({ col, op: 'gte', val }); return q; },
      lt: (col: string, val: unknown) => { filters.push({ col, op: 'lt', val }); return q; },
      like: (col: string, val: unknown) => { filters.push({ col, op: 'like', val }); return q; },
      eq: (col: string, val: unknown) => { filters.push({ col, op: 'eq', val }); return q; },
      order: (col: string, o: { ascending: boolean }) => { orders.push({ col, ascending: o.ascending }); return q; },
      limit: (n: number) => { limitN = n; return q; },
      insert: (r: Row) => { op = 'insert'; payload = r; return q; },
      update: (p: Row) => { op = 'update'; payload = p; return q; },
      maybeSingle: () => Promise.resolve({ data: ((run().data as Row[] | null)?.[0] ?? null) }),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
    };
    return q;
  };
  return { from };
}

const verdictV2 = (gaps: string[], over: Row = {}): Row => ({
  v: 2, result: 'fail', source: 'verifier', model: 'm', gaps, revisions: 1,
  checkedAt: daysAgo(1), outcome: 'completed', reason: 'revisions-exhausted',
  evidence: { verifyStepIdx: 3, artifactIds: [] },
  claims: { total: 2, sourced: 2, stale: 0 }, claimGaps: [], ...over,
});

const GAP = '集計期間の明記がない';
const seedDerivationWorld = (taintedRun: string | null = null): Store => {
  const store: Store = {
    run_outcomes: [], agent_runs: [], agent_actions: [], agent_run_steps: [],
    definitions: [{ id: 'd1', name: '請求書の送付', body: '# 目的\n請求書を送る\n\n# 点検\n- 金額を検算する' }],
    strategies: [], constraint_drafts: [], definition_revision_candidates: [], planning_constraints: [],
  };
  for (let i = 1; i <= 4; i++) {
    store.run_outcomes.push({
      id: `o${i}`, run_id: `r${i}`, activity_space_id: 's1', definition_id: 'd1',
      strategy_id: null, human_signal: 'none', finished_at: daysAgo(i),
    });
    store.agent_runs.push({
      id: `r${i}`, verdict: verdictV2(i <= 3 ? [GAP] : []), finish_detail: { claims: [], unconfirmed: [] },
      created_at: daysAgo(i + 1),
    });
  }
  if (taintedRun) store.agent_run_steps.push({ run_id: taintedRun, title: 'Web 検索: 競合の価格' });
  return store;
};

const phraser = async (clusters: { clusterKey: string }[]) =>
  new Map(clusters.map((c) => [c.clusterKey, '出典は URL と取得時刻を併記すること']));

describe('deriveConstraintDrafts — the tick derivation', () => {
  it('drafts exactly one constraint from a seeded cluster, with its evidence and hashes; a re-run drafts nothing', async () => {
    const store = seedDerivationWorld();
    const admin = fakeAdmin(store) as never;
    const first = await cd.deriveConstraintDrafts(admin, NOW, phraser);
    expect(first).toMatchObject({ drafted: 1, taintedDropped: 0 });
    expect(store.constraint_drafts).toHaveLength(1);
    const draft = store.constraint_drafts[0];
    expect(draft).toMatchObject({
      activity_space_id: 's1', scope: 'definition', target_definition_id: 'd1',
      constraint_text: '出典は URL と取得時刻を併記すること',
      derived_from: 'verifier_gap', status: 'awaiting_review',
    });
    expect(draft.evidence_outcome_ids).toEqual(['o1', 'o2', 'o3']);
    expect(typeof draft.structure_hash).toBe('string');
    expect(typeof draft.binding_hash).toBe('string');
    expect(draft.target_snapshot).toBe('# 目的\n請求書を送る\n\n# 点検\n- 金額を検算する');
    expect(draft.expires_at).toBe(daysAgo(-7));

    const again = await cd.deriveConstraintDrafts(admin, NOW, phraser);
    expect(again.drafted).toBe(0);
    expect(store.constraint_drafts).toHaveLength(1);
  });

  it('a cluster whose evidence run fetched the web is dropped whole — no draft', async () => {
    const store = seedDerivationWorld('r2');
    const admin = fakeAdmin(store) as never;
    const out = await cd.deriveConstraintDrafts(admin, NOW, phraser);
    expect(out.drafted).toBe(0);
    expect(out.taintedDropped).toBeGreaterThanOrEqual(1);
    expect(store.constraint_drafts).toHaveLength(0);
  });

  it('an unphraseable or unvalidatable cluster drafts nothing this tick', async () => {
    const store = seedDerivationWorld();
    const admin = fakeAdmin(store) as never;
    const silent = await cd.deriveConstraintDrafts(admin, NOW, async () => new Map());
    expect(silent.drafted).toBe(0);
    const dirty = await cd.deriveConstraintDrafts(admin, NOW, async (cs: { clusterKey: string }[]) =>
      new Map(cs.map((c) => [c.clusterKey, 'api_key = sk-1234567890abcdef を使うこと'])));
    expect(dirty.drafted).toBe(0);
    expect(store.constraint_drafts).toHaveLength(0);
  });

  it('a draft whose review window lapsed expires on the next pass', async () => {
    const store = seedDerivationWorld();
    store.constraint_drafts.push({
      id: 'old1', activity_space_id: 's1', scope: 'definition', target_definition_id: 'd9',
      target_strategy_id: null, status: 'awaiting_review', expires_at: daysAgo(1),
    });
    const admin = fakeAdmin(store) as never;
    const out = await cd.deriveConstraintDrafts(admin, NOW, phraser);
    expect(out.expired).toBe(1);
    expect(store.constraint_drafts.find((d) => d.id === 'old1')?.status).toBe('expired');
  });
});

describe('evaluateConstraintEffects — the tick measurement', () => {
  const seedEffectWorld = (withSigCount: number): Store => {
    const store = seedDerivationWorld();
    store.planning_constraints.push({
      id: 'c1', activity_space_id: 's1', scope: 'definition', target_definition_id: 'd1',
      target_strategy_id: null, signature: `gap:${cd.normalizeGapText(GAP)}`, derived_from: 'verifier_gap',
      baseline_rate: 0.75, effect_status: 'measuring', effect: {}, status: 'active',
      activated_at: daysAgo(10),
    });
    for (let i = 1; i <= 5; i++) {
      store.run_outcomes.push({
        id: `u${i}`, run_id: `ru${i}`, activity_space_id: 's1', definition_id: 'd1',
        strategy_id: null, human_signal: 'none', finished_at: daysAgo(i),
        evidence: { constraint_ids: ['c1'] },
      });
      store.agent_runs.push({
        id: `ru${i}`, verdict: verdictV2(i <= withSigCount ? [GAP] : []),
        finish_detail: { claims: [], unconfirmed: [] }, created_at: daysAgo(i),
      });
    }
    return store;
  };

  it('flags ineffective when the signature rate has not fallen below baseline', async () => {
    const store = seedEffectWorld(4); // 4/5 = 0.8 ≥ 0.75
    const admin = fakeAdmin(store) as never;
    const out = await cd.evaluateConstraintEffects(admin, NOW);
    expect(out).toMatchObject({ evaluated: 1, ineffective: 1 });
    const c = store.planning_constraints[0];
    expect(c.effect_status).toBe('ineffective');
    // Flagged, never retired: the row is still active.
    expect(c.status).toBe('active');
    expect(c.effect).toMatchObject({ under: 5, withSignature: 4, rate: 0.8 });
  });

  it('marks improving when the rate has fallen, and holds the clock from the first improving reading', async () => {
    const store = seedEffectWorld(1); // 1/5 = 0.2 < 0.75
    const admin = fakeAdmin(store) as never;
    const out = await cd.evaluateConstraintEffects(admin, NOW);
    expect(out).toMatchObject({ evaluated: 1, ineffective: 0 });
    const c = store.planning_constraints[0];
    expect(c.effect_status).toBe('improving');
    expect(c.effect).toMatchObject({ under: 5, withSignature: 1, rate: 0.2, firstImprovingAt: NOW.toISOString() });
  });
});
