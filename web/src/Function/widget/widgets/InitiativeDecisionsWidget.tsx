'use client';

import { InitiativeDecisions } from '@/ActivitySpace/strategy/initiative/InitiativeDecisions';
import { useInitiativeIntentContext } from '@/ActivitySpace/strategy/initiative/InitiativeIntent';
import type { WidgetHost } from '../types';

/** Decisions — one of the Strategy's hand-written Intent sections. Reads through
 *  the surface's shared Intent context; see InitiativeIntent.tsx for why the
 *  read cannot be per-widget. */
export function InitiativeDecisionsWidget({ host }: { host: WidgetHost }) {
  const initiative = useInitiativeIntentContext();
  if (!initiative) return null;
  return (
    <InitiativeDecisions
      initiative={initiative}
      onOpenObject={(objectId, domainId) => host.onNavigate?.({ objectId, domainId })}
    />
  );
}
