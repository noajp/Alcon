'use client';

import { CampaignDecisions } from '@/alcon/element/actions/CampaignDecisions';
import { useCampaignIntentContext } from '@/alcon/element/actions/CampaignIntent';
import type { WidgetHost } from '../types';

/** Decisions — one of the Campaign's hand-written Intent sections. Reads through
 *  the surface's shared Intent context; see CampaignIntent.tsx for why the
 *  read cannot be per-widget. */
export function CampaignDecisionsWidget({ host }: { host: WidgetHost }) {
  const campaign = useCampaignIntentContext();
  if (!campaign) return null;
  return (
    <CampaignDecisions
      campaign={campaign}
      onOpenObject={(objectId, domainId) => host.onNavigate?.({ objectId, domainId })}
    />
  );
}
