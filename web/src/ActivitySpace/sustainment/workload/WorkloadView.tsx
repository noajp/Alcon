'use client';

import { ResourceView } from '@/ActivitySpace/sustainment/workload/ResourceView';
import { ElementDrilldown } from '@/ActivitySpace/execution/element/ElementDrilldown';
import { useTeamRoster } from '@/hooks/useTeamRoster';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { Button } from '@/ui/button';
import type { NavigationState } from '@/types/navigation';

export function WorkloadView({ workerId, onNavigate, onViewChange }: {
  workerId?: string | null;
  onNavigate: (nav: Partial<NavigationState>) => void;
  onViewChange?: (view: string) => void;
}) {
  const { t } = useI18n();
  const roster = useTeamRoster();
  return (
    <ElementDrilldown label="Workload" onNavigate={onNavigate} onViewChange={onViewChange}>
      {openElement => roster.error ? <div role="alert" className="flex items-center gap-2 px-4 py-3 text-sm text-destructive">
        {t('Could not load the team.')} <Button size="xs" onClick={() => void roster.refresh()}>{t('Retry')}</Button>
      </div> : roster.loading ? <p role="status" className="px-4 py-3 text-sm text-muted-foreground">{t('Loading team…')}</p> : (
        <ResourceView
          title="Workload"
          roster={roster.workers}
          workerId={workerId ?? undefined}
          onClearWorker={() => onNavigate({ workerId: null })}
          onElementClick={element => openElement(element.id)}
          publish
        />
      )}
    </ElementDrilldown>
  );
}
