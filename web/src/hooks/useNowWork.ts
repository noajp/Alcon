'use client';

import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useCurrentUserId } from '@/providers/authContext';
import { getActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { CoordinationError, fetchNowWork, type NowWorkData } from '@/hooks/coordinationData';

const EMPTY: NowWorkData = { elements: [], workers: [], objects: [], edges: [], readAt: '' };

export function useNowWork(spaceId: string | null) {
  const userId = useCurrentUserId();
  const enabled = Boolean(userId && spaceId);
  const query = useQuery({
    queryKey: ['nowWork', userId, spaceId],
    queryFn: ({ signal }) => fetchNowWork(spaceId!, signal),
    enabled, staleTime: 0, gcTime: 60_000, refetchOnWindowFocus: true,
    // Never carry another Space/user's data through a context switch.
  });
  const queryRefetch = query.refetch;
  const refetch = useCallback(async (): Promise<NowWorkData> => {
    if (!enabled || getActiveSpaceId() !== spaceId) throw new CoordinationError('Select the current Space before refreshing.', 'CONTEXT_CHANGED');
    const result = await queryRefetch({ throwOnError: true });
    if (getActiveSpaceId() !== spaceId) throw new CoordinationError('The active Space changed. Refresh its work.', 'CONTEXT_CHANGED');
    if (!result.data) throw new CoordinationError('Now data is unavailable.', 'INVALID_RESPONSE');
    return result.data;
  }, [enabled, spaceId, queryRefetch]);
  return {
    data: enabled ? query.data ?? EMPTY : EMPTY,
    loading: enabled && query.isPending,
    refreshing: enabled && query.isFetching && !query.isPending,
    error: enabled ? query.error : new CoordinationError('Sign in and select a Space to see its work.', 'CONTEXT_REQUIRED'),
    enabled, contextKey: JSON.stringify(['nowWork', userId, spaceId]), refetch,
  };
}
