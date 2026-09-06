'use client';

import { InitiativeMeasures } from '@/alcon/element/actions/InitiativeMeasures';
import { useInitiativeIntentContext } from '@/alcon/element/actions/InitiativeIntent';

/** Measures — the conditions this Initiative is held to, and whether they are
 *  being met. Reads through the surface's shared Intent context; see
 *  InitiativeIntent.tsx for why the read cannot be per-widget. */
export function InitiativeMeasuresWidget() {
  const initiative = useInitiativeIntentContext();
  if (!initiative) return null;
  return <InitiativeMeasures initiative={initiative} />;
}
