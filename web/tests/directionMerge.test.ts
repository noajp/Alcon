import { describe, expect, it } from 'vitest';
import { mergeAcceptance, sameAcceptance } from '@/alcon/element/directionMerge';
import type { AcceptanceLine } from '@/types/database';

const line = (id: string, text = id): AcceptanceLine => ({ id, text });

// The whole point of the merge: a save writes the entire jsonb column, so what
// this tab sends has to be its own changes applied to the list the server has
// now — not the list this tab happens to be holding.
describe('merging acceptance criteria', () => {
  const base = [line('a'), line('b')];

  it('keeps a criterion somebody else added while this tab was editing', () => {
    const mine = [line('a', 'a edited'), line('b')];
    const theirs = [line('a'), line('b'), line('c')];
    expect(mergeAcceptance(base, mine, theirs)).toEqual([line('a', 'a edited'), line('b'), line('c')]);
  });

  it('still removes a criterion deleted here', () => {
    const mine = [line('a')];
    const theirs = [line('a'), line('b'), line('c')];
    expect(mergeAcceptance(base, mine, theirs)).toEqual([line('a'), line('c')]);
  });

  it('adds a new criterion after the one it was typed under', () => {
    const mine = [line('a'), line('new'), line('b')];
    const theirs = [line('a'), line('b'), line('c')];
    expect(mergeAcceptance(base, mine, theirs)).toEqual([line('a'), line('new'), line('b'), line('c')]);
  });

  it('puts a criterion typed at the top at the top', () => {
    const mine = [line('new'), line('a'), line('b')];
    expect(mergeAcceptance(base, mine, [line('a'), line('b')])).toEqual([line('new'), line('a'), line('b')]);
  });

  it('keeps a new criterion whose neighbour was deleted on the other side', () => {
    const mine = [line('a'), line('b'), line('new')];
    expect(mergeAcceptance(base, mine, [line('a')])).toEqual([line('a'), line('new')]);
  });

  it('takes the other side of a row this tab did not touch', () => {
    const mine = [line('a'), line('b')];
    const theirs = [line('a', 'a rewritten there'), line('b')];
    expect(mergeAcceptance(base, mine, theirs)).toEqual(theirs);
  });

  it('lets an edit here win when both sides changed the same row', () => {
    const mine = [line('a', 'mine'), line('b')];
    const theirs = [line('a', 'theirs'), line('b')];
    expect(mergeAcceptance(base, mine, theirs)).toEqual([line('a', 'mine'), line('b')]);
  });

  it('does not resurrect a row deleted on the other side', () => {
    const mine = [line('a'), line('b')];
    expect(mergeAcceptance(base, mine, [line('a')])).toEqual([line('a')]);
  });

  it('is a no-op when nothing changed anywhere', () => {
    expect(mergeAcceptance(base, base, base)).toEqual(base);
  });

  it('keeps both writers when each edits a different row', () => {
    const mine = [line('a', 'mine on a'), line('b')];
    const theirs = [line('a'), line('b', 'theirs on b')];
    expect(mergeAcceptance(base, mine, theirs)).toEqual([line('a', 'mine on a'), line('b', 'theirs on b')]);
  });
});

describe('comparing two criteria lists', () => {
  it('is false when an id changes even though the text does not', () => {
    expect(sameAcceptance([line('a', 'x')], [line('b', 'x')])).toBe(false);
  });
  it('is true only for the same lines in the same order', () => {
    expect(sameAcceptance([line('a'), line('b')], [line('a'), line('b')])).toBe(true);
    expect(sameAcceptance([line('a'), line('b')], [line('b'), line('a')])).toBe(false);
  });
});

// A client from before ids existed reads the list fine (it takes `.text`) and
// writes it back as plain strings, so every id is regenerated from text and
// position. Without lining the two lists up, this tab's rows would look both
// deleted and added, and its edit would go nowhere.
describe('a list that came back from a client without ids', () => {
  const base = [line('u1', 'a'), line('u2', 'b')];

  it('lands this tab\'s edit on the row the other client renamed, and gives the ids back', () => {
    const mine = [line('u1', 'a'), line('u2', 'b edited here')];
    const theirs = [line('legacy:0:A', 'A'), line('legacy:1:b', 'b')];
    expect(mergeAcceptance(base, mine, theirs)).toEqual([line('u1', 'A'), line('u2', 'b edited here')]);
  });

  it('still deletes here, and keeps what the other client added', () => {
    const mine = [line('u1', 'a')];
    const theirs = [line('legacy:0:a', 'a'), line('legacy:1:b', 'b'), line('legacy:2:c', 'c')];
    expect(mergeAcceptance(base, mine, theirs)).toEqual([line('u1', 'a'), line('legacy:2:c', 'c')]);
  });

  it('does not line up by position when the other side kept even one id', () => {
    const mine = [line('u1', 'a edited here'), line('u2', 'b')];
    const theirs = [line('u1', 'a'), line('legacy:1:B', 'B')];
    expect(mergeAcceptance(base, mine, theirs)).toEqual([line('u1', 'a edited here'), line('legacy:1:B', 'B')]);
  });
});
