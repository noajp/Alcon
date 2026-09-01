'use client';

import { createContext, useContext } from 'react';
import { useCampaignIntent, type CampaignIntentState } from '@/alcon/element/actions/useCampaignIntent';

// =============================================================
// One read, one root, shared by every Intent widget on a Campaign.
//
// Measures, Assumptions and Decisions are three widgets now — separately
// placed, separately removable — but they must not be three reads. `intents`
// carries a partial unique index allowing exactly one parent-less row per
// Campaign, and each of the three creates children under it; three widgets
// each holding their own `ensureRoot` would each insert on first use and the
// losers would hit the index, on any Campaign that has never recorded
// anything, which is every Campaign the first time. The bundle is eight
// queries besides.
//
// So the surface mounts the read and the widgets consume it. There is no
// fallback to a private read: a widget that could quietly make its own would
// reintroduce exactly the race this exists to prevent.
// =============================================================

const CampaignIntentContext = createContext<CampaignIntentState | null>(null);

export function CampaignIntentProvider({
  campaignId,
  campaignName,
  children,
}: {
  campaignId: string;
  campaignName: string;
  children: React.ReactNode;
}) {
  // Passed straight through: `useCampaignIntent` builds a fresh object every
  // render, so a useMemo keyed on it would memoize nothing while reading as
  // though it did. If this ever needs to be stable, it has to become stable
  // at the source.
  const campaign = useCampaignIntent(campaignId, campaignName);
  return <CampaignIntentContext.Provider value={campaign}>{children}</CampaignIntentContext.Provider>;
}

export function useCampaignIntentContext(): CampaignIntentState | null {
  return useContext(CampaignIntentContext);
}
