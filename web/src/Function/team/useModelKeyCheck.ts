'use client';

import { useCallback, useMemo } from 'react';
import { useIntegrations } from '@/AIP/connectors/data';
import { useActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { aiProviderOf } from '@/Function/team/aiAgents';
import { needsModelKey } from '@/Function/team/agentModel';
import type { Json } from '@/types/database';

type KeyWorker = { type?: string | null; ai_model?: string | null; ai_config?: Json | null; name?: string | null };

/** Whether an AI Worker still needs its model's API key in this Space
 *  (Function/team/agentModel's needsModelKey, against the Space's model
 *  connections that hold a key and are on). */
export function useModelKeyCheck(): (worker: KeyWorker | null | undefined) => boolean {
  const spaceId = useActiveSpaceId();
  const { data: integrations } = useIntegrations(spaceId);
  const connected = useMemo(
    () => new Set(integrations.filter((i) => i.kind === 'model' && i.enabled && !!i.secret_id).map((i) => i.id)),
    [integrations],
  );
  return useCallback((worker) => !!worker && needsModelKey(worker, connected, aiProviderOf(worker)), [connected]);
}
