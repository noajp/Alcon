import { describe, expect, it } from 'vitest';

// The web twin of promotion's hashes and drift (AIP/harness/
// promotionModel.ts) must agree with the Deno originals
// (_shared/promotion.ts): one definition of "the tested package" and
// of structural drift, on both sides of the wire.
const deno = await import(new URL('../../supabase/functions/_shared/promotion.ts', import.meta.url).pathname);
const web = await import(new URL('../src/AIP/harness/promotionModel.ts', import.meta.url).pathname);

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

describe('promotionModel (web twin agreement)', () => {
  it('canonical JSON and the structure hash agree', async () => {
    expect(web.canonicalJson({ b: 1, a: { d: [1, 2], c: null } }))
      .toBe('{"a":{"c":null,"d":[1,2]},"b":1}');
    expect(await web.promotionStructureHashWeb('A', 'body'))
      .toBe(await deno.promotionStructureHash('A', 'body'));
    expect(await web.promotionStructureHashWeb(PKG.name, PKG.body))
      .toBe(await deno.promotionStructureHash(PKG.name, PKG.body));
  });

  it('the binding hash agrees, including its order-insensitivity', async () => {
    expect(await web.promotionBindingHashWeb(PKG)).toBe(await deno.promotionBindingHash(PKG));
    const reordered = { ...PKG, body: BODY.replace('- Gmail\n- Slack', '- Slack\n- Gmail') };
    expect(await web.promotionBindingHashWeb(reordered)).toBe(await deno.promotionBindingHash(PKG));
  });

  it('the binding reader agrees', () => {
    expect(web.readPromotionBindingWeb(PKG.binding)).toEqual(deno.readPromotionBinding(PKG.binding));
    expect(web.readPromotionBindingWeb(null)).toEqual(deno.readPromotionBinding(null));
    expect(web.readPromotionBindingWeb({ trigger: { kind: 'schedule', cron: '0 9 * * *' } }))
      .toEqual(deno.readPromotionBinding({ trigger: { kind: 'schedule', cron: '0 9 * * *' } }));
  });

  it('drift agrees: wording is free, structure binds', () => {
    const reworded = BODY.replace('未読を取得する', '未読メールを取得する');
    expect(web.promotionDriftWeb({ name: 'X', body: BODY }, { name: 'X', body: reworded }))
      .toEqual(deno.promotionDrift({ name: 'X', body: BODY }, { name: 'X', body: reworded }));
    const conn = BODY.replace('- Slack', '- Teams');
    const d = web.promotionDriftWeb({ name: 'X', body: BODY }, { name: 'X', body: conn });
    expect(d.drifted).toBe(true);
    expect(d.aspects).toContain('connectors');
    expect(d).toEqual(deno.promotionDrift({ name: 'X', body: BODY }, { name: 'X', body: conn }));
  });

  it('the rehearsal report reader keeps the evidence shape', () => {
    const view = web.readRehearsalReportWeb({
      reads: [{ tool: 'Gmail: list', ok: true }],
      writes: [{ tool: 'Slack: post', valid: false, problem: 'channel が必要です' }],
      outcome: 'write_plan_invalid', at: '2026-11-08T00:00:00Z',
    });
    expect(view.reads).toEqual([{ tool: 'Gmail: list', ok: true, authFailure: false }]);
    expect(view.writes).toEqual([{ tool: 'Slack: post', valid: false, problem: 'channel が必要です' }]);
    expect(view.outcome).toBe('write_plan_invalid');
    expect(web.readRehearsalReportWeb(null)).toEqual({ reads: [], writes: [], outcome: null, at: null });
  });
});
