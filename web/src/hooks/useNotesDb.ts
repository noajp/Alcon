'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type {
  Brief,
  BriefComment,
  BriefStructured,
  NoteNode,
  NoteNodeType,
} from '@/components/brief/types';

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
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface NoteContentRow {
  note_id: string;
  blocks: unknown; // jsonb → we store as stringified in app layer
  updated_at: string;
}

interface BriefRow {
  id: string;
  source_note_id: string | null;
  source_note_name: string;
  title: string;
  summary: string;
  structured: BriefStructured | null;
  blocks_snapshot: unknown | null;
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
  };
}

function rowToBrief(r: BriefRow): Brief {
  let sourceSnapshot: string | undefined;
  if (r.blocks_snapshot !== null && r.blocks_snapshot !== undefined) {
    sourceSnapshot =
      typeof r.blocks_snapshot === 'string'
        ? r.blocks_snapshot
        : JSON.stringify(r.blocks_snapshot);
  }
  return {
    id: r.id,
    sourceFileId: r.source_note_id ?? '',
    sourceFileName: r.source_note_name,
    title: r.title,
    summary: r.summary,
    structured: r.structured ?? undefined,
    sourceSnapshot,
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
      const { data, error } = await supabase
        .from('notes')
        .insert({ type, name, parent_id: parentId })
        .select('*')
        .single();
      if (error) throw error;
      const node = rowToNode(data as NoteRow);
      setNodes((prev) => [...prev, node]);
      // Ensure content row exists for files so upserts work later.
      if (type === 'file') {
        await supabase.from('note_contents').insert({ note_id: node.id, blocks: [] });
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

  return { nodes, loading, error, reload, createNode, renameNode, deleteNode };
}

// ============================================
// useNoteContent — single-file body (debounced save)
// ============================================
export function useNoteContent(noteId: string | null) {
  const [state, setState] = useState<{ activeId: string | null; content: string; loading: boolean }>({
    activeId: noteId,
    content: '',
    loading: !!noteId,
  });
  // React's "adjust state while rendering" pattern: reset on noteId change
  // without scheduling an extra effect pass.
  if (state.activeId !== noteId) {
    setState({ activeId: noteId, content: '', loading: !!noteId });
  }
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!noteId) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('note_contents')
        .select('*')
        .eq('note_id', noteId)
        .maybeSingle();
      if (cancelled) return;
      const next: string = !error && data
        ? (typeof (data as NoteContentRow).blocks === 'string'
            ? ((data as NoteContentRow).blocks as string)
            : JSON.stringify((data as NoteContentRow).blocks ?? []))
        : '';
      setState((prev) =>
        prev.activeId === noteId ? { activeId: noteId, content: next, loading: false } : prev
      );
    })();
    return () => {
      cancelled = true;
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [noteId]);

  // Debounced upsert: every 500ms of idle after the latest change.
  const save = useCallback(
    (next: string) => {
      setState((prev) => (prev.activeId === noteId ? { ...prev, content: next } : prev));
      if (!noteId) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        let parsed: unknown = [];
        try { parsed = JSON.parse(next); } catch { parsed = []; }
        await supabase
          .from('note_contents')
          .upsert({ note_id: noteId, blocks: parsed }, { onConflict: 'note_id' });
      }, 500);
    },
    [noteId]
  );

  return { content: state.content, loading: state.loading, save };
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
      let snapshot: unknown = null;
      if (input.sourceSnapshot) {
        try {
          snapshot = JSON.parse(input.sourceSnapshot);
        } catch {
          snapshot = input.sourceSnapshot;
        }
      }
      const { data, error } = await supabase
        .from('briefs')
        .insert({
          source_note_id: input.sourceNoteId,
          source_note_name: input.sourceNoteName,
          title: input.title,
          summary: input.summary,
          structured: input.structured ?? null,
          blocks_snapshot: snapshot,
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

// ============================================
// Derived: pick a default file from the node list
// ============================================
export function useDefaultFileId(nodes: NoteNode[], currentId: string | null): string | null {
  return useMemo(() => {
    if (currentId && nodes.some((n) => n.id === currentId && n.type === 'file')) return currentId;
    const first = nodes.find((n) => n.type === 'file');
    return first?.id ?? null;
  }, [nodes, currentId]);
}
