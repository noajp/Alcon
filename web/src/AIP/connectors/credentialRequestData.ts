'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { CredentialRequest } from '@/types/database';

// A credential capture ask (secure-login PR2): the live read the card
// and dialog render from, and the submits they answer with. The card
// re-reads its row, so a stale ask in an old transcript shows its true
// state (saved / declined / expired) and never offers a dead form —
// the connect card's honesty rule.
//
// The value a person types travels exactly one hop: from the dialog
// to a storage RPC over PostgREST with the person's own JWT. It is
// never selected back, never put in a query key, a cache, or an
// error this module raises — failures surface the RPC's own fixed
// message through formatError at the surface.

const REQUEST_COLUMNS = 'id, activity_space_id, kind, integration_id, site_credential_id, origin, username_hint, need, status, requested_by, decided_by, decided_at, expires_at, created_at';

const requestKey = (requestId: string | null) => ['credential-request', requestId] as const;

export function useCredentialRequest(requestId: string | null) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: requestKey(requestId),
    queryFn: async (): Promise<CredentialRequest | null> => {
      const { data, error } = await supabase
        .from('credential_requests')
        .select(REQUEST_COLUMNS)
        .eq('id', requestId!)
        .maybeSingle();
      if (error) throw error;
      return (data as CredentialRequest | null) ?? null;
    },
    enabled: !!requestId,
    staleTime: 5_000,
    // While the ask stands, another surface may answer it (the owner
    // in Settings, a second tab): poll gently so this card flips to
    // its true state instead of offering a form already answered.
    refetchInterval: (q) => ((q.state.data as CredentialRequest | null)?.status === 'pending' ? 8_000 : false),
  });
  return {
    data: query.data ?? null,
    loading: !!requestId && query.isPending,
    error: (query.error as Error | null) ?? null,
    refetch: () => qc.invalidateQueries({ queryKey: requestKey(requestId) }),
  };
}

/** Whether any of a conversation's capture asks still stands
 *  (secure-login PR4): the chat hint's fact — while an ask is
 *  pending, the composer's neighbourhood says the password belongs
 *  in the card, not the chat (the T2 residual: a person who cannot
 *  find the form may paste the value into the conversation instead).
 *  Polls gently while an ask stands, like the card itself. */
export function useAnyCredentialRequestPending(requestIds: readonly string[]): boolean {
  const ids = [...new Set(requestIds)].sort();
  const query = useQuery({
    queryKey: ['credential-requests-pending', ids.join(',')],
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase
        .from('credential_requests')
        .select('id')
        .in('id', ids)
        .eq('status', 'pending')
        .limit(1);
      if (error) throw error;
      return (data ?? []).length > 0;
    },
    enabled: ids.length > 0,
    staleTime: 5_000,
    refetchInterval: (q) => (q.state.data === true ? 8_000 : false),
  });
  return query.data === true;
}

/** Save for the token class: the value goes to the connection's
 *  existing Vault slot through set_integration_secret — no new write
 *  path — and complete_credential_request then seals the ask, which
 *  it does only after verifying the slot is actually filled.
 *  Returns the seal's word ('saved' | 'not_saved' | a status). */
export async function saveTokenCredential(request: CredentialRequest, secret: string): Promise<string> {
  const { error } = await supabase.rpc('set_integration_secret', {
    p_integration_id: request.integration_id!,
    p_secret: secret,
  });
  if (error) throw error;
  const { data, error: sealError } = await supabase.rpc('complete_credential_request', { p_request_id: request.id });
  if (sealError) throw sealError;
  return data as string;
}

/** Save for the site class: addressed by request id — the RPC reads
 *  the origin off the request row, so the password is filed under
 *  the destination the dialog displayed and no other. Returns the
 *  storage word ('stored' | 'replaced' | 'covered_by_connection'). */
export async function saveSiteCredential(request: CredentialRequest, username: string, secret: string): Promise<string> {
  const { data, error } = await supabase.rpc('set_site_credential', {
    p_request_id: request.id,
    p_username: username,
    p_password: secret,
  });
  if (error) throw error;
  return data as string;
}

/** Use once, either class: the value is stashed against the request
 *  (single-take, ten minutes) and never written to standing storage.
 *  The username travels for a site login (the pair is the stash);
 *  the token class has no username. */
export async function stashCredentialOnce(request: CredentialRequest, username: string | null, value: string): Promise<string> {
  const { data, error } = await supabase.rpc('stash_credential_once', {
    p_request_id: request.id,
    p_username: username ?? '',
    p_value: value,
  });
  if (error) throw error;
  return data as string;
}

/** The dialog's Cancel: a decline is an answer, recorded as one. */
export async function declineCredentialRequest(request: CredentialRequest): Promise<string> {
  const { data, error } = await supabase.rpc('decline_credential_request', { p_request_id: request.id });
  if (error) throw error;
  return data as string;
}

/** A fresh token capture is proven before the waiting work resumes
 *  (§3.6): the existing connection-test round, best-effort — its
 *  verdict lands on the connection's last_test, where the need
 *  machinery reads it honestly either way. */
export async function testCapturedIntegration(integrationId: string): Promise<void> {
  await supabase.functions.invoke('integration-test', { body: { integrationId } }).catch(() => null);
}
