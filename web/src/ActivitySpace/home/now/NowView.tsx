'use client';

import { ArrowRight, Clock3, GitBranch, RefreshCw, Upload } from '@/ui/icons';
import { Button, ButtonAppearanceProvider } from '@/ui/button';
import { FONT, statusColor, statusLabel } from '@/shared/designTokens';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { displayIdOf } from '@/Function/shared/element/displayId';
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
  const { t, locale } = useI18n();
  const active = items.filter(r => r.lane !== 'later').length;
  return (
    <div className="flex-1 overflow-auto">
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-8">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-[24px] font-semibold text-foreground">{t('Now')}</h1>
            <p className="mt-1 text-[13px] text-muted-foreground">{t('Know what can move. Share what changed.')}</p>
          </div>
          <Button variant="ghost" onClick={onImport}><Upload size={14} />{t('Bring existing work')}</Button>
        </header>
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1" role="group" aria-label={t('Work scope')}>
            <Button shape="tab" variant={scope === 'mine' ? 'secondary' : 'ghost'} aria-pressed={scope === 'mine'} onClick={() => onScopeChange('mine')}>{t('My work')}</Button>
            <Button shape="tab" variant={scope === 'team' ? 'secondary' : 'ghost'} aria-pressed={scope === 'team'} onClick={() => onScopeChange('team')}>{t('Team')}</Button>
            <span className="ml-2 text-[12px] tabular-nums text-muted-foreground">{t('{n} active', { n: active })}</span>
          </div>
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
            {readAt && <span>{t('Read {time}', { time: new Date(readAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) })}</span>}
            <ButtonAppearanceProvider appearance="navigation">
              <Button variant="ghost" size="icon-sm" aria-label={t('Refresh work')} title={t('Refresh work')} disabled={refreshing} onClick={onRefresh}>
                <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
              </Button>
            </ButtonAppearanceProvider>
          </div>
        </div>
        {error && <div role="alert" className="mt-4 rounded-md bg-[var(--status-warning-subtle)] p-3 text-[13px] text-foreground">
          {error} <span className="text-muted-foreground">{t('Shown work may be out of date. Refresh before acting.')}</span>
        </div>}
        {items.length === 0 && <div className="flex flex-col items-start gap-2 py-12">
          <p className="text-[13px] text-muted-foreground">
            {t(scope === 'mine' ? 'No open work assigned to you here.' : 'Paste a list or bring a CSV. Check the dates and assignees, then start moving the first Element forward.')}
          </p>
          {scope === 'mine'
            ? <Button variant="ghost" size="sm" onClick={() => onScopeChange('team')}>{t('Show team work')} <ArrowRight size={14} /></Button>
            : <Button variant="ghost" size="sm" onClick={onPersonalWork}>{t('Open My Elements')}</Button>}
        </div>}
        <div className="mt-4 space-y-8">
          {LANES.map(lane => {
            const rows = items.filter(row => row.lane === lane.id);
            if (!rows.length) return null;
            const content = <div className="mt-2 space-y-0.5">
              {rows.map(item => <NowRow key={item.element.id} item={item} onOpenElement={onOpenElement} onCheckIn={onCheckIn} disabled={!!error} />)}
            </div>;
            const heading = <>{t(lane.title)} <span className="ml-2 text-[12px] font-normal tabular-nums text-muted-foreground">{rows.length}</span></>;
            if (lane.id === 'later') return <details key={lane.id}>
              <summary className={`cursor-pointer ${FONT.lg} text-foreground`}>{heading}</summary>
              <p className="mt-1 text-[12px] text-muted-foreground">{t(lane.description)}</p>{content}
            </details>;
            return <section key={lane.id} aria-label={t(lane.title)}>
              <h2 className={`${FONT.lg} text-foreground`}>{heading}</h2>
              <p className="mt-1 text-[12px] text-muted-foreground">{t(lane.description)}</p>{content}
            </section>;
          })}
        </div>
        <p className="mt-8 text-[12px] leading-relaxed text-muted-foreground">{t('Current Space only. Readiness uses recorded dependencies, not a capacity or delivery forecast. Missing dates and hidden dependencies are not treated as confirmed progress.')}</p>
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
  const { t } = useI18n();
  const e = item.element;
  const who = (element: ElementWithDetails) => { const names = workAssignees(element); return names === 'Unassigned' ? t(names) : names; };
  return <div className="-mx-2 rounded-lg px-2 py-3 transition-colors hover:bg-muted/40 focus-within:bg-muted/40">
    <div className="flex items-start gap-3">
      <span className="mt-2 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: statusColor(e.status) }} title={t(statusLabel(e.status))} />
      <div className="min-w-0 flex-1">
        <button type="button" onClick={() => onOpenElement(e)} className="max-w-full text-left text-[14px] font-medium leading-relaxed text-foreground hover:underline">
          {e.title}
        </button>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
          {displayIdOf(e) && <span className="font-mono">{displayIdOf(e)}</span>}
          <span>{who(e)}</span><span>{t(statusLabel(e.status))}</span>
          {e.due_date && <span className={item.overdue ? 'text-[var(--status-warning)]' : ''}>{t(!validWorkDate(e.due_date) ? 'Unrecognized due date · {date}' : item.overdue ? 'Due date passed · {date}' : 'Due {date}', { date: e.due_date })}</span>}
          {(e.objects ?? []).map(o => <span key={o.id}>{o.name}</span>)}
        </div>
        <p className="mt-2 text-[12px] text-muted-foreground">{t(item.reason, item.reasonValues)}</p>
        {item.next && <p className="mt-2 whitespace-pre-wrap break-words text-[13px] leading-relaxed"><span className="text-muted-foreground">{t('Next')} · </span>{item.next}</p>}
        <ButtonAppearanceProvider appearance="inline">
          {item.blockers.length > 0 && <div className="mt-2 flex flex-col items-start gap-1">
            {item.blockers.map(blocker => <Button key={blocker.id} variant="ghost" align="start" onClick={() => onOpenElement(blocker)}
              className="h-auto min-h-7 max-w-full whitespace-normal text-left">
              <Clock3 size={14} /><span className="min-w-0 break-words">{blocker.title}<span className="text-muted-foreground"> · {who(blocker)}</span></span><ArrowRight size={12} />
            </Button>)}
          </div>}
          {item.unlocks.length > 0 && <p className="mt-2 flex items-start gap-2 text-[12px] text-muted-foreground"><GitBranch size={14} className="mt-0.5 shrink-0" />
            <span>{t('Completing this clears the recorded prerequisites for {names}.', { names: item.unlocks.map(el => el.title).join(', ') })}</span>
          </p>}
          <div className="mt-1 flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" onClick={() => onCheckIn(e)} disabled={disabled}>{t('Share an update')}</Button>
          </div>
        </ButtonAppearanceProvider>
      </div>
    </div>
  </div>;
}
