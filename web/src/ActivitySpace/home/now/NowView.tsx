'use client';

import { ArrowRight, CheckCircle2, Clock3, GitBranch, RefreshCw, Upload } from 'lucide-react';
import { Button } from '@/ui/button';
import { statusColor, statusLabel } from '@/shared/designTokens';
import { displayIdOf } from '@/ActivitySpace/execution/element/displayId';
import type { ElementWithDetails } from '@/types/database';
import { type NowItem, type NowLane, type NowScope, workAssignees, validWorkDate } from './nowModel';

const LANES: { id: NowLane; title: string; description: string }[] = [
  { id: 'attention', title: 'Review & clarify', description: 'A result or decision needs a response.' },
  { id: 'ready', title: 'Move forward', description: 'Start or continue from the latest shared context.' },
  { id: 'waiting', title: 'Waiting on', description: 'See what must change before this work can move.' },
  { id: 'later', title: 'Later', description: 'Backlog and future starts, kept out of today’s queue.' },
];

export function NowView({ items, scope, onScopeChange, readAt, refreshing, error, onRefresh, onImport,
  onOpenElement, onCheckIn, onPersonalWork }: {
  items: NowItem[];
  scope: NowScope;
  onScopeChange: (scope: NowScope) => void;
  readAt: string;
  refreshing: boolean;
  error: string | null;
  onRefresh: () => void;
  onImport: () => void;
  onOpenElement: (element: ElementWithDetails) => void;
  onCheckIn: (element: ElementWithDetails) => void;
  onPersonalWork: () => void;
}) {
  const active = items.filter(r => r.lane !== 'later').length;
  return (
    <div className="flex-1 overflow-auto">
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-8">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-[24px] font-semibold text-foreground">Now</h1>
            <p className="mt-1 text-[13px] text-muted-foreground">Know what can move. Share what changed.</p>
          </div>
          <Button variant="primary" size="md" onClick={onImport}><Upload size={16} />Bring existing work</Button>
        </header>
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] pb-3">
          <div className="flex items-center gap-1" role="group" aria-label="Work scope">
            <Button variant={scope === 'mine' ? 'secondary' : 'ghost'} aria-pressed={scope === 'mine'} onClick={() => onScopeChange('mine')}>My work</Button>
            <Button variant={scope === 'team' ? 'secondary' : 'ghost'} aria-pressed={scope === 'team'} onClick={() => onScopeChange('team')}>Team</Button>
            <span className="ml-2 text-[12px] tabular-nums text-muted-foreground">{active} active</span>
          </div>
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
            {readAt && <span>Read {new Date(readAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
            <Button variant="ghost" size="icon-sm" aria-label="Refresh work" title="Refresh work" disabled={refreshing} onClick={onRefresh}>
              <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            </Button>
          </div>
        </div>
        {error && <div role="alert" className="mt-4 rounded-md bg-[var(--status-warning-subtle)] p-3 text-[13px] text-foreground">
          {error} <span className="text-muted-foreground">Shown work may be out of date. Refresh before acting.</span>
        </div>}
        {items.length === 0 && <div className="py-12">
          <CheckCircle2 size={24} className="mb-4 text-muted-foreground" />
          <h2 className="text-[16px] font-semibold">{scope === 'mine' ? 'No open work assigned to you here' : 'Start with the work you already have'}</h2>
          <p className="mt-2 max-w-lg text-[13px] leading-relaxed text-muted-foreground">
            {scope === 'mine' ? 'Look at the team’s work, or bring in one project and match its assignees. Personal Elements without a project remain in My Elements.'
              : 'Paste a list or bring a CSV. Check the dates and assignees, then start moving the first Element forward.'}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {scope === 'mine' && <Button onClick={() => onScopeChange('team')}>Show team work <ArrowRight size={14} /></Button>}
            <Button variant="ghost" onClick={onPersonalWork}>Open My Elements</Button>
          </div>
        </div>}
        <div className="divide-y divide-[var(--border-subtle)]">
          {LANES.map(lane => {
            const rows = items.filter(row => row.lane === lane.id);
            if (!rows.length) return null;
            const content = <div className="mt-3 divide-y divide-[var(--border-subtle)]">
              {rows.map(item => <NowRow key={item.element.id} item={item} onOpenElement={onOpenElement} onCheckIn={onCheckIn} disabled={!!error} />)}
            </div>;
            if (lane.id === 'later') return <details key={lane.id} className="py-5">
              <summary className="cursor-pointer text-[13px] font-semibold">Later <span className="ml-2 font-normal text-muted-foreground">{rows.length}</span></summary>
              <p className="mt-1 text-[12px] text-muted-foreground">{lane.description}</p>{content}
            </details>;
            return <section key={lane.id} aria-label={lane.title} className="py-5">
              <h2 className="text-[14px] font-semibold">{lane.title} <span className="ml-2 text-[12px] font-normal tabular-nums text-muted-foreground">{rows.length}</span></h2>
              <p className="mt-1 text-[12px] text-muted-foreground">{lane.description}</p>{content}
            </section>;
          })}
        </div>
        <p className="mt-4 text-[12px] leading-relaxed text-muted-foreground">Current Space only. Readiness uses recorded dependencies, not a capacity or delivery forecast. Missing dates and hidden dependencies are not treated as confirmed progress.</p>
      </div>
    </div>
  );
}

function NowRow({ item, onOpenElement, onCheckIn, disabled }: {
  item: NowItem;
  onOpenElement: (element: ElementWithDetails) => void;
  onCheckIn: (element: ElementWithDetails) => void;
  disabled: boolean;
}) {
  const e = item.element;
  return <div className="py-4">
    <div className="flex items-start gap-3">
      <span className="mt-2 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: statusColor(e.status) }} title={statusLabel(e.status)} />
      <div className="min-w-0 flex-1">
        <Button variant="ghost" align="start" onClick={() => onOpenElement(e)} className="h-auto min-h-7 max-w-full justify-start whitespace-normal px-0 text-left text-[14px] font-medium leading-relaxed hover:bg-transparent hover:underline">
          {e.title}
        </Button>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
          {displayIdOf(e) && <span className="font-mono">{displayIdOf(e)}</span>}
          <span>{workAssignees(e)}</span><span>{statusLabel(e.status)}</span>
          {e.due_date && <span className={item.overdue ? 'text-[var(--status-warning)]' : ''}>{!validWorkDate(e.due_date) ? 'Unrecognized due date · ' : item.overdue ? 'Due date passed · ' : 'Due '}{e.due_date}</span>}
          {(e.objects ?? []).map(o => <span key={o.id}>{o.name}</span>)}
        </div>
        <p className="mt-2 text-[12px] text-muted-foreground">{item.reason}</p>
        {item.next && <p className="mt-2 whitespace-pre-wrap break-words text-[13px] leading-relaxed"><span className="text-muted-foreground">Next · </span>{item.next}</p>}
        {item.blockers.length > 0 && <div className="mt-2 flex flex-col items-start gap-1">
          {item.blockers.map(blocker => <Button key={blocker.id} variant="ghost" align="start" onClick={() => onOpenElement(blocker)}
            className="h-auto min-h-7 max-w-full whitespace-normal text-left">
            <Clock3 size={14} /><span className="min-w-0 break-words">{blocker.title}<span className="text-muted-foreground"> · {workAssignees(blocker)}</span></span><ArrowRight size={12} />
          </Button>)}
        </div>}
        {item.unlocks.length > 0 && <p className="mt-2 flex items-start gap-2 text-[12px] text-muted-foreground"><GitBranch size={14} className="mt-0.5 shrink-0" />
          <span>Completing this clears the recorded prerequisites for {item.unlocks.map(el => el.title).join(', ')}.</span>
        </p>}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => onCheckIn(e)} disabled={disabled}>Share an update</Button>
          <Button size="sm" variant="ghost" onClick={() => onOpenElement(e)}>Open Element <ArrowRight size={13} /></Button>
        </div>
      </div>
    </div>
  </div>;
}
