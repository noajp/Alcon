'use client';

import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { get, set, del } from 'idb-keyval';
import { getQueryClient } from '@/lib/queryClient';

// IndexedDB key the persister writes the serialised cache under. Exported
// so sign-out can drop it explicitly (see useAuth.signOut).
export const QUERY_CACHE_IDB_KEY = 'alcon-query-cache';

// Bump when the on-disk cache shape changes — e.g. ExplorerData adds a
// field, or a query key is renamed. Previously persisted entries are then
// dropped instead of restored stale.
const CACHE_BUSTER = 'alcon-v1';

// IndexedDB-backed persister via idb-keyval. IndexedDB beats localStorage
// here: much higher quota (50-100MB+ vs 5-10MB) so a workspace tree
// doesn't trip storage limits, and it's async so a big serialise doesn't
// block the main thread on tab close.
const persister = createAsyncStoragePersister({
  storage: {
    getItem: (key) => get<string>(key).then((v) => v ?? null),
    setItem: (key, value) => set(key, value),
    removeItem: (key) => del(key),
  },
  key: QUERY_CACHE_IDB_KEY,
});

export function QueryProvider({ children }: { children: React.ReactNode }) {
  return (
    <PersistQueryClientProvider
      client={getQueryClient()}
      persistOptions={{
        persister,
        buster: CACHE_BUSTER,
        // Drop persisted entries older than 7 days — beyond that the
        // membership / status / etc. has drifted too far to trust without
        // a fresh fetch.
        maxAge: 7 * 24 * 60 * 60 * 1000,
      }}
    >
      {children}
      {process.env.NODE_ENV === 'development' && (
        <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-left" />
      )}
    </PersistQueryClientProvider>
  );
}
