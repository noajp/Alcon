'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import {
  SURFACE_SUBJECT,
  applyEdit,
  boardLayout,
  findInstance,
  fitsZone,
  movePosition,
  paramsPatch,
  positionBetween,
  unplacedDefaults,
  type BoardEdit,
  type BoardRows,
} from '@/Function/widget/boardModel';
import { WIDGET_REGISTRY } from '@/Function/widget/registry';
import type { BoardLayout, SubjectKind } from '@/Function/widget/types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface BoardTarget {
  surface: string;
  kind: SubjectKind;
  subjectId: string;
  /** A personal board is kept per Space. */
  spaceId: string | null;
}

async function fetchBoard(target: BoardTarget): Promise<BoardRows | null> {
  const query = supabase.from('boards')
    .select('id, dismissed_defaults, board_placements(id, widget_id, zone, position, size, default_id, widget:widgets(id, kind, params))')
    .eq('surface', target.surface).eq('subject_kind', target.kind).eq('subject_id', target.subjectId);
  // Most boards have never been edited and have no row; asking for a list
  // keeps that ordinary case from being answered as an HTTP error.
  const { data, error } = await (target.spaceId ? query.eq('space_id', target.spaceId) : query.is('space_id', null)).limit(1);
  if (error) throw error;
  // The untyped client reads the embedded widget as a list; a placement has one.
  return (data?.[0] ?? null) as unknown as BoardRows | null;
}

function check({ error }: { error: { message: string } | null }): void {
  if (error) throw new Error(error.message);
}

/** One edit, applied to the board as it is on the server right now. */
async function persistEdit(target: BoardTarget, defaults: BoardLayout, edit: BoardEdit): Promise<void> {
  let rows = await fetchBoard(target);
  if (edit.op === 'reset') {
    // Clears every placement the caller can see and forgets what was
    // dismissed, which leaves the surface's defaults.
    if (rows) check(await supabase.rpc('reset_board', { p_board_id: rows.id }));
    return;
  }
  let layout = boardLayout(rows, defaults);
  const unplaced = unplacedDefaults(layout);
  if (!rows || unplaced.length) {
    // The first edit writes the defaults it was looking at, so the edit below
    // addresses rows. The server derives their ids from the board, so two
    // people making that first edit at once write one set.
    check(await supabase.rpc('ensure_board', {
      p_surface: target.surface,
      p_subject_kind: target.kind,
      p_subject_id: target.kind === 'me' ? null : target.subjectId,
      p_space_id: target.spaceId,
      p_instances: unplaced,
    }));
    rows = await fetchBoard(target);
    if (!rows) throw new Error('This board is unavailable.');
    layout = boardLayout(rows, defaults);
  }

  if (edit.op === 'add') {
    const def = Object.hasOwn(WIDGET_REGISTRY, edit.type) ? WIDGET_REGISTRY[edit.type] : undefined;
    if (!def || !def.zones.includes(edit.zone)) return;
    const items = layout[edit.zone];
    const index = Math.max(0, Math.min(edit.index ?? items.length, items.length));
    check(await supabase.rpc('add_widget', {
      p_board_id: rows.id,
      p_kind: def.type,
      p_zone: edit.zone,
      p_position: positionBetween(items[index - 1]?.position, items[index]?.position),
      p_size: def.defaultSize ?? null,
      p_params: def.normalizeParams?.(undefined) ?? {},
      p_singleton: !!def.singleton,
    }));
    return;
  }

  const found = findInstance(layout, edit.id);
  if (!found?.instance.placementId) return;
  const { zone, instance } = found;
  if (edit.op === 'remove') {
    if (instance.hidden) return;
    check(await supabase.from('board_placements').delete().eq('id', instance.placementId));
  } else if (edit.op === 'move') {
    if (!fitsZone(instance, zone, edit.zone)) return;
    check(await supabase.from('board_placements')
      .update({ zone: edit.zone, position: movePosition(layout, edit.id, edit.zone, edit.index) })
      .eq('id', instance.placementId));
  } else if (edit.op === 'size') {
    check(await supabase.from('board_placements').update({ size: edit.size }).eq('id', instance.placementId));
  } else if (!instance.hidden) {
    check(await supabase.rpc('merge_widget_params', {
      p_widget_id: instance.widgetId,
      p_patch: paramsPatch(instance, edit.params),
    }));
  }
}

/**
 * A surface's board for one subject. `subjectRef` is the subject's id; on a
 * personal surface (Home) the board is the signed-in person's and
 * `subjectRef` is the Space it is kept for.
 */
export function useWidgetBoard(surface: string, defaults: BoardLayout, subjectRef: string) {
  const qc = useQueryClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user.id ?? null);
      setAuthReady(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  const kind = SURFACE_SUBJECT[surface];
  const reference = UUID.test(subjectRef) ? subjectRef : null;
  const subjectId = kind === 'me' ? userId : reference;
  const spaceId = kind === 'me' ? reference : null;
  const key = ['widget-board', surface, subjectId, spaceId];
  const enabled = !!userId && !!kind && !!subjectId;

  const query = useQuery({
    queryKey: key,
    enabled,
    queryFn: () => fetchBoard({ surface, kind, subjectId: subjectId!, spaceId }),
    staleTime: 0,
  });
  const rows = query.data ?? null;
  const stored = useMemo(() => boardLayout(rows, defaults), [rows, defaults]);

  // What the board will look like once the edits in flight land. Shown in
  // place of the stored layout until the last of them has settled and been
  // read back, so a drag does not snap home and then jump.
  const [anticipated, setAnticipated] = useState<{ key: string; layout: BoardLayout } | null>(null);
  const inFlight = useRef(0);
  const scope = key.join(':');
  const layout = anticipated?.key === scope ? anticipated.layout : stored;
  const storedRef = useRef(stored);
  useEffect(() => { storedRef.current = stored; }, [stored]);

  const mutation = useMutation({
    // Serial per board: each edit reads the board the one before it left.
    mutationKey: ['widget-board-write', scope],
    scope: { id: `widget-board:${scope}` },
    retry: false,
    mutationFn: ({ target, edit }: { target: BoardTarget; edit: BoardEdit }) => persistEdit(target, defaults, edit),
    onSettled: async () => {
      await qc.invalidateQueries({ queryKey: key });
      inFlight.current -= 1;
      if (inFlight.current === 0) setAnticipated(null);
    },
  });
  const mutate = mutation.mutate;
  const update = useCallback((edit: BoardEdit) => {
    if (!enabled || !subjectId) return;
    inFlight.current += 1;
    setAnticipated((current) => ({
      key: scope,
      layout: applyEdit(current?.key === scope ? current.layout : storedRef.current, edit, defaults),
    }));
    mutate({ target: { surface, kind, subjectId, spaceId }, edit });
  }, [mutate, enabled, surface, kind, subjectId, spaceId, scope, defaults]);

  const error = mutation.error ?? query.error;
  return {
    layout,
    update,
    loading: !authReady || (enabled && query.isPending),
    saving: mutation.isPending,
    error: error ? error.message : authReady && !userId ? 'Sign in to save widgets.' : null,
    retry: () => { mutation.reset(); void query.refetch(); },
  };
}
