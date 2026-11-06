'use client';

import { useMemo, useState } from 'react';
import { ArrowRight, CalendarClock, UserPlus, X } from '@/ui/icons';
import type { ElementWithDetails, Worker } from '@/hooks/useSupabase';
import { CONTROL } from '@/shared/designTokens';
import { Button, ButtonAppearanceProvider } from '@/ui/button';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { fromDateOnlyString, daysBetween } from '@/Function/shared/dateUtils';
import { PLAN_HORIZON_DAYS, proposalPrerequisites, type Plan, type PlanIssue, type Proposal } from './workloadRebalance';
import { applyWorkloadProposal } from './workloadActions';

// =============================================================
// The rebalancing plan, beside the chart it changes.
//
// Each card says what to change, why, and what it does to the people
// involved, in numbers the chart can confirm: hovering a card draws the
// "after" line on the affected rows. Apply writes through the ordinary
// edit paths; once written, the board changes and the plan is worked out
// again from the new board — so an applied card disappears because its
// problem did, not because it was ticked off.
// =============================================================

const ISSUE_ORDER: PlanIssue[] = ['away', 'overload', 'unassigned'];
const ISSUE_LABEL: Record<PlanIssue, string> = {
  away: 'Deadlines during absences',
  overload: 'Over capacity',
  unassigned: 'Work nobody holds',
};

export function WorkloadPlanPanel({
  plan,
  proposals,
  elements,
  workers,
  focusName,
  onPreview,
  onDismiss,
  onElementClick,
  onClose,
}: {
  /** Null while the board is still being read. */
  plan: Plan | null;
  /** The plan's proposals, in plan order (worked out without the dismissed
   *  ones and, when focused, only those involving the focused Worker). */
  proposals: Proposal[];
  elements: ElementWithDetails[];
  workers: Map<string, Worker>;
  focusName: string | null;
  /** The proposals to draw on the chart: a card and everything it stands on. */
  onPreview: (proposals: Proposal[] | null) => void;
  onDismiss: (id: string) => void;
  onElementClick?: (element: ElementWithDetails) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const elementById = useMemo(() => new Map(elements.map((el) => [el.id, el])), [elements]);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [applyingAll, setApplyingAll] = useState(false);

  const writeOne = async (p: Proposal) => {
    setErrors((prev) => { const next = { ...prev }; delete next[p.id]; return next; });
    try {
      await applyWorkloadProposal(p);
      return true;
    } catch (e) {
      setErrors((prev) => ({ ...prev, [p.id]: e instanceof Error ? e.message : t('Could not apply this change. Try again.') }));
      return false;
    }
  };

  // In plan order, stopping at the first failure: each proposal was chosen on
  // the board as the ones before it left it, so a later one written without
  // an earlier one is not the change the card described.
  const applyInOrder = async (list: Proposal[]) => {
    setBusy(new Set(list.map((p) => p.id)));
    onPreview(null);
    try {
      for (const p of list) if (!(await writeOne(p))) break;
    } finally {
      setBusy(new Set());
    }
  };

  const apply = (index: number) => applyInOrder([...proposalPrerequisites(proposals, index), proposals[index]]);

  const applyAll = async () => {
    setApplyingAll(true);
    try {
      await applyInOrder(proposals);
    } finally {
      setApplyingAll(false);
    }
  };

  const groups = ISSUE_ORDER
    .map((issue) => ({ issue, items: proposals.filter((p) => p.issue === issue) }))
    .filter((g) => g.items.length > 0);
  const name = (id: string | null) => (id && workers.get(id)?.name) || t('Someone');

  return (
    <aside className="flex w-[360px] flex-shrink-0 flex-col border-l border-border/60 bg-card" aria-label={t('Rebalance plan')}>
      <div className="flex items-start gap-2 border-b border-border/60 px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-[13px] font-semibold text-foreground">{t('Rebalance plan')}</h2>
          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
            {focusName
              ? t('Changes involving {name}, read from every Worker’s hours, absences and deadlines over the next {n} days.', { name: focusName, n: PLAN_HORIZON_DAYS })
              : t('Read from every Worker’s hours, absences and deadlines over the next {n} days.', { n: PLAN_HORIZON_DAYS })}
          </p>
        </div>
        <ButtonAppearanceProvider appearance="navigation">
          <Button type="button" variant="ghost" size="icon-xs" onClick={onClose} aria-label={t('Close')}>
            <X size={CONTROL.icon.xs} />
          </Button>
        </ButtonAppearanceProvider>
      </div>

      {plan && (
        <div className="px-4 pb-1 pt-3">
          <div className="flex items-baseline gap-2 text-[12px]">
            <span className="text-muted-foreground">{t('Over capacity')}</span>
            <span className="flex-1" />
            <span className={`tabular-nums ${plan.overBefore > 0 ? 'text-[var(--status-danger)]' : 'text-foreground'}`}>{round1(plan.overBefore)}h</span>
            <ArrowRight size={12} className="text-muted-foreground" aria-label={t('after the plan')} />
            <span className={`font-semibold tabular-nums ${plan.overAfter > 0 ? 'text-[var(--status-danger)]' : 'text-foreground'}`}>{round1(plan.overAfter)}h</span>
          </div>
          {proposals.length > 0 && (
            <Button type="button" variant="primary" size="sm" className="mt-3 w-full" disabled={applyingAll || busy.size > 0}
              onClick={() => { void applyAll(); }}>
              {applyingAll ? t('Applying…') : t('Apply all {n} changes', { n: proposals.length })}
            </Button>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {!plan ? (
          <p className="px-2 py-6 text-center text-[12px] text-muted-foreground">{t('Reading the board…')}</p>
        ) : proposals.length === 0 ? (
          <div className="px-3 py-8 text-center">
            <p className="text-[13px] font-medium text-foreground">
              {plan.overBefore > 0 ? t('No change fits') : t('Nothing to rebalance')}
            </p>
            <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
              {plan.overBefore > 0
                ? t('Nobody has room on those days and the dates cannot move without breaking more. Add capacity, or cut scope.')
                : t('Everyone fits within their hours, no deadline lands on an absence, and dated work has an owner.')}
            </p>
          </div>
        ) : groups.map((g) => (
          <section key={g.issue} className="mb-2">
            <h3 className="flex h-7 items-center px-2 text-[12px] font-medium text-muted-foreground/80">
              {t(ISSUE_LABEL[g.issue])} <span className="ml-1.5 tabular-nums">{g.items.length}</span>
            </h3>
            <ul className="space-y-1">
              {g.items.map((p) => {
                const index = proposals.indexOf(p);
                const before = proposalPrerequisites(proposals, index);
                return (
                  <ProposalCard
                    key={p.id}
                    proposal={p}
                    element={elementById.get(p.elementId)}
                    name={name}
                    prerequisites={before.length}
                    applying={busy.has(p.id)}
                    locked={busy.size > 0 || applyingAll}
                    error={errors[p.id] ?? null}
                    onApply={() => { void apply(index); }}
                    onDismiss={() => { onPreview(null); onDismiss(p.id); }}
                    onPreview={(on) => onPreview(on ? [...before, p] : null)}
                    onElementClick={onElementClick}
                  />
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </aside>
  );
}

function ProposalCard({ proposal: p, element, name, prerequisites, applying, locked, error, onApply, onDismiss, onPreview, onElementClick }: {
  proposal: Proposal;
  element: ElementWithDetails | undefined;
  name: (id: string | null) => string;
  /** Earlier proposals this one stands on; Apply writes them first. */
  prerequisites: number;
  applying: boolean;
  /** Any write in flight: one at a time, so no card acts on a half-written board. */
  locked: boolean;
  error: string | null;
  onApply: () => void;
  onDismiss: () => void;
  onPreview: (on: boolean) => void;
  onElementClick?: (element: ElementWithDetails) => void;
}) {
  const { t, locale } = useI18n();
  const day = (iso: string | null) => {
    const d = iso ? fromDateOnlyString(iso) : null;
    return d ? d.toLocaleDateString(locale, { month: 'short', day: 'numeric' }) : '—';
  };
  const Icon = p.kind === 'reschedule' ? CalendarClock : p.kind === 'assign' ? UserPlus : ArrowRight;

  let headline: string;
  let detail: string | null = null;
  let warn = false;
  if (p.kind === 'reassign') {
    headline = t('Hand from {from} to {to}', { from: name(p.fromWorkerId), to: name(p.toWorkerId) });
    detail = targetDetail(p.target, name(p.toWorkerId), t);
  } else if (p.kind === 'assign') {
    headline = t('Assign to {to}', { to: name(p.toWorkerId) });
    detail = targetDetail(p.target, name(p.toWorkerId), t);
  } else if (p.mode === 'start-earlier') {
    headline = t('Start {date} instead of {old}', { date: day(p.to.start), old: day(p.from.start) });
    detail = t('Due date stays {due}; the work spreads over more days.', { due: day(p.to.due) });
  } else if (p.mode === 'pull-in') {
    headline = t('Finish by {due}', { due: day(p.to.due) });
    detail = t('{name} is away on {old}, and nobody else has room that day.', { name: name(p.workerId), old: day(p.from.due) });
  } else {
    headline = p.to.start && p.to.due && p.to.start !== p.to.due
      ? t('Move to {start} – {due}', { start: day(p.to.start), due: day(p.to.due) })
      : t('Move to {date}', { date: day(p.to.due ?? p.to.start) });
    detail = p.to.due
      ? t('The due date moves {n} days. Nobody has room, and nothing can start earlier.', { n: spanDays(p.from.due, p.to.due) })
      : t('The start moves {n} days. Nobody has room on the current day.', { n: spanDays(p.from.start, p.to.start) });
    warn = true;
  }

  return (
    <li
      className="group rounded-lg px-2.5 py-2 transition-colors hover:bg-[var(--surface-strong)] focus-within:bg-[var(--surface-strong)]"
      onMouseEnter={() => onPreview(true)}
      onMouseLeave={() => onPreview(false)}
      onFocus={() => onPreview(true)}
      onBlur={() => onPreview(false)}
    >
      <button type="button" disabled={!element || !onElementClick} onClick={() => element && onElementClick?.(element)}
        className="block w-full truncate text-left text-[12px] text-muted-foreground outline-none hover:text-foreground disabled:hover:text-muted-foreground"
        title={element?.title}>
        {element?.title ?? t('Element')}
      </button>
      <div className="mt-0.5 flex items-start gap-1.5">
        <Icon size={13} className={`mt-[1px] flex-shrink-0 ${warn ? 'text-[var(--status-warning)]' : 'text-muted-foreground'}`} aria-hidden="true" />
        <span className="min-w-0 flex-1 text-[13px] font-medium leading-snug text-foreground">{headline}</span>
      </div>
      {detail && <p className={`mt-0.5 pl-[19px] text-[11px] leading-snug ${warn ? 'text-[var(--status-warning)]' : 'text-muted-foreground'}`}>{detail}</p>}
      {p.workerId && p.overBefore > 0 && (
        <p className="mt-0.5 pl-[19px] text-[11px] tabular-nums text-muted-foreground">
          {t('{name}: {before}h over → {after}h', { name: name(p.workerId), before: round1(p.overBefore), after: round1(p.overAfter) })}
        </p>
      )}
      {error && <p role="alert" className="mt-1 pl-[19px] text-[11px] text-[var(--status-danger)]">{error}</p>}
      <div className="mt-1.5 flex items-center gap-1 pl-[19px]"><ButtonAppearanceProvider appearance="inline">
        <Button type="button" size="xs" variant="primary" disabled={locked} onClick={onApply}
          title={prerequisites > 0 ? t('Applies the {n} earlier changes this one depends on first', { n: prerequisites }) : undefined}>
          {applying ? t('Applying…') : prerequisites > 0 ? t('Apply with {n} earlier', { n: prerequisites }) : t('Apply')}
        </Button>
        <Button type="button" size="xs" variant="ghost" disabled={locked} onClick={onDismiss}>{t('Dismiss')}</Button>
      </ButtonAppearanceProvider></div>
    </li>
  );
}

type Translate = (message: string, values?: Record<string, string | number>) => string;

function targetDetail(target: { peakAfter: number; freeHours: number; familiarity: number }, who: string, t: Translate): string {
  const parts = [t('{name} has {h}h free those days, peaking at {p}%', { name: who, h: round1(target.freeHours), p: Math.round(target.peakAfter * 100) })];
  if (target.familiarity > 0) parts.push(t('already holds {n} in this Object', { n: target.familiarity }));
  return parts.join(' · ');
}

function spanDays(from: string | null, to: string | null): number {
  const a = fromDateOnlyString(from);
  const b = fromDateOnlyString(to);
  return a && b ? daysBetween(a, b) : 0;
}

function round1(n: number): string {
  return (Math.round(n * 10) / 10).toString();
}
