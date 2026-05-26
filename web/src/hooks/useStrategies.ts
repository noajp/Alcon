'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuthContext } from '@/providers/AuthProvider';
import type {
  Strategy,
  StrategyChild,
  StrategyInsert,
  StrategyUpdate,
  StrategyScope,
} from '@/types/database';

// ============================================
// useStrategies — DAG-aware CRUD for the Strategy view.
//
// Strategies are "saved aggregation views" that select whole Domains
// and/or Objects, and can contain other Strategies as children
// (DAG — multi-parent allowed). Cycle prevention is enforced here
// before adding an edge.
//
// Returned helpers:
//   strategies            : Strategy[]
//   childrenByParent      : Map<parentId, childId[]>
//   parentsByChild        : Map<childId, parentId[]>
//   roots                 : Strategy[]   — strategies with no parents
//   createStrategy({...}) : insert + optionally addChild under a parent
//   updateStrategy(id, patch)
//   deleteStrategy(id)
//   addChild(parent, child)   — rejects if it would create a cycle
//   removeChild(parent, child)
//   getDescendants(id)        — flatten the DAG below `id` (dedup'd)
//   wouldCreateCycle(parent, child)
// ============================================

interface UseStrategiesState {
  strategies: Strategy[];
  edges: StrategyChild[];
  loading: boolean;
  error: Error | null;
}

export function useStrategies() {
  const { user } = useAuthContext();
  const [state, setState] = useState<UseStrategiesState>({
    strategies: [],
    edges: [],
    loading: true,
    error: null,
  });

  // -------- initial fetch + Realtime subscription --------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [{ data: sRows, error: sErr }, { data: eRows, error: eErr }] = await Promise.all([
        supabase.from('strategies').select('*').order('created_at', { ascending: true }),
        supabase.from('strategy_children').select('*'),
      ]);
      if (cancelled) return;
      if (sErr || eErr) {
        setState({ strategies: [], edges: [], loading: false, error: (sErr ?? eErr) as Error });
        return;
      }
      setState({
        strategies: (sRows ?? []) as Strategy[],
        edges: (eRows ?? []) as StrategyChild[],
        loading: false,
        error: null,
      });
    })();

    const channel = supabase
      .channel('strategies-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'strategies' }, (payload) => {
        setState((prev) => applyStrategyChange(prev, payload as unknown as RealtimePayload<Strategy>));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'strategy_children' }, (payload) => {
        setState((prev) => applyEdgeChange(prev, payload as unknown as RealtimePayload<StrategyChild>));
      })
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, []);

  // -------- derived indexes --------
  const childrenByParent = useMemo(() => {
    const m = new Map<string, string[]>();
    const edges = [...state.edges].sort((a, b) => a.order_index - b.order_index);
    for (const e of edges) {
      const arr = m.get(e.parent_strategy_id) ?? [];
      arr.push(e.child_strategy_id);
      m.set(e.parent_strategy_id, arr);
    }
    return m;
  }, [state.edges]);

  const parentsByChild = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const e of state.edges) {
      const arr = m.get(e.child_strategy_id) ?? [];
      arr.push(e.parent_strategy_id);
      m.set(e.child_strategy_id, arr);
    }
    return m;
  }, [state.edges]);

  const roots = useMemo(
    () => state.strategies.filter((s) => !parentsByChild.has(s.id)),
    [state.strategies, parentsByChild],
  );

  // -------- cycle detection --------
  const wouldCreateCycle = useCallback(
    (parentId: string, childId: string): boolean => {
      if (parentId === childId) return true;
      // Walk descendants of `childId`; if we hit `parentId`, it's a cycle.
      const visited = new Set<string>();
      const stack: string[] = [childId];
      while (stack.length > 0) {
        const cur = stack.pop()!;
        if (visited.has(cur)) continue;
        visited.add(cur);
        if (cur === parentId) return true;
        const kids = childrenByParent.get(cur);
        if (kids) stack.push(...kids);
      }
      return false;
    },
    [childrenByParent],
  );

  // -------- mutations --------
  const createStrategy = useCallback(
    async (
      input: { name: string; description?: string; scope?: StrategyScope; color?: string; icon?: string },
      opts?: { parentStrategyId?: string },
    ): Promise<Strategy | null> => {
      if (!user?.id) {
        setState((s) => ({ ...s, error: new Error('Sign in to create a Strategy.') }));
        return null;
      }
      const payload: StrategyInsert = {
        name: input.name,
        description: input.description ?? null,
        scope: input.scope ?? {},
        color: input.color ?? null,
        icon: input.icon ?? null,
        created_by: user.id,
      };
      const { data, error: insertErr } = await supabase
        .from('strategies')
        .insert(payload)
        .select('*')
        .single();
      if (insertErr || !data) {
        setState((s) => ({ ...s, error: insertErr as Error }));
        return null;
      }

      // Optionally hang it under a parent in the same transaction-ish flow.
      if (opts?.parentStrategyId) {
        const cycleSafe = !wouldCreateCycle(opts.parentStrategyId, data.id);
        if (cycleSafe) {
          await supabase.from('strategy_children').insert({
            parent_strategy_id: opts.parentStrategyId,
            child_strategy_id: data.id,
          });
        }
      }
      return data as Strategy;
    },
    [user?.id, wouldCreateCycle],
  );

  const updateStrategy = useCallback(
    async (id: string, patch: StrategyUpdate): Promise<void> => {
      const { error: updateErr } = await supabase.from('strategies').update(patch).eq('id', id);
      if (updateErr) setState((s) => ({ ...s, error: updateErr as Error }));
    },
    [],
  );

  const deleteStrategy = useCallback(async (id: string): Promise<void> => {
    const { error: delErr } = await supabase.from('strategies').delete().eq('id', id);
    if (delErr) setState((s) => ({ ...s, error: delErr as Error }));
  }, []);

  const addChild = useCallback(
    async (parentId: string, childId: string): Promise<{ ok: boolean; reason?: string }> => {
      if (wouldCreateCycle(parentId, childId)) {
        return { ok: false, reason: 'cycle' };
      }
      const { error: edgeErr } = await supabase
        .from('strategy_children')
        .insert({ parent_strategy_id: parentId, child_strategy_id: childId });
      if (edgeErr) return { ok: false, reason: edgeErr.message };
      return { ok: true };
    },
    [wouldCreateCycle],
  );

  const removeChild = useCallback(
    async (parentId: string, childId: string): Promise<void> => {
      const { error: delErr } = await supabase
        .from('strategy_children')
        .delete()
        .eq('parent_strategy_id', parentId)
        .eq('child_strategy_id', childId);
      if (delErr) setState((s) => ({ ...s, error: delErr as Error }));
    },
    [],
  );

  // -------- traversal helpers --------
  /** Returns every descendant strategy id reachable from `rootId`,
   *  including the root itself. Dedupes naturally (DAG-safe). */
  const getDescendants = useCallback(
    (rootId: string): Set<string> => {
      const out = new Set<string>();
      const stack: string[] = [rootId];
      while (stack.length > 0) {
        const cur = stack.pop()!;
        if (out.has(cur)) continue;
        out.add(cur);
        const kids = childrenByParent.get(cur);
        if (kids) stack.push(...kids);
      }
      return out;
    },
    [childrenByParent],
  );

  /** Aggregate the effective scope of a Strategy subtree: union of
   *  all descendants' domain_ids and object_ids (deduped). Useful
   *  for fetching the Elements that should appear in the Gantt /
   *  list view of `rootId`. */
  const getEffectiveScope = useCallback(
    (rootId: string): { domain_ids: string[]; object_ids: string[] } => {
      const ids = getDescendants(rootId);
      const domains = new Set<string>();
      const objects = new Set<string>();
      const byId = new Map(state.strategies.map((s) => [s.id, s] as const));
      for (const id of ids) {
        const s = byId.get(id);
        if (!s) continue;
        for (const d of s.scope.domain_ids ?? []) domains.add(d);
        for (const o of s.scope.object_ids ?? []) objects.add(o);
      }
      return { domain_ids: [...domains], object_ids: [...objects] };
    },
    [getDescendants, state.strategies],
  );

  return {
    strategies: state.strategies,
    edges: state.edges,
    loading: state.loading,
    error: state.error,
    childrenByParent,
    parentsByChild,
    roots,
    createStrategy,
    updateStrategy,
    deleteStrategy,
    addChild,
    removeChild,
    wouldCreateCycle,
    getDescendants,
    getEffectiveScope,
  };
}

// ============================================
// Realtime reducers — keep state in sync with INSERT/UPDATE/DELETE.
// ============================================

interface RealtimePayload<T> {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  new: T | null;
  old: T | null;
}

function applyStrategyChange(
  state: UseStrategiesState,
  payload: RealtimePayload<Strategy>,
): UseStrategiesState {
  const { eventType, new: nrow, old: orow } = payload;
  if (eventType === 'INSERT' && nrow) {
    if (state.strategies.some((s) => s.id === nrow.id)) return state;
    return { ...state, strategies: [...state.strategies, nrow] };
  }
  if (eventType === 'UPDATE' && nrow) {
    return {
      ...state,
      strategies: state.strategies.map((s) => (s.id === nrow.id ? nrow : s)),
    };
  }
  if (eventType === 'DELETE' && orow) {
    return {
      ...state,
      strategies: state.strategies.filter((s) => s.id !== orow.id),
      edges: state.edges.filter(
        (e) => e.parent_strategy_id !== orow.id && e.child_strategy_id !== orow.id,
      ),
    };
  }
  return state;
}

function applyEdgeChange(
  state: UseStrategiesState,
  payload: RealtimePayload<StrategyChild>,
): UseStrategiesState {
  const { eventType, new: nrow, old: orow } = payload;
  if (eventType === 'INSERT' && nrow) {
    if (
      state.edges.some(
        (e) =>
          e.parent_strategy_id === nrow.parent_strategy_id &&
          e.child_strategy_id === nrow.child_strategy_id,
      )
    ) {
      return state;
    }
    return { ...state, edges: [...state.edges, nrow] };
  }
  if (eventType === 'DELETE' && orow) {
    return {
      ...state,
      edges: state.edges.filter(
        (e) =>
          !(
            e.parent_strategy_id === orow.parent_strategy_id &&
            e.child_strategy_id === orow.child_strategy_id
          ),
      ),
    };
  }
  return state;
}
