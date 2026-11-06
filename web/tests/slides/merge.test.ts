import { describe, expect, it } from 'vitest';
import { mergeFiles, sameFile } from '@/ActivitySpace/artifacts/slides/kata/model/merge';
import type { KataFile, Slide } from '@/ActivitySpace/artifacts/slides/kata/model/types';

const slide = (id: string, title = id, extra: Partial<Slide> = {}): Slide => ({ id, title, layout: 'statement', content: { statement: { lead: '', figure: '' } }, ...extra });
const file = (slides: Slide[], extra: Partial<KataFile> = {}): KataFile => ({
  id: 'd1', name: 'Deck', folderId: 'f', deck: { title: 'Deck', storyline: 'scr', slides }, mix: { selected: ['forest'], pins: {}, offset: 0 }, chat: [], updatedAt: 1, ...extra,
});
const titles = (f: KataFile) => f.deck.slides.map((s) => s.title);

describe('mergeFiles', () => {
  const base = file([slide('a'), slide('b'), slide('c')]);

  it('keeps both sides\' changes to different pages', () => {
    const mine = file([slide('a', 'A mine'), slide('b'), slide('c')]);
    const theirs = file([slide('a'), slide('b'), slide('c', 'C theirs')]);
    const { file: out, clashes } = mergeFiles(base, mine, theirs);
    expect(titles(out)).toEqual(['A mine', 'b', 'C theirs']);
    expect(clashes).toEqual([]);
  });

  it('keeps mine on a page both changed, and names it', () => {
    const mine = file([slide('a', 'A mine'), slide('b'), slide('c')]);
    const theirs = file([slide('a', 'A theirs'), slide('b'), slide('c')]);
    const { file: out, clashes } = mergeFiles(base, mine, theirs);
    expect(titles(out)).toEqual(['A mine', 'b', 'c']);
    expect(clashes).toEqual(['A mine']);
  });

  it('places pages each side added after the page before them', () => {
    const mine = file([slide('a'), slide('m'), slide('b'), slide('c')]);
    const theirs = file([slide('a'), slide('b'), slide('c'), slide('t')]);
    expect(titles(mergeFiles(base, mine, theirs).file)).toEqual(['a', 'm', 'b', 'c', 't']);
  });

  it('follows the side that reordered, and drops pages either side deleted unless the other edited them', () => {
    const mine = file([slide('c'), slide('a'), slide('b')]);
    const theirs = file([slide('a'), slide('c')]);
    expect(titles(mergeFiles(base, mine, theirs).file)).toEqual(['c', 'a']);
    const edited = file([slide('a'), slide('b', 'B edited'), slide('c')]);
    expect(titles(mergeFiles(base, edited, theirs).file)).toEqual(['a', 'B edited', 'c']);
  });

  it('takes deck and file fields from the side that changed them, and joins the chat', () => {
    const mine = file(base.deck.slides, { name: 'Mine', chat: [{ id: 'm1', from: 'me', text: 'hi', at: 2 }] });
    const theirs = file(base.deck.slides, { deck: { ...base.deck, title: 'Theirs' }, chat: [{ id: 't1', from: 'kata', text: 'yo', at: 1 }] });
    const { file: out } = mergeFiles(base, mine, theirs);
    expect(out.name).toBe('Mine');
    expect(out.deck.title).toBe('Theirs');
    expect(out.chat.map((c) => c.id)).toEqual(['t1', 'm1']);
  });

  it('sees content, not key order (the database reorders keys)', () => {
    const reordered = JSON.parse(JSON.stringify({ content: base.deck.slides[0].content, layout: 'statement', title: 'a', id: 'a' })) as Slide;
    const mine = file([slide('a', 'A mine'), slide('b'), slide('c')]);
    const theirs = file([reordered, slide('b'), slide('c')]);
    const { file: out, clashes } = mergeFiles(base, mine, theirs);
    expect(clashes).toEqual([]);
    expect(titles(out)).toEqual(['A mine', 'b', 'c']);
    expect(sameFile(file([reordered, slide('b'), slide('c')]), base)).toBe(true);
  });
});
