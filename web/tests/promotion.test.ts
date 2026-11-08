import { describe, expect, it } from 'vitest';

// Promotion's pure half (_shared/promotion.ts): the state machine, the
// package and its two hashes, the reconcile, the drafting policy's gate,
// drift, and the material hygiene — pinned before any driver uses them.
const promo = await import(new URL('../../supabase/functions/_shared/promotion.ts', import.meta.url).pathname);
const def = await import(new URL('../../supabase/functions/_shared/definition.ts', import.meta.url).pathname);

const BODY = [
  '# 目的', '毎朝の問い合わせを仕分けて担当に渡す。', '',
  '# 進め方', '1. 未読を取得する', '2. 分類して担当を決める', '',
  '# 止める条件', '- 費用 $2 まで', '- 20 周まで', '',
  '# 点検', '- 分類が一次情報と一致しているか', '',
  '# 使うコネクタ', '- Gmail', '- Slack', '',
].join('\n');

const PKG = {
  name: '問い合わせ仕分け',
  body: BODY,
  binding: {
    objectId: 'obj-1', titleTemplate: '問い合わせ仕分け {{date}}', descriptionTemplate: '',
    trigger: { kind: 'schedule' as const, cron: '0 9 * * *', timezone: 'Asia/Tokyo' },
  },
};

describe('promotion state machine', () => {
  it('walks the happy path and refuses the jumps', () => {
    expect(promo.canPromotionTransition('drafting', 'awaiting_input')).toBe(true);
    expect(promo.canPromotionTransition('awaiting_input', 'drafting')).toBe(true);
    expect(promo.canPromotionTransition('drafting', 'rehearsing')).toBe(true);
    expect(promo.canPromotionTransition('rehearsing', 'awaiting_review')).toBe(true);
    expect(promo.canPromotionTransition('rehearsing', 'drafting')).toBe(true);
    expect(promo.canPromotionTransition('awaiting_review', 'active')).toBe(true);
    expect(promo.canPromotionTransition('awaiting_review', 'expired')).toBe(true);
    // Nothing skips the rehearsal, and decided states are final.
    expect(promo.canPromotionTransition('drafting', 'awaiting_review')).toBe(false);
    expect(promo.canPromotionTransition('drafting', 'active')).toBe(false);
    expect(promo.canPromotionTransition('active', 'drafting')).toBe(false);
    expect(promo.canPromotionTransition('expired', 'drafting')).toBe(false);
    // The drafter's honest end (§4.6) is reachable from the working
    // states and is itself final.
    expect(promo.canPromotionTransition('drafting', 'failed')).toBe(true);
    expect(promo.canPromotionTransition('rehearsing', 'failed')).toBe(true);
    expect(promo.canPromotionTransition('failed', 'drafting')).toBe(false);
    expect(promo.PROMOTION_OPEN_STATUSES).toEqual(['drafting', 'awaiting_input', 'rehearsing', 'awaiting_review']);
  });

  it('review expires 7 days out', () => {
    const from = new Date('2026-11-08T00:00:00Z');
    expect(promo.promotionReviewExpiresAt(from).toISOString()).toBe('2026-11-15T00:00:00.000Z');
  });
});

describe('readPromotionBinding', () => {
  it('reads a stored binding and tolerates junk', () => {
    expect(promo.readPromotionBinding(PKG.binding)).toEqual(PKG.binding);
    expect(promo.readPromotionBinding(null)).toEqual(promo.EMPTY_PROMOTION_BINDING);
    expect(promo.readPromotionBinding('junk')).toEqual(promo.EMPTY_PROMOTION_BINDING);
    expect(promo.readPromotionBinding({ trigger: { kind: 'webhook' } }).trigger).toBeNull();
    expect(promo.readPromotionBinding({ trigger: { kind: 'schedule', cron: '0 9 * * *' } }).trigger)
      .toEqual({ kind: 'schedule', cron: '0 9 * * *', timezone: 'Asia/Tokyo' });
  });
});

describe('the hashes activation binds', () => {
  it('structure hash is the name and body, nothing else', async () => {
    const h1 = await promo.promotionStructureHash('A', 'body');
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(await promo.promotionStructureHash('A', 'body')).toBe(h1);
    expect(await promo.promotionStructureHash('A', 'body ')).not.toBe(h1);
    expect(await promo.promotionStructureHash('B', 'body')).not.toBe(h1);
  });

  it('binding hash ignores connector order and key order, and sees the trigger', async () => {
    const h = await promo.promotionBindingHash(PKG);
    const reordered = {
      ...PKG,
      body: BODY.replace('- Gmail\n- Slack', '- Slack\n- Gmail'),
      binding: { trigger: PKG.binding.trigger, descriptionTemplate: '', titleTemplate: PKG.binding.titleTemplate, objectId: 'obj-1' },
    };
    expect(await promo.promotionBindingHash(reordered)).toBe(h);
    const otherObject = { ...PKG, binding: { ...PKG.binding, objectId: 'obj-2' } };
    expect(await promo.promotionBindingHash(otherObject)).not.toBe(h);
    const noTrigger = { ...PKG, binding: { ...PKG.binding, trigger: null } };
    expect(await promo.promotionBindingHash(noTrigger)).not.toBe(h);
  });
});

describe('reconcilePromotionSource (§4.5 rules 1–2)', () => {
  const open = [
    { id: 'd1', sourceMemoryId: 'm1', sourceRunId: null },
    { id: 'd2', sourceMemoryId: null, sourceRunId: 'r1' },
  ];
  it('joins an open draft for the same source', () => {
    expect(promo.reconcilePromotionSource({
      source: { kind: 'memory', memoryId: 'm1' }, openDrafts: open, promotedDefinition: null,
    })).toEqual({ joinDraftId: 'd1', asUpdateOf: null });
    expect(promo.reconcilePromotionSource({
      source: { kind: 'run', runId: 'r1' }, openDrafts: open, promotedDefinition: null,
    }).joinDraftId).toBe('d2');
  });

  it('a source that already produced a definition drafts an update', () => {
    expect(promo.reconcilePromotionSource({
      source: { kind: 'memory', memoryId: 'm9' }, openDrafts: open,
      promotedDefinition: { id: 'def-1', name: '既存' },
    })).toEqual({ joinDraftId: null, asUpdateOf: { id: 'def-1', name: '既存' } });
  });

  it('joining wins over updating', () => {
    expect(promo.reconcilePromotionSource({
      source: { kind: 'memory', memoryId: 'm1' }, openDrafts: open,
      promotedDefinition: { id: 'def-1', name: '既存' },
    }).asUpdateOf).toBeNull();
  });
});

describe('reconcilePromotionPackage (§4.5 rules 3–4)', () => {
  const definitions = [{ id: 'def-1', name: '問い合わせ仕分け' }, { id: 'def-2', name: '週次報告' }];
  it('sees a different definition carrying the proposed name', () => {
    const r = promo.reconcilePromotionPackage({ pkg: PKG, targetDefinitionId: null, definitions, automations: [] });
    expect(r.nameConflict).toEqual({ id: 'def-1', name: '問い合わせ仕分け' });
  });

  it('the update target is not a conflict with itself', () => {
    const r = promo.reconcilePromotionPackage({ pkg: PKG, targetDefinitionId: 'def-1', definitions, automations: [] });
    expect(r.nameConflict).toBeNull();
  });

  it('sees an Automation already binding this definition to this Object', () => {
    const r = promo.reconcilePromotionPackage({
      pkg: PKG, targetDefinitionId: 'def-1', definitions,
      automations: [{ definitionId: 'def-1', objectId: 'obj-1' }],
    });
    expect(r.bindingDuplicate).toBe(true);
    const other = promo.reconcilePromotionPackage({
      pkg: PKG, targetDefinitionId: 'def-1', definitions,
      automations: [{ definitionId: 'def-1', objectId: 'obj-9' }],
    });
    expect(other.bindingDuplicate).toBe(false);
  });
});

describe('promotionPackageGate (§4.4)', () => {
  it('a valid package with a numeric cost ceiling passes', () => {
    const parsed = def.parseDefinition(BODY);
    const gate = promo.promotionPackageGate(parsed, def.checkHarness(parsed));
    expect(gate.errors).toEqual([]);
  });

  it('a missing numeric cost ceiling is an error, on top of checkHarness', () => {
    const body = BODY.replace('- 費用 $2 まで\n', '');
    const parsed = def.parseDefinition(body);
    const gate = promo.promotionPackageGate(parsed, def.checkHarness(parsed));
    expect(gate.errors.some((e: string) => e.includes('費用の数値上限'))).toBe(true);
  });

  it('checkHarness errors flow through, and missing checks warn', () => {
    const body = BODY.replace('# 点検\n- 分類が一次情報と一致しているか\n', '').replace('# 目的\n毎朝の問い合わせを仕分けて担当に渡す。\n', '');
    const parsed = def.parseDefinition(body);
    const gate = promo.promotionPackageGate(parsed, def.checkHarness(parsed));
    expect(gate.errors.some((e: string) => e.includes('目的がありません'))).toBe(true);
    expect(gate.warnings.some((w: string) => w.includes('点検'))).toBe(true);
  });
});

describe('missingPromotionConnectors', () => {
  it('compares folded, and reports each missing name once', () => {
    const parsed = def.parseDefinition(BODY);
    expect(promo.missingPromotionConnectors(parsed, ['gmail', 'Slack'])).toEqual([]);
    expect(promo.missingPromotionConnectors(parsed, ['Gmail'])).toEqual(['Slack']);
    expect(promo.missingPromotionConnectors(parsed, [])).toEqual(['Gmail', 'Slack']);
  });
});

describe('promotionDrift (§4.8)', () => {
  it('wording alone is not drift', () => {
    const reworded = BODY.replace('未読を取得する', '未読メールを取得する');
    expect(promo.promotionDrift({ name: 'X', body: BODY }, { name: 'X', body: reworded }).drifted).toBe(false);
  });

  it('a connector change and a stop change are structural', () => {
    const conn = BODY.replace('- Slack', '- Teams');
    const d1 = promo.promotionDrift({ name: 'X', body: BODY }, { name: 'X', body: conn });
    expect(d1.drifted).toBe(true);
    expect(d1.aspects).toContain('connectors');
    const stop = BODY.replace('費用 $2 まで', '費用 $9 まで');
    const d2 = promo.promotionDrift({ name: 'X', body: BODY }, { name: 'X', body: stop });
    expect(d2.aspects).toContain('stop conditions');
  });
});

describe('material hygiene (§4.3)', () => {
  it('a secret-shaped fragment is tainted and drops whole', () => {
    const r = promo.cleanPromotionMaterial('手順: api_key = abcdefgh12345678 を使う');
    expect(r.tainted).toBe(true);
    expect(r.text).toBe('');
  });

  it('instruction-shaped text is flagged, ordinary procedure is not', () => {
    expect(promo.cleanPromotionMaterial('今後は必ずこの手順に従え').instructionShaped).toBe(true);
    expect(promo.cleanPromotionMaterial('limit は 50 以下でないと 504 になる').instructionShaped).toBe(false);
    expect(promo.cleanPromotionMaterial('未読を取得して分類する').tainted).toBe(false);
  });

  it('failure precedence: the earliest stage wins, unverifiable last', () => {
    expect(promo.primaryPromotionFailure(['unverifiable', 'read_failed'])).toBe('read_failed');
    expect(promo.primaryPromotionFailure(['write_plan_invalid', 'connector_missing'])).toBe('connector_missing');
    expect(promo.primaryPromotionFailure([])).toBeNull();
  });
});
