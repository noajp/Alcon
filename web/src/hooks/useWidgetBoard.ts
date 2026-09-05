'use client';

import { useCallback, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { migrateBoard, reconcileBoard } from '@/alcon/widget/boardModel';
import type { BoardLayout, StoredBoard } from '@/alcon/widget/types';

interface BoardRow {
  id: string;
  owner_id: string;
  board_key: string;
  layout: StoredBoard;
  revision: number;
}

type Edit = {
  ownerId: string | null;
  boardKey: string;
  legacyKey: string;
  defaults: BoardLayout;
  apply: (layout: BoardLayout) => BoardLayout;
  dismiss?: { id: string; dismissed: boolean };
  reset?: boolean;
};

async function fetchBoard(ownerId: string, boardKey: string): Promise<BoardRow | null> {
  const { data, error } = await supabase.from('widget_boards').select('*')
    .eq('owner_id', ownerId).eq('board_key', boardKey).maybeSingle();
  if (error) throw error;
  return data as BoardRow | null;
}

function initialBoard(legacyKey: string, defaults: BoardLayout): StoredBoard {
  // Import a browser's previous arrangement only when no server board exists.
  // The legacy value stays intact so a failed first save never loses it.
  try {
    const legacy = migrateBoard(JSON.parse(localStorage.getItem(legacyKey) ?? 'null'));
    if (legacy) return { version: 2, zones: reconcileBoard(legacy, defaults), dismissed: [...legacy.dismissed] };
  } catch { /* Unreadable local preferences use the supplied defaults. */ }
  return { version: 2, zones: defaults, dismissed: [] };
}

export function useWidgetBoard(boardKey: string, legacyKey: string, defaults: BoardLayout) {
  const qc = useQueryClient();
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setOwnerId(session?.user.id ?? null);
      setAuthReady(true);
    });
    return () => subscription.unsubscribe();
  }, []);
  const key = ['widget-board', ownerId, boardKey];
  const query = useQuery({
    queryKey: key,
    enabled: !!ownerId,
    queryFn: () => fetchBoard(ownerId!, boardKey),
    staleTime: 0,
  });

  useEffect(() => {
    if (!ownerId) return;
    const channel = supabase.channel(`widget-board:${ownerId}:${boardKey}:${crypto.randomUUID()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'widget_boards' }, () => {
        void qc.invalidateQueries({ queryKey: ['widget-board', ownerId, boardKey] });
      }).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [ownerId, boardKey, qc]);

  const mutation = useMutation({
    // The queue is shared across mounted readers of this exact board.
    mutationKey: ['widget-board-write', ownerId, boardKey],
    scope: { id: `widget-board:${ownerId}:${boardKey}:${crypto.randomUUID()}` },
    retry: false,
    mutationFn: async (edit: Edit) => {
      const { ownerId, boardKey, legacyKey, defaults } = edit;
      if (!ownerId) throw new Error('Sign in to save widgets.');
      // Read inside the serial queue: each edit applies to the latest saved
      // board, including AI edits. Revision matching catches concurrent writers.
      const row = await fetchBoard(ownerId, boardKey);
      const stored = row?.layout ?? initialBoard(legacyKey, defaults);
      const parsed = migrateBoard(stored);
      if (!parsed) throw new Error('This board uses an unsupported format. Reload with the latest app.');
      const current = reconcileBoard(parsed, defaults);
      const next = edit.apply(current);
      const dismissed = edit.reset ? new Set<string>() : parsed.dismissed;
      if (edit.dismiss) {
        if (edit.dismiss.dismissed) dismissed.add(edit.dismiss.id);
        else dismissed.delete(edit.dismiss.id);
      }
      const layout: StoredBoard = { version: 2, zones: next, dismissed: [...dismissed] };
      const result = row
        ? await supabase.from('widget_boards').update({ layout }).eq('id', row.id).eq('revision', row.revision).select().maybeSingle()
        : await supabase.from('widget_boards').insert({ owner_id: ownerId, board_key: boardKey, layout }).select().single();
      if (result.error) throw result.error;
      if (!result.data) throw new Error('The board changed elsewhere. Reload and repeat this edit.');
      return result.data as BoardRow;
    },
    onSuccess: row => { qc.setQueryData(['widget-board', row.owner_id, row.board_key], row); },
    onSettled: (_data, _error, edit) => { void qc.invalidateQueries({ queryKey: ['widget-board', edit.ownerId, edit.boardKey] }); },
  });
  const mutate = mutation.mutate;
  const update = useCallback((apply: Edit['apply'], dismiss?: Edit['dismiss'], reset?: boolean) => {
    mutate({ apply, dismiss, reset, ownerId, boardKey, legacyKey, defaults });
  }, [mutate, ownerId, boardKey, legacyKey, defaults]);
  const parsed = query.data ? migrateBoard(query.data.layout) : null;
  const legacy = query.data === null ? migrateBoard(initialBoard(legacyKey, defaults)) : null;
  const layout = parsed ? reconcileBoard(parsed, defaults) : legacy ? reconcileBoard(legacy, defaults) : defaults;
  const error = mutation.error ?? query.error;
  return {
    layout,
    update,
    loading: !authReady || (!!ownerId && query.isPending),
    saving: mutation.isPending,
    error: error ? error.message : authReady && !ownerId ? 'Sign in to save widgets.' : null,
    retry: () => { mutation.reset(); void query.refetch(); },
  };
}
