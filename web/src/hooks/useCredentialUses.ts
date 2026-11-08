'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { CredentialUse } from '@/types/database';
import { credentialHistoryRow, type CredentialHistoryRow } from '@/Function/audit/credentialHistoryModel';

// The credential history's read (secure-login PR4): the Space's
// credential_uses trail, newest first, shaped for the Audit page.
// The trail's RLS is owners-only — a member's read comes back
// empty, and the page says the history is the owners' to read; the
// rows hold ids, origins and fixed codes, never a value, so there
// is nothing here to scrub. The names a row shows (a connection's
// name, a site login's origin, a person's name) are read beside the
// trail and joined by the pure model.

const USE_COLUMNS = 'id, activity_space_id, credential_kind, integration_id, site_credential_id, event, run_id, actor_id, origin, detail, created_at';

/** How much of the trail the page reads at once; past it the page
 *  says it shows the latest. */
export const CREDENTIAL_HISTORY_LIMIT = 300;

const EMPTY: CredentialHistoryRow[] = [];

export function useCredentialHistory(spaceId: string | null) {
  const query = useQuery({
    queryKey: ['credential-history', spaceId],
    queryFn: async (): Promise<CredentialHistoryRow[]> => {
      const uses = await supabase.from('credential_uses').select(USE_COLUMNS)
        .eq('activity_space_id', spaceId!)
        .order('created_at', { ascending: false })
        .limit(CREDENTIAL_HISTORY_LIMIT);
      if (uses.error) throw uses.error;
      const rows = (uses.data ?? []) as CredentialUse[];
      if (!rows.length) return [];
      const [integrations, sites] = await Promise.all([
        supabase.from('integrations').select('id, name').eq('activity_space_id', spaceId!),
        supabase.from('site_credentials').select('id, origin, username').eq('activity_space_id', spaceId!),
      ]);
      const actorIds = [...new Set(rows.map((r) => r.actor_id).filter((x): x is string => !!x))];
      const profiles = actorIds.length
        ? await supabase.from('profiles').select('id, display_name').in('id', actorIds)
        : { data: [] as { id: string; display_name: string | null }[] };
      const names = {
        integrationName: new Map(((integrations.data ?? []) as { id: string; name: string }[]).map((i) => [i.id, i.name])),
        siteOrigin: new Map(((sites.data ?? []) as { id: string; origin: string }[]).map((s) => [s.id, s.origin])),
        siteUsername: new Map(((sites.data ?? []) as { id: string; username: string }[]).map((s) => [s.id, s.username])),
        personName: new Map(((profiles.data ?? []) as { id: string; display_name: string | null }[])
          .filter((p) => p.display_name)
          .map((p) => [p.id, p.display_name as string])),
      };
      return rows.map((r) => credentialHistoryRow(r, names));
    },
    enabled: !!spaceId,
    staleTime: 30_000,
  });
  return {
    rows: query.data ?? EMPTY,
    truncated: (query.data?.length ?? 0) >= CREDENTIAL_HISTORY_LIMIT,
    loading: !!spaceId && query.isPending,
    error: (query.error as Error | null) ?? null,
    refetch: () => void query.refetch(),
  };
}
