'use client';

import { useCallback } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { getQueryClient } from '@/lib/queryClient';
import type { Portfolio, PortfolioInsert, PortfolioUpdate } from '@/types/database';
import { updateStrategy } from '@/ActivitySpace/strategy/initiative/strategyData';

// Portfolios of the active Space. RLS scopes rows to Space members; writes
// are member-level too (a Portfolio is shared grouping, not ownership).
// Putting an Initiative into a Portfolio is a write on the Initiative
// (strategies.portfolio_id), so it follows the Initiative's own rule —
// only its creator can.

const PORTFOLIOS_QUERY_KEY = ['portfolios'] as const;
const EMPTY: Portfolio[] = [];

async function fetchPortfolios(spaceId: string): Promise<Portfolio[]> {
  const { data, error } = await supabase
    .from('portfolios')
    .select('*')
    .eq('activity_space_id', spaceId)
    .order('order_index')
    .order('created_at');
  if (error) throw error;
  return (data ?? []) as Portfolio[];
}

function invalidatePortfolios(): Promise<void> {
  return getQueryClient().invalidateQueries({ queryKey: PORTFOLIOS_QUERY_KEY });
}

export function usePortfolios(spaceId: string | null) {
  const query = useQuery({
    queryKey: [...PORTFOLIOS_QUERY_KEY, spaceId],
    queryFn: () => fetchPortfolios(spaceId!),
    enabled: !!spaceId,
    placeholderData: keepPreviousData,
  });
  const refetch = useCallback(() => invalidatePortfolios(), []);
  return {
    data: query.data ?? EMPTY,
    loading: !!spaceId && query.isPending,
    error: (query.error as Error | null) ?? null,
    refetch,
  };
}

export async function createPortfolio(input: PortfolioInsert): Promise<Portfolio> {
  const { data, error } = await supabase.from('portfolios').insert(input).select().single();
  if (error) throw error;
  void invalidatePortfolios();
  return data as Portfolio;
}

export async function updatePortfolio(id: string, updates: PortfolioUpdate): Promise<Portfolio> {
  const { data, error } = await supabase.from('portfolios').update(updates).eq('id', id).select().single();
  if (error) throw error;
  void invalidatePortfolios();
  return data as Portfolio;
}

export async function deletePortfolio(id: string): Promise<void> {
  const { error } = await supabase.from('portfolios').delete().eq('id', id);
  if (error) throw error;
  void invalidatePortfolios();
  void getQueryClient().invalidateQueries({ queryKey: ['strategies'] });
}

/** Moves an Initiative into a Portfolio (or out of every Portfolio with null). */
export async function setStrategyPortfolio(strategyId: string, portfolioId: string | null): Promise<void> {
  await updateStrategy(strategyId, { portfolio_id: portfolioId });
  void getQueryClient().invalidateQueries({ queryKey: ['strategies'] });
}
