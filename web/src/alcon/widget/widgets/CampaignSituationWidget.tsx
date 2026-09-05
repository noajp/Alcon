'use client';

import { useMemo } from 'react';
import { useObjects, useStrategies } from '@/hooks/useSupabase';
import { CampaignSituation } from '@/alcon/element/actions/CampaignSituation';
import type { WidgetHost } from '../types';

/**
 * Situation — is this Campaign going to land.
 *
 * Reads the Phases its Objects' Elements sit in, so it needs the Objects
 * themselves rather than the flattened Element list the host resolves. It
 * fetches them itself: `useObjects` is query-cached, so asking again beside
 * the surface that already asked costs nothing.
 */
export function CampaignSituationWidget({ host }: { host: WidgetHost }) {
  const { data: strategies } = useStrategies();
  const { data: explorer } = useObjects(null);

  const objectIds = useMemo(
    () => strategies.find((s) => s.id === host.subject.id)?.objectIds ?? [],
    [strategies, host.subject.id],
  );

  const allObjects = explorer.objects;

  return <CampaignSituation objectIds={objectIds} allObjects={allObjects} />;
}
