'use client';

import { useMemo } from 'react';
import { useStrategies } from '@/hooks/useSupabase';
import { StrategyIntentBody } from '@/alcon/object/overview/StrategyIntentBody';
import { useWidgetEmpty } from '../WidgetFrame';
import type { WidgetHost } from '../types';

/**
 * Initiative intent — the strategic "why" behind this Object, excerpted from
 * the description of the Initiative(s) it feeds.
 *
 * Fetches its own Initiative list rather than being handed one: the host
 * resolves the subject (this Object and its Elements) and nothing more, so a
 * widget that needs Initiatives is the widget that asks for them.
 */
export function InitiativeIntentWidget({ host }: { host: WidgetHost }) {
  const { data: allStrategies } = useStrategies();
  const objectId = host.object?.id;

  const owning = useMemo(
    () => (objectId ? allStrategies.filter((s) => s.objectIds.includes(objectId)) : []),
    [allStrategies, objectId],
  );

  // An Object in no Initiative has no intent to show — the frame hides itself
  // rather than leaving an empty island in the rail.
  useWidgetEmpty(owning.length === 0);
  if (owning.length === 0) return null;

  return (
    <StrategyIntentBody
      strategies={owning}
      onOpenStrategy={(strategyId) => {
        host.onNavigate?.({ strategyId });
        host.onViewChange?.('strategy');
      }}
    />
  );
}
