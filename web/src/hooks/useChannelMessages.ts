'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Message, MessageReaction, MessageAttachment } from '@/types/database';

// ============================================
// useChannelMessages — fetches the message log for a channel,
// enriched with reactions + attachments, and keeps everything
// in sync via realtime change feeds.
// ============================================

export interface MessageWithExtras extends Message {
  reactions: MessageReaction[];
  attachments: MessageAttachment[];
}

export interface PendingAttachment {
  storage_path: string;
  name: string;
  mime: string | null;
  size_bytes: number | null;
}

interface UseChannelMessagesState {
  messages: MessageWithExtras[];
  loading: boolean;
  error: Error | null;
}

const PAGE_SIZE = 200;
const ATTACHMENT_BUCKET = 'message-attachments';

function asWithExtras(m: Message): MessageWithExtras {
  return { ...m, reactions: [], attachments: [] };
}

export function useChannelMessages(channelId: string | null) {
  const [state, setState] = useState<UseChannelMessagesState>({
    messages: [],
    loading: !!channelId,
    error: null,
  });

  const channelIdRef = useRef(channelId);
  useEffect(() => { channelIdRef.current = channelId; }, [channelId]);

  // Track which message ids belong to this channel so we can correctly
  // route realtime events for reactions / attachments (whose payloads
  // don't carry channel_id directly).
  const messageIdsRef = useRef<Set<string>>(new Set());

  // ------- initial fetch on channel change -------
  useEffect(() => {
    if (!channelId) {
      setState({ messages: [], loading: false, error: null });
      messageIdsRef.current = new Set();
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));

    (async () => {
      const { data: msgs, error: msgErr } = await supabase
        .from('messages')
        .select('*')
        .eq('channel_id', channelId)
        .order('created_at', { ascending: true })
        .limit(PAGE_SIZE);
      if (cancelled) return;
      if (msgErr) {
        setState({ messages: [], loading: false, error: msgErr });
        return;
      }
      const messages = (msgs ?? []) as Message[];
      const ids = messages.map((m) => m.id);
      messageIdsRef.current = new Set(ids);
      if (ids.length === 0) {
        setState({ messages: [], loading: false, error: null });
        return;
      }
      const [{ data: reactions }, { data: attachments }] = await Promise.all([
        supabase.from('message_reactions').select('*').in('message_id', ids),
        supabase.from('message_attachments').select('*').in('message_id', ids),
      ]);
      if (cancelled) return;
      const byMessage = new Map<string, MessageWithExtras>();
      for (const m of messages) byMessage.set(m.id, asWithExtras(m));
      for (const r of (reactions ?? []) as MessageReaction[]) {
        const m = byMessage.get(r.message_id);
        if (m) m.reactions.push(r);
      }
      for (const a of (attachments ?? []) as MessageAttachment[]) {
        const m = byMessage.get(a.message_id);
        if (m) m.attachments.push(a);
      }
      setState({
        messages: messages.map((m) => byMessage.get(m.id)!),
        loading: false,
        error: null,
      });
    })();

    return () => { cancelled = true; };
  }, [channelId]);

  // ------- realtime subscriptions -------
  useEffect(() => {
    if (!channelId) return;
    const ch = supabase.channel(`messages:${channelId}`);

    // messages
    ch.on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `channel_id=eq.${channelId}` },
      (payload) => {
        if (channelIdRef.current !== channelId) return;
        const incoming = payload.new as Message;
        messageIdsRef.current.add(incoming.id);
        setState((s) => {
          if (s.messages.some((m) => m.id === incoming.id)) return s;
          return { ...s, messages: [...s.messages, asWithExtras(incoming)] };
        });
      }
    );
    ch.on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'messages', filter: `channel_id=eq.${channelId}` },
      (payload) => {
        if (channelIdRef.current !== channelId) return;
        const updated = payload.new as Message;
        setState((s) => ({
          ...s,
          messages: s.messages.map((m) => (m.id === updated.id ? { ...m, ...updated } : m)),
        }));
      }
    );
    ch.on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'messages', filter: `channel_id=eq.${channelId}` },
      (payload) => {
        if (channelIdRef.current !== channelId) return;
        const old = payload.old as { id: string };
        messageIdsRef.current.delete(old.id);
        setState((s) => ({ ...s, messages: s.messages.filter((m) => m.id !== old.id) }));
      }
    );

    // reactions
    ch.on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'message_reactions' },
      (payload) => {
        if (channelIdRef.current !== channelId) return;
        const r = payload.new as MessageReaction;
        if (!messageIdsRef.current.has(r.message_id)) return;
        setState((s) => ({
          ...s,
          messages: s.messages.map((m) =>
            m.id === r.message_id && !m.reactions.some((x) => x.id === r.id)
              ? { ...m, reactions: [...m.reactions, r] }
              : m
          ),
        }));
      }
    );
    ch.on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'message_reactions' },
      (payload) => {
        if (channelIdRef.current !== channelId) return;
        const old = payload.old as { id: string; message_id: string };
        if (!messageIdsRef.current.has(old.message_id)) return;
        setState((s) => ({
          ...s,
          messages: s.messages.map((m) =>
            m.id === old.message_id
              ? { ...m, reactions: m.reactions.filter((x) => x.id !== old.id) }
              : m
          ),
        }));
      }
    );

    // attachments
    ch.on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'message_attachments' },
      (payload) => {
        if (channelIdRef.current !== channelId) return;
        const a = payload.new as MessageAttachment;
        if (!messageIdsRef.current.has(a.message_id)) return;
        setState((s) => ({
          ...s,
          messages: s.messages.map((m) =>
            m.id === a.message_id && !m.attachments.some((x) => x.id === a.id)
              ? { ...m, attachments: [...m.attachments, a] }
              : m
          ),
        }));
      }
    );
    ch.on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'message_attachments' },
      (payload) => {
        if (channelIdRef.current !== channelId) return;
        const old = payload.old as { id: string; message_id: string };
        if (!messageIdsRef.current.has(old.message_id)) return;
        setState((s) => ({
          ...s,
          messages: s.messages.map((m) =>
            m.id === old.message_id
              ? { ...m, attachments: m.attachments.filter((x) => x.id !== old.id) }
              : m
          ),
        }));
      }
    );

    ch.subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [channelId]);

  // ------- mutations -------

  const uploadAttachment = useCallback(
    async (userId: string, file: File): Promise<PendingAttachment> => {
      const ext = file.name.includes('.') ? file.name.split('.').pop() : '';
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
      const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}${ext ? '' : ''}`;
      const { error } = await supabase.storage
        .from(ATTACHMENT_BUCKET)
        .upload(path, file, { contentType: file.type || undefined, upsert: false });
      if (error) throw error;
      return {
        storage_path: path,
        name: file.name,
        mime: file.type || null,
        size_bytes: Number.isFinite(file.size) ? file.size : null,
      };
    },
    []
  );

  const sendMessage = useCallback(
    async (
      body: string,
      author: { id: string | null; kind: 'human' | 'ai_agent'; name: string | null },
      attachments: PendingAttachment[] = []
    ): Promise<Message> => {
      if (!channelId) throw new Error('No channel');
      const trimmed = body.trim();
      if (!trimmed && attachments.length === 0) throw new Error('Empty message');

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

      let savedAttachments: MessageAttachment[] = [];
      if (attachments.length > 0) {
        const { data: ins, error: aErr } = await supabase
          .from('message_attachments')
          .insert(
            attachments.map((a) => ({
              message_id: msg.id,
              storage_path: a.storage_path,
              name: a.name,
              mime: a.mime,
              size_bytes: a.size_bytes,
            }))
          )
          .select('*');
        if (aErr) throw aErr;
        savedAttachments = (ins ?? []) as MessageAttachment[];
      }

      messageIdsRef.current.add(msg.id);
      setState((s) => {
        if (s.messages.some((m) => m.id === msg.id)) return s;
        const enriched: MessageWithExtras = { ...msg, reactions: [], attachments: savedAttachments };
        return { ...s, messages: [...s.messages, enriched] };
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

  // Toggle a reaction for the current user. If the same user/emoji
  // exists, delete it; otherwise insert.
  const toggleReaction = useCallback(
    async (messageId: string, emoji: string, userId: string) => {
      const existing = state.messages
        .find((m) => m.id === messageId)
        ?.reactions.find((r) => r.user_id === userId && r.emoji === emoji);
      if (existing) {
        // optimistic
        setState((s) => ({
          ...s,
          messages: s.messages.map((m) =>
            m.id === messageId
              ? { ...m, reactions: m.reactions.filter((r) => r.id !== existing.id) }
              : m
          ),
        }));
        const { error } = await supabase.from('message_reactions').delete().eq('id', existing.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('message_reactions')
          .insert({ message_id: messageId, user_id: userId, emoji })
          .select('*')
          .single();
        if (error) throw error;
        const r = data as MessageReaction;
        setState((s) => ({
          ...s,
          messages: s.messages.map((m) =>
            m.id === messageId && !m.reactions.some((x) => x.id === r.id)
              ? { ...m, reactions: [...m.reactions, r] }
              : m
          ),
        }));
      }
    },
    [state.messages]
  );

  const attachmentPublicUrl = useCallback((storagePath: string): string => {
    const { data } = supabase.storage.from(ATTACHMENT_BUCKET).getPublicUrl(storagePath);
    return data.publicUrl;
  }, []);

  return {
    messages: state.messages,
    loading: state.loading,
    error: state.error,
    sendMessage,
    editMessage,
    deleteMessage,
    toggleReaction,
    uploadAttachment,
    attachmentPublicUrl,
  };
}
