'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { DirectMessage, DmReaction, DmAttachment } from '@/types/database';

// ============================================
// useConversationMessages — the message log for a chat conversation,
// enriched with reactions + attachments, kept in sync via realtime.
// Mirrors useChannelMessages but targets the chat tables
// (direct_messages / dm_reactions / dm_attachments).
// ============================================

export interface DirectMessageWithExtras extends DirectMessage {
  reactions: DmReaction[];
  attachments: DmAttachment[];
}

export interface PendingAttachment {
  storage_path: string;
  name: string;
  mime: string | null;
  size_bytes: number | null;
}

interface State {
  messages: DirectMessageWithExtras[];
  loading: boolean;
  error: Error | null;
}

const PAGE_SIZE = 200;
const ATTACHMENT_BUCKET = 'message-attachments';

function asWithExtras(m: DirectMessage): DirectMessageWithExtras {
  return { ...m, reactions: [], attachments: [] };
}

export function useConversationMessages(conversationId: string | null) {
  const [state, setState] = useState<State>({
    messages: [],
    loading: !!conversationId,
    error: null,
  });

  const conversationIdRef = useRef(conversationId);
  useEffect(() => { conversationIdRef.current = conversationId; }, [conversationId]);

  // Track which message ids belong to this conversation so realtime events
  // for reactions / attachments (whose payloads carry no conversation_id)
  // can be routed correctly.
  const messageIdsRef = useRef<Set<string>>(new Set());

  // ------- initial fetch on conversation change -------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!conversationId) {
        setState({ messages: [], loading: false, error: null });
        messageIdsRef.current = new Set();
        return;
      }
      setState((s) => ({ ...s, loading: true, error: null }));
      const { data: msgs, error: msgErr } = await supabase
        .from('direct_messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true })
        .limit(PAGE_SIZE);
      if (cancelled) return;
      if (msgErr) {
        setState({ messages: [], loading: false, error: msgErr });
        return;
      }
      const messages = (msgs ?? []) as DirectMessage[];
      const ids = messages.map((m) => m.id);
      messageIdsRef.current = new Set(ids);
      if (ids.length === 0) {
        setState({ messages: [], loading: false, error: null });
        return;
      }
      const [{ data: reactions }, { data: attachments }] = await Promise.all([
        supabase.from('dm_reactions').select('*').in('message_id', ids),
        supabase.from('dm_attachments').select('*').in('message_id', ids),
      ]);
      if (cancelled) return;
      const byMessage = new Map<string, DirectMessageWithExtras>();
      for (const m of messages) byMessage.set(m.id, asWithExtras(m));
      for (const r of (reactions ?? []) as DmReaction[]) {
        byMessage.get(r.message_id)?.reactions.push(r);
      }
      for (const a of (attachments ?? []) as DmAttachment[]) {
        byMessage.get(a.message_id)?.attachments.push(a);
      }
      setState({
        messages: messages.map((m) => byMessage.get(m.id)!),
        loading: false,
        error: null,
      });
    })();

    return () => { cancelled = true; };
  }, [conversationId]);

  // ------- realtime subscriptions -------
  useEffect(() => {
    if (!conversationId) return;
    const ch = supabase.channel(`dm:${conversationId}`);

    // messages
    ch.on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'direct_messages', filter: `conversation_id=eq.${conversationId}` },
      (payload) => {
        if (conversationIdRef.current !== conversationId) return;
        const incoming = payload.new as DirectMessage;
        messageIdsRef.current.add(incoming.id);
        setState((s) => {
          if (s.messages.some((m) => m.id === incoming.id)) return s;
          return { ...s, messages: [...s.messages, asWithExtras(incoming)] };
        });
      }
    );
    ch.on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'direct_messages', filter: `conversation_id=eq.${conversationId}` },
      (payload) => {
        if (conversationIdRef.current !== conversationId) return;
        const updated = payload.new as DirectMessage;
        setState((s) => ({
          ...s,
          messages: s.messages.map((m) => (m.id === updated.id ? { ...m, ...updated } : m)),
        }));
      }
    );
    ch.on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'direct_messages', filter: `conversation_id=eq.${conversationId}` },
      (payload) => {
        if (conversationIdRef.current !== conversationId) return;
        const old = payload.old as { id: string };
        messageIdsRef.current.delete(old.id);
        setState((s) => ({ ...s, messages: s.messages.filter((m) => m.id !== old.id) }));
      }
    );

    // reactions — payload carries no conversation_id, so guard by messageIdsRef
    ch.on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'dm_reactions' },
      (payload) => {
        if (conversationIdRef.current !== conversationId) return;
        const r = payload.new as DmReaction;
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
      { event: 'DELETE', schema: 'public', table: 'dm_reactions' },
      (payload) => {
        if (conversationIdRef.current !== conversationId) return;
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
      { event: 'INSERT', schema: 'public', table: 'dm_attachments' },
      (payload) => {
        if (conversationIdRef.current !== conversationId) return;
        const a = payload.new as DmAttachment;
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
      { event: 'DELETE', schema: 'public', table: 'dm_attachments' },
      (payload) => {
        if (conversationIdRef.current !== conversationId) return;
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
  }, [conversationId]);

  // ------- mutations -------

  const uploadAttachment = useCallback(
    async (userId: string, file: File): Promise<PendingAttachment> => {
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
      const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}`;
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
      author: { id: string | null; name: string | null },
      attachments: PendingAttachment[] = []
    ): Promise<DirectMessage> => {
      if (!conversationId) throw new Error('No conversation');
      const trimmed = body.trim();
      if (!trimmed && attachments.length === 0) throw new Error('Empty message');

      const { data, error } = await supabase
        .from('direct_messages')
        .insert({
          conversation_id: conversationId,
          body: trimmed,
          author_id: author.id,
          author_name: author.name,
        })
        .select('*')
        .single();
      if (error) throw error;
      const msg = data as DirectMessage;

      let savedAttachments: DmAttachment[] = [];
      if (attachments.length > 0) {
        const { data: ins, error: aErr } = await supabase
          .from('dm_attachments')
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
        savedAttachments = (ins ?? []) as DmAttachment[];
      }

      messageIdsRef.current.add(msg.id);
      setState((s) => {
        if (s.messages.some((m) => m.id === msg.id)) return s;
        const enriched: DirectMessageWithExtras = { ...msg, reactions: [], attachments: savedAttachments };
        return { ...s, messages: [...s.messages, enriched] };
      });
      return msg;
    },
    [conversationId]
  );

  const editMessage = useCallback(async (id: string, body: string) => {
    const trimmed = body.trim();
    if (!trimmed) throw new Error('Empty message');
    const { error } = await supabase
      .from('direct_messages')
      .update({ body: trimmed, edited_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  }, []);

  const deleteMessage = useCallback(async (id: string) => {
    const { error } = await supabase.from('direct_messages').delete().eq('id', id);
    if (error) throw error;
  }, []);

  // Toggle a reaction for the current user — delete the matching row if it
  // already exists, otherwise insert one.
  const toggleReaction = useCallback(
    async (messageId: string, emoji: string, userId: string) => {
      const existing = state.messages
        .find((m) => m.id === messageId)
        ?.reactions.find((r) => r.user_id === userId && r.emoji === emoji);
      if (existing) {
        setState((s) => ({
          ...s,
          messages: s.messages.map((m) =>
            m.id === messageId
              ? { ...m, reactions: m.reactions.filter((r) => r.id !== existing.id) }
              : m
          ),
        }));
        const { error } = await supabase.from('dm_reactions').delete().eq('id', existing.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('dm_reactions')
          .insert({ message_id: messageId, user_id: userId, emoji })
          .select('*')
          .single();
        if (error) throw error;
        const r = data as DmReaction;
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
