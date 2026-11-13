import { describe, expect, it } from 'vitest';
import { parseUnsavedDraft, pendingDraft, unsavedDraftKeysToDrop } from '@/Function/shared/element/unsavedDraft';

describe('parseUnsavedDraft', () => {
  it('reads the stored text and what it was written over', () => {
    expect(parseUnsavedDraft(JSON.stringify({ description: 'D', baseDescription: 'B' }))).toEqual({ description: 'D', baseDescription: 'B' });
  });

  it('keeps an emptied description as a draft', () => {
    expect(parseUnsavedDraft(JSON.stringify({ description: '' }))).toEqual({ description: '' });
  });

  it('ignores anything that is not a draft', () => {
    expect(parseUnsavedDraft(null)).toBeNull();
    expect(parseUnsavedDraft('not json')).toBeNull();
    expect(parseUnsavedDraft('42')).toBeNull();
    expect(parseUnsavedDraft(JSON.stringify({ title: 3 }))).toBeNull();
    expect(parseUnsavedDraft(JSON.stringify({ baseTitle: 'only a base' }))).toBeNull();
  });
});

describe('pendingDraft', () => {
  const saved = { title: 'Saved', description: 'Body' };

  it('offers only the fields that still differ from what is saved', () => {
    expect(pendingDraft({ title: 'Saved', description: 'New body', baseDescription: 'Body' }, saved))
      .toEqual({ description: 'New body', changedSince: false });
  });

  it('says when what is saved changed after the draft was written', () => {
    expect(pendingDraft({ description: 'Mine', baseDescription: 'Older body' }, saved))
      .toEqual({ description: 'Mine', changedSince: true });
  });

  it('has nothing to offer once the draft has been saved', () => {
    expect(pendingDraft({ title: 'Saved', description: 'Body' }, saved)).toBeNull();
    expect(pendingDraft(null, saved)).toBeNull();
  });

  it('never offers an empty title', () => {
    expect(pendingDraft({ title: '   ' }, saved)).toBeNull();
  });
});

describe('unsavedDraftKeysToDrop', () => {
  const p = 'clayware:element-unsaved-draft:';
  const keys = [`${p}u1:e1`, `${p}u2:e1`, `${p}u10:e2`, `${p}e3`, 'clayware-other-setting'];

  it('keeps only the signed-in user’s drafts', () => {
    expect(unsavedDraftKeysToDrop(keys, 'u1')).toEqual([`${p}u2:e1`, `${p}u10:e2`, `${p}e3`]);
  });

  it('drops every draft when nobody is signed in', () => {
    expect(unsavedDraftKeysToDrop(keys, null)).toEqual([`${p}u1:e1`, `${p}u2:e1`, `${p}u10:e2`, `${p}e3`]);
  });
});
