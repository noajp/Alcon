'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Ticket, TicketNode, TicketNodeType } from '@/components/ticket/types';

// ============================================
// Types (DB rows)
// ============================================
interface NoteRow {
  id: string;
  type: TicketNodeType;
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

interface TicketRow {
  id: string;
  source_note_id: string | null;
  source_note_name: string;
  title: string;
  summary: string;
  blocks_snapshot: unknown | null;
  created_by: string;
  created_at: string;
}

function rowToNode(r: NoteRow): TicketNode {
  return {
    id: r.id,
    type: r.type,
    name: r.name,
    icon: r.icon ?? undefined,
    parentId: r.parent_id,
  };
}

function rowToTicket(r: TicketRow): Ticket {
  return {
    id: r.id,
    sourceFileId: r.source_note_id ?? '',
    sourceFileName: r.source_note_name,
    title: r.title,
    summary: r.summary,
    createdBy: r.created_by,
    createdAt: r.created_at,
  };
}

// ============================================
// useNotes — folder/file tree CRUD
// ============================================
export function useNotes() {
  const [nodes, setNodes] = useState<TicketNode[]>([]);
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
    async (type: TicketNodeType, name: string, parentId: string | null): Promise<TicketNode> => {
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
// useTickets — flat list of ticket summaries
// ============================================
export function useTickets() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const reload = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('tickets')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setTickets((data as TicketRow[]).map(rowToTicket));
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

  const createTicket = useCallback(
    async (input: {
      sourceNoteId: string;
      sourceNoteName: string;
      title: string;
      summary: string;
    }): Promise<Ticket> => {
      const { data, error } = await supabase
        .from('tickets')
        .insert({
          source_note_id: input.sourceNoteId,
          source_note_name: input.sourceNoteName,
          title: input.title,
          summary: input.summary,
        })
        .select('*')
        .single();
      if (error) throw error;
      const ticket = rowToTicket(data as TicketRow);
      setTickets((prev) => [ticket, ...prev]);
      return ticket;
    },
    []
  );

  const deleteTicket = useCallback(async (id: string) => {
    setTickets((prev) => prev.filter((t) => t.id !== id));
    const { error } = await supabase.from('tickets').delete().eq('id', id);
    if (error) throw error;
  }, []);

  return { tickets, loading, error, reload, createTicket, deleteTicket };
}

// ============================================
// Derived: pick a default file from the node list
// ============================================
export function useDefaultFileId(nodes: TicketNode[], currentId: string | null): string | null {
  return useMemo(() => {
    if (currentId && nodes.some((n) => n.id === currentId && n.type === 'file')) return currentId;
    const first = nodes.find((n) => n.type === 'file');
    return first?.id ?? null;
  }, [nodes, currentId]);
}
