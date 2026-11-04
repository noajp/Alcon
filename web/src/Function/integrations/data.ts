'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Integration, IntegrationUpdate, Json } from '@/types/database';
import type { IntegrationInsertRow, OAuthProvider } from './catalog';
import { useSpaceRoleQuery } from '@/Function/space/data';

// A Space's integrations (ADR 0027): list, create, update, delete, set the
// credential, and run a connection test. RLS lets members read and only
// owners write; the screen mirrors that with useIsSpaceOwner, but the
// database is the boundary.
//
// The credential is write-only from here: it goes to set_integration_secret
// (Vault) and is never selected back. `secret_id` only says whether one is set.

//
// An OAuth connection (Google Drive, GitHub) has no credential to type: the
// integration-oauth Edge Function signs in with the provider and stores the tokens;
// `external_account` says which account it signed in as.

const COLUMNS = 'id, activity_space_id, preset, kind, name, description, icon, endpoint, auth_type, auth_header, secret_id, delegation, enabled, last_test, external_account, created_by, created_at, updated_at';

const integrationsKey = (spaceId: string | null) => ['integrations', spaceId] as const;

async function fetchIntegrations(spaceId: string): Promise<Integration[]> {
  const { data, error } = await supabase
    .from('integrations')
    .select(COLUMNS)
    .eq('activity_space_id', spaceId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Integration[];
}

const EMPTY: Integration[] = [];

export function useIntegrations(spaceId: string | null) {
  const query = useQuery({
    queryKey: integrationsKey(spaceId),
    queryFn: () => fetchIntegrations(spaceId!),
    enabled: !!spaceId,
    staleTime: 30_000,
  });
  return {
    data: query.data ?? EMPTY,
    loading: !!spaceId && query.isPending,
    error: (query.error as Error | null) ?? null,
  };
}

/** Whether the signed-in person is an owner of the Space — the same role the
 *  integrations write policies check. Null until the role has loaded. */
export function useIsSpaceOwner(spaceId: string | null): boolean | null {
  const role = useSpaceRoleQuery(spaceId).data;
  return role === undefined ? null : role === 'owner';
}

/** Writes (or, with an empty string, clears) the credential in Vault. */
async function setIntegrationSecret(integrationId: string, secret: string): Promise<void> {
  const { error } = await supabase.rpc('set_integration_secret', { p_integration_id: integrationId, p_secret: secret });
  if (error) throw error;
}

/** An Edge Function error with the function's own `error` message when it sent one. */
async function functionError(error: Error): Promise<Error> {
  let message = error.message;
  if ('context' in error && error.context instanceof Response) {
    try { message = (await error.context.json()).error ?? message; } catch { /* keep the transport error */ }
  }
  return new Error(message);
}

/** Runs the integration-test Edge Function; returns the stored last_test. */
async function testIntegration(integrationId: string): Promise<Json> {
  const { data, error } = await supabase.functions.invoke('integration-test', { body: { integrationId } });
  if (error) throw await functionError(error);
  return (data as { last_test: Json }).last_test;
}

/** Starts the sign-in for an OAuth integration; returns the URL to navigate to. */
async function startIntegrationOAuth(integrationId: string): Promise<string> {
  // The sign-in comes back to this app (production, a preview or localhost), when the server allows it.
  const { data, error } = await supabase.functions.invoke('integration-oauth/start', { body: { integrationId, returnTo: window.location.origin } });
  if (error) throw await functionError(error);
  const url = (data as { url?: unknown } | null)?.url;
  if (typeof url !== 'string' || !url.startsWith('https://')) throw new Error('Sign-in could not be started.');
  return url;
}

/** Confirms a finished sign-in (the one-time handle from the return
 *  URL) as the signed-in person; returns the connected integration's id. */
export async function finishIntegrationOAuth(handle: string): Promise<string | null> {
  const { data, error } = await supabase.functions.invoke('integration-oauth/finish', { body: { handle } });
  if (error) throw await functionError(error);
  const id = (data as { integrationId?: unknown } | null)?.integrationId;
  return typeof id === 'string' ? id : null;
}

/** Revokes an OAuth integration's grant at the provider and clears its stored
 *  tokens. `revoked` is false when the provider could not confirm it. */
async function revokeIntegrationOAuth(integrationId: string): Promise<{ revoked: boolean }> {
  const { data, error } = await supabase.functions.invoke('integration-oauth/revoke', { body: { integrationId } });
  if (error) throw await functionError(error);
  return { revoked: (data as { revoked?: unknown } | null)?.revoked === true };
}

/** Whether sign-in with `provider` is configured on the server: true / false,
 *  null while loading. An unreachable function reads as not configured. */
export function useIntegrationOAuthStatus(enabled: boolean, provider: OAuthProvider = 'google'): boolean | null {
  const query = useQuery({
    queryKey: ['integration-oauth-status'],
    queryFn: async (): Promise<Record<OAuthProvider, boolean>> => {
      const { data, error } = await supabase.functions.invoke('integration-oauth/status', { method: 'GET' });
      const body = (error ? null : data) as { google?: unknown; github?: unknown } | null;
      return { google: body?.google === true, github: body?.github === true };
    },
    enabled,
    staleTime: 5 * 60_000,
  });
  return query.data === undefined ? null : query.data[provider];
}

/** Create / update / delete / secret / test for one Space. Updates and deletes
 *  are optimistic and roll back to the previous list when the write fails. */
export function useIntegrationActions(spaceId: string | null) {
  const qc = useQueryClient();
  const key = integrationsKey(spaceId);

  const snapshot = async () => {
    await qc.cancelQueries({ queryKey: key });
    return qc.getQueryData<Integration[]>(key);
  };
  const restore = (previous: Integration[] | undefined) => {
    if (previous) qc.setQueryData(key, previous);
  };
  const refresh = () => qc.invalidateQueries({ queryKey: key });

  const create = useMutation({
    // The caller shows this failure inline.
    meta: { silent: true },
    mutationFn: async ({ row, secret }: { row: IntegrationInsertRow; secret: string }) => {
      const { data, error } = await supabase.from('integrations').insert(row).select(COLUMNS).single();
      if (error) throw error;
      const created = data as Integration;
      if (secret) {
        try {
          await setIntegrationSecret(created.id, secret);
        } catch (e) {
          // A connection without the credential it was created with is not
          // what the person asked for — undo the insert.
          await supabase.from('integrations').delete().eq('id', created.id);
          throw e;
        }
      }
      return created;
    },
    onSettled: refresh,
  });

  const update = useMutation({
    // The caller shows this failure inline.
    meta: { silent: true },
    mutationFn: async ({ id, patch }: { id: string; patch: IntegrationUpdate }) => {
      const { data, error } = await supabase
        .from('integrations')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select('id');
      if (error) throw error;
      // RLS filters a forbidden update to zero rows rather than raising.
      if (!data || data.length === 0) throw new Error('Only Space owners can change integrations.');
    },
    onMutate: async ({ id, patch }) => {
      const previous = await snapshot();
      qc.setQueryData<Integration[]>(key, (rows) => rows?.map((r) => (r.id === id ? { ...r, ...patch } : r)));
      return { previous };
    },
    onError: (_e, _v, ctx) => restore(ctx?.previous),
    onSettled: refresh,
  });

  const remove = useMutation({
    // The caller shows this failure inline.
    meta: { silent: true },
    mutationFn: async (id: string) => {
      // Deleting the row also deletes its Vault entry (a database trigger).
      const { data, error } = await supabase.from('integrations').delete().eq('id', id).select('id');
      if (error) throw error;
      if (!data || data.length === 0) throw new Error('Only Space owners can change integrations.');
    },
    onMutate: async (id) => {
      const previous = await snapshot();
      qc.setQueryData<Integration[]>(key, (rows) => rows?.filter((r) => r.id !== id));
      return { previous };
    },
    onError: (_e, _v, ctx) => restore(ctx?.previous),
    onSettled: refresh,
  });

  const secret = useMutation({
    // The caller shows this failure inline.
    meta: { silent: true },
    mutationFn: ({ id, value }: { id: string; value: string }) => setIntegrationSecret(id, value),
    onSettled: refresh,
  });

  const test = useMutation({
    // The caller shows this failure inline.
    meta: { silent: true },
    mutationFn: async (id: string) => ({ id, lastTest: await testIntegration(id) }),
    onSuccess: ({ id, lastTest }) => {
      qc.setQueryData<Integration[]>(key, (rows) => rows?.map((r) => (r.id === id ? { ...r, last_test: lastTest } : r)));
    },
  });

  const signIn = useMutation({ mutationFn: (id: string) => startIntegrationOAuth(id), meta: { silent: true } });

  const revoke = useMutation({
    // The caller shows this failure inline.
    meta: { silent: true },
    mutationFn: (id: string) => revokeIntegrationOAuth(id),
    onSettled: refresh,
  });

  return { create, update, remove, secret, test, signIn, revoke };
}
