// The persisted query cache belongs to one user.
//
// On a shared machine the next person to sign in must never be shown the
// previous person's Domains, members or Elements restored from IndexedDB. The
// cache is keyed per user, and whenever the signed-in user changes every
// other user's blob — and the unscoped blob from before caches were per user
// — is dropped.

import { describe, expect, it } from 'vitest';

import { queryCacheKey, queryCacheKeysToDrop } from '@/lib/queryCacheKeys';

const A = queryCacheKey('user-a');
const B = queryCacheKey('user-b');

describe('queryCacheKey', () => {
  it('names the user', () => {
    expect(A).not.toBe(B);
    expect(A).toContain('user-a');
  });
});

describe('queryCacheKeysToDrop', () => {
  it('keeps only the signed-in user\'s cache', () => {
    expect(queryCacheKeysToDrop([A, B], 'user-b')).toEqual([A]);
  });

  it('drops every cache when nobody is signed in', () => {
    expect(queryCacheKeysToDrop([A, B], null).sort()).toEqual([A, B].sort());
  });

  it('drops the unscoped cache written before caches were per user', () => {
    expect(queryCacheKeysToDrop(['clayware-query-cache', A], 'user-a')).toEqual(['clayware-query-cache']);
  });

  it('leaves unrelated IndexedDB entries alone', () => {
    expect(queryCacheKeysToDrop(['clayware-query-cache-x', 'kata', 42, ['clayware-query-cache']], null)).toEqual([]);
  });
});
