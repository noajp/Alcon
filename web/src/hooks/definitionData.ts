'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { AiWeight } from '@/types/database';

// Harnesses (stored as `definitions`): how a kind of work is carried out by
// AI, written once by a person and followed by the agent engine
// (supabase/functions/_shared/definition.ts reads and checks them). A Space
// keeps a library and may name one as its default, which a Strategy is
// worked by when it names none; an Element may name its own. Members of the
// Space read and write (RLS); the author or a Space owner deletes.

export interface Definition {
  id: string;
  activity_space_id: string;
  name: string;
  body: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  /** The catalog item it was added from (Settings › AI), if any. */
  source_id: string | null;
  /** The catalog version it was added or last updated from (null: local, or a copy from before versioning). */
  source_version: number | null;
  /** Off means installed but inert: nothing runs, plans from or offers it. */
  enabled: boolean;
  /** The promotion draft this definition was born from, if any (condition 5). */
  promoted_from_draft_id: string | null;
}

const COLUMNS = 'id, activity_space_id, name, body, created_by, created_at, updated_at, source_id, source_version, enabled, promoted_from_draft_id';
const key = (spaceId: string | null) => ['definitions', spaceId ?? 'none'] as const;

export function useDefinitions(spaceId: string | null) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: key(spaceId),
    enabled: !!spaceId,
    queryFn: async () => {
      const { data, error } = await supabase.from('definitions').select(COLUMNS).eq('activity_space_id', spaceId!).order('name');
      if (error) throw error;
      return (data ?? []) as Definition[];
    },
  });
  return {
    data: query.data ?? [],
    loading: !!spaceId && query.isPending,
    refetch: () => qc.invalidateQueries({ queryKey: key(spaceId) }),
  };
}

export async function createDefinition(input: { spaceId: string; name: string; body: string; sourceId?: string | null; sourceVersion?: number | null }): Promise<Definition> {
  const { data, error } = await supabase.from('definitions')
    .insert({ activity_space_id: input.spaceId, name: input.name.trim(), body: input.body, source_id: input.sourceId ?? null, source_version: input.sourceVersion ?? null })
    .select(COLUMNS).single();
  if (error) throw error;
  return data as Definition;
}

/** Turns a harness off or back on. Off is the reversible form of removal: bindings stay, and the engine falls through as if the slot were empty. */
export async function setDefinitionEnabled(id: string, enabled: boolean): Promise<void> {
  const { error } = await supabase.from('definitions').update({ enabled, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

/** Replaces an installed copy with the catalog version it came from. The id, the on/off state and every binding are kept; local edits are not merged. */
export async function applyDefinitionCatalogUpdate(id: string, item: { name: string; body: string; version: number }): Promise<void> {
  const { error } = await supabase.from('definitions')
    .update({ name: item.name, body: item.body, source_version: item.version, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

/** Records that an unmodified pre-versioning copy is the catalog version shown, without touching its text. */
export async function markDefinitionCatalogVersion(id: string, version: number): Promise<void> {
  const { error } = await supabase.from('definitions').update({ source_version: version, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

export async function updateDefinition(id: string, updates: { name?: string; body?: string }): Promise<void> {
  const { error } = await supabase.from('definitions').update({ ...updates, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

/** Takes a definition out of the library; Strategies and Elements that named it follow none. */
export async function deleteDefinition(id: string): Promise<void> {
  const { error } = await supabase.from('definitions').delete().eq('id', id);
  if (error) throw error;
}

/** The harness the Space's Strategies are worked by when they name none (null: Clayware's built-in way). */
export function useSpaceDefaultHarness(spaceId: string | null) {
  const qc = useQueryClient();
  const k = ['space-default-harness', spaceId ?? 'none'] as const;
  const query = useQuery({
    queryKey: k,
    enabled: !!spaceId,
    queryFn: async () => {
      const { data, error } = await supabase.from('activity_spaces').select('default_definition_id').eq('id', spaceId!).maybeSingle();
      if (error) throw error;
      return ((data as { default_definition_id: string | null } | null)?.default_definition_id) ?? null;
    },
  });
  return {
    data: query.data ?? null,
    set: async (definitionId: string | null) => {
      const { error } = await supabase.from('activity_spaces').update({ default_definition_id: definitionId }).eq('id', spaceId!);
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: k });
    },
  };
}

/** The definition a Strategy's Elements follow (null: none). */
export async function setStrategyDefinition(strategyId: string, definitionId: string | null): Promise<void> {
  const { error } = await supabase.from('strategies').update({ definition_id: definitionId }).eq('id', strategyId);
  if (error) throw error;
}

/** An Element's own definition, over its Strategy's (null: its Strategy's). */
/** How heavy an Element's work is for an AI (null: the standard model). */
export async function setElementAiWeight(elementId: string, weight: AiWeight | null): Promise<void> {
  const { error } = await supabase.from('elements').update({ ai_weight: weight }).eq('id', elementId);
  if (error) throw error;
}

export async function setElementDefinition(elementId: string, definitionId: string | null): Promise<void> {
  const { error } = await supabase.from('elements').update({ definition_id: definitionId }).eq('id', elementId);
  if (error) throw error;
}

/** The rounds a loop has run, per Element: how many, the latest and the best value. */
export interface RoundSummary { rounds: number; last: number | null; values: number[] }

export function useRunRounds(elementIds: string[]) {
  const ids = [...elementIds].sort();
  const query = useQuery({
    queryKey: ['run-rounds', ids.join(',')],
    enabled: ids.length > 0,
    staleTime: 5_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('run_iterations').select('element_id, n, value, created_at')
        .in('element_id', ids.slice(0, 200)).order('created_at');
      if (error) throw error;
      const out = new Map<string, RoundSummary>();
      for (const r of (data ?? []) as { element_id: string; value: number | null }[]) {
        const s = out.get(r.element_id) ?? { rounds: 0, last: null, values: [] };
        s.rounds += 1;
        s.last = r.value;
        if (r.value != null) s.values.push(r.value);
        out.set(r.element_id, s);
      }
      return out;
    },
  });
  return query.data ?? new Map<string, RoundSummary>();
}
