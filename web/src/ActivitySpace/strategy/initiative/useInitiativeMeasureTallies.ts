'use client';

import { useMemo } from 'react';
import { useInitiativeMeasures } from '@/hooks/useInitiativeMeasures';
import { talliesByInitiative, type MeasureTally } from './initiativeMeasureModel';

const EMPTY = new Map<string, MeasureTally>();

/** Success-condition tallies for every Strategy in a list, from one read of
 *  their measures. Empty until the read lands, so a row shows nothing rather
 *  than a premature "no success conditions". Shares the `initiative-measures`
 *  cache key, so an edit on the Strategy page refreshes the list. */
export function useInitiativeMeasureTallies(initiativeIds: string[]): Map<string, MeasureTally> {
  const { measures, loading, error } = useInitiativeMeasures(initiativeIds);
  const key = [...new Set(initiativeIds)].sort().join(',');
  return useMemo(() => {
    if (loading || error || !key) return EMPTY;
    return talliesByInitiative(key.split(','), measures.map((row) => ({
      initiativeId: row.strategy_id,
      id: row.id,
      title: row.title,
      target: row.target_value ?? null,
      actual: row.actual_value ?? null,
      unit: row.unit ?? null,
      direction: row.direction ?? null,
      measuredAt: row.measured_at ?? null,
      orderIndex: row.order_index ?? 0,
    })));
  }, [key, measures, loading, error]);
}
