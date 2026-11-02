import { MutationCache, QueryClient, type Mutation } from '@tanstack/react-query';
import { notifyError } from '@/Function/shared/toastStore';
import { translate } from '@/Function/i18n/I18nProvider';

declare module '@tanstack/react-query' {
  interface Register {
    mutationMeta: {
      /** The caller already shows this failure in its own UI (an inline error, a dialog); skip the toast. */
      silent?: boolean;
    };
  }
}

/**
 * Every failed mutation tells the person, once. Without this a failed save
 * only reached the console (or nowhere) while the optimistic patch quietly
 * rolled back. A mutation whose caller shows its own error sets
 * `meta: { silent: true }`.
 */
export function reportMutationError(error: unknown, mutation: Pick<Mutation<unknown, unknown, unknown, unknown>, 'meta'>): void {
  if (mutation.meta?.silent) return;
  console.error('[mutation]', error);
  notifyError(error, translate('Could not save your change.'));
}

// Singleton QueryClient shared between the React tree (via QueryProvider) and
// non-hook mutation helpers in useSupabase.ts. Standalone helpers like
// updateElement() reach into the cache to apply optimistic patches before
// awaiting Supabase, so they need a stable handle to the same client the UI
// reads from.
let _client: QueryClient | null = null;

export function getQueryClient(): QueryClient {
  if (_client) return _client;
  _client = new QueryClient({
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) => reportMutationError(error, mutation),
    }),
    defaultOptions: {
      queries: {
        // Realtime drives invalidation, so background refetching is mostly
        // unnecessary. Stale-while-revalidate on mount keeps reloads snappy
        // without serving wildly stale data.
        staleTime: 30_000,
        // 24h gcTime so queries survive long enough to be serialised to
        // IndexedDB by queryCachePersistence on tab close. The default
        // 5 min would garbage-collect them before persistence and defeat
        // the whole point of cache survival.
        gcTime: 24 * 60 * 60 * 1000,
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
