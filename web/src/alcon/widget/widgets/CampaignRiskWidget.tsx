'use client';

import { CampaignRiskView } from '@/alcon/element/actions/CampaignRisk';
import { useCampaignRisk } from '@/alcon/element/actions/useCampaignRisk';
import { useWidgetMeta } from '../WidgetFrame';
import type { WidgetHost } from '../types';

/**
 * Risk & Load — which Object is hurting, and who is already carrying it.
 *
 * Situation says whether the Campaign is on time; this says where to push,
 * which is the half a schedule cannot answer.
 */
export function CampaignRiskWidget({ host }: { host: WidgetHost }) {
  const campaignId = host.subject.id ?? '';
  const { report, loading, error } = useCampaignRisk(campaignId);

  // The open count rides in the frame's header, where the hand-written
  // section used to put it.
  useWidgetMeta(report && report.openTotal > 0 ? `${report.openTotal} open` : null);

  return (
    <CampaignRiskView
      report={report}
      loading={loading}
      error={error}
      onOpenObject={(objectId, domainId) => host.onNavigate?.({ objectId, domainId })}
    />
  );
}
