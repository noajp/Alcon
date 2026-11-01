import { describe, expect, it } from 'vitest';
import { fontStack } from '@/ActivitySpace/execution/element/officeFonts';

describe('fontStack', () => {
  it('maps Windows Japanese fonts to their Mac equivalents, keeping gothic and mincho apart', () => {
    expect(fontStack('游ゴシック')).toMatch(/^"Yu Gothic", YuGothic, "游ゴシック体", "Hiragino Sans".*sans-serif$/);
    expect(fontStack('Yu Gothic Light')).toMatch(/^"Yu Gothic"/);
    expect(fontStack('游明朝')).toMatch(/^"Yu Mincho".*"Hiragino Mincho ProN".*serif$/);
    expect(fontStack('ＭＳ Ｐゴシック')).toMatch(/^"MS PGothic".*"Hiragino Sans"/);
    expect(fontStack('MS Mincho')).toMatch(/^"MS PMincho".*serif$/);
    expect(fontStack('メイリオ')).toMatch(/^Meiryo/);
  });

  it('gives Latin faces their metric-close substitutes and a Japanese fallback', () => {
    expect(fontStack('Calibri')).toMatch(/^Calibri, Carlito, .*"Hiragino Sans".*sans-serif$/);
    expect(fontStack('Arial Narrow')).toMatch(/^"Arial Narrow", "Helvetica Neue Condensed"/);
    expect(fontStack('Times New Roman')).toMatch(/serif$/);
    expect(fontStack('Arial Black')).toMatch(/^"Arial Black"/);
    expect(fontStack('Garamond')).toMatch(/^Garamond, "EB Garamond".*serif$/);
    expect(fontStack('Century Gothic')).toMatch(/^"Century Gothic", Futura/);
    expect(fontStack('Book Antiqua')).toMatch(/Palatino/);
    expect(fontStack('Montserrat')).toMatch(/^"Montserrat", "Helvetica Neue"/);
    expect(fontStack('Candara')).toMatch(/^"Candara", Optima/);
    expect(fontStack('Fira Code')).toMatch(/^"Fira Code", Consolas.*monospace$/);
  });

  it('keeps an unknown face first, falling back by kind, and gives nothing for no name', () => {
    expect(fontStack('Original Font')).toMatch(/^"Original Font", "Hiragino Sans".*sans-serif$/);
    expect(fontStack('Some Mincho')).toMatch(/^"Some Mincho", "Hiragino Mincho ProN".*serif$/);
    expect(fontStack(null)).toBeNull();
  });
});
