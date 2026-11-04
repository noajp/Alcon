'use client';

import { useMemo } from 'react';
import { useInitiativeMission } from '@/hooks/initiativeMissionData';
import { useWorkers } from '@/hooks/useSupabase';
import { runsInClaudeCode } from '@/Function/team/agentModel';
import { liveLease } from '@/Function/shared/element/lease';
import { useNowMinute } from '@/Function/shared/useNow';
import { useInitiativeIntentContext } from '../InitiativeIntent';
import { MissionEvaluatePanel, MissionExecutePanel, MissionPlanPanel, type MissionContext } from './MissionPanels';
import type { MissionElementRow, MissionMeasureRow } from './missionModel';

// The mission part of one Strategy tab. Reads the Strategy's intents from
// the page's InitiativeIntentProvider and the runs, artifacts, approvals and
// dependencies of the Elements under its Objects, once per tab.

export function InitiativeMission({ tab, initiativeId, initiativeName, spaceId, objects, onChanged, onOpenObject }: {
  tab: 'plan' | 'execution' | 'audit';
  initiativeId: string;
  initiativeName: string;
  spaceId: string | null;
  /** The Strategy's Objects with their Elements. */
  objects: { id: string; name: string; domain_id: string | null; elements?: {
    id: string; title: string; status: string | null; display_id?: string | null; labels?: string[] | null;
    claimed_by?: string | null; claim_expires_at?: string | null; branch?: string | null;
    assignees?: { role?: string | null; worker?: { ai_config?: unknown } | null }[];
  }[] }[];
  /** Elements or measures were written: the page re-reads its Objects. */
  onChanged: () => void;
  onOpenObject?: (objectId: string, domainId: string | null) => void;
}) {
  const intent = useInitiativeIntentContext();
  const { data: workers } = useWorkers();
  // Ticks, so a lease that lapses while the tab is open stops reading as running.
  const now = useNowMinute(true);
  const elements = useMemo<MissionElementRow[]>(() => {
    return objects.flatMap((o) => (o.elements ?? []).map((e) => ({
      id: e.id, title: e.title, status: e.status, display_id: e.display_id ?? null, object_id: o.id,
      labels: e.labels ?? null,
      claudeCode: (e.assignees ?? []).some((a) => a.role !== 'reviewer' && runsInClaudeCode(a.worker?.ai_config)),
      leased: !!liveLease({ claimed_by: e.claimed_by ?? null, claim_expires_at: e.claim_expires_at ?? null, branch: e.branch ?? null }, now),
    })));
  }, [objects, now]);
  const elementIds = useMemo(() => elements.map((e) => e.id), [elements]);
  const mission = useInitiativeMission(initiativeId, elementIds);

  const measures = useMemo<MissionMeasureRow[]>(() => (intent?.data?.subs ?? [])
    .filter((i) => i.kind === 'measure')
    .map((m) => ({ id: m.id, title: m.title, target_value: m.target_value, actual_value: m.actual_value, unit: m.unit, direction: m.direction })),
  [intent?.data?.subs]);

  const ctx: MissionContext = {
    initiativeId, initiativeName, spaceId,
    canEdit: intent?.canEdit ?? false,
    measures,
    bindings: intent?.data?.bindings ?? [],
    elements,
    mission: mission.data,
    refetch: () => { void mission.refetch(); intent?.refetch(); onChanged(); },
    onOpenElement: (elementId) => {
      const object = objects.find((o) => (o.elements ?? []).some((e) => e.id === elementId));
      if (object) onOpenObject?.(object.id, object.domain_id);
    },
  };

  if (tab === 'plan') {
    return (
      <MissionPlanPanel ctx={ctx}
        objects={objects.map((o) => ({ id: o.id, name: o.name }))}
        aiWorkers={workers.filter((w) => w.type === 'ai_agent' && w.status !== 'inactive')}
        ensureRoot={intent?.ensureRoot ?? (() => Promise.reject(new Error('no intent')))} />
    );
  }
  if (tab === 'execution') return <MissionExecutePanel ctx={ctx} />;
  return <MissionEvaluatePanel ctx={ctx} />;
}
