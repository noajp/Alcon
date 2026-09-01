'use client';

import { CampaignAssumptions } from '@/alcon/element/actions/CampaignAssumptions';
import { CampaignDecisions } from '@/alcon/element/actions/CampaignDecisions';
import { useCampaignIntent } from '@/alcon/element/actions/useCampaignIntent';

// =============================================================
// The two hand-written sections of a Campaign, and the one read they share.
//
// Assumptions before decisions, because that is the order they hold in: what
// the plan takes as given comes before the choices made on top of it, and a
// decision read without the assumption under it looks arbitrary. It is also the
// order of urgency — an assumption that has been shaken invalidates the
// decisions below it, so it should be the thing the reader meets first.
// =============================================================

export function CampaignIntent({
  campaignId,
  campaignName,
  onOpenObject,
}: {
  campaignId: string;
  campaignName: string;
  onOpenObject?: (objectId: string, domainId: string | null) => void;
}) {
  const campaign = useCampaignIntent(campaignId, campaignName);
  return (
    <>
      <CampaignAssumptions campaign={campaign} onOpenObject={onOpenObject} />
      <CampaignDecisions campaign={campaign} onOpenObject={onOpenObject} />
    </>
  );
}
