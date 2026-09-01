'use client';

import { CampaignAssumptions } from '@/alcon/element/actions/CampaignAssumptions';
import { CampaignDecisions } from '@/alcon/element/actions/CampaignDecisions';
import { CampaignMeasures } from '@/alcon/element/actions/CampaignMeasures';
import { useCampaignIntent } from '@/alcon/element/actions/useCampaignIntent';

// =============================================================
// The three hand-written sections of a Campaign, and the one read they share.
//
// The order runs outward-in. Measures come first because they are the least
// negotiable thing on the page — the conditions are usually set by somebody
// outside the Campaign, and whether they are being met is the question a reader
// arrives with. Assumptions come next: what the plan takes as given, and the
// thing that invalidates everything below it when it is shaken. Decisions come
// last, because a choice read without the ground under it looks arbitrary.
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
      <CampaignMeasures campaign={campaign} />
      <CampaignAssumptions campaign={campaign} onOpenObject={onOpenObject} />
      <CampaignDecisions campaign={campaign} onOpenObject={onOpenObject} />
    </>
  );
}
