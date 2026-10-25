'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { supabase } from '@/lib/supabase';
import { useKata } from './kata/store/useKata';
import { tx } from './kata/i18n';
import type { Deck, Folder, KataFile, MixState, ChatMessage } from './kata/model/types';

// =============================================================
// Slides ⇄ Supabase. The editor keeps its workspace in one store; the Space
// keeps decks and folders as rows (docs/adr/0042). This module loads a Space's
// rows into the store, writes back what the editor changed, and takes in what
// other people changed — the store never has to know where it is saved.
//
// There is one store, so there is one sync: every surface that shows decks
// (the Slides app, a Deck widget, the full-screen editor) shares a session for
// the active Space, counted by who holds it. Writes and the intake of other
// people's changes run one after another in a single queue, so neither ever
// works from a picture the other has since changed. Each deck carries the
// server's updated_at as we last saw it: a write only lands on that version
// (otherwise someone else got there first), and a change that comes back with
// that version is our own echo.
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

const DECK_COLUMNS = 'id, activity_space_id, folder_id, name, deck, mix, chat, updated_at';

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

/**
 * The Space's folders as read just now, merged with this viewer's: folders
 * made here and not yet written stay, folders deleted here and not yet
 * written stay gone, and each keeps whether this viewer has it open.
 */
export function mergeFolders(remote: Folder[], local: Folder[], synced: Folder[]): Folder[] {
  const localById = new Map(local.map((f) => [f.id, f]));
  const syncedIds = new Set(synced.map((f) => f.id));
  const remoteIds = new Set(remote.map((f) => f.id));
  const kept = remote
    .filter((f) => localById.has(f.id) || !syncedIds.has(f.id))
    .map((f) => ({ ...f, open: localById.get(f.id)?.open ?? true }));
  const unsaved = local.filter((f) => !syncedIds.has(f.id) && !remoteIds.has(f.id));
  return [...kept, ...unsaved];
}

/** Postgres and Realtime spell a timestamp differently; compare what they mean. */
export function sameStamp(a: string | undefined | null, b: string | undefined | null) {
  if (!a || !b) return false;
  const norm = (s: string) => s.replace(' ', 'T').replace(/(Z|\+00(:?00)?)$/, '');
  return norm(a) === norm(b);
}

const replaceOrAdd = (files: KataFile[], file: KataFile) =>
  files.some((f) => f.id === file.id) ? files.map((f) => (f.id === file.id ? file : f)) : [...files, file];

const FLUSH_MS = 600;

interface Status { spaceId: string | null; ready: boolean; error: string | null }
let status: Status = { spaceId: null, ready: false, error: null };
const listeners = new Set<() => void>();
const publish = (next: Status) => { status = next; listeners.forEach((l) => l()); };

interface Session { spaceId: string; refs: number; stop: () => void }
let session: Session | null = null;
let pendingStop: ReturnType<typeof setTimeout> | null = null;

function start(spaceId: string): Session {
  let alive = true;
  let loaded = false;
  let synced: Snapshot = { folders: [], files: [] };
  // The server's updated_at for each deck, as we last wrote or read it.
  const stamps = new Map<string, string>();
  // Decks edited here and not yet written: a remote copy must not replace them.
  const dirty = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let queue: Promise<void> = Promise.resolve();
  let unsubscribe = () => {};
  const enqueue = (step: () => Promise<void>) => { queue = queue.then(step).catch(() => {}); };
  const setError = (error: string | null) => { if (alive) publish({ spaceId, ready: loaded, error }); };
  const snapshot = (): Snapshot => { const st = useKata.getState(); return { folders: st.folders, files: st.files }; };

  // The deck someone else changed first: theirs is kept, and this viewer is told.
  const takeTheirs = async (id: string, nextSynced: Snapshot): Promise<Snapshot> => {
    const { data } = await supabase.from('decks').select(DECK_COLUMNS).eq('id', id).maybeSingle();
    dirty.delete(id);
    const name = useKata.getState().files.find((f) => f.id === id)?.name ?? '';
    if (data) {
      const row = data as DeckRow;
      const file = fileFromRow(row);
      stamps.set(id, row.updated_at);
      // Saved before the store sees it, so the store's listener does not take theirs for an edit here.
      synced = { ...synced, files: replaceOrAdd(synced.files, file) };
      if (alive) {
        useKata.setState((s) => ({ files: replaceOrAdd(s.files, file) }));
        useKata.getState().notify(tx(`「${name}」は他の人が先に変えたので、その版に合わせました`, `Someone else changed “${name}” first, so it now shows their version`));
      }
      return { ...nextSynced, files: replaceOrAdd(nextSynced.files, file) };
    }
    stamps.delete(id);
    synced = { ...synced, files: synced.files.filter((f) => f.id !== id) };
    if (alive) {
      useKata.setState((s) => ({ files: s.files.filter((f) => f.id !== id), activeFileId: s.activeFileId === id ? null : s.activeFileId }));
      useKata.getState().notify(tx(`「${name}」は他の人が削除しました`, `Someone else deleted “${name}”`));
    }
    return { ...nextSynced, files: nextSynced.files.filter((f) => f.id !== id) };
  };

  const write = async (next: Snapshot) => {
    const diff = diffWorkspace(synced, next);
    if (isEmpty(diff)) return;
    try {
      if (diff.upsertFolders.length) {
        const { error } = await supabase.from('deck_folders').upsert(
          diff.upsertFolders.map(({ f, i }) => ({ id: f.id, activity_space_id: spaceId, name: f.name.trim().slice(0, 200) || 'Folder', position: i })));
        if (error) throw error;
      }
      const conflicts: string[] = [];
      const fresh = diff.upsertFiles.filter((f) => !stamps.has(f.id));
      if (fresh.length) {
        const { data, error } = await supabase.from('decks').insert(fresh.map((f) => rowFromFile(f, spaceId))).select('id, updated_at');
        if (error) throw error;
        for (const r of (data ?? []) as { id: string; updated_at: string }[]) stamps.set(r.id, r.updated_at);
      }
      for (const f of diff.upsertFiles.filter((x) => stamps.has(x.id) && !fresh.includes(x))) {
        const { data, error } = await supabase.from('decks').update(rowFromFile(f, spaceId))
          .eq('id', f.id).eq('updated_at', stamps.get(f.id)!).select('updated_at');
        if (error) throw error;
        if (data?.length) stamps.set(f.id, (data[0] as { updated_at: string }).updated_at);
        else conflicts.push(f.id);
      }
      if (diff.deleteFiles.length) {
        const { error } = await supabase.from('decks').delete().eq('activity_space_id', spaceId).in('id', diff.deleteFiles);
        if (error) throw error;
        for (const id of diff.deleteFiles) stamps.delete(id);
      }
      if (diff.deleteFolders.length) {
        const { error } = await supabase.from('deck_folders').delete().eq('activity_space_id', spaceId).in('id', diff.deleteFolders);
        if (error) throw error;
      }
      let nextSynced = next;
      for (const id of conflicts) nextSynced = await takeTheirs(id, nextSynced);
      synced = nextSynced;
      // Written as they are now; a deck edited again meanwhile stays pending.
      const current = new Map(useKata.getState().files.map((f) => [f.id, f]));
      for (const f of diff.upsertFiles) if (!conflicts.includes(f.id) && (!alive || current.get(f.id) === f)) dirty.delete(f.id);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the deck.');
    }
  };

  // Read when the step runs, so it writes the latest; a step still queued when
  // the session stops must not read a store that now holds the next Space.
  const flush = () => { timer = null; enqueue(async () => { if (alive) await write(snapshot()); }); };

  // Another viewer's change to one deck: take it unless it is our own echo, or
  // the deck has edits here still to be written (the write will then find the
  // version moved on and keep theirs).
  const takeDeck = (id: string, stamp?: string) => enqueue(async () => {
    if (!alive || dirty.has(id) || sameStamp(stamp, stamps.get(id))) return;
    const here = useKata.getState().files.some((f) => f.id === id);
    if (!here && synced.files.some((f) => f.id === id)) return; // deleted here, not yet written
    const { data } = await supabase.from('decks').select(DECK_COLUMNS).eq('id', id).eq('activity_space_id', spaceId).maybeSingle();
    if (!data || !alive || dirty.has(id)) return;
    const row = data as DeckRow;
    if (sameStamp(row.updated_at, stamps.get(id))) return;
    const file = fileFromRow(row);
    stamps.set(id, row.updated_at);
    synced = { ...synced, files: replaceOrAdd(synced.files, file) };
    useKata.setState((s) => ({ files: replaceOrAdd(s.files, file) }));
  });

  const dropDeck = (id: string) => enqueue(async () => {
    if (!alive || dirty.has(id) || !stamps.has(id)) return;
    stamps.delete(id);
    synced = { ...synced, files: synced.files.filter((f) => f.id !== id) };
    useKata.setState((s) => ({ files: s.files.filter((f) => f.id !== id), activeFileId: s.activeFileId === id ? null : s.activeFileId }));
  });

  const takeFolders = () => enqueue(async () => {
    if (!alive) return;
    const { data, error } = await supabase.from('deck_folders').select('id, activity_space_id, name, position').eq('activity_space_id', spaceId).order('position');
    if (error || !alive) return;
    const remote = ((data ?? []) as FolderRow[]).map((f) => ({ id: f.id, name: f.name, open: true }));
    const folders = mergeFolders(remote, useKata.getState().folders, synced.folders);
    synced = { ...synced, folders: remote };
    useKata.setState({ folders });
  });

  // The store shows this Space only. Keep the deck that was open if it is here too.
  const wanted = useKata.getState().activeFileId;
  useKata.setState({ folders: [], files: [], activeFileId: null, current: 0, history: {} });
  enqueue(async () => {
    const [folders, decks] = await Promise.all([
      supabase.from('deck_folders').select('id, activity_space_id, name, position').eq('activity_space_id', spaceId).order('position'),
      supabase.from('decks').select(DECK_COLUMNS).eq('activity_space_id', spaceId).order('updated_at', { ascending: false }),
    ]);
    if (!alive) return;
    if (folders.error || decks.error) { setError((folders.error ?? decks.error)!.message || 'Could not load decks.'); return; }
    const rows = (decks.data ?? []) as DeckRow[];
    for (const r of rows) stamps.set(r.id, r.updated_at);
    synced = {
      folders: ((folders.data ?? []) as FolderRow[]).map((f) => ({ id: f.id, name: f.name, open: true })),
      files: rows.map(fileFromRow),
    };
    const active = synced.files.find((f) => f.id === wanted)?.id ?? synced.files[0]?.id ?? null;
    useKata.setState({ folders: synced.folders, files: synced.files, activeFileId: active, current: 0 });
    unsubscribe = useKata.subscribe((s, prev) => {
      if (s.folders === prev.folders && s.files === prev.files) return;
      const before = new Map(prev.files.map((f) => [f.id, f]));
      const saved = new Map(synced.files.map((f) => [f.id, f]));
      for (const f of s.files) if (before.get(f.id) !== f && saved.get(f.id) !== f) dirty.add(f.id);
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, FLUSH_MS);
    });
    loaded = true;
    setError(null);
  });

  // Changes are filtered to this Space; deletes cannot be (Realtime sends only
  // the key), so they are matched against the decks and folders known here.
  const channel = supabase.channel(`slides:${spaceId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'decks', filter: `activity_space_id=eq.${spaceId}` },
      (p) => takeDeck(String((p.new as DeckRow).id), (p.new as DeckRow).updated_at))
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'decks', filter: `activity_space_id=eq.${spaceId}` },
      (p) => takeDeck(String((p.new as DeckRow).id), (p.new as DeckRow).updated_at))
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'decks' },
      (p) => { const id = (p.old as { id?: string }).id; if (id) dropDeck(id); })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'deck_folders', filter: `activity_space_id=eq.${spaceId}` }, () => takeFolders())
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'deck_folders', filter: `activity_space_id=eq.${spaceId}` }, () => takeFolders())
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'deck_folders' }, (p) => {
      const id = (p.old as { id?: string }).id;
      if (id && synced.folders.some((f) => f.id === id)) takeFolders();
    })
    .subscribe();

  return {
    spaceId,
    refs: 0,
    stop: () => {
      // Read the last edits now, before the next Space empties the store.
      const last = loaded ? snapshot() : null;
      if (timer) clearTimeout(timer);
      timer = null;
      alive = false;
      unsubscribe();
      void supabase.removeChannel(channel);
      if (last) enqueue(() => write(last));
    },
  };
}

function acquire(spaceId: string) {
  if (pendingStop) { clearTimeout(pendingStop); pendingStop = null; }
  if (session && session.spaceId !== spaceId) { session.stop(); session = null; }
  if (!session) {
    publish({ spaceId, ready: false, error: null });
    session = start(spaceId);
  }
  session.refs += 1;
}

function release(spaceId: string) {
  const held = session;
  if (!held || held.spaceId !== spaceId) return;
  held.refs -= 1;
  if (held.refs > 0) return;
  // A surface that remounts at once (a tab switch, a widget moving) keeps the session.
  pendingStop = setTimeout(() => {
    pendingStop = null;
    if (session !== held || held.refs > 0) return;
    held.stop();
    session = null;
    publish({ spaceId: null, ready: false, error: null });
  }, 0);
}

/** Whether the store holds the active Space's decks yet: before that, anything made in it would be replaced by the load. */
export const slidesReady = () => status.ready;

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const IDLE: Status = { spaceId: null, ready: false, error: null };

/**
 * Keeps the editor's store and a Space's decks in step while any surface
 * holds it. Returns whether the Space has been read, and the last error
 * writing to it.
 */
export function useSlidesSync(spaceId: string | null): { ready: boolean; error: string | null } {
  useEffect(() => {
    if (!spaceId) return;
    acquire(spaceId);
    return () => release(spaceId);
  }, [spaceId]);
  const now = useSyncExternalStore(subscribe, () => status, () => IDLE);
  const mine = !!spaceId && now.spaceId === spaceId;
  return { ready: mine && now.ready, error: mine ? now.error : null };
}
