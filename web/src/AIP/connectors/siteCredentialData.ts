'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { CredentialUse, SiteCredential } from '@/types/database';
import { siteCredentialLastUsedAt } from './siteCredentialModel';

// A Space's site logins (secure-login PR1): metadata reads and the
// owner-only writes. The password is write-only from here, exactly as
// a connection's credential is: it goes to set_site_credential_by_origin
// (Vault) and is never selected back — `secret_id` only says whether
// one is stored. The audit rows (credential_uses) are owner-readable;
// members' queries simply come back empty, and last_used_at stays
// unprojected for them.

const COLUMNS = 'id, activity_space_id, origin, username, label, secret_id, last_test, created_by, created_at, updated_at';
const USE_COLUMNS = 'id, activity_space_id, credential_kind, integration_id, site_credential_id, event, run_id, actor_id, origin, detail, created_at';

const siteCredentialsKey = (spaceId: string | null) => ['site-credentials', spaceId] as const;

export interface SiteCredentialRow extends SiteCredential {
  /** Projected from credential_uses ('used' events); null until a run spends it. */
  last_used_at: string | null;
}

const EMPTY: SiteCredentialRow[] = [];

export function useSiteCredentials(spaceId: string | null) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: siteCredentialsKey(spaceId),
    queryFn: async (): Promise<SiteCredentialRow[]> => {
      const [creds, uses] = await Promise.all([
        supabase.from('site_credentials').select(COLUMNS).eq('activity_space_id', spaceId!).order('created_at', { ascending: true }),
        supabase.from('credential_uses').select(USE_COLUMNS).eq('activity_space_id', spaceId!).eq('credential_kind', 'site'),
      ]);
      if (creds.error) throw creds.error;
      // The uses query may legitimately fail or come back empty for a
      // member (owners-only policy): the list still renders, without
      // the last-used projection.
      const useRows = (uses.error ? [] : uses.data ?? []) as CredentialUse[];
      return ((creds.data ?? []) as SiteCredential[]).map((c) => ({
        ...c,
        last_used_at: siteCredentialLastUsedAt(useRows, c.id),
      }));
    },
    enabled: !!spaceId,
    staleTime: 30_000,
  });
  return {
    data: query.data ?? EMPTY,
    loading: !!spaceId && query.isPending,
    error: (query.error as Error | null) ?? null,
    refetch: () => qc.invalidateQueries({ queryKey: siteCredentialsKey(spaceId) }),
  };
}

/** What the by-origin write did (the RPC's own words, server-decided). */
export type SiteCredentialSaveResult = 'stored' | 'replaced' | 'deleted' | 'noop' | 'covered_by_connection';

async function setSiteCredentialByOrigin(spaceId: string, args: {
  origin: string; username: string; password: string; label?: string | null; force?: boolean;
}): Promise<SiteCredentialSaveResult> {
  const { data, error } = await supabase.rpc('set_site_credential_by_origin', {
    p_activity_space_id: spaceId,
    p_origin: args.origin,
    p_username: args.username,
    p_password: args.password,
    p_label: args.label ?? null,
    p_force: args.force ?? false,
  });
  if (error) throw error;
  return data as SiteCredentialSaveResult;
}

/** Save / replace / clear for one Space's site logins. The caller
 *  shows failures inline. */
export function useSiteCredentialActions(spaceId: string | null) {
  const qc = useQueryClient();
  const key = siteCredentialsKey(spaceId);
  const refresh = () => qc.invalidateQueries({ queryKey: key });

  const save = useMutation({
    meta: { silent: true },
    mutationFn: (args: { origin: string; username: string; password: string; label?: string | null; force?: boolean }) =>
      setSiteCredentialByOrigin(spaceId!, args),
    onSettled: refresh,
  });

  /** The empty-value set: the stored password goes, the row (and its
   *  audit referent) stays, marked with secret_id null. */
  const clear = useMutation({
    meta: { silent: true },
    mutationFn: (cred: Pick<SiteCredential, 'origin' | 'username'>) =>
      setSiteCredentialByOrigin(spaceId!, { origin: cred.origin, username: cred.username, password: '', label: null }),
    onSettled: refresh,
  });

  return { save, clear };
}
