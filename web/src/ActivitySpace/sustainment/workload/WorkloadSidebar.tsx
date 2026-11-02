'use client';

import { useMemo } from 'react';
import { Check, Scale, Users } from '@/ui/icons';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { SidebarRow, SidebarSectionLabel } from '@/Function/shared/SidebarRow';
import { WorkerAvatar } from '@/Function/shared/WorkerAvatar';
import { useActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { useSustainmentDomains } from '@/hooks/useSustainmentDomains';
import { useCurrentUserId } from '@/providers/authContext';
import type { NavigationState } from '@/types/navigation';
import { LoadMeter } from './LoadMeter';
import {
  setWorkloadDomainChoice,
  setWorkloadPlanOpen,
  useWorkloadDomainChoice,
  useWorkloadPlanOpen,
  useWorkloadPublished,
  type WorkloadPerson,
} from '@/Function/workload/workloadStore';

/**
 * Workload navigation: how loaded the team is, the plan that fixes it, every
 * person with their load, and which Domains are counted.
 *
 * The people list is the sidebar's main job. It is sorted by who needs
 * attention — over capacity first, then deadlines on an absence, then by load
 * — so the person to look at next is at the top without reading the chart.
 * Choosing one narrows the chart and the plan to them; choosing again, or
 * "Everyone", widens it back.
 */
export function WorkloadSidebar({ navigation, onNavigate, onOpen }: {
  navigation: NavigationState;
  onNavigate: (navigation: Partial<NavigationState>) => void;
  /** Brings the Workload surface forward when it is not the open view. */
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
    onNavigate({ workerId: workerId === focus ? null : workerId });
  };

  return (
    <div className="mt-1 pb-4">
      <SidebarSectionLabel>{t('Workload')}</SidebarSectionLabel>

      {/* The team at a glance — the number that says whether to look further. */}
      <div className="mx-1 mt-1 rounded-lg px-2 py-2">
        <div className="flex items-baseline gap-2">
          <span className={`text-[26px] font-semibold leading-none tabular-nums ${team?.utilization != null && team.utilization > 1 ? 'text-[var(--status-danger)]' : 'text-foreground'}`}>
            {team?.utilization != null ? `${Math.round(team.utilization * 100)}%` : '—'}
          </span>
          <span className="min-w-0 truncate text-[11px] text-muted-foreground">{published?.ahead === false ? t('team load in view') : t('team load ahead')}</span>
        </div>
        {team?.utilization != null && <LoadMeter value={team.utilization} className="mt-2" />}
        {team && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            {team.overloadedPeople > 0
              ? <span className="text-[var(--status-danger)]">{t('{n} people over capacity', { n: team.overloadedPeople })}</span>
              : t('Nobody is over capacity')}
          </p>
        )}
      </div>

      <div className="mt-1 space-y-px">
        <SidebarRow
          active={planOpen && published?.proposals !== null}
          disabled={published?.proposals === null}
          title={published?.failed ? t('Could not load the work in this scope.')
            : published?.proposals === null ? t('Rebalancing reads everyone’s whole load. Choose All Domains to plan.') : undefined}
          icon={<Scale size={16} />}
          label={t('Rebalance plan')}
          meta={published?.proposals
            ? <span className="text-[11px] tabular-nums text-[var(--status-danger)]">{published.proposals}</span>
            : null}
          buttonProps={{ 'aria-pressed': planOpen, 'aria-current': undefined }}
          onClick={() => { onOpen(); setWorkloadPlanOpen(!planOpen); }}
        />
        <SidebarRow
          active={focus === null}
          icon={<Users size={16} />}
          label={t('Everyone')}
          meta={published ? published.people.length : null}
          onClick={() => focusOn(null)}
        />
      </div>

      {!published ? (
        <p className="px-2.5 py-3 text-[12px] text-muted-foreground">{t('Loading workload…')}</p>
      ) : published.failed ? (
        <p role="alert" className="px-2.5 py-3 text-[12px] text-[var(--status-danger)]">{t('Could not load the work in this scope.')}</p>
      ) : (
        <>
          {people.length > 0 && <>
            <SidebarSectionLabel className="mt-4">{t('People')}</SidebarSectionLabel>
            <div className="space-y-px">
              {people.map((p) => <PersonRow key={p.worker.id} person={p} active={focus === p.worker.id} ahead={published.ahead} onClick={() => focusOn(p.worker.id)} />)}
            </div>
          </>}
          {agents.length > 0 && <>
            <SidebarSectionLabel className="mt-4">{t('AI agents')}</SidebarSectionLabel>
            <div className="space-y-px">
              {agents.map((p) => <PersonRow key={p.worker.id} person={p} active={focus === p.worker.id} ahead={published.ahead} onClick={() => focusOn(p.worker.id)} />)}
            </div>
          </>}
          {people.length + agents.length === 0 && (
            <p className="px-2.5 py-3 text-[12px] text-muted-foreground">{t('Nobody holds work in these Domains yet.')}</p>
          )}
        </>
      )}

      <WorkloadDomains />
    </div>
  );
}

/** Over capacity first, then deadlines landing on an absence, then load. */
function attentionOrder(a: WorkloadPerson, b: WorkloadPerson): number {
  return Number(b.overDays > 0) - Number(a.overDays > 0)
    || Number(b.dueAway > 0) - Number(a.dueAway > 0)
    || (b.utilization ?? -1) - (a.utilization ?? -1)
    || a.worker.name.localeCompare(b.worker.name);
}

function PersonRow({ person, active, ahead, onClick }: { person: WorkloadPerson; active: boolean; ahead: boolean; onClick: () => void }) {
  const { t } = useI18n();
  const { worker, utilization, overDays, awayDays, dueAway } = person;
  const over = overDays > 0;
  const notes = [
    utilization !== null
      ? (ahead ? t('{p}% of capacity ahead', { p: Math.round(utilization * 100) }) : t('{p}% of capacity in view', { p: Math.round(utilization * 100) }))
      : (ahead ? t('No hours ahead') : t('No hours in view')),
    over ? t('{n} days over', { n: overDays }) : null,
    awayDays > 0 ? t('away {n}d', { n: awayDays }) : null,
    dueAway > 0 ? t('{n} due while away', { n: dueAway }) : null,
  ].filter(Boolean).join(' · ');
  return (
    <SidebarRow
      active={active}
      size="tall"
      title={`${worker.name} — ${notes}`}
      icon={<WorkerAvatar worker={worker} size={18} />}
      onClick={onClick}
      label={
        <span className="flex min-w-0 flex-col gap-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate">{worker.name}</span>
            {dueAway > 0 && <span className="size-1.5 flex-shrink-0 rounded-full bg-[var(--status-warning)]" aria-label={t('{n} due while away', { n: dueAway })} />}
            <span className={`flex-shrink-0 text-[11px] font-normal tabular-nums ${over ? 'font-semibold text-[var(--status-danger)]' : 'text-muted-foreground/80'}`}>
              {utilization !== null ? `${Math.round(utilization * 100)}%` : awayDays > 0 ? t('Away') : '—'}
            </span>
          </span>
          {utilization !== null && <LoadMeter value={utilization} />}
        </span>
      }
    />
  );
}

/** Which Domains the standalone Workload counts. Every Domain is the default;
 *  unticking one narrows the chart, the people and the plan together. */
function WorkloadDomains() {
  const { t } = useI18n();
  const userId = useCurrentUserId();
  const spaceId = useActiveSpaceId();
  const contextKey = JSON.stringify([userId, spaceId]);
  const { data: domains } = useSustainmentDomains();
  const choice = useWorkloadDomainChoice(contextKey);
  if (domains.length < 2) return null;
  const accessible = domains.map((d) => d.id);
  const selected = choice === null ? accessible : choice.filter((id) => accessible.includes(id));
  const all = choice === null;
  const toggle = (id: string) => {
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
    setWorkloadDomainChoice(contextKey, next.length === accessible.length ? null : next);
  };
  const sorted = [...domains].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <>
      <SidebarSectionLabel className="mt-4">{t('Domains')}</SidebarSectionLabel>
      <div className="space-y-px">
        <SidebarRow size="sm" active={false} label={t('All Domains')}
          icon={<Tick on={all} />} buttonProps={{ role: 'checkbox', 'aria-checked': all, 'aria-current': undefined }}
          onClick={() => setWorkloadDomainChoice(contextKey, null)} />
        {sorted.map((d) => {
          const on = selected.includes(d.id);
          return (
            <SidebarRow key={d.id} size="sm" active={false} label={d.name}
              icon={<Tick on={on} />} buttonProps={{ role: 'checkbox', 'aria-checked': on, 'aria-current': undefined }}
              onClick={() => toggle(d.id)} />
          );
        })}
      </div>
    </>
  );
}

function Tick({ on }: { on: boolean }) {
  return (
    <span className={`flex size-3.5 items-center justify-center rounded-[4px] border ${on ? 'border-[var(--accent-default)] bg-[var(--accent-default)] text-primary-foreground' : 'border-[var(--border-default)]'}`} aria-hidden="true">
      {on && <Check size={10} strokeWidth={3} />}
    </span>
  );
}
