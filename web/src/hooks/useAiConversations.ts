'use client';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

// The AI's kept conversations, the signed-in person's own, in one Space:
// folders, and the conversations in them or loose. Messages are read only
// when a conversation is opened; the list carries titles.

export interface AiFolder { id: string; name: string; created_at: string }
export interface AiSessionSummary { id: string; folder_id: string | null; title: string; updated_at: string }

export function useAiConversations(spaceId: string | null) {
  const [folders, setFolders] = useState<AiFolder[]>([]);
  const [sessions, setSessions] = useState<AiSessionSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!spaceId) { setFolders([]); setSessions([]); return; }
    const [f, s] = await Promise.all([
      supabase.from('ai_folders').select('id,name,created_at').eq('activity_space_id', spaceId).order('created_at'),
      supabase.from('ai_sessions').select('id,folder_id,title,updated_at').eq('activity_space_id', spaceId).order('updated_at', { ascending: false }),
    ]);
    if (f.error || s.error) { setError((f.error ?? s.error)!.message); return; }
    setError(null);
    setFolders(f.data ?? []);
    setSessions(s.data ?? []);
  }, [spaceId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- reads the server when the Space changes
  useEffect(() => { void refetch(); }, [refetch]);

  const createFolder = useCallback(async (name: string): Promise<string | null> => {
    if (!spaceId) return null;
    const { data, error: e } = await supabase.from('ai_folders').insert({ activity_space_id: spaceId, name }).select('id,name,created_at').single();
    if (e || !data) { setError(e?.message ?? 'Could not create the folder.'); return null; }
    setFolders((prev) => [...prev, data]);
    return data.id;
  }, [spaceId]);

  const renameFolder = useCallback(async (id: string, name: string) => {
    setFolders((prev) => prev.map((f) => (f.id === id ? { ...f, name } : f)));
    const { error: e } = await supabase.from('ai_folders').update({ name }).eq('id', id);
    if (e) { setError(e.message); void refetch(); }
  }, [refetch]);

  /** Deletes the folder and the conversations in it. */
  const deleteFolder = useCallback(async (id: string) => {
    setFolders((prev) => prev.filter((f) => f.id !== id));
    setSessions((prev) => prev.filter((s) => s.folder_id !== id));
    const { error: e } = await supabase.from('ai_folders').delete().eq('id', id);
    if (e) { setError(e.message); void refetch(); }
  }, [refetch]);

  const loadMessages = useCallback(async (id: string): Promise<unknown[] | null> => {
    const { data, error: e } = await supabase.from('ai_sessions').select('messages').eq('id', id).single();
    if (e || !data) { setError(e?.message ?? 'Could not open the conversation.'); return null; }
    return Array.isArray(data.messages) ? data.messages : [];
  }, []);

  /** Writes a conversation; without an id it starts one and returns its id. */
  const saveSession = useCallback(async (
    id: string | null, patch: { title?: string; folder_id?: string | null; messages: unknown[] },
  ): Promise<string | null> => {
    if (!spaceId) return null;
    const updated_at = new Date().toISOString();
    if (id) {
      // A session the function created for its anchor starts untitled and
      // loose: the first save fills its title in (only while it is still
      // empty — a rename is never overwritten) and files it in the folder
      // the conversation was started in, when one was chosen.
      const { data: cur } = await supabase.from('ai_sessions').select('title').eq('id', id).maybeSingle();
      const fillTitle = cur && !cur.title && patch.title ? patch.title : null;
      const { data: row, error: e } = await supabase.from('ai_sessions').update({
        messages: patch.messages, updated_at,
        ...(fillTitle ? { title: fillTitle } : {}),
        ...(patch.folder_id != null ? { folder_id: patch.folder_id } : {}),
      }).eq('id', id).select('id,folder_id,title,updated_at').maybeSingle();
      if (e) { setError(e.message); return id; }
      // The row may be new to this list (the function created it for the
      // turn's anchor), so it goes in whether or not it was listed.
      if (row) {
        setSessions((prev) => [row as AiSessionSummary, ...prev.filter((s) => s.id !== id)]
          .sort((x, y) => y.updated_at.localeCompare(x.updated_at)));
      }
      return id;
    }
    const { data, error: e } = await supabase.from('ai_sessions')
      .insert({ activity_space_id: spaceId, title: patch.title ?? '', folder_id: patch.folder_id ?? null, messages: patch.messages })
      .select('id,folder_id,title,updated_at').single();
    if (e || !data) { setError(e?.message ?? 'Could not keep the conversation.'); return null; }
    setSessions((prev) => [data, ...prev]);
    return data.id;
  }, [spaceId]);

  const renameSession = useCallback(async (id: string, title: string) => {
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, title } : s)));
    const { error: e } = await supabase.from('ai_sessions').update({ title }).eq('id', id);
    if (e) { setError(e.message); void refetch(); }
  }, [refetch]);

  const moveSession = useCallback(async (id: string, folderId: string | null) => {
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, folder_id: folderId } : s)));
    const { error: e } = await supabase.from('ai_sessions').update({ folder_id: folderId }).eq('id', id);
    if (e) { setError(e.message); void refetch(); }
  }, [refetch]);

  const deleteSession = useCallback(async (id: string) => {
    setSessions((prev) => prev.filter((s) => s.id !== id));
    const { error: e } = await supabase.from('ai_sessions').delete().eq('id', id);
    if (e) { setError(e.message); void refetch(); }
  }, [refetch]);

  return {
    folders, sessions, error,
    createFolder, renameFolder, deleteFolder,
    loadMessages, saveSession, renameSession, moveSession, deleteSession,
  };
}
