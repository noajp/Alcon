'use client';

import { useMemo, useState } from 'react';
import { Bot, MoreHorizontal, Network, Plus, Scale, User, Users } from '@/ui/icons';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { SidebarRow, SidebarRowAction, SidebarSectionLabel } from '@/Function/shared/SidebarRow';
import { DisclosureTriangle } from '@/Function/shared/DisclosureTriangle';
import { GroupTree } from '@/Function/shared/folders/GroupTree';
import { WorkerAvatar } from '@/Function/shared/WorkerAvatar';
import { appDialog } from '@/Function/shared/appDialogStore';
import { DropdownMenu, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import { MenuShell, MENU_SEPARATOR } from '@/Function/shared/menu';
import { childUnits } from '@/Function/team/orgUnits';
import { useActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { useSpaceRole } from '@/Function/space/data';
import { useOrgUnitActions, useOrgUnits, type OrgUnit } from '@/hooks/orgUnitData';
import { useTeamRoster } from '@/hooks/useTeamRoster';
import type { Worker } from '@/types/database';
import type { NavigationState } from '@/types/navigation';
import {
  setWorkloadPlanOpen,
  useWorkloadPlanOpen,
  useWorkloadPublished,
  type WorkloadPerson,
} from '@/Function/workload/workloadStore';


/**
 * People, laid out as Execution is: everyone (the team's load) and the plan
 * that evens it out first, then the organisation — its units, nested, each
 * unfolding onto the units inside it and its members with their load — and
 * whoever is in no unit. Without units, the people and the AI agents are the
 * groups. Choosing a unit shows its members' load and its page; choosing a
 * Worker, their load and their profile.
 *
 * Members are listed by who needs attention first — over capacity, then
 * deadlines on an absence, then by load.
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
  const roster = useTeamRoster();
  const { units, members } = useOrgUnits();
  const canArrange = useSpaceRole(useActiveSpaceId()) === 'owner';
  const actions = useOrgUnitActions();
  const focus = navigation.workerId ?? null;
  const unitFocus = navigation.unitId ?? null;

  // Every Worker with their load where Workload has read it.
  const loadOf = useMemo(() => new Map((published?.people ?? []).map((p) => [p.worker.id, p])), [published]);
  const workers = useMemo(() => {
    const m = new Map<string, Worker>(roster.workers.map((w) => [w.id, w]));
    for (const p of published?.people ?? []) m.set(p.worker.id, p.worker);
    return m;
  }, [roster.workers, published]);
  const byAttention = (ids: Iterable<string>) => [...ids].filter((id) => workers.has(id))
    .sort((a, b) => attentionOrder(loadOf.get(a), loadOf.get(b)) || workers.get(a)!.name.localeCompare(workers.get(b)!.name));

  const team = published?.team ?? null;
  const go = (nav: Partial<NavigationState>) => { onOpen(); onNavigate(nav); };
  const teamLoad = team?.utilization != null ? Math.round(team.utilization * 100) : null;

  const memberRow = (id: string, unitId: string | null) => ({
    id: `${unitId ?? 'none'}:${id}`,
    label: workers.get(id)!.name,
    mark: <WorkerAvatar worker={workers.get(id)!} size={16} />,
    meta: <Load person={loadOf.get(id)} />,
    active: focus === id && unitFocus === unitId,
    onClick: () => go({ workerId: id, unitId }),
  });
  const inAUnit = useMemo(() => new Set(members.map((m) => m.worker_id)), [members]);
  const unplaced = byAttention([...workers.keys()].filter((id) => !inAUnit.has(id)));

  const newUnit = async (parentId: string | null) => {
    const name = (await appDialog.prompt(t('Unit name')))?.trim();
    if (!name) return;
    actions.create.mutate({ name, parentId }, { onSuccess: (u) => go({ unitId: u.id, workerId: null }) });
  };

  return (
    <div className="mt-1 pb-4">
      <SidebarSectionLabel>{t('People')}</SidebarSectionLabel>
      <div className="mt-1 space-y-px">
        <SidebarRow
          active={focus === null && unitFocus === null}
          icon={<Users size={16} />}
          label={t('Everyone')}
          title={team ? (team.overloadedPeople > 0 ? t('{n} people over capacity', { n: team.overloadedPeople }) : t('Nobody is over capacity')) : undefined}
          meta={teamLoad !== null
            ? <span className={team!.utilization! > 1 ? 'text-[var(--status-danger)]' : undefined}>{teamLoad}%</span>
            : null}
          onClick={() => go({ workerId: null, unitId: null })}
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

      {(units.length > 0 || canArrange) && (
        <SidebarSectionLabel className="mt-4 justify-between pr-1">
          <span>{t('Units')}</span>
          {canArrange && (
            <SidebarRowAction label={t('New unit')} onClick={() => void newUnit(null)}><Plus size={13} /></SidebarRowAction>
          )}
        </SidebarSectionLabel>
      )}
      {units.length > 0 ? <>
        {childUnits(units, null).map((u) => (
          <UnitBranch key={u.id} unit={u} units={units} unitFocus={unitFocus} focusWorker={focus} canArrange={canArrange}
            membersOf={(id) => byAttention(members.filter((m) => m.unit_id === id).map((m) => m.worker_id))}
            memberRow={memberRow} onOpen={(id) => go({ unitId: id, workerId: null })} onNew={(id) => void newUnit(id)} />
        ))}
        {unplaced.length > 0 && (
          <GroupTree name={t('Not in a unit')} mark={<User size={16} />}
            homeActive={false} onOpenHome={() => go({ workerId: null, unitId: null })} items={unplaced.map((id) => memberRow(id, null))} />
        )}
      </> : <>
        {canArrange && (
          <SidebarRow size="sm" icon={<Plus size={14} />} label={<span className="text-muted-foreground">{t('Add a unit — a team, a department, a CoE')}</span>}
            onClick={() => void newUnit(null)} />
        )}
        <div className="mt-3">
          {!published && !roster.workers.length ? (
            <p className="px-2.5 py-2 text-[12px] text-muted-foreground">{t('Loading workload…')}</p>
          ) : <>
            <PlainGroup name={t('People')} mark={<User size={16} />} ids={unplaced.filter((id) => workers.get(id)!.type !== 'ai_agent')}
              memberRow={memberRow} onOpen={() => go({ workerId: null, unitId: null })} />
            <PlainGroup name={t('AI agents')} mark={<Bot size={16} />} ids={unplaced.filter((id) => workers.get(id)!.type === 'ai_agent')}
              memberRow={memberRow} onOpen={() => go({ workerId: null, unitId: null })} />
          </>}
        </div>
      </>}
    </div>
  );
}

type MemberRow = (id: string, unitId: string | null) => {
  id: string; label: string; mark: React.ReactNode; meta: React.ReactNode; active: boolean; onClick: () => void;
};

function PlainGroup({ name, mark, ids, memberRow, onOpen }: { name: string; mark: React.ReactNode; ids: string[]; memberRow: MemberRow; onOpen: () => void }) {
  if (!ids.length) return null;
  return <GroupTree name={name} mark={mark} defaultOpen homeActive={false} onOpenHome={onOpen} items={ids.map((id) => memberRow(id, null))} />;
}

/** One unit in the tree: its row (opens its page; the triangle folds; "…"
 *  arranges it), then the units inside it and its own members. */
function UnitBranch({ unit, units, unitFocus, focusWorker, canArrange, membersOf, memberRow, onOpen, onNew }: {
  unit: OrgUnit; units: OrgUnit[]; unitFocus: string | null; focusWorker: string | null; canArrange: boolean;
  membersOf: (unitId: string) => string[]; memberRow: MemberRow;
  onOpen: (unitId: string) => void; onNew: (parentId: string) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(true);
  const { update, remove } = useOrgUnitActions();
  const children = childUnits(units, unit.id);
  const ids = membersOf(unit.id);
  return (
    <div>
      <SidebarRow active={unitFocus === unit.id && focusWorker === null} icon={<Network size={16} />} label={unit.name} title={unit.name}
        meta={ids.length || null} onClick={() => onOpen(unit.id)}
        actions={<>
          {canArrange && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" aria-label={t('Unit actions')} title={t('Unit actions')}
                  className="flex size-6 items-center justify-center rounded text-muted-foreground outline-none hover:text-foreground"><MoreHorizontal size={14} /></button>
              </DropdownMenuTrigger>
              <MenuShell as="dropdown" align="start">
                <DropdownMenuItem onSelect={() => onNew(unit.id)}>{t('New unit inside')}</DropdownMenuItem>
                <DropdownMenuItem onSelect={async () => {
                  const name = (await appDialog.prompt(t('Unit name'), unit.name))?.trim();
                  if (name && name !== unit.name) update.mutate({ id: unit.id, patch: { name } });
                }}>{t('Rename')}</DropdownMenuItem>
                <div className={MENU_SEPARATOR} />
                <DropdownMenuItem onSelect={async () => {
                  if (!await appDialog.confirm(t('Delete the unit “{name}”? Its members stay in the Space.', { name: unit.name }))) return;
                  remove.mutate(unit.id);
                }}>{t('Delete')}</DropdownMenuItem>
              </MenuShell>
            </DropdownMenu>
          )}
          {(children.length > 0 || ids.length > 0) && (
            <SidebarRowAction label={t(open ? 'Collapse {name}' : 'Expand {name}', { name: unit.name })} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
              <DisclosureTriangle open={open} />
            </SidebarRowAction>
          )}
        </>} />
      {open && (children.length > 0 || ids.length > 0) && (
        <div className="mt-0.5 pl-7">
          {children.map((c) => (
            <UnitBranch key={c.id} unit={c} units={units} unitFocus={unitFocus} focusWorker={focusWorker} canArrange={canArrange}
              membersOf={membersOf} memberRow={memberRow} onOpen={onOpen} onNew={onNew} />
          ))}
          {ids.map((id) => {
            const row = memberRow(id, unit.id);
            return <SidebarRow key={row.id} active={row.active} icon={row.mark} label={row.label} meta={row.meta} onClick={row.onClick} />;
          })}
        </div>
      )}
    </div>
  );
}

/** A Worker's load beside their name: red when over capacity, "Away" when out. */
function Load({ person }: { person: WorkloadPerson | undefined }) {
  const { t } = useI18n();
  if (!person) return <span>—</span>;
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
function attentionOrder(a: WorkloadPerson | undefined, b: WorkloadPerson | undefined): number {
  return Number((b?.overDays ?? 0) > 0) - Number((a?.overDays ?? 0) > 0)
    || Number((b?.dueAway ?? 0) > 0) - Number((a?.dueAway ?? 0) > 0)
    || (b?.utilization ?? -1) - (a?.utilization ?? -1);
}
