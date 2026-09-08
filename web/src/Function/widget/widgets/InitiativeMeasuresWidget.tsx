'use client';

import { InitiativeMeasures } from '@/ActivitySpace/strategy/initiative/InitiativeMeasures';
import { useInitiativeIntentContext } from '@/ActivitySpace/strategy/initiative/InitiativeIntent';

/** Measures — the conditions this Initiative is held to, and whether they are
 *  being met. Reads through the surface's shared Intent context; see
 *  InitiativeIntent.tsx for why the read cannot be per-widget. */
export function InitiativeMeasuresWidget() {
  const initiative = useInitiativeIntentContext();
  if (!initiative) return null;
  return <InitiativeMeasures initiative={initiative} />;
}
