'use client';

import { Network, X } from '@/ui/icons';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { FONT } from '@/shared/designTokens';
import { WorkerAvatar } from '@/Function/shared/WorkerAvatar';
import { childUnits, membersBelow, unitsOf } from '@/Function/team/orgUnits';
import { useActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { useSpaceRole } from '@/Function/space/data';
import { useOrgUnitActions, useOrgUnits } from '@/hooks/orgUnitData';
import { useTeamRoster } from '@/hooks/useTeamRoster';

const SELECT = `${FONT.sm} h-7 rounded-md bg-transparent px-2 text-foreground hover:bg-muted/40 focus:bg-[var(--surface-raised)]`;

/**
 * A unit's page under its members' load: who leads it, the units inside it,
 * and its members — added from the Space's Workers, removed with ×. Its
 * owners arrange it; everyone else reads it.
 */
export function UnitPanel({ unitId, onOpenUnit, onOpenWorker }: {
  unitId: string;
  onOpenUnit: (unitId: string) => void;
  onOpenWorker: (workerId: string) => void;
}) {
  const { t } = useI18n();
  const { units, members } = useOrgUnits();
  const { workers } = useTeamRoster();
  const canArrange = useSpaceRole(useActiveSpaceId()) === 'owner';
  const { update, addMember, removeMember } = useOrgUnitActions();
  const unit = units.find((u) => u.id === unitId);
  if (!unit) return null;
  const direct = members.filter((m) => m.unit_id === unit.id).map((m) => m.worker_id);
  const everyone = membersBelow(units, members, unit.id);
  const children = childUnits(units, unit.id);
  const byId = new Map(workers.map((w) => [w.id, w]));
  const outside = workers.filter((w) => !direct.includes(w.id)).sort((a, b) => a.name.localeCompare(b.name));
  const lead = unit.lead_worker_id ? byId.get(unit.lead_worker_id) : undefined;

  return (
    <div className="max-w-3xl space-y-6 py-5 pl-[30px] pr-6">
      <div>
        <h2 className={`${FONT.lg} flex items-center gap-2 text-foreground`}><Network size={16} className="text-muted-foreground" />{unit.name}</h2>
        <p className={`${FONT.sm} mt-1 text-muted-foreground`}>
          {t('{n} members, counting the units inside it.', { n: everyone.length })}
        </p>
      </div>

      <section className="space-y-1.5">
        <h3 className={`${FONT.sm} font-medium text-foreground`}>{t('Lead')}</h3>
        {canArrange ? (
          <select aria-label={t('Lead')} className={SELECT} value={unit.lead_worker_id ?? ''}
            onChange={(e) => update.mutate({ id: unit.id, patch: { lead_worker_id: e.target.value || null } })}>
            <option value="">{t('No lead')}</option>
            {[...workers].sort((a, b) => a.name.localeCompare(b.name)).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        ) : <p className={`${FONT.sm} text-muted-foreground`}>{lead?.name ?? t('No lead')}</p>}
      </section>

      {children.length > 0 && (
        <section className="space-y-1">
          <h3 className={`${FONT.sm} font-medium text-foreground`}>{t('Units inside')}</h3>
          <div className="-mx-2">
            {children.map((c) => (
              <button key={c.id} type="button" onClick={() => onOpenUnit(c.id)}
                className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-muted/40">
                <Network size={14} className="text-muted-foreground" />
                <span className={`${FONT.sm} min-w-0 flex-1 truncate text-foreground`}>{c.name}</span>
                <span className="text-[12px] tabular-nums text-muted-foreground">{membersBelow(units, members, c.id).length}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-1">
        <div className="flex items-center gap-2">
          <h3 className={`${FONT.sm} font-medium text-foreground`}>{t('Members')}</h3>
          <span className="text-[12px] tabular-nums text-muted-foreground">{direct.length}</span>
          <span className="flex-1" />
          {canArrange && outside.length > 0 && (
            <select aria-label={t('Add a member')} className={SELECT} value=""
              onChange={(e) => { if (e.target.value) addMember.mutate({ unitId: unit.id, workerId: e.target.value }); }}>
              <option value="">{t('Add a member…')}</option>
              {outside.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          )}
        </div>
        {direct.length === 0 ? (
          <p className={`${FONT.sm} text-muted-foreground`}>{canArrange ? t('No members yet. Add the people and AI agents who belong here.') : t('No members yet.')}</p>
        ) : (
          <div className="-mx-2">
            {direct.map((id) => byId.get(id)).filter((w) => !!w).sort((a, b) => a!.name.localeCompare(b!.name)).map((w) => (
              <div key={w!.id} className="group/member flex h-9 items-center gap-2 rounded-md px-2 hover:bg-muted/40">
                <button type="button" onClick={() => onOpenWorker(w!.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                  <WorkerAvatar worker={w!} size={20} />
                  <span className={`${FONT.sm} truncate text-foreground`}>{w!.name}</span>
                  {w!.id === unit.lead_worker_id && <span className="text-[11px] text-muted-foreground">{t('Lead')}</span>}
                  {w!.role && <span className="truncate text-[12px] text-muted-foreground">{w!.role}</span>}
                </button>
                {canArrange && (
                  <button type="button" aria-label={t('Remove {name} from the unit', { name: w!.name })} title={t('Remove from the unit')}
                    onClick={() => removeMember.mutate({ unitId: unit.id, workerId: w!.id })}
                    className="flex size-6 items-center justify-center rounded text-muted-foreground opacity-0 hover:text-foreground group-hover/member:opacity-100">
                    <X size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/** The units a Worker belongs to, for their profile; each opens its unit. */
export function WorkerUnits({ workerId, onOpenUnit }: { workerId: string; onOpenUnit: (unitId: string) => void }) {
  const { t } = useI18n();
  const { units, members } = useOrgUnits();
  const mine = unitsOf(units, members, workerId);
  if (!units.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 pl-[30px] pr-6 pt-5">
      <span className={`${FONT.sm} mr-1 text-muted-foreground`}>{t('Units')}</span>
      {mine.length === 0 ? <span className={`${FONT.sm} text-muted-foreground`}>{t('Not in a unit')}</span>
        : mine.map((u) => (
          <button key={u.id} type="button" onClick={() => onOpenUnit(u.id)}
            className="flex h-6 items-center gap-1 rounded-full bg-[var(--surface-strong)] px-2 text-[12px] text-foreground hover:bg-muted">
            <Network size={11} className="text-muted-foreground" />{u.name}
          </button>
        ))}
    </div>
  );
}
