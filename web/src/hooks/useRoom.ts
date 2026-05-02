'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Room, Channel, ChannelKind } from '@/types/database';

// ============================================
// useRoom — fetches (and lazily creates) the Room for a System,
// returns the room + its channels. Seeds default `general` (text)
// and `Voice` (voice) channels on first creation.
// ============================================

interface UseRoomState {
  room: Room | null;
  channels: Channel[];
  loading: boolean;
  error: Error | null;
}

async function fetchRoom(domainId: string): Promise<Room | null> {
  const { data, error } = await supabase
    .from('rooms')
    .select('*')
    .eq('system_id', domainId)
    .maybeSingle();
  if (error) throw error;
  return (data as Room | null) ?? null;
}

async function createRoomWithDefaults(domainId: string): Promise<{ room: Room; channels: Channel[] }> {
  const { data: room, error: roomErr } = await supabase
    .from('rooms')
    .insert({ system_id: domainId })
    .select('*')
    .single();
  if (roomErr) throw roomErr;
  const created = room as Room;

  const { data: defaults, error: chanErr } = await supabase
    .from('channels')
    .insert([
      { room_id: created.id, kind: 'text', name: 'general', position: 0 },
      { room_id: created.id, kind: 'voice', name: 'Voice', position: 0 },
    ])
    .select('*');
  if (chanErr) throw chanErr;
  const channels = (defaults ?? []) as Channel[];

  const generalCh = channels.find((c) => c.kind === 'text');
  if (generalCh) {
    await supabase
      .from('rooms')
      .update({ default_channel_id: generalCh.id })
      .eq('id', created.id);
    created.default_channel_id = generalCh.id;
  }

  return { room: created, channels };
}

async function fetchChannels(roomId: string): Promise<Channel[]> {
  const { data, error } = await supabase
    .from('channels')
    .select('*')
    .eq('room_id', roomId)
    .order('kind', { ascending: true })
    .order('position', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Channel[];
}

export function useRoom(domainId: string | null | undefined) {
  const [state, setState] = useState<UseRoomState>({
    room: null,
    channels: [],
    loading: true,
    error: null,
  });

  const reload = useCallback(async () => {
    if (!domainId) {
      setState({ room: null, channels: [], loading: false, error: null });
      return;
    }
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      let room = await fetchRoom(domainId);
      let channels: Channel[];
      if (!room) {
        const seeded = await createRoomWithDefaults(domainId);
        room = seeded.room;
        channels = seeded.channels;
      } else {
        channels = await fetchChannels(room.id);
      }
      setState({ room, channels, loading: false, error: null });
    } catch (err) {
      setState({ room: null, channels: [], loading: false, error: err as Error });
    }
  }, [domainId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const createChannel = useCallback(
    async (input: { kind: ChannelKind; name: string; topic?: string | null }): Promise<Channel> => {
      if (!state.room) throw new Error('Room not loaded');
      const samePosCount = state.channels.filter((c) => c.kind === input.kind).length;
      const { data, error } = await supabase
        .from('channels')
        .insert({
          room_id: state.room.id,
          kind: input.kind,
          name: input.name,
          topic: input.topic ?? null,
          position: samePosCount,
        })
        .select('*')
        .single();
      if (error) throw error;
      const ch = data as Channel;
      setState((s) => ({ ...s, channels: [...s.channels, ch] }));
      return ch;
    },
    [state.room, state.channels]
  );

  const updateChannel = useCallback(
    async (id: string, patch: { name?: string; topic?: string | null; position?: number }) => {
      const { error } = await supabase.from('channels').update(patch).eq('id', id);
      if (error) throw error;
      setState((s) => ({
        ...s,
        channels: s.channels.map((c) => (c.id === id ? { ...c, ...patch } as Channel : c)),
      }));
    },
    []
  );

  const deleteChannel = useCallback(async (id: string) => {
    const { error } = await supabase.from('channels').delete().eq('id', id);
    if (error) throw error;
    setState((s) => ({ ...s, channels: s.channels.filter((c) => c.id !== id) }));
  }, []);

  // Persist a new ordering for one kind. The caller passes the channel ids
  // in the desired visual order; positions are written as 0..N-1.
  const reorderChannels = useCallback(
    async (kind: ChannelKind, orderedIds: string[]) => {
      // Optimistic local update
      setState((s) => {
        const byId = new Map(s.channels.map((c) => [c.id, c] as const));
        const same = orderedIds
          .map((id, i) => {
            const c = byId.get(id);
            return c ? { ...c, position: i } : null;
          })
          .filter((c): c is Channel => c !== null && c.kind === kind);
        const others = s.channels.filter((c) => c.kind !== kind);
        return { ...s, channels: [...others, ...same] };
      });
      // Persist sequentially (small N — fine without batching)
      for (let i = 0; i < orderedIds.length; i++) {
        const { error } = await supabase
          .from('channels')
          .update({ position: i })
          .eq('id', orderedIds[i]);
        if (error) throw error;
      }
    },
    []
  );

  return {
    room: state.room,
    channels: state.channels,
    loading: state.loading,
    error: state.error,
    reload,
    createChannel,
    updateChannel,
    deleteChannel,
    reorderChannels,
  };
}
