'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useKata } from './kata/store/useKata';
import type { Deck, Folder, KataFile, MixState, ChatMessage } from './kata/model/types';

// =============================================================
// Slides ⇄ Supabase. The editor keeps its workspace in a store; the Space
// keeps decks and folders as rows (docs/adr/0042). This module loads a Space's
// rows into the store, writes back what the editor changed, and takes in what
// other people changed — the store never has to know where it is saved.
// =============================================================

export interface DeckRow {
  id: string;
  activity_space_id: string;
  folder_id: string | null;
  name: string;
  deck: Deck;
  mix: MixState;
  chat: ChatMessage[];
  updated_at: string;
}
export interface FolderRow { id: string; activity_space_id: string; name: string; position: number }

export interface Snapshot { folders: Folder[]; files: KataFile[] }

export function fileFromRow(row: DeckRow): KataFile {
  return {
    id: row.id,
    name: row.name,
    folderId: row.folder_id ?? '',
    deck: row.deck,
    mix: { ...{ selected: [], pins: {}, offset: 0 }, ...(row.mix as Partial<MixState>) } as MixState,
    chat: Array.isArray(row.chat) ? row.chat : [],
    updatedAt: Date.parse(row.updated_at) || Date.now(),
  };
}

export function rowFromFile(file: KataFile, spaceId: string) {
  return {
    id: file.id,
    activity_space_id: spaceId,
    folder_id: file.folderId || null,
    name: file.name.trim().slice(0, 200) || 'Untitled deck',
    deck: file.deck,
    mix: file.mix,
    chat: file.chat,
  };
}

/**
 * What to write to bring the server from `prev` to `next`. The store updates
 * immutably, so a file or folder that is the same object did not change. A
 * folder being open or closed is this viewer's, not the Space's.
 */
export function diffWorkspace(prev: Snapshot, next: Snapshot) {
  const prevFolders = new Map(prev.folders.map((f, i) => [f.id, { f, i }]));
  const nextFolderIds = new Set(next.folders.map((f) => f.id));
  const upsertFolders = next.folders
    .map((f, i) => ({ f, i }))
    .filter(({ f, i }) => { const p = prevFolders.get(f.id); return !p || p.f.name !== f.name || p.i !== i; });
  const deleteFolders = prev.folders.filter((f) => !nextFolderIds.has(f.id)).map((f) => f.id);
  const prevFiles = new Map(prev.files.map((f) => [f.id, f]));
  const nextFileIds = new Set(next.files.map((f) => f.id));
  const upsertFiles = next.files.filter((f) => prevFiles.get(f.id) !== f);
  const deleteFiles = prev.files.filter((f) => !nextFileIds.has(f.id)).map((f) => f.id);
  return { upsertFolders, deleteFolders, upsertFiles, deleteFiles };
}

const isEmpty = (d: ReturnType<typeof diffWorkspace>) =>
  !d.upsertFolders.length && !d.deleteFolders.length && !d.upsertFiles.length && !d.deleteFiles.length;

async function loadSpace(spaceId: string): Promise<Snapshot> {
  const [folders, decks] = await Promise.all([
    supabase.from('deck_folders').select('id, activity_space_id, name, position').eq('activity_space_id', spaceId).order('position'),
    supabase.from('decks').select('id, activity_space_id, folder_id, name, deck, mix, chat, updated_at').eq('activity_space_id', spaceId).order('updated_at', { ascending: false }),
  ]);
  if (folders.error) throw folders.error;
  if (decks.error) throw decks.error;
  return {
    folders: ((folders.data ?? []) as FolderRow[]).map((f) => ({ id: f.id, name: f.name, open: true })),
    files: ((decks.data ?? []) as DeckRow[]).map(fileFromRow),
  };
}

const FLUSH_MS = 600;

/**
 * Keeps the editor's store and a Space's decks in step. Returns whether the
 * Space has been read, and the last error writing to it.
 */
export function useSlidesSync(spaceId: string | null): { ready: boolean; error: string | null } {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!spaceId) return;
    let alive = true;
    let synced: Snapshot = { folders: [], files: [] };
    let timer: ReturnType<typeof setTimeout> | null = null;
    let writing: Promise<void> = Promise.resolve();
    // Files edited here and not yet written: a remote copy must not replace them.
    const dirty = new Set<string>();

    const flush = () => {
      timer = null;
      writing = writing.then(async () => {
        const state = useKata.getState();
        const next: Snapshot = { folders: state.folders, files: state.files };
        const diff = diffWorkspace(synced, next);
        if (isEmpty(diff)) return;
        try {
          if (diff.upsertFolders.length) {
            const { error: e } = await supabase.from('deck_folders').upsert(
              diff.upsertFolders.map(({ f, i }) => ({ id: f.id, activity_space_id: spaceId, name: f.name.trim().slice(0, 200) || 'Folder', position: i })));
            if (e) throw e;
          }
          if (diff.upsertFiles.length) {
            const { error: e } = await supabase.from('decks').upsert(diff.upsertFiles.map((f) => rowFromFile(f, spaceId)));
            if (e) throw e;
          }
          if (diff.deleteFiles.length) {
            const { error: e } = await supabase.from('decks').delete().in('id', diff.deleteFiles);
            if (e) throw e;
          }
          if (diff.deleteFolders.length) {
            const { error: e } = await supabase.from('deck_folders').delete().in('id', diff.deleteFolders);
            if (e) throw e;
          }
          synced = next;
          for (const f of diff.upsertFiles) dirty.delete(f.id);
          if (alive) setError(null);
        } catch (e) {
          if (alive) setError(e instanceof Error ? e.message : 'Could not save the deck.');
        }
      });
    };

    let unsubscribe = () => {};
    useKata.setState({ folders: [], files: [], activeFileId: null, current: 0, history: {} });
    void loadSpace(spaceId).then((loaded) => {
      if (!alive) return;
      synced = loaded;
      const st = useKata.getState();
      const active = loaded.files.find((f) => f.id === st.activeFileId)?.id ?? loaded.files[0]?.id ?? null;
      useKata.setState({ folders: loaded.folders, files: loaded.files, activeFileId: active, current: 0 });
      unsubscribe = useKata.subscribe((s, prev) => {
        if (s.folders === prev.folders && s.files === prev.files) return;
        const prevFiles = new Map(prev.files.map((f) => [f.id, f]));
        // A deck taken in from someone else is already saved; only local edits are pending.
        const saved = new Map(synced.files.map((f) => [f.id, f]));
        for (const f of s.files) if (prevFiles.get(f.id) !== f && saved.get(f.id) !== f) dirty.add(f.id);
        if (timer) clearTimeout(timer);
        timer = setTimeout(flush, FLUSH_MS);
      });
      setReady(true);
    }).catch((e) => { if (alive) setError(e instanceof Error ? e.message : 'Could not load decks.'); });

    // Other people's edits: take a deck in unless it has unsaved edits here.
    const channel = supabase.channel(`slides:${spaceId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'decks', filter: `activity_space_id=eq.${spaceId}` }, async (payload) => {
        const id = String((payload.new as { id?: string })?.id ?? (payload.old as { id?: string })?.id ?? '');
        if (!id || dirty.has(id)) return;
        if (payload.eventType === 'DELETE') {
          synced = { ...synced, files: synced.files.filter((f) => f.id !== id) };
          useKata.setState((s) => ({ files: s.files.filter((f) => f.id !== id), activeFileId: s.activeFileId === id ? null : s.activeFileId }));
          return;
        }
        const { data } = await supabase.from('decks').select('id, activity_space_id, folder_id, name, deck, mix, chat, updated_at').eq('id', id).maybeSingle();
        if (!data || dirty.has(id) || !alive) return;
        const file = fileFromRow(data as DeckRow);
        const known = synced.files.find((f) => f.id === id);
        if (known && known.updatedAt >= file.updatedAt && JSON.stringify(known.deck) === JSON.stringify(file.deck) && known.name === file.name) return;
        synced = { ...synced, files: known ? synced.files.map((f) => (f.id === id ? file : f)) : [...synced.files, file] };
        useKata.setState((s) => ({ files: s.files.some((f) => f.id === id) ? s.files.map((f) => (f.id === id ? file : f)) : [...s.files, file] }));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deck_folders', filter: `activity_space_id=eq.${spaceId}` }, async () => {
        const loaded = await loadSpace(spaceId).catch(() => null);
        if (!loaded || !alive) return;
        const open = new Map(useKata.getState().folders.map((f) => [f.id, f.open]));
        const folders = loaded.folders.map((f) => ({ ...f, open: open.get(f.id) ?? true }));
        synced = { ...synced, folders };
        useKata.setState({ folders });
      })
      .subscribe();

    return () => {
      alive = false;
      unsubscribe();
      if (timer) { clearTimeout(timer); flush(); }
      void supabase.removeChannel(channel);
      setReady(false);
    };
  }, [spaceId]);

  return { ready: ready && !!spaceId, error };
}
