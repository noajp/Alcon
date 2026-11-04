'use client';

import { ascNullsLast } from '@/hooks/strategyData';
import type { PhaseCloseWrite } from '@/Function/strategy/phaseClose';
import { translate } from '@/Function/i18n/I18nProvider';
import { selectIn } from '@/hooks/chunkedIn';
import { getQueryClient } from '@/lib/queryClient';
import { supabase } from '@/lib/supabase';
import type { AlconObject, Element, ElementUpdate, Intent, Phase, PhaseInsert, PhaseStatus, PhaseUpdate, Strategy } from '@/types/database';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { onlyActiveObjects } from '@/Function/shared/objectArchive';


// ============================================
// Phase — Linear-Cycle-style time-boxed periods
// ============================================
//
// Domain-scoped (mirrors Linear's per-team cycles). Objects / Elements join a
// Phase through their own phase_id column — assignment is just
// updateObject/updateElement({ phase_id }), no junction table.

const PHASES_QUERY_PREFIX = ['phases'] as const;

async function fetchPhases(domainId: string): Promise<Phase[]> {
  const { data: rows, error } = await supabase
    .from('phases')
    .select('*')
    .eq('domain_id', domainId)
    .order('start_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (rows || []) as Phase[];
}

function invalidatePhases() {
  void getQueryClient().invalidateQueries({ queryKey: PHASES_QUERY_PREFIX });
}

const EMPTY_PHASES: Phase[] = [];

export function usePhases(domainId: string | null) {
  const query = useQuery({
    queryKey: [...PHASES_QUERY_PREFIX, domainId],
    queryFn: () => fetchPhases(domainId!),
    enabled: !!domainId,
  });
  return {
    data: query.data ?? EMPTY_PHASES,
    loading: !!domainId && query.isPending,
    error: (query.error as Error | null) ?? null,
    refetch: invalidatePhases,
  };
}

// ============================================
// Why a Phase's dates are what they are.
//
// The Strategy layer records the call — what was chosen, what it gave up — and
// binds it to the Phase it moved. Read from the Phase's own side, that binding
// is the answer to the question the Phase surface could not answer before:
// somebody opens a box that is running three weeks long and finds the reason,
// with the name of whoever made the call and the Strategy it was made in.
//
// Read-only on purpose. A Phase does not get to record a decision — a decision
// lives under a Strategy's root Intent, and inventing one from here would put a
// second author on a record whose whole value is that it has one.
// ============================================

export interface PhaseReschedule {
  bindingId: string
  intentId: string
  /** What was decided. */
  title: string
  /** What it gave up. */
  abandoned: string | null
  decidedByName: string | null
  /** ISO timestamp. */
  decidedAt: string | null
  strategyId: string
  strategyName: string
}

async function fetchPhaseReschedules(phaseId: string): Promise<PhaseReschedule[]> {
  const { data: bindingRows, error: bErr } = await supabase
    .from('intent_bindings')
    .select('id, intent_id, target_id')
    .eq('target_type', 'phase')
    .eq('target_id', phaseId)
    .eq('relationship_type', 'reschedules')
  if (bErr) throw bErr

  const bindings = (bindingRows || []) as { id: string; intent_id: string }[]
  if (bindings.length === 0) return []

  const intents = await selectIn<
    Pick<Intent, 'id' | 'title' | 'abandoned' | 'decided_by_name' | 'decided_at' | 'strategy_id'>
  >(
    bindings.map((b) => b.intent_id),
    (chunk) => supabase
      .from('intents')
      .select('id, title, abandoned, decided_by_name, decided_at, strategy_id')
      .in('id', chunk),
  )
  const byIntent = new Map(intents.map((i) => [i.id, i]))

  const strategies = await selectIn<Pick<Strategy, 'id' | 'name'>>(
    [...new Set(intents.map((i) => i.strategy_id))],
    (chunk) => supabase.from('strategies').select('id, name').in('id', chunk),
  )
  const byStrategy = new Map(strategies.map((s) => [s.id, s]))

  // A binding whose Intent is unreadable is dropped rather than shown as a
  // blank row: unlike the Strategy side, there is nothing a reader could do
  // about it here, and a row that says nothing is worse than no row.
  return bindings
    .flatMap((b) => {
      const intent = byIntent.get(b.intent_id)
      if (!intent) return []
      return [{
        bindingId: b.id,
        intentId: intent.id,
        title: intent.title,
        abandoned: intent.abandoned,
        decidedByName: intent.decided_by_name,
        decidedAt: intent.decided_at,
        strategyId: intent.strategy_id,
        strategyName: byStrategy.get(intent.strategy_id)?.name ?? 'Strategy',
      }]
    })
    // Newest call first — the latest one is why the dates are what they are
    // now, and the earlier ones are how they got there.
    .sort((a, b) => (b.decidedAt ?? '').localeCompare(a.decidedAt ?? ''))
}

/**
 * The decisions recorded as having moved this Phase's dates.
 *
 * No loading flag. The section this feeds renders nothing until rows arrive and
 * nothing when there are none, so a third state would have no rendering of its
 * own — and holding it would mean a setState in the effect body, which is the
 * cascading render the lint rule is there to stop.
 */
export function usePhaseReschedules(phaseId: string | null) {
  const [state, setState] = useState<{
    forPhase: string | null
    rows: PhaseReschedule[]
    error: Error | null
  }>({ forPhase: null, rows: [], error: null })

  useEffect(() => {
    if (!phaseId) return
    let cancelled = false
    fetchPhaseReschedules(phaseId)
      .then((rows) => { if (!cancelled) setState({ forPhase: phaseId, rows, error: null }) })
      .catch((e) => {
        // Kept visible rather than swallowed: an empty section and a failed
        // read look identical, and only one of them means "nobody recorded a
        // reason".
        console.error('Failed to read why this Phase moved:', e)
        if (!cancelled) setState({ forPhase: phaseId, rows: [], error: e as Error })
      })
    return () => { cancelled = true }
  }, [phaseId])

  // A result belonging to the Phase that was open a moment ago is not this
  // Phase's answer. Read off the id it was fetched for rather than cleared in
  // the effect, so switching boxes never shows the previous one's reasons.
  const current = state.forPhase === phaseId
  return { data: current ? state.rows : [], error: current ? state.error : null }
}

export async function createPhase(input: PhaseInsert): Promise<Phase> {
  const { data, error } = await supabase.from('phases').insert(input).select().single();
  if (error) throw error;
  return data as Phase;
}

export async function updatePhase(id: string, updates: PhaseUpdate): Promise<Phase> {
  const { data, error } = await supabase
    .from('phases')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data as Phase;
}

export async function deletePhase(id: string): Promise<void> {
  // phase_id FKs are ON DELETE SET NULL — members drop back to "no Phase".
  const { error } = await supabase.from('phases').delete().eq('id', id);
  if (error) throw error;
}

/**
 * Close a Phase: move the unfinished Elements where the closer sent them
 * (`planPhaseClose` decided that), then mark the Phase complete.
 *
 * Elements first, the `phases` row last, because PostgREST gives no
 * transaction across the two: `status = 'complete'` is the only mark that the
 * close happened, so a failed Element write leaves an open Phase that can
 * simply be closed again. Carried Elements have already left this Phase by
 * then, so the retry neither counts them a second time nor loses the rest.
 * The other order would leave a Phase reading closed over work that never
 * moved, with nothing on the surface to say so.
 */
export async function closePhase(
  phaseId: string,
  input: { closingNote: string; elementWrites: readonly PhaseCloseWrite[] },
): Promise<Phase> {
  for (const write of input.elementWrites) {
    const patch: ElementUpdate = { phase_id: write.phase_id, updated_at: new Date().toISOString() };
    if (write.carried_over_count !== undefined) patch.carried_over_count = write.carried_over_count;
    // A write RLS refuses matches no row; count what came back, so a Phase
    // does not close with Elements silently left where they were.
    const written = await selectIn(write.ids, chunk =>
      supabase.from('elements').update(patch).in('id', chunk).select('id'),
    );
    const missed = new Set(write.ids).size - written.length;
    if (missed > 0) throw new Error(translate('{count} Elements could not be moved, so the Phase was not closed.', { count: missed }));
  }
  return updatePhase(phaseId, {
    status: 'complete',
    closed_at: new Date().toISOString(),
    closing_note: input.closingNote.trim() || null,
  });
}

/**
 * Move a Phase back out of `complete`. `closed_at` goes with it — it dates an
 * act that has been undone. `closing_note` stays: what somebody wrote about
 * how the Phase ended is theirs to change, and the close dialog offers it back
 * as the draft next time. Nothing shows it while the Phase is open again.
 */
export async function reopenPhase(phaseId: string, status: Exclude<PhaseStatus, 'complete'>): Promise<Phase> {
  return updatePhase(phaseId, { status, closed_at: null });
}

/** The Element fields the Phase surface reads — membership, progress, and how
 *  many Phases this Element has already been carried through. */
export type PhaseCandidateElement = Pick<
  Element,
  'id' | 'title' | 'status' | 'due_date' | 'phase_id' | 'object_id' | 'carried_over_count'
>;

// Every Object and Element of a Domain with just the fields the Phase surface
// needs — membership rows for each Phase plus candidates for its "+" pickers.
// Elements come via their home Object (domain-direct Elements aren't listed).
export async function fetchPhaseCandidates(domainId: string): Promise<{
  objects: Pick<AlconObject, 'id' | 'name' | 'type' | 'due_date' | 'phase_id'>[];
  elements: PhaseCandidateElement[];
}> {
  const { data: objects, error: oErr } = await onlyActiveObjects(supabase
    .from('objects')
    .select('id, name, type, due_date, phase_id')
    .eq('domain_id', domainId))
    .order('order_index', { ascending: true, nullsFirst: false });
  if (oErr) throw oErr;
  const objectIds = (objects || []).map((o) => o.id);
  if (objectIds.length === 0) return { objects: [], elements: [] };
  // order_index joins the select so the chunks can be reordered back into one
  // Domain-wide sequence; the Phase surface reads the other fields.
  const elements = await selectIn(
    objectIds,
    chunk =>
      supabase
        .from('elements')
        .select('id, title, status, due_date, phase_id, object_id, carried_over_count, order_index')
        .in('object_id', chunk)
        .order('order_index', { ascending: true, nullsFirst: false }),
    { compare: (a, b) => ascNullsLast(a.order_index, b.order_index) },
  );
  return {
    objects: (objects || []) as Pick<AlconObject, 'id' | 'name' | 'type' | 'due_date' | 'phase_id'>[],
    elements: elements as PhaseCandidateElement[],
  };
}

/** These Phases, earliest first. Unreadable or missing ids are simply absent. */
export async function fetchPhasesByIds(ids: string[]): Promise<Phase[]> {
  if (!ids.length) return [];
  const { data } = await supabase
    .from('phases')
    .select('*')
    .in('id', ids)
    .order('start_date', { ascending: true, nullsFirst: false });
  return (data ?? []) as Phase[];
}
