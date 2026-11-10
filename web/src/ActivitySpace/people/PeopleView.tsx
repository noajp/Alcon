'use client';

import { useMemo } from 'react';
import { Button } from '@/ui/button';
import { useI18n } from '@/Function/i18n/I18nProvider';
import type { IslandCrumb } from '@/Function/shared/MainIsland';
import { membersBelow, unitPath } from '@/Function/team/orgUnits';
import { useOrgUnits } from '@/hooks/orgUnitData';
import { useTeamRoster } from '@/hooks/useTeamRoster';
import { ElementDrilldown } from '@/ActivitySpace/execution/element/ElementDrilldown';
import { ResourceView } from '@/ActivitySpace/people/workload/ResourceView';
import type { NavigationState } from '@/types/navigation';
import { PersonProfile } from './TeamView';
import { UnitPanel, WorkerUnits } from './UnitPanel';

/**
 * People: who holds how much work against the hours they have. Everyone's
 * load first; a unit chosen in the sidebar narrows the chart to its members
 * (counting the units inside it) with the unit's page under it; a Worker,
 * to them with their profile — their units, capacity, skills, what they are
 * on. The header's path runs People › the units › the Worker.
 */
export function PeopleView({ workerId, unitId, onNavigate, onViewChange }: {
  workerId?: string | null;
  unitId?: string | null;
  onNavigate: (nav: Partial<NavigationState>) => void;
  onViewChange?: (view: string) => void;
}) {
  const { t } = useI18n();
  const roster = useTeamRoster();
  const { units, members } = useOrgUnits();
  const unit = unitId ? units.find((u) => u.id === unitId) ?? null : null;
  const memberIds = useMemo(() => unit && !workerId ? membersBelow(units, members, unit.id) : undefined, [unit, workerId, units, members]);
  const openUnit = (id: string) => onNavigate({ unitId: id, workerId: null });
  const openWorker = (id: string) => onNavigate({ workerId: id, unitId: unit?.id ?? null });

  const path: IslandCrumb[] = [
    { id: 'people', label: t('Team'), onClick: workerId || unit ? () => onNavigate({ workerId: null, unitId: null }) : undefined },
    ...(unit ? unitPath(units, unit.id).map((u) => ({ id: u.id, label: u.name, onClick: u.id !== unit.id || workerId ? () => openUnit(u.id) : undefined })) : []),
    ...(workerId ? [{ id: 'worker', label: roster.workers.find((w) => w.id === workerId)?.name ?? '' }] : []),
  ];

  return (
    <ElementDrilldown label="Team" onNavigate={onNavigate} onViewChange={onViewChange}>
      {openElement => roster.error ? <div role="alert" className="flex items-center gap-2 px-4 py-3 text-sm text-destructive">
        {t('Could not load the team.')} <Button size="xs" onClick={() => void roster.refresh()}>{t('Retry')}</Button>
      </div> : roster.loading ? <p role="status" className="px-4 py-3 text-sm text-muted-foreground">{t('Loading team…')}</p> : (
        <ResourceView
          title="Team"
          path={path}
          roster={roster.workers}
          workerId={workerId ?? undefined}
          memberIds={memberIds}
          onClearWorker={() => onNavigate({ workerId: null })}
          onElementClick={element => openElement(element.id)}
          below={workerId ? <>
            <WorkerUnits workerId={workerId} onOpenUnit={openUnit} />
            <PersonProfile workerId={workerId} onOpenElement={openElement} />
          </> : unit ? <UnitPanel unitId={unit.id} onOpenUnit={openUnit} onOpenWorker={openWorker} /> : undefined}
        />
      )}
    </ElementDrilldown>
  );
}
