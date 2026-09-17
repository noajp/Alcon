'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Bot, ChevronDown, ChevronRight, LoaderCircle, Search } from 'lucide-react';
import { useTeamRoster } from '@/hooks/useTeamRoster';
import { ReachHint, WorkerAvatar } from '@/Function/shared/WorkerAvatar';
import { formatElementDate, toDateOnlyString } from '@/Function/shared/dateUtils';
import { useEscapeLayer } from '@/Function/shared/keyboard';
import { standingCapacity } from '@/Function/shared/workerCapacity';
import { parseCapacityDraft, type TeamRosterEntry } from '@/ActivitySpace/sustainment/team/teamRoster';
import { NavTeamsIcon } from '@/shell/sidebar/NavIcons';
import { FONT, STATUS } from '@/shared/designTokens';
import { Button } from '@/ui/button';
import type { Worker } from '@/types/database';
import { displayIdOf } from '@/ActivitySpace/execution/element/displayId';
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

function WorkerRow({ entry, onSave, onOpenWorkload, onOpenElement }: {
  entry: TeamRosterEntry;
  onSave: SaveCapacity;
} & Pick<TeamViewProps, 'onOpenWorkload' | 'onOpenElement'>) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const { worker, activeElements } = entry;
  const today = toDateOnlyString(new Date());
  const overdue = activeElements.filter((element) => element.due_date && element.due_date.slice(0, 10) < today).length;
  const typeLabel = worker.type === 'ai_agent' ? 'AI agent' : worker.type === 'robot' ? 'Robot' : null;
  const context = [entry.membership, ...entry.domainNames].join(' · ');

  return (
    <li className="border-b border-[var(--border-subtle)] last:border-b-0">
      <div className="flex flex-wrap items-center gap-3 px-2 py-3 hover:bg-muted/20 transition-colors">
        <WorkerAvatar worker={worker} size={28} />
        <div className="flex-1 min-w-40">
          <div className="flex items-center gap-2">
            <span className={`${FONT.base} font-medium text-foreground truncate`}>{worker.name}</span>
            {typeLabel && <span className={`${FONT.xs} text-muted-foreground flex items-center gap-1`}><Bot size={12} />{typeLabel}</span>}
            <ReachHint worker={worker} />
          </div>
          <p className={`${FONT.sm} text-muted-foreground truncate`} title={context}>{worker.role ? `${worker.role} · ` : ''}{context}</p>
        </div>
        <div className="flex w-full min-w-0 flex-wrap items-center gap-2 pl-10 sm:w-auto sm:pl-0">
          <Button variant="ghost" size="sm" disabled={activeElements.length === 0} aria-expanded={expanded} aria-controls={listId} onClick={() => setExpanded((value) => !value)}>
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {activeElements.length} open{overdue > 0 && <span className="text-[var(--status-warning)]"> · {overdue} overdue</span>}
          </Button>
          <CapacityField worker={worker} canManage={entry.canManage} onSave={onSave} />
          {onOpenWorkload && <Button variant="ghost" size="sm" onClick={() => onOpenWorkload(worker.id)}>Workload</Button>}
        </div>
      </div>
      {expanded && <ul id={listId} className="pb-3 pl-12 pr-2 space-y-1">
        {activeElements.map((element) => {
          const status = STATUS[element.status ?? 'todo'];
          const content = <>
            <span className={`size-2 rounded-full shrink-0 ${status.dot}`} aria-label={status.label} />
            {displayIdOf(element) && <span className={`${FONT.mono} shrink-0`}>{displayIdOf(element)}</span>}
            <span className="flex-1 truncate">{element.title}</span>
            <span className={`${FONT.xs} shrink-0 text-muted-foreground`}>{element.due_date ? formatElementDate(element.due_date) : 'No due date'}</span>
          </>;
          return <li key={element.id}>{onOpenElement
            ? <Button variant="ghost" size="md" align="start" className="w-full min-w-0" onClick={() => onOpenElement(element.id)}>{content}</Button>
            : <div className={`${FONT.base} flex items-center gap-2 h-8 px-3`}>{content}</div>}
          </li>;
        })}
      </ul>}
    </li>
  );
}

function TeamContent({ roster, onOpenWorkload, onOpenElement, onManageTeam }: TeamViewProps & { roster: ReturnType<typeof useTeamRoster> }) {
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const query = search.trim().toLocaleLowerCase();
  const filtered = roster.entries.filter(({ worker, domainNames, membership }) => [worker.name, worker.role, worker.email, worker.type, membership, ...domainNames]
    .some((value) => value?.toLocaleLowerCase().includes(query)));
  const groups = [
    { title: 'Members', entries: filtered.filter((entry) => entry.isMember) },
    { title: 'Participating Workers', entries: filtered.filter((entry) => !entry.isMember) },
  ];

  return <div className="max-w-5xl mx-auto px-4 sm:px-8 py-6 space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className={`${FONT.xl} text-foreground`}>{t('Team')}</h1>
        <p className={`${FONT.sm} text-muted-foreground mt-1`}>Members and Workers supporting this Space. Capacity applies across their work.</p>
      </div>
      <div className="flex items-center gap-2">
        {onManageTeam && <Button variant="ghost" size="sm" onClick={onManageTeam}>Manage team</Button>}
        {onOpenWorkload && <Button variant="secondary" size="sm" onClick={() => onOpenWorkload()}>Open Workload</Button>}
      </div>
    </div>
    <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] pb-3">
      <Search size={16} className="text-muted-foreground shrink-0" />
      <input type="search" aria-label="Find a Worker" placeholder="Find a Worker…" value={search} onChange={(event) => setSearch(event.target.value)}
        className={`${FONT.base} h-8 flex-1 min-w-0 px-2 bg-transparent focus:bg-[var(--surface-raised)] rounded-md`} />
      <span className={`${FONT.sm} text-muted-foreground tabular-nums`}>{filtered.length} Workers</span>
      <Button variant="ghost" size="sm" disabled={roster.loading || roster.refreshing || !roster.enabled} onClick={() => { void roster.refresh(); }}>
        {roster.refreshing ? 'Refreshing…' : 'Refresh'}
      </Button>
    </div>
    {roster.error && <div role="alert" className={`${FONT.base} text-[var(--status-danger)]`}>Could not refresh Team. {roster.error.message}</div>}
    {!roster.enabled ? <p className={`${FONT.base} text-muted-foreground`}>Select a Space to view its Team.</p>
      : roster.loading ? <p role="status" className={`${FONT.base} text-muted-foreground`}>Loading Team…</p>
        : filtered.length === 0 ? <p className={`${FONT.base} text-muted-foreground`}>{query ? 'No Workers match your search.' : 'No Workers are connected to this Space yet. Space members and Workers assigned to its Objects or Elements appear here.'}</p>
          : groups.map((group) => group.entries.length > 0 && <section key={group.title}>
            <h2 className={`${FONT.lg} text-foreground mb-2`}>{group.title} <span className="text-muted-foreground">{group.entries.length}</span></h2>
            <ul>{group.entries.map((entry) => <WorkerRow key={entry.worker.id} entry={entry} onSave={roster.saveCapacity} onOpenWorkload={onOpenWorkload} onOpenElement={onOpenElement} />)}</ul>
          </section>)}
  </div>;
}

export function TeamView(props: TeamViewProps = {}) {
  const { t } = useI18n();
  const roster = useTeamRoster();
  return <div className="flex flex-col h-full bg-card">
    <div className="h-[50px] flex items-center gap-2 px-4 border-b border-border/60 bg-card flex-shrink-0">
      <NavTeamsIcon size={12} /><span className={`${FONT.sm} font-semibold text-foreground`}>{t('Team')}</span>
    </div>
    <div className="flex-1 overflow-auto"><TeamContent key={roster.contextKey} roster={roster} {...props} /></div>
  </div>;
}
