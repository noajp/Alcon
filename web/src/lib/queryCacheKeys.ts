// Which IndexedDB entries hold a persisted query cache, and whose.
//
// The cache is written under one key per signed-in user, so a blob is only
// ever restored for the user who wrote it. At most one user's cache stays on
// the device: whenever the signed-in user changes (sign-out, session expiry,
// sign-out in another tab, a different account), every other user's blob is
// dropped — on a shared machine nobody inherits the previous person's data.

const PREFIX = 'alcon-query-cache';

/** The IndexedDB key that holds `userId`'s persisted query cache. */
export function queryCacheKey(userId: string): string {
  return `${PREFIX}:${userId}`;
}

/** The persisted-cache keys among `keys` that must not survive for `userId`
 *  (null = nobody is signed in): every user's blob but theirs, including the
 *  unscoped key written before caches were per user. */
export function queryCacheKeysToDrop(keys: readonly IDBValidKey[], userId: string | null): string[] {
  const keep = userId ? queryCacheKey(userId) : null;
  return keys.filter((k): k is string =>
    typeof k === 'string' && (k === PREFIX || k.startsWith(`${PREFIX}:`)) && k !== keep);
}
