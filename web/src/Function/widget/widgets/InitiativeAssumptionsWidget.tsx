'use client';

import { InitiativeAssumptions } from '@/ActivitySpace/strategy/initiative/InitiativeAssumptions';
import { useInitiativeIntentContext } from '@/ActivitySpace/strategy/initiative/InitiativeIntent';
import type { WidgetHost } from '../types';

/** Assumptions — one of the Strategy's hand-written Intent sections. Reads through
 *  the surface's shared Intent context; see InitiativeIntent.tsx for why the
 *  read cannot be per-widget. */
export function InitiativeAssumptionsWidget({ host }: { host: WidgetHost }) {
  const initiative = useInitiativeIntentContext();
  if (!initiative) return null;
  return (
    <InitiativeAssumptions
      initiative={initiative}
      onOpenObject={(objectId, domainId) => host.onNavigate?.({ objectId, domainId })}
    />
  );
}
