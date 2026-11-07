'use client';

import { useMemo } from 'react';
import { useInitiativeMission } from '@/hooks/initiativeMissionData';
import { useDomains, useWorkers } from '@/hooks/useSupabase';
import { useNowMinute } from '@/Function/shared/useNow';
import { useInitiativeIntentContext } from '../InitiativeIntent';
import { MissionEvaluatePanel, type MissionContext } from './MissionPanels';
import { MissionExecutionPanel } from './MissionExecution';
import type { BoardOrientation } from '@/Function/shared/boardOrientation';
import type { ElementWithDetails, StrategyDelegation } from '@/types/database';
import { missionElementRow, type MissionElementRow, type MissionMeasureRow } from './missionModel';

// The mission part of one Strategy tab (Execution or Evaluate). Reads the Strategy's intents from
// the page's InitiativeIntentProvider and the runs, artifacts, approvals and
// dependencies of the Elements under its Objects, once per tab.

export function InitiativeMission({ tab, initiativeId, initiativeName, spaceId, objects, delegation, onDelegationChange, definitionId, onDefinitionChange, onChanged, onOpenObject, orientation }: {
  tab: 'execution' | 'audit';
  initiativeId: string;
  initiativeName: string;
  delegation: StrategyDelegation;
  onDelegationChange: (d: StrategyDelegation) => Promise<void>;
  definitionId: string | null;
  onDefinitionChange: (id: string | null) => Promise<void>;
  spaceId: string | null;
  /** The Strategy's Objects with their Elements. */
  objects: { id: string; name: string; domain_id: string | null; icon?: string | null; color?: string | null; elements?: ElementWithDetails[] }[];
  /** Elements or measures were written: the page re-reads its Objects. */
  onChanged: () => void;
  onOpenObject?: (objectId: string, domainId: string | null) => void;
  /** The board's orientation, from the page's tabs-row toggle. */
  orientation: BoardOrientation;
}) {
  const intent = useInitiativeIntentContext();
  const { data: workers } = useWorkers();
  const { data: domains } = useDomains();
  // Ticks, so a lease that lapses while the tab is open stops reading as running.
  const now = useNowMinute(true);
  const elements = useMemo<MissionElementRow[]>(() => {
    return objects.flatMap((o) => (o.elements ?? []).map((e) => missionElementRow(e, o.id, now)));
  }, [objects, now]);
  const elementIds = useMemo(() => elements.map((e) => e.id), [elements]);
  // The Elements as the shared card reads them, for the Execution tab.
  const details = useMemo(() => new Map(objects.flatMap((o) => (o.elements ?? []).map((e) => [e.id, e] as const))), [objects]);

  const measures = useMemo<MissionMeasureRow[]>(() => (intent?.data?.subs ?? [])
    .filter((i) => i.kind === 'measure')
    .map((m) => ({ id: m.id, title: m.title, target_value: m.target_value, actual_value: m.actual_value, unit: m.unit, direction: m.direction, measured_at: m.measured_at ?? null })),
  [intent?.data?.subs]);
  const measureIds = useMemo(() => measures.map((m) => m.id), [measures]);
  const mission = useInitiativeMission(initiativeId, elementIds, measureIds);

  const ctx: MissionContext = {
    initiativeId, initiativeName, spaceId,
    canEdit: intent?.canEdit ?? false,
    measures,
    bindings: intent?.data?.bindings ?? [],
    elements,
    mission: mission.data,
    missionLoaded: !mission.loading,
    delegation,
    setDelegation: onDelegationChange,
    definitionId,
    setDefinition: onDefinitionChange,
    refetch: () => { void mission.refetch(); intent?.refetch(); onChanged(); },
    onOpenElement: (elementId) => {
      const object = objects.find((o) => (o.elements ?? []).some((e) => e.id === elementId));
      if (object) onOpenObject?.(object.id, object.domain_id);
    },
  };

  if (tab === 'execution') {
    return (
      <MissionExecutionPanel ctx={ctx} details={details} orientation={orientation}
        objects={objects.map((o) => ({ id: o.id, name: o.name, domain_id: o.domain_id, icon: o.icon ?? null, color: o.color ?? null }))}
        domains={domains.filter((d) => !spaceId || d.activity_space_id === spaceId).map((d) => ({ id: d.id, name: d.name }))}
        aiWorkers={workers.filter((w) => w.type === 'ai_agent' && w.status !== 'inactive')}
        people={workers.filter((w) => w.type === 'human' && w.status !== 'inactive')}
        ensureRoot={intent?.ensureRoot ?? (() => Promise.reject(new Error('no intent')))} />
    );
  }
  return <MissionEvaluatePanel ctx={ctx} />;
}
