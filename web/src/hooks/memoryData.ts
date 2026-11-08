'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { fingerprintOf, memoryOf, topicKeyOf, type Memory } from '@/Function/settings/memoryModel';

// Memory, as the settings screens hold it: a Space's memories (read by
// its members — RLS decides; corrected by its owner and by each
// memory's own creator) and a person's own (theirs alone). The engine
// writes through the service role; everything here goes through the
// person's client, so what the screen may do is exactly what the
// policies allow, no more.

const ROW_COLS = 'id, layer, kind, status, scope, activity_space_id, user_id, title, gist, body, topic_key, fingerprint, element_id, domain_id, strategy_id, integration_name, origin, created_by, edited_by, source_run_id, source_session_id, supersedes_id, pinned, use_count, last_used_at, expires_at, created_at, updated_at';

const spaceKey = (spaceId: string | null) => ['space-memories', spaceId] as const;
const personalKey = (userId: string | null) => ['personal-memories', userId] as const;

export interface MemoryListState {
  memories: Memory[];
  autoCapture: boolean | null;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

const toMemories = (rows: unknown[] | null): Memory[] =>
  (rows ?? []).map((r) => memoryOf(r as Record<string, unknown>)).filter((m): m is Memory => !!m);

export function useSpaceMemories(spaceId: string | null): MemoryListState {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: spaceKey(spaceId),
    queryFn: async () => {
      const [mem, space] = await Promise.all([
        supabase.from('memories').select(ROW_COLS).eq('activity_space_id', spaceId!)
          .order('pinned', { ascending: false }).order('created_at', { ascending: false }).limit(300),
        supabase.from('activity_spaces').select('memory_auto_capture').eq('id', spaceId!).maybeSingle(),
      ]);
      if (mem.error) throw mem.error;
      return {
        memories: toMemories(mem.data as unknown[] | null),
        autoCapture: (space.data as { memory_auto_capture?: boolean } | null)?.memory_auto_capture ?? null,
      };
    },
    enabled: !!spaceId,
    staleTime: 10_000,
  });
  return {
    memories: query.data?.memories ?? [],
    autoCapture: query.data?.autoCapture ?? null,
    loading: !!spaceId && query.isPending,
    error: (query.error as Error | null) ?? null,
    refetch: async () => { await qc.invalidateQueries({ queryKey: spaceKey(spaceId) }); },
  };
}

export function usePersonalMemories(userId: string | null): MemoryListState {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: personalKey(userId),
    queryFn: async () => {
      const [mem, profile] = await Promise.all([
        supabase.from('memories').select(ROW_COLS).eq('scope', 'personal').eq('user_id', userId!)
          .order('pinned', { ascending: false }).order('created_at', { ascending: false }).limit(300),
        supabase.from('profiles').select('memory_auto_capture').eq('id', userId!).maybeSingle(),
      ]);
      if (mem.error) throw mem.error;
      return {
        memories: toMemories(mem.data as unknown[] | null),
        autoCapture: (profile.data as { memory_auto_capture?: boolean } | null)?.memory_auto_capture ?? null,
      };
    },
    enabled: !!userId,
    staleTime: 10_000,
  });
  return {
    memories: query.data?.memories ?? [],
    autoCapture: query.data?.autoCapture ?? null,
    loading: !!userId && query.isPending,
    error: (query.error as Error | null) ?? null,
    refetch: async () => { await qc.invalidateQueries({ queryKey: personalKey(userId) }); },
  };
}

export async function setSpaceAutoCapture(spaceId: string, on: boolean): Promise<void> {
  const { error } = await supabase.from('activity_spaces').update({ memory_auto_capture: on }).eq('id', spaceId);
  if (error) throw error;
}

export async function setPersonalAutoCapture(userId: string, on: boolean): Promise<void> {
  const { error } = await supabase.from('profiles').update({ memory_auto_capture: on }).eq('id', userId);
  if (error) throw error;
}

/** A person's correction: title, gist and body. A durable memory's
 *  topic follows its title when it has no topic of its own yet — the
 *  one-fact-one-memory index is what would refuse a collision, and
 *  its refusal is the error the screen shows. */
export async function updateMemory(id: string, patch: { title: string; gist: string; body: string }, userId: string): Promise<void> {
  const { error } = await supabase.from('memories').update({
    title: patch.title, gist: patch.gist, body: patch.body,
    edited_by: userId, updated_at: new Date().toISOString(),
  }).eq('id', id);
  if (error) throw error;
}

export async function deleteMemory(id: string): Promise<void> {
  const { error } = await supabase.from('memories').delete().eq('id', id);
  if (error) throw error;
}

export async function setMemoryPinned(id: string, pinned: boolean): Promise<void> {
  const { error } = await supabase.from('memories').update({ pinned, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

/** Keeps a memory past its layer's fate: an episode the person
 *  promotes by hand — the same movement the third use makes on its
 *  own (the store's promotion, through the person's client). The
 *  topic's standing durable is superseded, never overwritten. */
export async function promoteMemory(m: Memory): Promise<void> {
  const key = m.topic_key ?? topicKeyOf(m.title);
  if (key) {
    let q = supabase.from('memories').select('id')
      .eq('layer', 'durable').eq('status', 'active').eq('topic_key', key).eq('scope', m.scope);
    q = m.scope === 'space' ? q.eq('activity_space_id', m.activity_space_id ?? '') : q.eq('user_id', m.user_id ?? '');
    const { data } = await q.limit(1);
    const target = (data?.[0] as { id: string } | undefined)?.id ?? null;
    if (target && target !== m.id) {
      const { error } = await supabase.from('memories')
        .update({ status: 'superseded', updated_at: new Date().toISOString() })
        .eq('id', target).eq('status', 'active');
      if (error) throw error;
      const { error: linkError } = await supabase.from('memories').update({ supersedes_id: target }).eq('id', m.id);
      if (linkError) throw linkError;
    }
  }
  const { error } = await supabase.from('memories').update({
    layer: 'durable', topic_key: key, expires_at: null, updated_at: new Date().toISOString(),
  }).eq('id', m.id).eq('layer', 'episode');
  if (error) throw error;
}

/** The explicit share: a personal memory is copied into a Space, at
 *  the person's word, after they have seen its body (the screen only
 *  offers this from the opened memory). The copy is the person's own
 *  (origin 'person'); the original stays personal. */
export async function shareMemoryToSpace(m: Memory, spaceId: string, userId: string): Promise<void> {
  const { error } = await supabase.from('memories').insert({
    layer: m.layer, kind: m.kind, status: 'active', scope: 'space',
    activity_space_id: spaceId, user_id: userId,
    title: m.title, gist: m.gist, body: m.body, topic_key: m.topic_key,
    fingerprint: fingerprintOf(m, 'space', spaceId, userId),
    element_id: m.element_id, domain_id: m.domain_id, strategy_id: m.strategy_id, integration_name: m.integration_name,
    origin: 'person', created_by: userId,
    expires_at: m.layer === 'episode' ? m.expires_at : null,
  });
  if (error) throw error;
}

/** The Spaces a personal memory can be shared into: the ones the
 *  person belongs to (RLS names them). */
export async function listMySpaces(userId: string): Promise<{ id: string; name: string }[]> {
  const { data, error } = await supabase.from('activity_space_members')
    .select('activity_space_id, space:activity_spaces(id, name)').eq('user_id', userId);
  if (error) throw error;
  return ((data ?? []) as unknown as { space: { id: string; name: string } | { id: string; name: string }[] | null }[])
    .flatMap((r) => (Array.isArray(r.space) ? r.space : r.space ? [r.space] : []));
}
