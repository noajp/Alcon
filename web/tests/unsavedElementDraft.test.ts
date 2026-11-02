import { describe, expect, it } from 'vitest';
import { parseUnsavedDraft, pendingDraft } from '@/Function/shared/element/unsavedDraft';

describe('parseUnsavedDraft', () => {
  it('reads the stored title and description', () => {
    expect(parseUnsavedDraft(JSON.stringify({ title: 'T', description: 'D' }))).toEqual({ title: 'T', description: 'D' });
  });

  it('keeps an emptied description as a draft', () => {
    expect(parseUnsavedDraft(JSON.stringify({ description: '' }))).toEqual({ description: '' });
  });

  it('ignores anything that is not a draft', () => {
    expect(parseUnsavedDraft(null)).toBeNull();
    expect(parseUnsavedDraft('not json')).toBeNull();
    expect(parseUnsavedDraft('42')).toBeNull();
    expect(parseUnsavedDraft(JSON.stringify({ title: 3 }))).toBeNull();
  });
});

describe('pendingDraft', () => {
  const saved = { title: 'Saved', description: 'Body' };

  it('offers only the fields that still differ from what is saved', () => {
    expect(pendingDraft({ title: 'Saved', description: 'New body' }, saved)).toEqual({ description: 'New body' });
  });

  it('has nothing to offer once the draft has been saved', () => {
    expect(pendingDraft({ title: 'Saved', description: 'Body' }, saved)).toBeNull();
    expect(pendingDraft(null, saved)).toBeNull();
  });

  it('never offers an empty title', () => {
    expect(pendingDraft({ title: '   ' }, saved)).toBeNull();
  });
});
