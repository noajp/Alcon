'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { IntentMeasureReading } from '@/types/database';

/** How many readings the history shows; older ones stay in the table. */
export const MEASURE_READINGS_LIMIT = 50;

/**
 * The reading history of one success condition, newest first. The database
 * appends a row whenever intents.actual_value / measured_at change, so this is
 * read-only. Callers invalidate ['measure-readings', intentId] after a write.
 */
export function useMeasureReadings(intentId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['measure-readings', intentId],
    enabled: enabled && !!intentId,
    queryFn: async (): Promise<IntentMeasureReading[]> => {
      const { data, error } = await supabase
        .from('intent_measure_readings')
        .select('*')
        .eq('intent_id', intentId)
        .order('recorded_at', { ascending: false })
        .limit(MEASURE_READINGS_LIMIT);
      if (error) throw error;
      return (data ?? []) as IntentMeasureReading[];
    },
  });
}
