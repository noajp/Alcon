import { describe, expect, it } from 'vitest';
import { linkConflicts, linkWouldLoop } from '@/Function/shared/objectDependencyModel';

describe('linkWouldLoop', () => {
  const links = [{ blocker: 'a', blocked: 'b' }, { blocker: 'b', blocked: 'c' }];
  it('refuses an Object waiting for itself', () => {
    expect(linkWouldLoop([], 'a', 'a')).toBe(true);
  });
  it('refuses the reverse of an existing link, direct or through others', () => {
    expect(linkWouldLoop(links, 'b', 'a')).toBe(true);
    expect(linkWouldLoop(links, 'c', 'a')).toBe(true);
  });
  it('allows a link that closes no loop', () => {
    expect(linkWouldLoop(links, 'a', 'c')).toBe(false);
    expect(linkWouldLoop(links, 'd', 'a')).toBe(false);
  });
});

describe('linkConflicts', () => {
  it('flags a waiting Object that starts on or before its blocker is due', () => {
    expect(linkConflicts('2026-11-20', '2026-11-20')).toBe(true);
    expect(linkConflicts('2026-11-20', '2026-11-10T00:00:00+00:00')).toBe(true);
  });
  it('is quiet when the waiting Object starts after', () => {
    expect(linkConflicts('2026-11-20', '2026-11-21')).toBe(false);
  });
  it('cannot judge a missing date', () => {
    expect(linkConflicts(null, '2026-11-21')).toBe(false);
    expect(linkConflicts('2026-11-20', null)).toBe(false);
  });
});
