import { describe, expect, it } from 'vitest';

// The promotion testing stage's pure evaluation (_shared/promotionTest.ts):
// the static gate and connector matching a package must pass before its
// rehearsal, in the design's order — validity first, then the floor,
// then the connections.
const test = await import(new URL('../../supabase/functions/_shared/promotionTest.ts', import.meta.url).pathname);

const BODY = [
  '# 目的', '毎朝の問い合わせを仕分けて担当に渡す。', '',
  '# 進め方', '1. 未読を取得する', '2. 分類して担当を決める', '',
  '# 止める条件', '- 費用 $2 まで', '',
  '# 点検', '- 分類が一次情報と一致しているか', '',
  '# 使うコネクタ', '- Gmail', '- Slack', '',
].join('\n');

const pkg = (body: string = BODY) => ({
  name: '問い合わせ仕分け', body,
  binding: { objectId: 'obj-1', titleTemplate: 't', descriptionTemplate: '', trigger: null },
});

describe('evaluatePromotionPackage', () => {
  it('a valid package with its connectors connected passes clean', () => {
    const out = test.evaluatePromotionPackage(pkg(), ['Gmail', 'Slack']);
    expect(out.errors).toEqual([]);
    expect(out.missing).toEqual([]);
  });

  it('static errors and missing connectors are reported apart', () => {
    const out = test.evaluatePromotionPackage(pkg(BODY.replace('毎朝の問い合わせを仕分けて担当に渡す。\n', '')), ['Gmail']);
    expect(out.errors.some((e: string) => e.includes('目的がありません'))).toBe(true);
    expect(out.missing).toEqual(['Slack']);
  });

  it('the promotion floor applies even when checkHarness is satisfied', () => {
    const out = test.evaluatePromotionPackage(pkg(BODY.replace('- 費用 $2 まで\n', '')), ['Gmail', 'Slack']);
    expect(out.errors.some((e: string) => e.includes('費用の数値上限'))).toBe(true);
    expect(out.missing).toEqual([]);
  });

  it('preset display names count as connected', () => {
    // connectedConnectorNames adds preset display names beside row names;
    // the evaluation itself folds, so either spelling satisfies it.
    const out = test.evaluatePromotionPackage(pkg(), ['gmail', 'SLACK']);
    expect(out.missing).toEqual([]);
  });
});
