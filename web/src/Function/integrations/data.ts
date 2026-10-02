'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useCurrentUserId } from '@/providers/authContext';
import type { Integration, IntegrationUpdate, Json } from '@/types/database';
import type { IntegrationInsertRow } from './catalog';

// A Space's integrations (ADR 0027): list, create, update, delete, set the
// credential, and run a connection test. RLS lets members read and only
// owners write; the screen mirrors that with useIsSpaceOwner, but the
// database is the boundary.
//
// The credential is write-only from here: it goes to set_integration_secret
// (Vault) and is never selected back. `secret_id` only says whether one is set.

const COLUMNS = 'id, activity_space_id, preset, kind, name, description, icon, endpoint, auth_type, auth_header, secret_id, delegation, enabled, last_test, created_by, created_at, updated_at';

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
  const userId = useCurrentUserId();
  const query = useQuery({
    queryKey: ['space-role', spaceId, userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('activity_space_members')
        .select('role')
        .eq('activity_space_id', spaceId!)
        .eq('user_id', userId!)
        .maybeSingle();
      if (error) throw error;
      return (data?.role as string | undefined) ?? null;
    },
    enabled: !!spaceId && !!userId,
    staleTime: 60_000,
  });
  return query.data === undefined ? null : query.data === 'owner';
}

/** Writes (or, with an empty string, clears) the credential in Vault. */
async function setIntegrationSecret(integrationId: string, secret: string): Promise<void> {
  const { error } = await supabase.rpc('set_integration_secret', { p_integration_id: integrationId, p_secret: secret });
  if (error) throw error;
}

/** Runs the integration-test Edge Function; returns the stored last_test. */
async function testIntegration(integrationId: string): Promise<Json> {
  const { data, error } = await supabase.functions.invoke('integration-test', { body: { integrationId } });
  if (error) {
    let message = error.message;
    if ('context' in error && error.context instanceof Response) {
      try { message = (await error.context.json()).error ?? message; } catch { /* keep the transport error */ }
    }
    throw new Error(message);
  }
  return (data as { last_test: Json }).last_test;
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
    mutationFn: ({ id, value }: { id: string; value: string }) => setIntegrationSecret(id, value),
    onSettled: refresh,
  });

  const test = useMutation({
    mutationFn: async (id: string) => ({ id, lastTest: await testIntegration(id) }),
    onSuccess: ({ id, lastTest }) => {
      qc.setQueryData<Integration[]>(key, (rows) => rows?.map((r) => (r.id === id ? { ...r, last_test: lastTest } : r)));
    },
  });

  return { create, update, remove, secret, test };
}
