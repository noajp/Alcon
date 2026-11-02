'use client';

import { useMemo } from 'react';
import { Bot, Scale, User, Users } from '@/ui/icons';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { SidebarRow, SidebarSectionLabel } from '@/Function/shared/SidebarRow';
import { GroupTree } from '@/Function/shared/folders/GroupTree';
import { WorkerAvatar } from '@/Function/shared/WorkerAvatar';
import type { NavigationState } from '@/types/navigation';
import {
  setWorkloadPlanOpen,
  useWorkloadPlanOpen,
  useWorkloadPublished,
  type WorkloadPerson,
} from '@/Function/workload/workloadStore';

/**
 * People, laid out as Execution is: everyone (the team's load) and the plan
 * that evens it out first, then the people and the AI agents as groups that
 * unfold onto each Worker with their load. Choosing one opens their load and
 * their profile; choosing again, or "Everyone", widens back to the team.
 *
 * Each group lists who needs attention first — over capacity, then deadlines
 * on an absence, then by load — so the person to look at next is at the top.
 */
export function PeopleSidebar({ navigation, onNavigate, onOpen }: {
  navigation: NavigationState;
  onNavigate: (navigation: Partial<NavigationState>) => void;
  /** Brings People forward when it is not the open view. */
  onOpen: () => void;
}) {
  const { t } = useI18n();
  const published = useWorkloadPublished();
  const planOpen = useWorkloadPlanOpen();
  const focus = navigation.workerId ?? null;

  const { people, agents } = useMemo(() => {
    const all = [...(published?.people ?? [])].sort(attentionOrder);
    return { people: all.filter((p) => p.worker.type !== 'ai_agent'), agents: all.filter((p) => p.worker.type === 'ai_agent') };
  }, [published]);

  const team = published?.team ?? null;
  const focusOn = (workerId: string | null) => {
    onOpen();
    onNavigate({ workerId });
  };
  const teamLoad = team?.utilization != null ? Math.round(team.utilization * 100) : null;
  const member = (p: WorkloadPerson) => ({
    id: p.worker.id,
    label: p.worker.name,
    mark: <WorkerAvatar worker={p.worker} size={16} />,
    meta: <Load person={p} />,
    title: `${p.worker.name} — ${published?.ahead === false ? t('{p}% of capacity in view', { p: pct(p) }) : t('{p}% of capacity ahead', { p: pct(p) })}`,
    active: focus === p.worker.id,
    onClick: () => focusOn(p.worker.id),
  });

  return (
    <div className="mt-1 pb-4">
      <SidebarSectionLabel>{t('People')}</SidebarSectionLabel>
      <div className="mt-1 space-y-px">
        <SidebarRow
          active={focus === null}
          icon={<Users size={16} />}
          label={t('Everyone')}
          title={team ? (team.overloadedPeople > 0 ? t('{n} people over capacity', { n: team.overloadedPeople }) : t('Nobody is over capacity')) : undefined}
          meta={teamLoad !== null
            ? <span className={team!.utilization! > 1 ? 'text-[var(--status-danger)]' : undefined}>{teamLoad}%</span>
            : null}
          onClick={() => focusOn(null)}
        />
        <SidebarRow
          active={planOpen && published?.proposals !== null}
          disabled={published?.proposals === null}
          title={published?.failed ? t('Could not load the work in this scope.')
            : published?.proposals === null ? t('Rebalancing reads everyone’s whole load. Choose All Domains to plan.') : undefined}
          icon={<Scale size={16} />}
          label={t('Rebalance plan')}
          meta={published?.proposals ? <span className="text-[var(--status-danger)]">{published.proposals}</span> : null}
          buttonProps={{ 'aria-pressed': planOpen, 'aria-current': undefined }}
          onClick={() => { onOpen(); setWorkloadPlanOpen(!planOpen); }}
        />
      </div>

      <div className="mt-3">
        {!published ? (
          <p className="px-2.5 py-2 text-[12px] text-muted-foreground">{t('Loading workload…')}</p>
        ) : published.failed ? (
          <p role="alert" className="px-2.5 py-2 text-[12px] text-[var(--status-danger)]">{t('Could not load the work in this scope.')}</p>
        ) : people.length + agents.length === 0 ? (
          <p className="px-2.5 py-2 text-[12px] text-muted-foreground">{t('Nobody holds work in these Domains yet.')}</p>
        ) : <>
          {people.length > 0 && (
            <GroupTree name={t('People')} mark={<User size={16} />} defaultOpen
              homeActive={false} onOpenHome={() => focusOn(null)} items={people.map(member)} />
          )}
          {agents.length > 0 && (
            <GroupTree name={t('AI agents')} mark={<Bot size={16} />} defaultOpen
              homeActive={false} onOpenHome={() => focusOn(null)} items={agents.map(member)} />
          )}
        </>}
      </div>
    </div>
  );
}

const pct = (p: WorkloadPerson) => Math.round((p.utilization ?? 0) * 100);

/** A Worker's load beside their name: red when over capacity, "Away" when out. */
function Load({ person }: { person: WorkloadPerson }) {
  const { t } = useI18n();
  const { utilization, overDays, awayDays, dueAway } = person;
  return (
    <span className="flex items-center gap-1">
      {dueAway > 0 && <span className="size-1.5 rounded-full bg-[var(--status-warning)]" aria-label={t('{n} due while away', { n: dueAway })} />}
      <span className={overDays > 0 ? 'font-semibold text-[var(--status-danger)]' : undefined}>
        {utilization !== null ? `${Math.round(utilization * 100)}%` : awayDays > 0 ? t('Away') : '—'}
      </span>
    </span>
  );
}

/** Over capacity first, then deadlines landing on an absence, then load. */
function attentionOrder(a: WorkloadPerson, b: WorkloadPerson): number {
  return Number(b.overDays > 0) - Number(a.overDays > 0)
    || Number(b.dueAway > 0) - Number(a.dueAway > 0)
    || (b.utilization ?? -1) - (a.utilization ?? -1)
    || a.worker.name.localeCompare(b.worker.name);
}
