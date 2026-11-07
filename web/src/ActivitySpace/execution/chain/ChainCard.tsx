'use client';

import { AlertTriangle, Check, Flag, Hand, Pause, Plus } from '@/ui/icons';
import { Button } from '@/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { ObjectIcon } from '@/Function/shared/conceptIcons';
import { ItemIcon } from '@/Function/shared/itemIcon/ItemIcon';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { advanceFromElement } from '@/AIP/ai/agentData';
import { ElementCard } from '@/ActivitySpace/execution/element/board/ElementCard';
import { WaitingChip } from '@/ActivitySpace/execution/element/board/BoardColumn';
import { StatusPicker } from '@/Function/shared/StatusPicker';
import { ElementProgressMark, getElementProgress } from '@/Function/shared/ElementProgressMark';
import { traceHeadline, traceStatusWord, VERDICT_FAIL_WORD } from '@/Function/shared/workTrace';
import { CARD_FLAT, FONT, STATUS } from '@/shared/designTokens';
import type { ElementWithDetails } from '@/types/database';
import type { RoundSummary } from '@/hooks/definitionData';
import type { ChainStatus } from './ExecutionChain';
import type { WaitingReason } from './waiting';
import {
  type ActionState, type ChainFilter, type FleetElement, type FleetObjectRow, type MissionRunRow, type MissionSummary,
} from '@/ActivitySpace/strategy/initiative/mission/missionModel';
import { STATE_LABEL, stateColor } from '@/ActivitySpace/strategy/initiative/mission/MissionPanels';

// The Execution Chain's card, shared by every host of the chain — a
// Strategy's and a Domain's alike: the shared Element card with the
// chain's lead, badge and lines, so a card reads the same wherever the
// chain is drawn. The lines under the title are the work's own account:
// the latest run's one line (the shared trace headline), what it
// delivers, the work it waits on, a loop's progress, and a hand-off to
// Claude Code. The run's model and cost are not here: they are run
// bookkeeping, shown by the run panel and the trace's completion.

function StateIcon({ state }: { state: ActionState }) {
  switch (state) {
    case 'running': return <span className="h-2.5 w-2.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />;
    case 'done': return <Check size={11} strokeWidth={2.5} />;
    case 'failed': case 'blocked': return <AlertTriangle size={11} />;
    case 'waiting': return <Hand size={11} />;
    case 'cancelled': return <Pause size={11} />;
    default: return <span className="h-1.5 w-1.5 rounded-full bg-current" />;
  }
}

function StateBadge({ state }: { state: ActionState }) {
  const { t } = useI18n();
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium"
      style={{ color: stateColor(state), background: `color-mix(in srgb, ${stateColor(state)} 14%, transparent)` }}>
      <StateIcon state={state} />
      {t(STATE_LABEL[state])}
    </span>
  );
}

/** Whether the card's state comes from an AI run rather than the Element's
 *  Status — the one case the card still needs a badge for. The column shows
 *  the Element's Status, the record a person sets; actionState is that same
 *  record read with the latest run, and the badge shows it only when the
 *  run adds something the Status cannot say. */
function runOnlyState(state: ActionState, status: string | null): boolean {
  if (state === 'failed') return true;
  if (state === 'running') return status !== 'in_progress';
  if (state === 'waiting') return status !== 'review';
  return false;
}

/** What the chain adds under a card's title: the latest run's one line
 *  (the shared trace headline), what it delivers, the work it waits
 *  on (each blocker with where it stands, opening it on click), a loop's
 *  progress, and a hand-off to Claude Code. */
export function ChainLines({ element, busy, onHandOver, rounds, onOpenElement, latestRun }: {
  element: FleetElement; busy: boolean; onHandOver?: () => void; rounds?: RoundSummary;
  onOpenElement?: (elementId: string) => void; latestRun?: MissionRunRow | null;
}) {
  const { t } = useI18n();
  // A loop's progress: how many rounds, the latest value and the best.
  const loop = rounds && rounds.rounds > 0
    ? t('{n} rounds · latest {last} · best {best}', {
      n: rounds.rounds, last: rounds.last ?? '—',
      best: rounds.values.length ? Math.max(...rounds.values) : '—',
    })
    : null;
  // The run's one line, from the shared trace model. Its words of its own
  // (the verdict's, the status words) translate; a run's summary or error
  // is data and stands as written.
  const headline = traceHeadline(latestRun);
  const headlineText = headline
    ? (headline.text === VERDICT_FAIL_WORD || headline.text === traceStatusWord('running') || headline.text === traceStatusWord('queued')
      ? t(headline.text) : headline.text)
    : null;
  if (!element.serves.length && !element.blockers.length && !onHandOver && !loop && !headline) return null;
  return (
    <div className="mt-1.5 space-y-0.5 text-[12px] leading-5 text-muted-foreground">
      {headline && (
        <div className={cn('flex min-w-0 items-center gap-1.5', headline.tone === 'danger' && 'text-[var(--status-danger)]', headline.tone === 'working' && 'text-[var(--accent-default)]')}><span className="truncate">{headlineText}</span></div>
      )}
      {element.serves.length > 0 && (
        <div className="flex min-w-0 items-center gap-1.5"><Flag size={12} className="shrink-0" /><span className="truncate">{element.serves.join(', ')}</span></div>
      )}
      {element.blockers.map((b, i) => (
        <div key={`${b.elementId ?? 'draft'}:${b.title}:${i}`} className="flex min-w-0 items-center gap-1.5">
          <span className="inline-flex shrink-0" style={{ color: stateColor(b.state) }}><StateIcon state={b.state} /></span>
          {b.elementId && onOpenElement ? (
            <button type="button" className="min-w-0 truncate text-left hover:text-foreground hover:underline"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onOpenElement(b.elementId!); }}>
              {b.title}
            </button>
          ) : (
            <span className="truncate">{b.title}</span>
          )}
        </div>
      ))}
      {loop && <div className="tabular-nums">{loop}</div>}
      {onHandOver && (
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="xs" className="ml-auto" onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onHandOver(); }} disabled={busy}>
            {t('Hand to Claude Code')}
          </Button>
        </div>
      )}
    </div>
  );
}

/** A written Element's chain card. The Element's Status leads, as every
 *  list shows it: the mark opens the status menu, so work an agent left
 *  for review is approved (Done) right from its card. Beside the verb,
 *  why it waits (when it waits) and only what the Status cannot say: an
 *  AI run going, waiting or failed. */
export function ChainCard({ element, object, detail, canEdit, busy = false, reason = null, rounds, latestRun, onRefresh, onOpen, onOpenElement, onHandOver }: {
  element: FleetElement;
  /** The Object the card names; null for an Element that sits in none. */
  object: { name: string; icon?: string | null; color?: string | null; isNew?: boolean } | null;
  detail: ElementWithDetails;
  canEdit: boolean;
  busy?: boolean;
  reason?: WaitingReason | null;
  rounds?: RoundSummary;
  latestRun?: MissionRunRow | null;
  onRefresh?: () => void;
  /** Open this Element. */
  onOpen?: () => void;
  /** Open another Element (a blocker line names it). */
  onOpenElement?: (elementId: string) => void;
  onHandOver?: () => void;
}) {
  return (
    <ElementCard element={detail} onRefresh={onRefresh} object={object} onOpen={onOpen}
      lead={canEdit ? (
        <span onPointerDown={(ev) => ev.stopPropagation()} onClick={(ev) => ev.stopPropagation()} className="flex">
          <StatusPicker element={detail}
            onChanged={(s) => { if (s === 'done' || s === 'cancelled') void advanceFromElement(element.elementId!).then(() => onRefresh?.()); else onRefresh?.(); }} />
        </span>
      ) : (
        <ElementProgressMark status={detail.status} progress={getElementProgress(detail)} size={16} />
      )}
      badge={reason || runOnlyState(element.state, detail.status) ? (
        <span className="flex shrink-0 items-center gap-1">
          {reason && <WaitingChip reason={reason} />}
          {runOnlyState(element.state, detail.status) && <StateBadge state={element.state} />}
        </span>
      ) : undefined}
      extra={<ChainLines element={element} rounds={rounds} busy={busy}
        onOpenElement={onOpenElement}
        latestRun={latestRun}
        onHandOver={onHandOver} />} />
  );
}

/** A column's "+": the chain spans Objects, so the one question a host
 *  must ask is which Object the new Element belongs to. Only written
 *  Objects are offered. */
export function AddElementMenu({ status, objects, onAdd }: {
  status: ChainStatus;
  objects: FleetObjectRow[];
  onAdd: (status: ChainStatus, objectId: string) => void;
}) {
  const { t } = useI18n();
  const label = t('Add Element to {column}', { column: t(STATUS[status].label) });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-xs" type="button" title={label} aria-label={label}>
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[160px]">
        {objects.map((o) => (
          <DropdownMenuItem key={o.id} onClick={() => onAdd(status, o.id)} className="gap-2 text-[13px]">
            <ItemIcon icon={o.icon ?? null} color={o.color ?? null} size={12} fallback={<ObjectIcon size={12} />} />
            <span className="truncate">{o.name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The chain's orientation: one quiet row over the board — how far along,
 *  what waits on a person, what is stuck, what failed. Every count comes
 *  from the same helpers the cards' chips read, so the two agree. With a
 *  filter handler the counts are lenses (a Strategy's chain); without
 *  one they are readouts (a Domain's). The outcome segments — checks not
 *  passed, measures, cost — are a Strategy's: it is held to them, and a
 *  Domain's chain leaves them out rather than inventing them. */
export function ChainSummary({ summary, waitingOnYou, filter = null, onFilter, outcomes = true }: {
  summary: MissionSummary;
  /** Elements whose waitingReason needs a person — the strip's own count,
   *  not missionSummary.waiting (which counts states, not the queue). */
  waitingOnYou: number;
  filter?: ChainFilter;
  onFilter?: (next: ChainFilter) => void;
  /** The outcome segments (checks, measures, cost). */
  outcomes?: boolean;
}) {
  const { t } = useI18n();
  const seg = (target: NonNullable<ChainFilter>, label: string, n: number) => {
    if (!onFilter) {
      return (
        <span key={target.kind} className="flex items-baseline gap-1.5">
          <span className={FONT.label}>{label}</span>
          <span className="tabular-nums text-foreground">{n}</span>
        </span>
      );
    }
    const active = filter?.kind === target.kind;
    if (n === 0 && !active) {
      return (
        <span key={target.kind} className="flex items-baseline gap-1.5 text-muted-foreground/60">
          <span className={FONT.label}>{label}</span>
          <span className="tabular-nums">{n}</span>
        </span>
      );
    }
    return (
      <button key={target.kind} type="button" aria-pressed={active}
        onClick={() => onFilter(active ? null : target)}
        className={cn('flex items-baseline gap-1.5 rounded-md px-1.5 py-0.5 -mx-1.5',
          active ? 'bg-[var(--accent-default)]/10 text-foreground' : 'text-muted-foreground hover:text-foreground')}>
        <span className={FONT.label}>{label}</span>
        <span className="tabular-nums text-foreground">{n}</span>
      </button>
    );
  };
  return (
    <div className={cn(CARD_FLAT, 'flex flex-wrap items-center gap-x-5 gap-y-1 px-3 py-2 text-[12px]')}>
      <span className="flex items-baseline gap-1.5">
        <span className={FONT.label}>{t('Progress')}</span>
        <span className="tabular-nums text-foreground">{summary.done}/{summary.actions}</span>
        <span className="tabular-nums text-muted-foreground">{summary.progress}%</span>
      </span>
      {seg({ kind: 'waiting' }, t('Waiting on you'), waitingOnYou)}
      {seg({ kind: 'blocked' }, t('Blocked'), summary.blocked)}
      {seg({ kind: 'failed' }, t('Failed'), summary.failed)}
      {outcomes && seg({ kind: 'verdict-fail' }, t('Checks not passed'), summary.verdicts.fail)}
      {outcomes && (
        <span className="flex items-baseline gap-1.5">
          <span className={FONT.label}>{t('Measures')}</span>
          <span className="tabular-nums text-foreground">{summary.measuresMet}/{summary.measures}</span>
          {summary.measuresStale > 0 && <span className="text-muted-foreground">· {t('{n} unrefreshed', { n: summary.measuresStale })}</span>}
        </span>
      )}
      {outcomes && (
        <span className="flex items-baseline gap-1.5">
          <span className={FONT.label}>{t('Cost')}</span>
          <span className="tabular-nums text-foreground">${summary.costUsd.toFixed(2)}</span>
        </span>
      )}
      {onFilter && filter && (
        <button type="button" onClick={() => onFilter(null)} className="ml-auto text-muted-foreground hover:text-foreground">
          ✕ {t('Clear filter')}
        </button>
      )}
    </div>
  );
}
