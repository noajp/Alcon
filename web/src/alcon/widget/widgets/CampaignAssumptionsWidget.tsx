'use client';

import { CampaignAssumptions } from '@/alcon/element/actions/CampaignAssumptions';
import { useCampaignIntentContext } from '@/alcon/element/actions/CampaignIntent';
import type { WidgetHost } from '../types';

/** Assumptions — one of the Campaign's hand-written Intent sections. Reads through
 *  the surface's shared Intent context; see CampaignIntent.tsx for why the
 *  read cannot be per-widget. */
export function CampaignAssumptionsWidget({ host }: { host: WidgetHost }) {
  const campaign = useCampaignIntentContext();
  if (!campaign) return null;
  return (
    <CampaignAssumptions
      campaign={campaign}
      onOpenObject={(objectId, domainId) => host.onNavigate?.({ objectId, domainId })}
    />
  );
}
