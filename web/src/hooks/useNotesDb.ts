'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getCurrentUserId, supabase } from '@/lib/supabase';
import { useCurrentUserId } from '@/providers/authContext';
import { createNoteContentStore, EMPTY_NOTE_CONTENT } from '@/Function/notebook/noteContentStore';
import type {
  NoteNode,
  NoteNodeType,
} from '@/types/notes';

// ============================================
// Types (DB rows)
// ============================================
interface NoteRow {
  id: string;
  type: NoteNodeType;
  name: string;
  icon: string | null;
  parent_id: string | null;
  order_index: number;
  linked_object_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface NoteContentRow {
  note_id: string;
  html: string | null;
  updated_at: string;
}

function rowToNode(r: NoteRow): NoteNode {
  return {
    id: r.id,
    type: r.type,
    name: r.name,
    icon: r.icon ?? undefined,
    parentId: r.parent_id,
    linkedObjectId: r.linked_object_id ?? null,
    createdBy: r.created_by,
  };
}

// ============================================
// Default onboarding — seed an "App Guide" note
// ============================================

/** App overview written into the seeded readme. Sanitiser-safe HTML
 *  (h1/h2/p/ul/li/strong — see brief/editor/htmlSanitizer). */
const APP_GUIDE_README_HTML = `<h1>Alcon へようこそ</h1>
<p>Alcon は世界最高の組織活動支援ツールを目指しています。企業・軍事作戦・病院など業界を問わず、あらゆる組織活動を業界非依存の少数概念で扱います。</p>
<h2>三分類</h2>
<p>機能は Strategy / Execution / Sustainment の三つに分類されます。全体の体系はクラウゼヴィッツ『戦争論』の 戦略・戦闘・兵站 に着想を得ています。</p>
<ul>
<li><strong>Strategy（戦略）</strong> — 何を達成し、どう勝つか。Initiative が単位で、複数の Initiative を束ねると戦略になる。</li>
<li><strong>Execution（戦闘）</strong> — 実際に行動する。Element → Object → Domain。</li>
<li><strong>Sustainment（兵站）</strong> — 行動を支える仕事道具。</li>
</ul>
<h2>機能</h2>
<h3>Strategy</h3>
<ul>
<li><strong>Initiative</strong> — 複数の Object を束ね、意図・前提・決定・成功条件を持つ。Initiative は Initiative を内包できる</li>
<li><strong>Phase</strong> — 努力をどの段階に配分するかの時間箱</li>
<li><strong>Timeline</strong> — Initiative の期間・シーケンスを Gantt で俯瞰</li>
</ul>
<h3>Execution</h3>
<p>三層はアーレント『人間の条件』の 労働・仕事・活動 に着想を得ています。</p>
<ul>
<li><strong>Element</strong> — 行動の最小単位。複数の Object に同時に所属可能</li>
<li><strong>Object</strong> — Element を束ねる単位。Domain 直下のフラット構造（病棟 / プロジェクト）</li>
<li><strong>Domain</strong> — Object の集合（病院 / 会社 / 作戦）</li>
<li><strong>Property</strong> — 実行単位に付与する型付きメタデータ（期限・担当・ステータス）</li>
</ul>
<h3>Sustainment</h3>
<ul>
<li><strong>Workload</strong> — Worker 別の日次負荷</li>
<li><strong>Notebook</strong> — ドキュメント（議事録 / メモ）</li>
<li><strong>Table</strong> — 任意の表</li>
<li><strong>Team</strong> — Worker と所属</li>
<li><strong>Calendar</strong> — Element の期日を時間軸で管理</li>
</ul>
<h3>Home</h3>
<ul>
<li><strong>Inbox</strong> — 通知フィード</li>
<li><strong>My Elements</strong> — 自分が所有・アサインされた Element</li>
</ul>
<p>このノートはいつでも編集・削除できます。</p>`;

/**
 * Seed a new user's Note space with an "アプリガイド" folder → "readme" file
 * describing the app. Idempotent: a no-op once the App Guide folder exists, so
 * it's safe to call on every login (mirrors ensureSelfWorker). Notes are
 * user-scoped (created_by defaults to auth.uid()). Best-effort — never throws
 * into the auth flow.
 */
export async function ensureAppGuideNotes(): Promise<void> {
  try {
    const { data: existing } = await supabase
      .from('notes')
      .select('id')
      .eq('type', 'folder')
      .eq('name', 'アプリガイド')
      .limit(1)
      .maybeSingle();
    if (existing) return;

    // "アプリガイド" folder at the tree root.
    const { data: folder, error: fErr } = await supabase
      .from('notes')
      .insert({ type: 'folder', name: 'アプリガイド', parent_id: null })
      .select('id')
      .single();
    if (fErr) throw fErr;

    const { data: file, error: fileErr } = await supabase
      .from('notes')
      .insert({ type: 'file', name: 'readme', parent_id: folder.id })
      .select('id')
      .single();
    if (fileErr) throw fileErr;

    await supabase.from('note_contents').insert({ note_id: file.id, html: APP_GUIDE_README_HTML });
  } catch (e) {
    // Onboarding is best-effort; a seeding hiccup must never block login.
    console.error('Failed to seed App Guide notes', e);
  }
}

/**
 * Resolve a Section to hold a "parent-less" new file (the global "+ New
 * Note" shortcut, NotePicker's quick-create) — the first existing Folder's
 * first Section, creating either as needed. Files must land in a Section
 * once one exists (the FilesPane only ever shows the active Section's
 * files), so parenting straight under a Folder that already has Sections
 * would leave the new file unreachable in the UI.
 */
async function ensureNoteHome(): Promise<{
  sectionId: string;
  createdFolder: NoteNode | null;
  createdSection: NoteNode | null;
}> {
  const { data: existingFolder } = await supabase
    .from('notes')
    .select('*')
    .eq('type', 'folder')
    .order('order_index', { ascending: true })
    .limit(1)
    .maybeSingle();
  let folderId: string;
  let createdFolder: NoteNode | null = null;
  if (existingFolder) {
    folderId = (existingFolder as NoteRow).id;
  } else {
    const { data, error } = await supabase
      .from('notes')
      .insert({ type: 'folder', name: 'New Notebook', parent_id: null })
      .select('*')
      .single();
    if (error) throw error;
    createdFolder = rowToNode(data as NoteRow);
    folderId = createdFolder.id;
  }

  const { data: existingSection } = await supabase
    .from('notes')
    .select('*')
    .eq('type', 'section')
    .eq('parent_id', folderId)
    .order('order_index', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (existingSection) {
    return { sectionId: (existingSection as NoteRow).id, createdFolder, createdSection: null };
  }
  const { data, error } = await supabase
    .from('notes')
    .insert({ type: 'section', name: 'New Section', parent_id: folderId })
    .select('*')
    .single();
  if (error) throw error;
  const createdSection = rowToNode(data as NoteRow);
  return { sectionId: createdSection.id, createdFolder, createdSection };
}

// ============================================
// useNotes — folder/file tree CRUD
// ============================================
// Module-level cache — the sidebar's folder tree mounts/unmounts on every
// Note-row toggle (collapse/expand), and without this it flashed empty on
// each remount while the fetch was in flight. Seeding state from the last
// known list makes a re-open instant; reload() below still revalidates.
let notesCache: NoteNode[] | null = null;
// The sidebar, the Notes view and the note picker each mount useNotes, so a
// boot fired the same `notes` select three times. Concurrent callers share
// one in-flight request.
let notesInflight: Promise<NoteNode[]> | null = null;
// Every mounted instance sees the same list: a create in the sidebar's "+"
// has to show up in the notebook list and the open notebook at once, and
// there is no realtime channel on `notes` to do that for us.
const notesListeners = new Set<(list: NoteNode[]) => void>();
function publishNotes(list: NoteNode[]) {
  notesCache = list;
  notesListeners.forEach((fn) => fn(list));
}

export function useNotes() {
  const [nodes, setNodes] = useState<NoteNode[]>(() => notesCache ?? []);
  const [loading, setLoading] = useState(() => notesCache === null);
  const [error, setError] = useState<Error | null>(null);

  const fetchAll = useCallback(() => {
    if (notesInflight) return notesInflight;
    notesInflight = (async () => {
      try {
        const { data, error } = await supabase
          .from('notes')
          .select('*')
          .order('order_index', { ascending: true });
        if (error) throw error;
        return (data as NoteRow[]).map(rowToNode);
      } finally {
        notesInflight = null;
      }
    })();
    return notesInflight;
  }, []);

  useEffect(() => {
    notesListeners.add(setNodes);
    return () => { notesListeners.delete(setNodes); };
  }, []);

  const reload = useCallback(async () => {
    try {
      const list = await fetchAll();
      publishNotes(list);
      setError(null);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  }, [fetchAll]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Every optimistic update below goes through the shared list, so each
  // mounted instance — and a sidebar remount right after a
  // create/rename/delete/move — sees it, instead of reverting to the last
  // *fetched* snapshot.
  const updateNodes = useCallback((updater: (prev: NoteNode[]) => NoteNode[]) => {
    publishNotes(updater(notesCache ?? []));
  }, []);

  // --- mutations ---
  const createNode = useCallback(
    async (type: NoteNodeType, name: string, parentId: string | null): Promise<NoteNode> => {
      // DB CHECK: folders sit at the root (parent_id null); sections and
      // files both require a non-null parent. When a caller passes null:
      // - a Section falls back to the first existing root Folder (creating
      //   one if none exist yet).
      // - a File resolves all the way to a Section via ensureNoteHome, so it
      //   never lands invisibly under a Folder that already has Sections.
      let resolvedParentId = parentId;
      if (type === 'folder') {
        resolvedParentId = null;
      } else if (resolvedParentId === null && type === 'file') {
        const { sectionId, createdFolder, createdSection } = await ensureNoteHome();
        if (createdFolder) updateNodes((prev) => [...prev, createdFolder]);
        if (createdSection) updateNodes((prev) => [...prev, createdSection]);
        resolvedParentId = sectionId;
      } else if (resolvedParentId === null) {
        const { data: existing } = await supabase
          .from('notes')
          .select('id')
          .eq('type', 'folder')
          .order('order_index', { ascending: true })
          .limit(1)
          .maybeSingle();
        if (existing) {
          resolvedParentId = existing.id as string;
        } else {
          const { data: f, error: fErr } = await supabase
            .from('notes')
            .insert({ type: 'folder', name: 'New Folder', parent_id: null })
            .select('*')
            .single();
          if (fErr) throw fErr;
          updateNodes((prev) => [...prev, rowToNode(f as NoteRow)]);
          resolvedParentId = f.id as string;
        }
      }

      const { data, error } = await supabase
        .from('notes')
        .insert({ type, name, parent_id: resolvedParentId })
        .select('*')
        .single();
      if (error) throw error;
      const node = rowToNode(data as NoteRow);
      updateNodes((prev) => [...prev, node]);
      // Ensure content row exists for files so upserts work later.
      if (type === 'file') {
        await supabase.from('note_contents').insert({ note_id: node.id, html: '' });
      }
      return node;
    },
    []
  );

  const renameNode = useCallback(async (id: string, name: string) => {
    updateNodes((prev) => prev.map((n) => (n.id === id ? { ...n, name } : n)));
    const { error } = await supabase.from('notes').update({ name }).eq('id', id);
    // Re-sync from the DB on failure — otherwise the optimistic update sticks
    // in local state even though the write never landed.
    if (error) { void reload(); throw error; }
  }, [reload]);

  const deleteNode = useCallback(async (id: string) => {
    // Drop the node and every descendant (folder → sections → files) so the
    // local tree matches the DB's ON DELETE CASCADE in one pass.
    updateNodes((prev) => {
      const doomed = new Set([id]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const n of prev) {
          if (n.parentId && doomed.has(n.parentId) && !doomed.has(n.id)) {
            doomed.add(n.id);
            grew = true;
          }
        }
      }
      return prev.filter((n) => !doomed.has(n.id));
    });
    const { error } = await supabase.from('notes').delete().eq('id', id);
    if (error) { void reload(); throw error; }
  }, [reload]);

  /** Move a Note (folder or file) under a new parent. `parentId === null`
   *  promotes it to the tree root. Used by the NotesSidebar DnD + the
   *  "Move to folder…" context menu. */
  const moveNode = useCallback(async (id: string, parentId: string | null) => {
    updateNodes((prev) => prev.map((n) => (n.id === id ? { ...n, parentId } : n)));
    const { error } = await supabase.from('notes').update({ parent_id: parentId }).eq('id', id);
    if (error) { void reload(); throw error; }
  }, [reload]);

  /** Persist the Note's link to an Object (or clear it with null). The
   *  PageView header surfaces this so users can hook a Note to an
   *  Object/Domain when extracting bullets into Elements. */
  const setLinkedObject = useCallback(async (id: string, linkedObjectId: string | null) => {
    updateNodes((prev) => prev.map((n) => (n.id === id ? { ...n, linkedObjectId } : n)));
    const { error } = await supabase
      .from('notes')
      .update({ linked_object_id: linkedObjectId })
      .eq('id', id);
    if (error) { void reload(); throw error; }
  }, [reload]);

  return {
    nodes,
    loading,
    error,
    reload,
    createNode,
    renameNode,
    deleteNode,
    moveNode,
    setLinkedObject,
  };
}

// ============================================
// Note content — shared drafts and autosave queues, scoped to the signed-in user.
// ============================================
const contentStores = new Map<string, ReturnType<typeof createNoteContentStore>>();
function contentStoreFor(userId: string) {
  let store = contentStores.get(userId);
  if (!store) {
    const requireSameUser = async () => {
      if (await getCurrentUserId() !== userId) throw new Error('Sign in again to sync your changes.');
    };
    store = createNoteContentStore({
      async read(noteId) {
        await requireSameUser();
        const { data, error } = await supabase.from('note_contents').select('html').eq('note_id', noteId).maybeSingle();
        if (error) throw error;
        return (data as NoteContentRow | null)?.html ?? '';
      },
      async write(noteId, html) {
        await requireSameUser();
        const { error } = await supabase.from('note_contents')
          .upsert({ note_id: noteId, html }, { onConflict: 'note_id' });
        if (error) throw error;
      },
    });
    contentStores.set(userId, store);
  }
  return store;
}

export function useNoteContent(noteId: string | null) {
  const userId = useCurrentUserId();
  const store = userId ? contentStoreFor(userId) : null;
  const subscribe = useCallback((listener: () => void) => {
    return noteId && store ? store.subscribe(noteId, listener) : () => {};
  }, [noteId, store]);
  const snapshot = useCallback(() => noteId && store ? store.getSnapshot(noteId) : EMPTY_NOTE_CONTENT, [noteId, store]);
  const state = useSyncExternalStore(subscribe, snapshot, () => EMPTY_NOTE_CONTENT);

  useEffect(() => {
    if (!noteId || !store) return;
    void store.load(noteId);
    // Cleanup starts the save immediately; it never cancels the pending draft.
    // The store owns the queue after this editor has gone away.
    return () => { void store.flush(noteId); };
  }, [noteId, store]);

  const save = useCallback((html: string) => {
    if (noteId && store?.getSnapshot(noteId).ready) store.edit(noteId, html);
  }, [noteId, store]);
  const retry = useCallback(() => {
    if (noteId && store) void store.retry(noteId);
  }, [noteId, store]);

  return {
    html: state.html,
    // Keep an unreadable Note out of the editor; status consumers show the
    // read error and Retry without presenting a blank body as a saved one.
    loading: !!noteId && (!state.ready || state.loading),
    saving: state.saving || (state.dirty && !state.error),
    error: state.error,
    errorKind: state.errorKind,
    retry,
    save,
  };
}

/** One Note's id and name, or null when the viewer cannot see it (Notes are
 *  their author's own). Shared by every embed of the same Note. */
export function useNoteHeader(noteId: string | null) {
  return useQuery({
    queryKey: ['note-header', noteId],
    enabled: !!noteId,
    queryFn: async () => {
      const { data, error } = await supabase.from('notes').select('id, name').eq('id', noteId!).maybeSingle();
      if (error) throw error;
      return (data ?? null) as { id: string; name: string } | null;
    },
  });
}

export interface NoteFileSummary {
  id: string;
  name: string;
  parent_id: string | null;
  updated_at: string;
}

/** Every Note file the viewer can see, most recently edited first. */
export async function fetchNoteFiles(): Promise<NoteFileSummary[]> {
  const { data, error } = await supabase
    .from('notes')
    .select('id, name, parent_id, updated_at')
    .eq('type', 'file')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as NoteFileSummary[];
}

/** A new, empty Note file. Files need a parent (DB CHECK), so it goes into a
 *  Section rather than a bare Folder — a Folder that has (or gains) Sections
 *  would hide it. The empty content row lets the editor upsert later. */
export async function createNoteFile(name: string): Promise<NoteFileSummary> {
  const { sectionId } = await ensureNoteHome();
  const { data, error } = await supabase
    .from('notes')
    .insert({ type: 'file', name, parent_id: sectionId })
    .select('id, name, parent_id, updated_at')
    .single();
  if (error || !data) throw error ?? new Error('Failed to create note');
  await supabase.from('note_contents').insert({ note_id: data.id, html: '' });
  return data as NoteFileSummary;
}
