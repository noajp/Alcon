'use client';

import { Button } from '@/ui/button';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { useTeamRoster } from '@/hooks/useTeamRoster';
import { ElementDrilldown } from '@/ActivitySpace/execution/element/ElementDrilldown';
import { ResourceView } from '@/ActivitySpace/sustainment/workload/ResourceView';
import type { NavigationState } from '@/types/navigation';
import { PersonProfile } from './TeamView';

/**
 * People: who holds how much work against the hours they have. Everyone's
 * load first; a Worker chosen in the sidebar narrows the chart to them and
 * shows their profile — capacity, skills, what they are on — under it.
 */
export function PeopleView({ workerId, onNavigate, onViewChange }: {
  workerId?: string | null;
  onNavigate: (nav: Partial<NavigationState>) => void;
  onViewChange?: (view: string) => void;
}) {
  const { t } = useI18n();
  const roster = useTeamRoster();
  return (
    <ElementDrilldown label="People" onNavigate={onNavigate} onViewChange={onViewChange}>
      {openElement => roster.error ? <div role="alert" className="flex items-center gap-2 px-4 py-3 text-sm text-destructive">
        {t('Could not load the team.')} <Button size="xs" onClick={() => void roster.refresh()}>{t('Retry')}</Button>
      </div> : roster.loading ? <p role="status" className="px-4 py-3 text-sm text-muted-foreground">{t('Loading team…')}</p> : (
        <ResourceView
          title="People"
          roster={roster.workers}
          workerId={workerId ?? undefined}
          onClearWorker={() => onNavigate({ workerId: null })}
          onElementClick={element => openElement(element.id)}
          publish
          below={workerId ? <PersonProfile workerId={workerId} onOpenElement={openElement} /> : undefined}
        />
      )}
    </ElementDrilldown>
  );
}
