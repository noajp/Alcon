'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type {
  Brief,
  BriefComment,
  BriefStructured,
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
  linked_domain_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface NoteContentRow {
  note_id: string;
  html: string | null;
  updated_at: string;
}

interface BriefRow {
  id: string;
  source_note_id: string | null;
  source_note_name: string;
  title: string;
  summary: string;
  structured: BriefStructured | null;
  html_snapshot: string | null;
  created_by: string;
  created_at: string;
}

function rowToNode(r: NoteRow): NoteNode {
  return {
    id: r.id,
    type: r.type,
    name: r.name,
    icon: r.icon ?? undefined,
    parentId: r.parent_id,
    linkedObjectId: r.linked_object_id ?? null,
    linkedDomainId: r.linked_domain_id ?? null,
  };
}

function rowToBrief(r: BriefRow): Brief {
  return {
    id: r.id,
    sourceFileId: r.source_note_id ?? '',
    sourceFileName: r.source_note_name,
    title: r.title,
    summary: r.summary,
    structured: r.structured ?? undefined,
    sourceSnapshot: r.html_snapshot ?? undefined,
    createdBy: r.created_by,
    createdAt: r.created_at,
  };
}

// ============================================
// useNotes — folder/file tree CRUD
// ============================================
export function useNotes() {
  const [nodes, setNodes] = useState<NoteNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchAll = useCallback(async () => {
    const { data, error } = await supabase
      .from('notes')
      .select('*')
      .order('order_index', { ascending: true });
    if (error) throw error;
    return (data as NoteRow[]).map(rowToNode);
  }, []);

  const reload = useCallback(async () => {
    try {
      const list = await fetchAll();
      setNodes(list);
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

  // --- mutations ---
  const createNode = useCallback(
    async (type: NoteNodeType, name: string, parentId: string | null): Promise<NoteNode> => {
      // Resolve a default Cabinet (notebook) — find the first, or spin up a
      // "My Notes" placeholder so freshly signed-up users don't error on
      // their first note. Shared by the folder/file null-parent fallbacks.
      const ensureCabinet = async (): Promise<string> => {
        const { data: existing } = await supabase
          .from('notes')
          .select('id')
          .eq('type', 'notebook')
          .is('parent_id', null)
          .order('order_index', { ascending: true })
          .limit(1)
          .maybeSingle();
        if (existing) return existing.id as string;
        const { data: nb, error: nbErr } = await supabase
          .from('notes')
          .insert({ type: 'notebook', name: 'My Notes', parent_id: null })
          .select('*')
          .single();
        if (nbErr) throw nbErr;
        setNodes((prev) => [...prev, rowToNode(nb as NoteRow)]);
        return nb.id as string;
      };

      // Files always live inside a Folder (no "unfiled" files in the UI). When
      // a caller hands us a null parent for a file (e.g. the global "+ New
      // Note" or the new-note shortcut), drop it into the first existing
      // Folder, creating one under the default Cabinet if none exist yet.
      const ensureFolder = async (): Promise<string> => {
        const { data: existing } = await supabase
          .from('notes')
          .select('id')
          .eq('type', 'folder')
          .order('order_index', { ascending: true })
          .limit(1)
          .maybeSingle();
        if (existing) return existing.id as string;
        const cabinetId = await ensureCabinet();
        const { data: f, error: fErr } = await supabase
          .from('notes')
          .insert({ type: 'folder', name: 'New Folder', parent_id: cabinetId })
          .select('*')
          .single();
        if (fErr) throw fErr;
        setNodes((prev) => [...prev, rowToNode(f as NoteRow)]);
        return f.id as string;
      };

      // DB CHECK requires folder/file rows to have a parent. Resolve defaults
      // when the caller passes null: folders → a Cabinet, files → a Folder.
      let resolvedParentId = parentId;
      if (resolvedParentId === null) {
        if (type === 'folder') resolvedParentId = await ensureCabinet();
        else if (type === 'file') resolvedParentId = await ensureFolder();
      }

      const { data, error } = await supabase
        .from('notes')
        .insert({ type, name, parent_id: resolvedParentId })
        .select('*')
        .single();
      if (error) throw error;
      const node = rowToNode(data as NoteRow);
      setNodes((prev) => [...prev, node]);
      // Ensure content row exists for files so upserts work later.
      if (type === 'file') {
        await supabase.from('note_contents').insert({ note_id: node.id, html: '' });
      }
      return node;
    },
    []
  );

  const renameNode = useCallback(async (id: string, name: string) => {
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, name } : n)));
    const { error } = await supabase.from('notes').update({ name }).eq('id', id);
    if (error) throw error;
  }, []);

  const deleteNode = useCallback(async (id: string) => {
    setNodes((prev) => prev.filter((n) => n.id !== id && n.parentId !== id));
    const { error } = await supabase.from('notes').delete().eq('id', id);
    if (error) throw error;
  }, []);

  /** Move a Note (folder or file) under a new parent. `parentId === null`
   *  promotes it to the tree root. Used by the NotesSidebar DnD + the
   *  "Move to folder…" context menu. */
  const moveNode = useCallback(async (id: string, parentId: string | null) => {
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, parentId } : n)));
    const { error } = await supabase.from('notes').update({ parent_id: parentId }).eq('id', id);
    if (error) throw error;
  }, []);

  /** Persist the Note's link to an Object (or clear it with null). The
   *  PageView header surfaces this so users can hook a Note to an
   *  Object/Domain when extracting bullets into Elements. */
  const setLinkedObject = useCallback(async (id: string, linkedObjectId: string | null) => {
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, linkedObjectId } : n)));
    const { error } = await supabase
      .from('notes')
      .update({ linked_object_id: linkedObjectId })
      .eq('id', id);
    if (error) throw error;
  }, []);

  /** Persist a Notebook's link to a Domain (or clear it with null).
   *  DB CHECK only allows this when the node is type='notebook' — the
   *  caller should gate the UI accordingly. */
  const setLinkedDomain = useCallback(async (id: string, linkedDomainId: string | null) => {
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, linkedDomainId } : n)));
    const { error } = await supabase
      .from('notes')
      .update({ linked_domain_id: linkedDomainId })
      .eq('id', id);
    if (error) throw error;
  }, []);

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
    setLinkedDomain,
  };
}

// ============================================
// useNoteContent — single-file body (debounced save)
// Reads/writes the `html` column. Apple Notes-style HTML is the only
// supported format.
// ============================================
export function useNoteContent(noteId: string | null) {
  const [state, setState] = useState<{ activeId: string | null; html: string; loading: boolean }>({
    activeId: noteId,
    html: '',
    loading: !!noteId,
  });
  if (state.activeId !== noteId) {
    setState({ activeId: noteId, html: '', loading: !!noteId });
  }
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!noteId) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('note_contents')
        .select('html')
        .eq('note_id', noteId)
        .maybeSingle();
      if (cancelled) return;
      const next = !error && data ? ((data as NoteContentRow).html ?? '') : '';
      setState((prev) =>
        prev.activeId === noteId ? { activeId: noteId, html: next, loading: false } : prev
      );
    })();
    return () => {
      cancelled = true;
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [noteId]);

  const save = useCallback(
    (nextHtml: string) => {
      setState((prev) => (prev.activeId === noteId ? { ...prev, html: nextHtml } : prev));
      if (!noteId) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        await supabase
          .from('note_contents')
          .upsert({ note_id: noteId, html: nextHtml }, { onConflict: 'note_id' });
      }, 500);
    },
    [noteId]
  );

  return { html: state.html, loading: state.loading, save };
}

// ============================================
// useBriefs — flat list of brief summaries
// ============================================
export function useBriefs() {
  const [briefs, setBriefs] = useState<Brief[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const reload = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('briefs')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setBriefs((data as BriefRow[]).map(rowToBrief));
      setError(null);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const createBrief = useCallback(
    async (input: {
      sourceNoteId: string;
      sourceNoteName: string;
      title: string;
      summary: string;
      structured?: BriefStructured;
      sourceSnapshot?: string;
    }): Promise<Brief> => {
      const { data, error } = await supabase
        .from('briefs')
        .insert({
          source_note_id: input.sourceNoteId,
          source_note_name: input.sourceNoteName,
          title: input.title,
          summary: input.summary,
          structured: input.structured ?? null,
          html_snapshot: input.sourceSnapshot ?? null,
        })
        .select('*')
        .single();
      if (error) throw error;
      const brief = rowToBrief(data as BriefRow);
      setBriefs((prev) => [brief, ...prev]);
      return brief;
    },
    []
  );

  const deleteBrief = useCallback(async (id: string) => {
    setBriefs((prev) => prev.filter((t) => t.id !== id));
    const { error } = await supabase.from('briefs').delete().eq('id', id);
    if (error) throw error;
  }, []);

  return { briefs, loading, error, reload, createBrief, deleteBrief };
}

// ============================================
// useBriefComments — comments anchored to a Brief
// ============================================
interface BriefCommentRow {
  id: string;
  brief_id: string;
  author_id: string | null;
  author_kind: 'human' | 'ai_agent';
  author_name: string | null;
  content: string;
  created_at: string;
  updated_at: string;
}

function rowToBriefComment(r: BriefCommentRow): BriefComment {
  return {
    id: r.id,
    briefId: r.brief_id,
    authorId: r.author_id,
    authorKind: r.author_kind,
    authorName: r.author_name ?? undefined,
    content: r.content,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function useBriefComments(briefId: string | null) {
  const [state, setState] = useState<{ activeId: string | null; comments: BriefComment[]; loading: boolean }>({
    activeId: briefId,
    comments: [],
    loading: !!briefId,
  });
  // Reset on briefId change without scheduling an effect pass.
  if (state.activeId !== briefId) {
    setState({ activeId: briefId, comments: [], loading: !!briefId });
  }

  useEffect(() => {
    if (!briefId) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('brief_comments')
        .select('*')
        .eq('brief_id', briefId)
        .order('created_at', { ascending: true });
      if (cancelled) return;
      const comments = !error && data ? (data as BriefCommentRow[]).map(rowToBriefComment) : [];
      setState((prev) =>
        prev.activeId === briefId ? { activeId: briefId, comments, loading: false } : prev
      );
    })();
    return () => { cancelled = true; };
  }, [briefId]);

  const addComment = useCallback(
    async (content: string, authorName?: string): Promise<BriefComment | null> => {
      if (!briefId) return null;
      const trimmed = content.trim();
      if (!trimmed) return null;
      const { data, error } = await supabase
        .from('brief_comments')
        .insert({ brief_id: briefId, content: trimmed, author_name: authorName ?? null })
        .select('*')
        .single();
      if (error || !data) throw error ?? new Error('Failed to add comment');
      const comment = rowToBriefComment(data as BriefCommentRow);
      setState((prev) =>
        prev.activeId === briefId
          ? { ...prev, comments: [...prev.comments, comment] }
          : prev
      );
      return comment;
    },
    [briefId]
  );

  const deleteComment = useCallback(async (id: string) => {
    setState((prev) => ({ ...prev, comments: prev.comments.filter((c) => c.id !== id) }));
    const { error } = await supabase.from('brief_comments').delete().eq('id', id);
    if (error) throw error;
  }, []);

  return {
    comments: state.comments,
    loading: state.loading,
    addComment,
    deleteComment,
  };
}

