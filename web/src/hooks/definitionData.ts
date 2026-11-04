'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

// Definitions: how a goal is to be carried out, written once by a person and
// followed by the agent engine (supabase/functions/_shared/definition.ts reads
// them). A Space keeps a library; a Strategy names the one its Elements
// follow, an Element may name its own. Members of the Space read and write
// (RLS); the author or a Space owner deletes.

export interface Definition {
  id: string;
  activity_space_id: string;
  name: string;
  body: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

const COLUMNS = 'id, activity_space_id, name, body, created_by, created_at, updated_at';
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

export async function createDefinition(input: { spaceId: string; name: string; body: string }): Promise<Definition> {
  const { data, error } = await supabase.from('definitions')
    .insert({ activity_space_id: input.spaceId, name: input.name.trim(), body: input.body })
    .select(COLUMNS).single();
  if (error) throw error;
  return data as Definition;
}

export async function updateDefinition(id: string, updates: { name?: string; body?: string }): Promise<void> {
  const { error } = await supabase.from('definitions').update({ ...updates, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

/** The definition a Strategy's Elements follow (null: none). */
export async function setStrategyDefinition(strategyId: string, definitionId: string | null): Promise<void> {
  const { error } = await supabase.from('strategies').update({ definition_id: definitionId }).eq('id', strategyId);
  if (error) throw error;
}

/** An Element's own definition, over its Strategy's (null: its Strategy's). */
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
