'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useCurrentUserId } from '@/providers/authContext';
import { mergeConnectedApps, type ConnectedApp, type OAuthAccess } from './connectedApps';

// The signed-in person's OAuth connections (ADR 0034). Supabase Auth holds
// the grants (listGrants / revokeGrant); Alcon holds what each client may do
// (oauth_client_access, read or read & write). Both writes refuse a caller
// that is itself a delegated client.

const appsKey = (userId: string | null) => ['oauth-connected-apps', userId] as const;
const EMPTY: ConnectedApp[] = [];

export function useConnectedApps() {
  const userId = useCurrentUserId();
  const query = useQuery({
    queryKey: appsKey(userId),
    queryFn: async () => {
      const [{ data: grants, error: grantsError }, { data: rows, error: rowsError }] = await Promise.all([
        supabase.auth.oauth.listGrants(),
        supabase.from('oauth_client_access').select('client_id, access'),
      ]);
      if (grantsError) throw grantsError;
      if (rowsError) throw rowsError;
      return mergeConnectedApps(grants ?? [], rows ?? []);
    },
    enabled: !!userId,
    // Without the OAuth server there is nothing to list; one failed try is enough.
    retry: false,
  });
  return { data: query.data ?? EMPTY, loading: query.isLoading, error: query.error as Error | null };
}

export function useConnectedAppActions() {
  const userId = useCurrentUserId();
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: appsKey(userId) });

  const setAccess = useMutation({
    // The caller shows this failure inline.
    meta: { silent: true },
    mutationFn: async ({ clientId, access }: { clientId: string; access: OAuthAccess }) => {
      const { error } = await supabase.rpc('set_oauth_client_access', { p_client_id: clientId, p_access: access });
      if (error) throw error;
    },
    onSettled: refresh,
  });

  // Revoking the grant ends the client's sessions and refresh tokens; the
  // access row goes with it so a later reconnect starts from the consent.
  const disconnect = useMutation({
    // The caller shows this failure inline.
    meta: { silent: true },
    mutationFn: async (clientId: string) => {
      const { error } = await supabase.auth.oauth.revokeGrant({ clientId });
      if (error) throw error;
      // The grant is gone either way; a row left behind is overwritten on the
      // next consent, so its delete is best-effort.
      await supabase.from('oauth_client_access').delete().eq('client_id', clientId);
    },
    onSettled: refresh,
  });

  return { setAccess, disconnect };
}

/** Records what the person allowed before the consent is approved, so the first call already has it. */
export async function saveOAuthAccess(clientId: string, access: OAuthAccess): Promise<void> {
  const { error } = await supabase.rpc('set_oauth_client_access', { p_client_id: clientId, p_access: access });
  if (error) throw error;
}
