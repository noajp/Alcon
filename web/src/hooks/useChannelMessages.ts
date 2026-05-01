'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Message } from '@/types/database';

// ============================================
// useChannelMessages — fetches the message log for a channel and
// keeps it in sync with realtime INSERT/UPDATE/DELETE events.
// Provides sendMessage / editMessage / deleteMessage mutations.
// ============================================

interface UseChannelMessagesState {
  messages: Message[];
  loading: boolean;
  error: Error | null;
}

const PAGE_SIZE = 200;

export function useChannelMessages(channelId: string | null) {
  const [state, setState] = useState<UseChannelMessagesState>({
    messages: [],
    loading: !!channelId,
    error: null,
  });

  // Latest channelId is captured so async fetches can detect a switch
  const channelIdRef = useRef(channelId);
  useEffect(() => { channelIdRef.current = channelId; }, [channelId]);

  // ------- initial fetch on channel change -------
  useEffect(() => {
    if (!channelId) {
      setState({ messages: [], loading: false, error: null });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));

    (async () => {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('channel_id', channelId)
        .order('created_at', { ascending: true })
        .limit(PAGE_SIZE);
      if (cancelled) return;
      if (error) {
        setState({ messages: [], loading: false, error });
        return;
      }
      setState({ messages: (data ?? []) as Message[], loading: false, error: null });
    })();

    return () => { cancelled = true; };
  }, [channelId]);

  // ------- realtime subscription -------
  useEffect(() => {
    if (!channelId) return;
    const channel = supabase
      .channel(`messages:${channelId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `channel_id=eq.${channelId}` },
        (payload) => {
          if (channelIdRef.current !== channelId) return;
          const incoming = payload.new as Message;
          setState((s) => {
            if (s.messages.some((m) => m.id === incoming.id)) return s;
            return { ...s, messages: [...s.messages, incoming] };
          });
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages', filter: `channel_id=eq.${channelId}` },
        (payload) => {
          if (channelIdRef.current !== channelId) return;
          const updated = payload.new as Message;
          setState((s) => ({
            ...s,
            messages: s.messages.map((m) => (m.id === updated.id ? updated : m)),
          }));
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'messages', filter: `channel_id=eq.${channelId}` },
        (payload) => {
          if (channelIdRef.current !== channelId) return;
          const old = payload.old as { id: string };
          setState((s) => ({ ...s, messages: s.messages.filter((m) => m.id !== old.id) }));
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [channelId]);

  // ------- mutations -------
  const sendMessage = useCallback(
    async (body: string, author: { id: string | null; kind: 'human' | 'ai_agent'; name: string | null }): Promise<Message> => {
      if (!channelId) throw new Error('No channel');
      const trimmed = body.trim();
      if (!trimmed) throw new Error('Empty message');
      const { data, error } = await supabase
        .from('messages')
        .insert({
          channel_id: channelId,
          body: trimmed,
          author_id: author.id,
          author_kind: author.kind,
          author_name: author.name,
        })
        .select('*')
        .single();
      if (error) throw error;
      const msg = data as Message;
      // Optimistic add — realtime will dedupe via id check
      setState((s) => {
        if (s.messages.some((m) => m.id === msg.id)) return s;
        return { ...s, messages: [...s.messages, msg] };
      });
      return msg;
    },
    [channelId]
  );

  const editMessage = useCallback(async (id: string, body: string) => {
    const trimmed = body.trim();
    if (!trimmed) throw new Error('Empty message');
    const { error } = await supabase
      .from('messages')
      .update({ body: trimmed, edited_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  }, []);

  const deleteMessage = useCallback(async (id: string) => {
    const { error } = await supabase.from('messages').delete().eq('id', id);
    if (error) throw error;
  }, []);

  return {
    messages: state.messages,
    loading: state.loading,
    error: state.error,
    sendMessage,
    editMessage,
    deleteMessage,
  };
}
