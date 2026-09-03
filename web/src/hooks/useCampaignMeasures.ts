'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { selectIn } from '@/hooks/chunkedIn';
import type { Intent } from '@/types/database';

/**
 * Every measure under a set of Campaigns, in one read.
 *
 * `useStrategyIntentBundle` fetches one Campaign's whole Intent tree — ten
 * tables — which is right for the Campaign page and far too much for a lens
 * that wants one column family across a cascade of Campaigns. This asks for
 * the measures of several Campaigns at once, so an Objective tree costs one
 * query rather than one per node.
 */
export function useCampaignMeasures(campaignIds: string[]) {
  // Key-stamped, so a result for a previous set is never shown for the current
  // one and a failure clears with the key rather than through a setState in
  // the effect body.
  const [result, setResult] = useState<{
    key: string;
    measures: Intent[];
    error: Error | null;
  } | null>(null);
  const key = campaignIds.join(' ');

  useEffect(() => {
    if (!key) return;
    const ids = key.split(' ');
    let cancelled = false;
    void (async () => {
      try {
        const rows = await selectIn<Intent>(ids, (chunk) =>
          supabase
            .from('intents')
            .select('*')
            .in('strategy_id', chunk)
            .eq('kind', 'measure')
            .order('order_index', { ascending: true }),
        );
        if (!cancelled) setResult({ key, measures: rows, error: null });
      } catch (e) {
        if (!cancelled) setResult({ key, measures: NO_MEASURES, error: e as Error });
      }
    })();
    return () => { cancelled = true; };
  }, [key]);

  const current = result && result.key === key ? result : null;
  return {
    measures: current?.measures ?? NO_MEASURES,
    loading: Boolean(key) && current === null,
    error: current?.error ?? null,
  };
}

const NO_MEASURES: Intent[] = [];
