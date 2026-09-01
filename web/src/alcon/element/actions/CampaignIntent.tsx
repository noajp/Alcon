'use client';

import { createContext, useContext, useMemo } from 'react';
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
  const campaign = useCampaignIntent(campaignId, campaignName);
  const value = useMemo(() => campaign, [campaign]);
  return <CampaignIntentContext.Provider value={value}>{children}</CampaignIntentContext.Provider>;
}

export function useCampaignIntentContext(): CampaignIntentState | null {
  return useContext(CampaignIntentContext);
}
