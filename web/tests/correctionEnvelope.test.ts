import { describe, expect, it } from 'vitest';

// The correction envelope (back-half B3): a sent-back finish carries
// the unit, the verdict, the reason, the evidence and the scope —
// and the rules that judge corrections afterwards (the unit-return
// rule, the exhausted unit's plan-level signal) are pure decisions
// over records, never over a model's text.
const env = await import(new URL('../../supabase/functions/_shared/correctionEnvelope.ts', import.meta.url).pathname);
const loop = await import(new URL('../../supabase/functions/_shared/agentLoop.ts', import.meta.url).pathname);
const advance = await import(new URL('../../supabase/functions/run-agent/advance.ts', import.meta.url).pathname);

type Envelope = ReturnType<typeof env.correctionEnvelopeOf>;

const verifierReturn = (over: Record<string, unknown> = {}): Envelope => env.correctionEnvelopeOf({
  unit: { id: 'e1', title: '競合を調べる' },
  source: 'verifier',
  reason: ['件数が足りない', '比較表がない'],
  evidence: { verifyStepIdx: 12, artifactIds: ['a1', 'a2'] },
  attempt: 1,
  ...over,
});

describe('correctionEnvelopeOf', () => {
  it('assembles the five things a return must carry', () => {
    const e = verifierReturn();
    expect(e.unit).toEqual({ kind: 'element', id: 'e1', title: '競合を調べる' });
    expect(e.verdict).toBe('fail');
    expect(e.source).toBe('verifier');
    expect(e.reason).toEqual(['件数が足りない', '比較表がない']);
    expect(e.evidence).toEqual({ verifyStepIdx: 12, artifactIds: ['a1', 'a2'] });
    expect(e.scope).toContain('この Element の成果だけ');
    // The cap is the loop's: a run gets MAX_REVISIONS returns, so its
    // finishes number one more.
    expect(e.attempt).toBe(1);
    expect(e.maxAttempts).toBe(loop.MAX_REVISIONS + 1);
  });

  it('caps the reasons at five, as the verdict record caps its gaps', () => {
    const e = verifierReturn({ reason: ['1', '2', '3', '4', '5', '6', '7'] });
    expect(e.reason).toEqual(['1', '2', '3', '4', '5']);
  });
});

describe('formatCorrectionEnvelope', () => {
  it('tells the agent the unit, the verdict, the reasons, the evidence and the scope', () => {
    const text = env.formatCorrectionEnvelope(verifierReturn());
    expect(text).toContain('UNIT: Element「競合を調べる」（id: e1）');
    expect(text).toContain('VERDICT: fail（1 回目の完了報告 / 上限 3 回）');
    expect(text).toContain('- 件数が足りない');
    expect(text).toContain('- 比較表がない');
    expect(text).toContain('EVIDENCE: 検証ステップ #12');
    expect(text).toContain('成果物 2 件');
    expect(text).toContain('SCOPE: 直すのはこの Element の成果だけです');
    expect(text).toContain('隣接する Element');
    // The reporting contract survives the new shape: facts in claims,
    // the unconfirmable in unconfirmed.
    expect(text).toContain('claims');
    expect(text).toContain('unconfirmed');
  });

  it('words a mechanical return as what it is — no step, no artifacts', () => {
    const text = env.formatCorrectionEnvelope(env.correctionEnvelopeOf({
      unit: { id: 'e2', title: '価格を調べる' }, source: 'mechanical',
      reason: ['主張「価格は 3,000 円」に出典がありません'],
      evidence: { verifyStepIdx: null, artifactIds: [] }, attempt: 2,
    }));
    expect(text).toContain('機械検査の指摘');
    expect(text).toContain('EVIDENCE: 機械検査による差し戻しのため検証ステップはありません');
    expect(text).toContain('VERDICT: fail（2 回目の完了報告 / 上限 3 回）');
  });
});

describe('parseCorrectionEnvelope', () => {
  it('round-trips an assembled envelope (and through JSON)', () => {
    const e = verifierReturn();
    expect(env.parseCorrectionEnvelope(e)).toEqual(e);
    expect(env.parseCorrectionEnvelope(JSON.parse(JSON.stringify(e)))).toEqual(e);
  });

  it('refuses anything that is not exactly an envelope', () => {
    const e = verifierReturn();
    const bad: unknown[] = [
      null, undefined, 'fail', [], {},
      { ...e, v: 2 },
      { ...e, verdict: 'pass' },
      { ...e, source: 'agent' },
      { ...e, unit: { kind: 'strategy', id: 'e1', title: 'x' } },
      { ...e, unit: { kind: 'element', id: '', title: 'x' } },
      { ...e, reason: ['1', '2', '3', '4', '5', '6'] },
      { ...e, reason: ['ok', 4] },
      { ...e, evidence: { verifyStepIdx: -1, artifactIds: [] } },
      { ...e, evidence: { verifyStepIdx: 1.5, artifactIds: [] } },
      { ...e, evidence: { verifyStepIdx: null, artifactIds: [1] } },
      { ...e, scope: '' },
      { ...e, attempt: 0 },
      { ...e, attempt: 4 },
      { ...e, maxAttempts: 1 },
    ];
    for (const b of bad) expect(env.parseCorrectionEnvelope(b)).toBeNull();
  });

  it('reads a history tolerantly: the parseable entries, in order', () => {
    const e1 = verifierReturn();
    const e2 = verifierReturn({ attempt: 2 });
    expect(env.parseCorrectionHistory([e1, { nope: true }, e2, null])).toEqual([e1, e2]);
    expect(env.parseCorrectionHistory(null)).toEqual([]);
    expect(env.parseCorrectionHistory('x')).toEqual([]);
  });
});

describe('elementInputsCanonical', () => {
  const base = { title: '調べる', description: '10 件以上', definitionBody: '定義の本文' };

  it('is stable for the same inputs, and moves with any of them', () => {
    expect(env.elementInputsCanonical(base)).toBe(env.elementInputsCanonical({ ...base }));
    expect(env.elementInputsCanonical({ ...base, title: '比べる' })).not.toBe(env.elementInputsCanonical(base));
    expect(env.elementInputsCanonical({ ...base, description: '5 件以上' })).not.toBe(env.elementInputsCanonical(base));
    expect(env.elementInputsCanonical({ ...base, definitionBody: '直した定義' })).not.toBe(env.elementInputsCanonical(base));
    expect(env.elementInputsCanonical({ ...base, definitionBody: null })).not.toBe(env.elementInputsCanonical(base));
  });

  it('treats a missing description as the empty one', () => {
    expect(env.elementInputsCanonical({ ...base, description: null }))
      .toBe(env.elementInputsCanonical({ ...base, description: '' }));
  });
});

describe('standingSkipReason — the unit-return rule', () => {
  const pass = { verdict: { result: 'pass' as const, inputsHash: 'h1' }, readingsLanded: false, currentInputsHash: 'h1' };

  it('skips a standing pass over unchanged inputs', () => {
    expect(env.standingSkipReason(pass)).toBe('verdict-pass');
  });

  it('skips work a person accepted — readings landed — even without a checked pass', () => {
    expect(env.standingSkipReason({
      verdict: { result: 'unchecked', inputsHash: 'h1' }, readingsLanded: true, currentInputsHash: 'h1',
    })).toBe('readings-landed');
    expect(env.standingSkipReason({
      verdict: { result: 'fail', inputsHash: 'h1' }, readingsLanded: true, currentInputsHash: 'h1',
    })).toBe('readings-landed');
  });

  it('runs it again when the inputs changed since the pass', () => {
    expect(env.standingSkipReason({ ...pass, currentInputsHash: 'h2' })).toBeNull();
    expect(env.standingSkipReason({
      verdict: { result: 'unchecked', inputsHash: 'h1' }, readingsLanded: true, currentInputsHash: 'h2',
    })).toBeNull();
  });

  it('runs it when sameness cannot be proven — an old record seals no hash', () => {
    expect(env.standingSkipReason({
      verdict: { result: 'pass' }, readingsLanded: false, currentInputsHash: 'h1',
    })).toBeNull();
    expect(env.standingSkipReason({ ...pass, currentInputsHash: null })).toBeNull();
  });

  it('runs it when nothing stands: no verdict, a fail, an unchecked nothing', () => {
    expect(env.standingSkipReason({ verdict: null, readingsLanded: true, currentInputsHash: 'h1' })).toBeNull();
    expect(env.standingSkipReason({
      verdict: { result: 'fail', inputsHash: 'h1' }, readingsLanded: false, currentInputsHash: 'h1',
    })).toBeNull();
    expect(env.standingSkipReason({
      verdict: { result: 'unchecked', inputsHash: 'h1' }, readingsLanded: false, currentInputsHash: 'h1',
    })).toBeNull();
  });

  it('the pass outranks the readings when both stand', () => {
    expect(env.standingSkipReason({ ...pass, readingsLanded: true })).toBe('verdict-pass');
  });
});

describe('correctionExhaustedSignals — the plan-level wait', () => {
  const fact = (over: Record<string, unknown> = {}) => ({
    runId: 'r1', elementId: 'e1', elementTitle: '競合を調べる',
    verdict: { result: 'fail', reason: 'revisions-exhausted', gaps: ['件数が足りない', '比較表がない', '三つ目'] },
    finishedAt: '2026-11-08T01:00:00Z', updatedAt: '2026-11-08T02:00:00Z',
    ...over,
  });

  it('raises exactly one signal per exhausted run, naming the Element and the standing gaps', () => {
    const out = env.correctionExhaustedSignals([fact(), fact({ runId: 'r2' })]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ kind: 'correction_exhausted', id: 'r1', since: '2026-11-08T01:00:00Z' });
    expect(out[0].label).toContain('競合を調べる');
    expect(out[0].label).toContain('件数が足りない');
    expect(out[0].label).not.toContain('三つ目');
    expect(out[0].place).toContain('Strategy');
  });

  it('raises nothing for a pass, an unchecked finish, or a run with no Element', () => {
    expect(env.correctionExhaustedSignals([fact({ verdict: { result: 'pass', reason: null, gaps: [] } })])).toEqual([]);
    expect(env.correctionExhaustedSignals([fact({ verdict: { result: 'unchecked', reason: 'verify-unavailable', gaps: [] } })])).toEqual([]);
    expect(env.correctionExhaustedSignals([fact({ verdict: null })])).toEqual([]);
    expect(env.correctionExhaustedSignals([fact({ elementId: null })])).toEqual([]);
  });
});

describe('the acceptance fixture — four siblings, one fails', () => {
  it('a re-dispatch touches exactly the failed one', () => {
    // Four sibling Elements were dispatched together. Three passed
    // over the inputs they still carry; one failed its verify. The
    // batch is re-dispatched (their prerequisite finished again):
    // the dispatch decision, fed the standing records, starts only
    // the unit that never passed — the three correct ones are not
    // re-proved.
    const siblings = [
      { id: 's1', record: { verdict: { result: 'pass', inputsHash: 'h-s1' }, readingsLanded: false, currentInputsHash: 'h-s1' } },
      { id: 's2', record: { verdict: { result: 'pass', inputsHash: 'h-s2' }, readingsLanded: true, currentInputsHash: 'h-s2' } },
      { id: 's3', record: { verdict: { result: 'pass', inputsHash: 'h-s3' }, readingsLanded: false, currentInputsHash: 'h-s3' } },
      { id: 's4', record: { verdict: { result: 'fail', inputsHash: 'h-s4' }, readingsLanded: false, currentInputsHash: 'h-s4' } },
    ];
    const next = advance.readyDownstream({
      doneId: 'root',
      edges: siblings.map((s) => ({ from_element: 'root', to_element: s.id })),
      candidates: siblings.map((s) => ({
        id: s.id, status: 'todo', ai: true, openRun: false,
        standingPass: env.standingSkipReason(s.record) !== null,
      })),
      statusOf: new Map(),
    });
    expect(next).toEqual(['s4']);
  });

  it('and the passed one whose inputs changed is re-run with it', () => {
    const siblings = [
      { id: 's1', record: { verdict: { result: 'pass', inputsHash: 'h-old' }, readingsLanded: false, currentInputsHash: 'h-new' } },
      { id: 's4', record: { verdict: { result: 'fail', inputsHash: 'h-s4' }, readingsLanded: false, currentInputsHash: 'h-s4' } },
    ];
    const next = advance.readyDownstream({
      doneId: 'root',
      edges: siblings.map((s) => ({ from_element: 'root', to_element: s.id })),
      candidates: siblings.map((s) => ({
        id: s.id, status: 'todo', ai: true, openRun: false,
        standingPass: env.standingSkipReason(s.record) !== null,
      })),
      statusOf: new Map(),
    });
    expect(next).toEqual(['s1', 's4']);
  });
});
