// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { mergeNote } from '@/Function/notebook/noteMerge';

// Blocks named by letters: each is a paragraph holding that text.
const html = (xs: string[]) => xs.map((x) => (x.startsWith('<') ? x : `<p>${x}</p>`)).join('');
const mergeBlocks = (base: string[], mine: string[], theirs: string[]) => mergeNote(html(base), html(mine), html(theirs));

describe('mergeNote — paragraphs', () => {
  it('keeps loose text and repeated blocks apart', () => {
    expect(mergeNote('<p>a</p>x<p>a</p>', '<p>A</p>x<p>a</p>', '<p>a</p>x<p>a</p><p>b</p>')).toBe('<p>A</p>x<p>a</p><p>b</p>');
  });

  const base = ['h', 'p1', 'p2', 'p3'];
  it('keeps both sides\' edits to different paragraphs', () => {
    expect(mergeBlocks(base, ['h', 'P1', 'p2', 'p3'], ['h', 'p1', 'p2', 'P3'])).toBe(html(['h', 'P1', 'p2', 'P3']));
  });
  it('keeps an insertion on one side and a deletion on the other', () => {
    expect(mergeBlocks(base, ['h', 'p1', 'new', 'p2', 'p3'], ['h', 'p1', 'p2'])).toBe(html(['h', 'p1', 'new', 'p2']));
  });
  it('keeps mine where both changed the same paragraph', () => {
    expect(mergeBlocks(base, ['h', 'mine', 'p2', 'p3'], ['h', 'theirs', 'p2', 'p3'])).toBe(html(['h', 'mine', 'p2', 'p3']));
  });
  it('adds both sides\' paragraphs appended at the end', () => {
    expect(mergeBlocks(['a'], ['a', 'm'], ['a', 't'])).toBe(html(['a', 'm', 't']));
    expect(mergeBlocks(['a', 'z'], ['a', 'm', 'z'], ['a', 'z', 't'])).toBe(html(['a', 'm', 'z', 't']));
  });
  it('handles empty bases and repeated blank paragraphs', () => {
    expect(mergeBlocks([], ['m'], [])).toBe(html(['m']));
    expect(mergeBlocks([], [], ['t'])).toBe(html(['t']));
    const blank = '<br>';
    expect(mergeBlocks(['a', blank, 'b', blank, 'c'], ['A', blank, 'b', blank, 'c'], ['a', blank, 'b', blank, 'C'])).toBe(html(['A', blank, 'b', blank, 'C']));
  });
});

describe('mergeNote', () => {
  it('short-circuits when one side did nothing', () => {
    expect(mergeNote('<p>a</p>', '<p>a</p>', '<p>b</p>')).toBe('<p>b</p>');
    expect(mergeNote('<p>a</p>', '<p>m</p>', '<p>a</p>')).toBe('<p>m</p>');
  });
  it('merges two people\'s paragraphs in real HTML', () => {
    const base = '<h1>議事録</h1><p>決定事項</p><p>次回まで</p>';
    const mine = '<h1>議事録</h1><p>決定事項：料金改定</p><p>次回まで</p>';
    const theirs = '<h1>議事録</h1><p>決定事項</p><p>次回まで：見積もり</p><ul><li>担当 中野</li></ul>';
    expect(mergeNote(base, mine, theirs)).toBe('<h1>議事録</h1><p>決定事項：料金改定</p><p>次回まで：見積もり</p><ul><li>担当 中野</li></ul>');
  });
});
