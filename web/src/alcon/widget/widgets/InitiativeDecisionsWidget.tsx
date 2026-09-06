'use client';

import { InitiativeDecisions } from '@/alcon/element/actions/InitiativeDecisions';
import { useInitiativeIntentContext } from '@/alcon/element/actions/InitiativeIntent';
import type { WidgetHost } from '../types';

/** Decisions — one of the Initiative's hand-written Intent sections. Reads through
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
