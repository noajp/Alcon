import { defaultShouldDehydrateQuery, type Query } from '@tanstack/react-query';
import { persistQueryClient } from '@tanstack/react-query-persist-client';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { get, set, del, keys } from 'idb-keyval';
import { getQueryClient } from './queryClient';
import { queryCacheKey, queryCacheKeysToDrop } from './queryCacheKeys';

// Bump when the on-disk cache shape changes — e.g. ExplorerData adds a
// field, or a query key is renamed. Previously persisted entries are then
// dropped instead of restored stale.
const CACHE_BUSTER = 'alcon-v2';

// Drop persisted entries older than 7 days — beyond that the membership /
// status / etc. has drifted too far to trust without a fresh fetch.
const MAX_AGE = 7 * 24 * 60 * 60 * 1000;

// Only the workspace-shaped queries are worth restoring on the next load:
// the tree, the lists the shell paints before anything is clicked. Per-entity
// facets and per-visible-set maps (Element details, blockers, activity, load
// charts, menu targets) are keyed by ids that change with every click or
// keystroke — persisting them grows the store without ever serving a paint.
const PERSISTED_ROOTS = new Set([
  'explorer', 'domains', 'my-space-ids', 'spaces', 'my-elements',
  'strategies', 'portfolios', 'visions', 'phases', 'workers', 'element-templates',
]);
function shouldDehydrateQuery(query: Query): boolean {
  return defaultShouldDehydrateQuery(query) && PERSISTED_ROOTS.has(String(query.queryKey[0]));
}

// The user whose cache is restored into, and saved from, the QueryClient.
// `undefined` until the session is first resolved.
let currentUserId: string | null | undefined = undefined;
let stopPersisting: (() => void) | null = null;

/**
 * Point the query cache at the signed-in user (null = signed out). Called on
 * every auth state change — including SIGNED_OUT from session expiry or a
 * sign-out in another tab. Nothing is restored until the user is known; when
 * the user changes, the in-memory cache and every other user's IndexedDB blob
 * are dropped before the new user's own cache is restored.
 */
export function setQueryCacheUser(userId: string | null): void {
  if (typeof window === 'undefined' || userId === currentUserId) return;
  const hadUser = currentUserId != null;
  stopPersisting?.();
  stopPersisting = null;
  currentUserId = userId;
  if (hadUser) getQueryClient().clear();
  void dropOtherCaches(userId);
  if (userId) stopPersisting = persistFor(userId);
}

/** Sign-out: forget the cache now, before Supabase tears the session down. */
export async function clearQueryCache(): Promise<void> {
  stopPersisting?.();
  stopPersisting = null;
  currentUserId = null;
  getQueryClient().clear();
  await dropOtherCaches(null);
}

async function dropOtherCaches(userId: string | null): Promise<void> {
  try {
    await Promise.all(queryCacheKeysToDrop(await keys(), userId).map((k) => del(k)));
  } catch { /* best effort */ }
}

// IndexedDB-backed persister via idb-keyval. IndexedDB beats localStorage
// here: much higher quota (50-100MB+ vs 5-10MB) so a workspace tree
// doesn't trip storage limits, and it's async so a big serialise doesn't
// block the main thread on tab close. `active` closes the window where a
// throttled write or an in-flight read for the previous user lands after the
// switch.
function persistFor(userId: string): () => void {
  let active = true;
  const persister = createAsyncStoragePersister({
    storage: {
      getItem: async (key) => {
        const value = await get<string>(key);
        return active ? value ?? null : null;
      },
      setItem: async (key, value) => { if (active) await set(key, value); },
      removeItem: (key) => del(key),
    },
    key: queryCacheKey(userId),
  });
  const [unsubscribe, restored] = persistQueryClient({
    queryClient: getQueryClient(),
    persister,
    buster: CACHE_BUSTER,
    maxAge: MAX_AGE,
    dehydrateOptions: { shouldDehydrateQuery },
  });
  // A blob that fails to restore is discarded by the library; the queries
  // then simply fetch.
  restored.catch(() => {});
  return () => { active = false; unsubscribe(); };
}
