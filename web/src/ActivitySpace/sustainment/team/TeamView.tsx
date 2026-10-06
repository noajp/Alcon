'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Bot, LoaderCircle, Search } from 'lucide-react';
import { useTeamRoster } from '@/hooks/useTeamRoster';
import { useWorkerSkills } from '@/hooks/useWorkerSkills';
import { WorkerAvatar } from '@/Function/shared/WorkerAvatar';
import { useEscapeLayer } from '@/Function/shared/keyboard';
import { standingCapacity } from '@/Function/shared/workerCapacity';
import { parseCapacityDraft, type TeamRosterEntry } from '@/ActivitySpace/sustainment/team/teamRoster';
import { skillIndex, skillLevelLabel } from '@/ActivitySpace/sustainment/team/people';
import { PersonPanel } from '@/ActivitySpace/sustainment/team/PersonPanel';
import { NavTeamsIcon } from '@/shell/sidebar/NavIcons';
import { FONT } from '@/shared/designTokens';
import { Button } from '@/ui/button';
import type { Worker, WorkerSkill } from '@/types/database';
import { useI18n } from '@/Function/i18n/I18nProvider';

interface TeamViewProps {
  onOpenWorkload?: (workerId?: string) => void;
  onOpenElement?: (elementId: string) => void;
  onManageTeam?: () => void;
}

type SaveCapacity = (workerId: string, hours: number | null) => Promise<Worker>;

function CapacityField({ worker, canManage, onSave }: { worker: Worker; canManage: boolean; onSave: SaveCapacity }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saving = useRef(false);
  const mounted = useRef(true);
  const inputId = useId();
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEscapeLayer(editing, () => { if (!saving.current) setEditing(false); });

  const save = async () => {
    if (saving.current) return;
    let hours: number | null;
    try { hours = parseCapacityDraft(draft); }
    catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Enter a valid capacity.');
      return;
    }
    if (hours === worker.capacity_hours_per_day) { setEditing(false); return; }
    saving.current = true;
    setPending(true);
    setError(null);
    try {
      await onSave(worker.id, hours);
      if (mounted.current) setEditing(false);
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : 'Could not save capacity. Try again.');
    } finally {
      saving.current = false;
      if (mounted.current) setPending(false);
    }
  };

  if (!editing) {
    const label = `${standingCapacity(worker)} h/day${worker.capacity_hours_per_day === null ? ' · default' : ''}`;
    return canManage ? (
      <Button variant="ghost" size="sm" aria-label={`Edit capacity for ${worker.name}: ${label}`} onClick={() => {
        setDraft(worker.capacity_hours_per_day === null ? '' : String(worker.capacity_hours_per_day));
        setError(null);
        setEditing(true);
      }}>{label}</Button>
    ) : <span className={`${FONT.sm} px-2 text-muted-foreground tabular-nums`} title="Standing capacity">{label}</span>;
  }

  return (
    <form className="flex flex-col gap-2 w-full sm:w-72" aria-busy={pending} onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <label htmlFor={inputId} className={`${FONT.sm} text-muted-foreground`}>Standing hours per day</label>
      <div className="flex items-center gap-2">
        <input
          id={inputId} type="text" inputMode="decimal" autoFocus disabled={pending}
          className={`${FONT.base} h-8 w-20 px-2 rounded-md bg-transparent focus:bg-[var(--surface-raised)] tabular-nums`}
          value={draft} onChange={(event) => { setDraft(event.target.value); setError(null); }}
          placeholder={String(standingCapacity({ ...worker, capacity_hours_per_day: null }))}
          aria-invalid={Boolean(error)} aria-describedby={`${inputId}-hint${error ? ` ${inputId}-error` : ''}`}
        />
        <Button type="submit" size="sm" disabled={pending}>{pending ? <><LoaderCircle size={12} className="animate-spin" />Saving…</> : 'Save'}</Button>
        <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => setEditing(false)}>Cancel</Button>
      </div>
      <span id={`${inputId}-hint`} className={`${FONT.xs} text-muted-foreground`}>0–24 hours. Leave blank for the default.</span>
      {error && <p id={`${inputId}-error`} role="alert" className={`${FONT.sm} text-[var(--status-danger)]`}>{error}</p>}
    </form>
  );
}

function PersonRow({ entry, skills, selected, onSelect }: {
  entry: TeamRosterEntry;
  skills: WorkerSkill[];
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useI18n();
  const { worker, activeElements } = entry;
  const top = skills.slice(0, 3);
  return <li>
    <button type="button" aria-current={selected || undefined} onClick={onSelect}
      className={`w-full flex items-center gap-3 rounded-md px-2 py-2 text-left transition-colors ${selected ? 'bg-[var(--surface-strong)]' : 'hover:bg-muted/30'}`}>
      <WorkerAvatar worker={worker} size={28} />
      <span className="flex-1 min-w-0">
        <span className="flex items-center gap-1.5">
          <span className={`${FONT.base} font-medium text-foreground truncate`}>{worker.name}</span>
          {worker.type === 'ai_agent' && <Bot size={12} className="text-muted-foreground shrink-0" aria-label={t('AI agent')} />}
        </span>
        <span className={`${FONT.xs} text-muted-foreground block truncate`}>
          {top.length > 0 ? top.map((skill) => skill.name).join(' · ') : worker.role ?? t(entry.membership)}
        </span>
      </span>
      <span className={`${FONT.xs} text-muted-foreground tabular-nums shrink-0`}>{t('{n} open', { n: activeElements.length })}</span>
    </button>
  </li>;
}

function TeamContent({ roster, onOpenWorkload, onOpenElement, onManageTeam }: TeamViewProps & { roster: ReturnType<typeof useTeamRoster> }) {
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const [skillFilter, setSkillFilter] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const workerIds = useMemo(() => roster.entries.map((entry) => entry.worker.id), [roster.entries]);
  const skills = useWorkerSkills(workerIds);
  const index = useMemo(() => skillIndex(skills.data.skills, skills.data.evidence, new Set(workerIds)), [skills.data, workerIds]);
  const skillsByWorker = useMemo(() => {
    const map = new Map<string, WorkerSkill[]>();
    for (const skill of skills.data.skills) map.set(skill.worker_id, [...(map.get(skill.worker_id) ?? []), skill]);
    for (const list of map.values()) list.sort((a, b) => b.level - a.level || a.name.localeCompare(b.name));
    return map;
  }, [skills.data.skills]);

  const query = search.trim().toLocaleLowerCase();
  const holders = skillFilter ? index.find((row) => row.key === skillFilter)?.holders ?? [] : null;
  const rank = new Map(holders?.map((holder, position) => [holder.workerId, position]));
  const filtered = roster.entries
    .filter((entry) => !holders || rank.has(entry.worker.id))
    .filter(({ worker, domainNames, membership }) => [worker.name, worker.role, worker.email, worker.type, membership, ...domainNames,
      ...(skillsByWorker.get(worker.id) ?? []).map((skill) => skill.name)]
      .some((value) => value?.toLocaleLowerCase().includes(query)))
    .sort((a, b) => (rank.get(a.worker.id) ?? 0) - (rank.get(b.worker.id) ?? 0));
  const groups = [
    { title: t('Members'), entries: filtered.filter((entry) => entry.isMember) },
    { title: t('Participating Workers'), entries: filtered.filter((entry) => !entry.isMember) },
  ];
  const selected = filtered.find((entry) => entry.worker.id === selectedId) ?? filtered[0] ?? null;
  const filterSummary = holders && skillFilter
    ? holders.map((holder) => `${roster.entries.find((entry) => entry.worker.id === holder.workerId)?.worker.name ?? ''} (${t(skillLevelLabel(holder.level))})`).join(', ')
    : null;

  return <div className="max-w-6xl mx-auto px-4 sm:px-8 py-6 space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className={`${FONT.xl} text-foreground`}>{t('People')}</h1>
        <p className={`${FONT.sm} text-muted-foreground mt-1`}>{t('Who is here, what they know, and what they have worked on. People and AI agents share one roster.')}</p>
      </div>
      <div className="flex items-center gap-2">
        {onManageTeam && <Button variant="ghost" size="sm" onClick={onManageTeam}>{t('Manage team')}</Button>}
        {onOpenWorkload && <Button variant="secondary" size="sm" onClick={() => onOpenWorkload()}>{t('Open Workload')}</Button>}
      </div>
    </div>
    <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] pb-3">
      <Search size={16} className="text-muted-foreground shrink-0" />
      <input type="search" aria-label={t('Find a person or skill')} placeholder={t('Find a person or skill…')} value={search} onChange={(event) => setSearch(event.target.value)}
        className={`${FONT.base} h-8 flex-1 min-w-0 px-2 bg-transparent focus:bg-[var(--surface-raised)] rounded-md`} />
      <span className={`${FONT.sm} text-muted-foreground tabular-nums`}>{t('{n} Workers', { n: filtered.length })}</span>
      <Button variant="ghost" size="sm" disabled={roster.loading || roster.refreshing || !roster.enabled} onClick={() => { void roster.refresh(); }}>
        {roster.refreshing ? t('Refreshing…') : t('Refresh')}
      </Button>
    </div>
    {index.length > 0 && <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t('Filter by skill')}>
        <span className={`${FONT.sm} text-muted-foreground mr-1`}>{t('Skills')}</span>
        {index.slice(0, 16).map((row) => {
          const active = skillFilter === row.key;
          return <Button key={row.key} shape="tab" size="xs" variant={active ? 'secondary' : 'ghost'} aria-pressed={active}
            onClick={() => setSkillFilter(active ? null : row.key)}>
            {row.name} <span className="text-muted-foreground tabular-nums">{row.holders.length}</span>
          </Button>;
        })}
      </div>
      {filterSummary && <p className={`${FONT.xs} text-muted-foreground`}>{t('Strongest first: {list}', { list: filterSummary })}</p>}
    </div>}
    {roster.error && <div role="alert" className={`${FONT.base} text-[var(--status-danger)]`}>{t('Could not refresh People.')} {roster.error.message}</div>}
    {!roster.enabled ? <p className={`${FONT.base} text-muted-foreground`}>{t('Select a Space to see its people.')}</p>
      : roster.loading ? <p role="status" className={`${FONT.base} text-muted-foreground`}>{t('Loading people…')}</p>
        : filtered.length === 0 ? <p className={`${FONT.base} text-muted-foreground`}>{query || skillFilter ? t('Nobody matches.') : t('No Workers are connected to this Space yet. Space members and Workers assigned to its Objects or Elements appear here.')}</p>
          : <div className="grid gap-6 lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
            <nav aria-label={t('People')} className="space-y-4 min-w-0">
              {groups.map((group) => group.entries.length > 0 && <section key={group.title}>
                <h2 className={`${FONT.sm} text-muted-foreground mb-1 px-2`}>{group.title} <span className="tabular-nums">{group.entries.length}</span></h2>
                <ul className="space-y-0.5">{group.entries.map((entry) => <PersonRow key={entry.worker.id} entry={entry}
                  skills={skillsByWorker.get(entry.worker.id) ?? []} selected={entry.worker.id === selected?.worker.id}
                  onSelect={() => {
                    setSelectedId(entry.worker.id);
                    // Below lg the panel sits under the list; bring it into view.
                    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches) {
                      requestAnimationFrame(() => panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
                    }
                  }} />)}</ul>
              </section>)}
            </nav>
            <div ref={panelRef} className="min-w-0 lg:border-l lg:border-[var(--border-subtle)] lg:pl-6">
              {selected && <PersonPanel key={selected.worker.id} entry={selected} skills={skills} objectNames={roster.objectNames}
                skillSuggestions={index.map((row) => row.name)} onOpenWorkload={onOpenWorkload} onOpenElement={onOpenElement}
                capacity={<CapacityField worker={selected.worker} canManage={selected.canManage} onSave={roster.saveCapacity} />} />}
            </div>
          </div>}
  </div>;
}

export function TeamView(props: TeamViewProps = {}) {
  const { t } = useI18n();
  const roster = useTeamRoster();
  return <div className="flex flex-col h-full bg-card">
    <div className="h-[50px] flex items-center gap-2 px-4 border-b border-border/60 bg-card flex-shrink-0">
      <NavTeamsIcon size={12} /><span className={`${FONT.sm} font-semibold text-foreground`}>{t('People')}</span>
    </div>
    <div className="flex-1 overflow-auto"><TeamContent key={roster.contextKey} roster={roster} {...props} /></div>
  </div>;
}
