'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuthContext } from '@/providers/AuthProvider';
import type { ConversationListItem } from '@/types/database';

// ============================================
// useConversations — the current user's chat list (direct + group),
// fetched through the get_my_conversations() RPC (last-message preview
// + unread count + member profiles in one round-trip), kept fresh via
// realtime, plus create / mutate helpers.
// ============================================

interface State {
  conversations: ConversationListItem[];
  loading: boolean;
  error: Error | null;
}

export function useConversations() {
  const { user, profile } = useAuthContext();
  const userId = user?.id ?? null;
  const myName = profile?.display_name ?? user?.email ?? 'Unknown';
  const [state, setState] = useState<State>({
    conversations: [],
    loading: !!userId,
    error: null,
  });

  const reload = useCallback(async () => {
    if (!userId) {
      setState({ conversations: [], loading: false, error: null });
      return;
    }
    const { data, error } = await supabase.rpc('get_my_conversations');
    setState({
      conversations: error ? [] : ((data ?? []) as ConversationListItem[]),
      loading: false,
      error: error ?? null,
    });
  }, [userId]);

  // ------- initial fetch -------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setState((s) => ({ ...s, loading: true, error: null }));
      if (!userId) {
        if (!cancelled) setState({ conversations: [], loading: false, error: null });
        return;
      }
      const { data, error } = await supabase.rpc('get_my_conversations');
      if (cancelled) return;
      setState({
        conversations: error ? [] : ((data ?? []) as ConversationListItem[]),
        loading: false,
        error: error ?? null,
      });
    })();
    return () => { cancelled = true; };
  }, [userId]);

  // ------- realtime: any change to my messages / conversations /
  // memberships re-pulls the list (debounced so a burst is one reload) -------
  useEffect(() => {
    if (!userId) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const bump = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { void reload(); }, 300);
    };
    // Unique per effect run — this hook is mounted by both ChatSidebarPanel
    // and ChatView at once, and a shared channel name would make the second
    // .on() throw ("cannot add callbacks after subscribe()").
    const ch = supabase.channel(`conversations:${userId}:${Math.random().toString(36).slice(2)}`);
    ch.on('postgres_changes', { event: '*', schema: 'public', table: 'direct_messages' }, bump);
    ch.on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, bump);
    ch.on('postgres_changes', { event: '*', schema: 'public', table: 'conversation_members' }, bump);
    ch.subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(ch);
    };
  }, [userId, reload]);

  // ------- mutations -------

  // Centered system notice in the message stream ("X added Y", renames, …).
  // Group conversations only; best-effort — a failed notice never blocks the
  // action it describes.
  const postSystemMessage = useCallback(async (conversationId: string, body: string) => {
    try {
      await supabase.from('direct_messages').insert({
        conversation_id: conversationId,
        body,
        author_id: userId,
        author_name: myName,
        kind: 'system',
      });
    } catch (e) {
      console.error('Failed to post system message', e);
    }
  }, [userId, myName]);

  // Reuses an existing 1:1 conversation if one already exists for this
  // pair — the RPC handles the find-or-create atomically.
  const createDirect = useCallback(async (otherUserId: string): Promise<string> => {
    const { data, error } = await supabase.rpc('find_or_create_direct_conversation', {
      p_other_user: otherUserId,
    });
    if (error) throw error;
    await reload();
    return data as string;
  }, [reload]);

  // Atomic + RLS-safe via a SECURITY DEFINER RPC — a client-side
  // INSERT ... RETURNING would be blocked by the SELECT policy (the
  // creator isn't a member yet at the moment the row is returned).
  const createGroup = useCallback(async (title: string, memberIds: string[]): Promise<string> => {
    const { data, error } = await supabase.rpc('create_group_conversation', {
      p_title: title,
      p_member_ids: memberIds,
    });
    if (error) throw error;
    await reload();
    return data as string;
  }, [reload]);

  const renameConversation = useCallback(async (conversationId: string, title: string) => {
    const trimmed = title.trim();
    const { error } = await supabase
      .from('conversations')
      .update({ title: trimmed || null })
      .eq('id', conversationId);
    if (error) throw error;
    if (trimmed) {
      await postSystemMessage(conversationId, `${myName} がグループ名を「${trimmed}」に変更しました`);
    }
    await reload();
  }, [reload, postSystemMessage, myName]);

  const addMembers = useCallback(
    async (conversationId: string, memberIds: string[], memberNames: string[] = []) => {
      if (memberIds.length === 0) return;
      const { error } = await supabase
        .from('conversation_members')
        .insert(memberIds.map((uid) => ({ conversation_id: conversationId, user_id: uid })));
      if (error) throw error;
      const who = memberNames.length ? memberNames.join('、') : `${memberIds.length}人`;
      await postSystemMessage(conversationId, `${myName} が ${who} を追加しました`);
      await reload();
    },
    [reload, postSystemMessage, myName]
  );

  // Owner-only (enforced by RLS): remove another member from a group.
  const removeMember = useCallback(
    async (conversationId: string, memberId: string, memberName?: string | null) => {
      const { error } = await supabase
        .from('conversation_members')
        .delete()
        .eq('conversation_id', conversationId)
        .eq('user_id', memberId);
      if (error) throw error;
      await postSystemMessage(
        conversationId,
        `${myName} が ${memberName ?? 'メンバー'} を削除しました`
      );
      await reload();
    },
    [reload, postSystemMessage, myName]
  );

  const leaveConversation = useCallback(async (conversationId: string) => {
    if (!userId) return;
    // Post the notice BEFORE dropping membership — once the row is gone the
    // messages INSERT policy would reject us.
    await postSystemMessage(conversationId, `${myName} が退出しました`);
    const { error } = await supabase
      .from('conversation_members')
      .delete()
      .eq('conversation_id', conversationId)
      .eq('user_id', userId);
    if (error) throw error;
    await reload();
  }, [userId, reload, postSystemMessage, myName]);

  // Mark a conversation read up to now. Optimistically clears its unread
  // badge; the persisted last_read_at also drives unread on the next pull.
  const markRead = useCallback(async (conversationId: string) => {
    if (!userId) return;
    setState((s) => ({
      ...s,
      conversations: s.conversations.map((c) =>
        c.id === conversationId ? { ...c, unread_count: 0 } : c
      ),
    }));
    await supabase
      .from('conversation_members')
      .update({ last_read_at: new Date().toISOString() })
      .eq('conversation_id', conversationId)
      .eq('user_id', userId);
  }, [userId]);

  return {
    conversations: state.conversations,
    loading: state.loading,
    error: state.error,
    reload,
    createDirect,
    createGroup,
    renameConversation,
    addMembers,
    removeMember,
    leaveConversation,
    markRead,
  };
}
