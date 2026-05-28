import { QueryClient } from '@tanstack/react-query';

// Singleton QueryClient shared between the React tree (via QueryProvider) and
// non-hook mutation helpers in useSupabase.ts. Standalone helpers like
// updateElement() reach into the cache to apply optimistic patches before
// awaiting Supabase, so they need a stable handle to the same client the UI
// reads from.
let _client: QueryClient | null = null;

export function getQueryClient(): QueryClient {
  if (_client) return _client;
  _client = new QueryClient({
    defaultOptions: {
      queries: {
        // Realtime drives invalidation, so background refetching is mostly
        // unnecessary. Stale-while-revalidate on mount keeps reloads snappy
        // without serving wildly stale data.
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
        retry: 1,
      },
      mutations: {
        retry: 0,
      },
    },
  });
  return _client;
}
