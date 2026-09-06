'use client';

import { createContext, useContext } from 'react';
import { useInitiativeIntent, type InitiativeIntentState } from '@/alcon/element/actions/useInitiativeIntent';

// =============================================================
// One read, one root, shared by every Intent widget on a Initiative.
//
// Measures, Assumptions and Decisions are three widgets now — separately
// placed, separately removable — but they must not be three reads. `intents`
// carries a partial unique index allowing exactly one parent-less row per
// Initiative, and each of the three creates children under it; three widgets
// each holding their own `ensureRoot` would each insert on first use and the
// losers would hit the index, on any Initiative that has never recorded
// anything, which is every Initiative the first time. The bundle is eight
// queries besides.
//
// So the surface mounts the read and the widgets consume it. There is no
// fallback to a private read: a widget that could quietly make its own would
// reintroduce exactly the race this exists to prevent.
// =============================================================

const InitiativeIntentContext = createContext<InitiativeIntentState | null>(null);

export function InitiativeIntentProvider({
  initiativeId,
  initiativeName,
  children,
}: {
  initiativeId: string;
  initiativeName: string;
  children: React.ReactNode;
}) {
  // Passed straight through: `useInitiativeIntent` builds a fresh object every
  // render, so a useMemo keyed on it would memoize nothing while reading as
  // though it did. If this ever needs to be stable, it has to become stable
  // at the source.
  const initiative = useInitiativeIntent(initiativeId, initiativeName);
  return <InitiativeIntentContext.Provider value={initiative}>{children}</InitiativeIntentContext.Provider>;
}

export function useInitiativeIntentContext(): InitiativeIntentState | null {
  return useContext(InitiativeIntentContext);
}
