'use client';

import { type ExplorerData } from '@/alcon/sync/explorerPatch';
import { getQueryClient } from '@/lib/queryClient';


// ============================================
// Hook: Fetch All Objects (flat list per Domain)
// ============================================
//
// Backed by TanStack Query — cache lives under ['explorer', domainId] and
// is shared between the sidebar tree, page views, and the optimistic-mutation
// helpers below (updateElement / updateSubelement). Mutations patch the cache
// in place before awaiting Supabase so the UI reflects user actions without
// waiting on the network. Realtime still drives reconciliation but a future
// phase will switch from invalidate-everything to delta-apply.

const EXPLORER_QUERY_PREFIX = ['explorer'] as const;

/** Drop every cached facet of one Element (`['element', id, …]`: edges,
 *  member Objects, custom columns, comments, reactions, menu targets) so the
 *  next reader refetches. Writers that change those rows call this. */
/** Drop every list's cached column set + values (`['custom-columns', …]`):
 *  a Property definition, placement or value changed. */
export function invalidateCustomColumnLists(): void {
  void getQueryClient().invalidateQueries({ queryKey: ['custom-columns'] });
}

export function invalidateElementDetail(elementId: string): void {
  void getQueryClient().invalidateQueries({ queryKey: ['element', elementId] });
}

// ----- Cache patch helpers (for optimistic mutations) -----
//
// Patches walk the explorer tree and clone-on-write the changed element /
// subelement. TanStack Query's built-in structural sharing (replaceEqualDeep)
// preserves references for unchanged subtrees, so combined with React.memo
// on list rows (Phase 3) this re-renders only the rows whose entity actually
// changed — Linear's "one delta, one cell", adapted.


// Apply a patch to every cached explorer query and return a rollback that
// restores the pre-patch snapshot. Used by mutation helpers from non-hook
// contexts (where useQueryClient isn't available).
export function applyOptimisticExplorerPatch(
  patch: (data: ExplorerData) => ExplorerData,
): () => void {
  const qc = getQueryClient();
  const snapshot = qc.getQueriesData<ExplorerData>({ queryKey: EXPLORER_QUERY_PREFIX });
  for (const [key, data] of snapshot) {
    if (!data) continue;
    qc.setQueryData<ExplorerData>(key, patch(data));
  }
  return () => {
    for (const [key, data] of snapshot) {
      qc.setQueryData(key, data);
    }
  };
}
