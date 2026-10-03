'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useCurrentUserId } from '@/providers/authContext';
import type { IssuedPersonalAccessToken, PersonalAccessToken, PersonalAccessTokenAccess } from '@/types/database';

// The signed-in person's personal access tokens (ADR 0031): list, issue,
// revoke. RLS shows each person only their own rows, and the hash is not
// selectable at all. Issue and revoke are RPCs; the database refuses both
// when the caller is itself a delegated client.
//
// The plaintext is returned once by `issue` and is not kept: the mutation is
// dropped from React Query's MutationCache as soon as nothing observes it
// (gcTime 0), and the dialog that shows the token resets it on close.

// Every column the browser may read — token_hash is deliberately not one.
const COLUMNS = 'id, user_id, name, token_prefix, access, expires_at, last_used_at, last_used_client, revoked_at, created_at';

/** Derived from the project this build talks to, so preview and local builds show their own addresses. */
const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/+$/, '');
export const ALCON_MCP_URL = `${SUPABASE_URL}/functions/v1/alcon-mcp`;

/** The Claude Code command that connects to Alcon with a token (or a placeholder for one). */
export function claudeMcpAddCommand(token: string): string {
  return `claude mcp add --transport http alcon "${ALCON_MCP_URL}?client=Claude%20Code" --header "Authorization: Bearer ${token}"`;
}

export type TokenExpiryDays = 30 | 90 | null;

const tokensKey = (userId: string | null) => ['personal-access-tokens', userId] as const;
const EMPTY: PersonalAccessToken[] = [];

/** Live tokens, newest first. Revoked ones are gone for good and are not listed. */
export function usePersonalAccessTokens() {
  const userId = useCurrentUserId();
  const query = useQuery({
    queryKey: tokensKey(userId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('personal_access_tokens')
        .select(COLUMNS)
        .is('revoked_at', null)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as PersonalAccessToken[];
    },
    enabled: !!userId,
    staleTime: 30_000,
  });
  return {
    data: query.data ?? EMPTY,
    loading: !!userId && query.isPending,
    error: (query.error as Error | null) ?? null,
  };
}

export function usePersonalAccessTokenActions() {
  const qc = useQueryClient();
  const userId = useCurrentUserId();
  const key = tokensKey(userId);

  const issue = useMutation({
    // The result is the plaintext token: never let the cache outlive the dialog.
    gcTime: 0,
    mutationFn: async (input: { name: string; expiresDays: TokenExpiryDays; access: PersonalAccessTokenAccess }) => {
      const { data, error } = await supabase.rpc('create_personal_access_token', {
        p_name: input.name.trim(),
        p_expires_days: input.expiresDays,
        p_access: input.access,
      });
      if (error) throw error;
      return data as IssuedPersonalAccessToken;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });

  const revoke = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('revoke_personal_access_token', { p_id: id });
      if (error) throw error;
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<PersonalAccessToken[]>(key);
      qc.setQueryData<PersonalAccessToken[]>(key, (rows) => rows?.filter((r) => r.id !== id));
      return { previous };
    },
    onError: (_e, _id, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });

  return { issue, revoke };
}
