'use client';

import { CampaignMeasures } from '@/alcon/element/actions/CampaignMeasures';
import { useCampaignIntentContext } from '@/alcon/element/actions/CampaignIntent';

/** Measures — the conditions this Campaign is held to, and whether they are
 *  being met. Reads through the surface's shared Intent context; see
 *  CampaignIntent.tsx for why the read cannot be per-widget. */
export function CampaignMeasuresWidget() {
  const campaign = useCampaignIntentContext();
  if (!campaign) return null;
  return <CampaignMeasures campaign={campaign} />;
}
