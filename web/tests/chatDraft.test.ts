import { describe, expect, it } from 'vitest';

// The draft step's throttle (run-agent/draft.ts): the rhythm at which a
// streaming chat answer is written to its draft step for the panel's
// live display — often enough to follow, never per token.
const draft = await import(new URL('../../supabase/functions/run-agent/draft.ts', import.meta.url).pathname);

describe('draftDue', () => {
  it('the first words are due at once', () => {
    expect(draft.draftDue(0, 0, Date.now(), 1)).toBe(true);
  });

  it('nothing new is never due', () => {
    expect(draft.draftDue(1_000, 300, 999_999, 300)).toBe(false);
    expect(draft.draftDue(1_000, 300, 999_999, 250)).toBe(false);
  });

  it('flushes on time or on volume, whichever comes first', () => {
    const t0 = 1_000_000;
    expect(draft.draftDue(t0, 100, t0 + 749, 299)).toBe(false);
    expect(draft.draftDue(t0, 100, t0 + 750, 101)).toBe(true);
    expect(draft.draftDue(t0, 100, t0 + 100, 300)).toBe(true);
    expect(draft.draftDue(t0, 100, t0 + 100, 299)).toBe(false);
  });
});
