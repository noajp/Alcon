import type { PostgrestError } from '@supabase/supabase-js';

/**
 * supabase-js resolves a failed write instead of rejecting, and a write RLS
 * refuses simply matches no rows. Batched writes run through Promise.all
 * therefore "succeed" whatever happened, and the caller's rollback never
 * runs. Ask each write for its rows (`.select('id')`) and pass the results
 * here: it throws on the first error or the first write that touched nothing.
 */
export function throwOnFailedWrites(
  results: readonly { error: PostgrestError | null; data: readonly unknown[] | null }[],
  what: string,
): void {
  for (const { error, data } of results) {
    if (error) throw error;
    if (!data?.length) throw new Error(`${what}: a row was not written (refused or gone)`);
  }
}
