'use client';

import { Fragment, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  CalendarClock,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Scale,
  UserRound,
  X,
} from '@/ui/icons';
import {
  useWorkerAvailability,
  type ElementWithDetails,
  type Worker,
  type WorkerAvailability,
  type WorkerAvailabilityKind,
} from '@/hooks/useSupabase';
import { CONTROL, FONT, SEMANTIC_COLORS, STATUS } from '@/shared/designTokens';
import { Button, ButtonAppearanceProvider } from '@/ui/button';
import { Popover, PopoverTrigger } from '@/ui/popover';
import { MenuSectionLabel, MenuShell, MENU_SEPARATOR } from '@/Function/shared/menu';
import { DateField } from '@/Function/shared/date/DateControl';
import { formatElementDate, fromDateOnlyString, toDateOnlyString } from '@/Function/shared/dateUtils';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { isOpenStatus } from '@/Function/shared/completion';
import { unreachableMarkProps } from '@/Function/shared/workerReach';
import { UnreachableAvatarTooltip } from '@/Function/shared/WorkerAvatar';
import {
  DEFAULT_CAPACITY_PER_DAY,
  awayDayCount,
  dailyCapacity,
} from '@/Function/shared/workerCapacity';
import {
  countsOnDay,
  dueWhileAway,
  elementHours,
  elementSpan,
  elementsDueInSpan,
  hoursPerDay,
} from '@/Function/shared/assignmentLoad';
import { useWorkloadData } from '@/hooks/useWorkloadData';
import {
  summarizeWorkload,
  workloadBar,
  workloadDailyHours,
  workloadElementsInWindow,
  workloadOverDays,
  workloadUtilization,
  type WorkloadTeamSummary,
} from '@/Function/workload/workloadModel';
import { applyProposals, planRebalance, proposalWorkers, type Proposal } from '@/ActivitySpace/sustainment/workload/workloadRebalance';
import {
  WORKLOAD_RANGES,
  publishWorkload,
  setWorkloadPlanOpen,
  setWorkloadRange,
  shiftWorkloadAnchor,
  useWorkloadPlanOpen,
  useWorkloadRange,
  type WorkloadRange,
} from '@/Function/workload/workloadStore';
import { IslandHeader } from '@/Function/shared/MainIsland';
import { WorkloadDomainsMenu } from './WorkloadDomainsMenu';
import { WorkloadPlanPanel } from '@/ActivitySpace/sustainment/workload/WorkloadPlanPanel';

// =============================================================
// Resource — per-Worker daily load, and what to change about it.
// Rows are Workers. The body of each row is a small SVG area
// chart showing total assigned hours per day across the visible
// window against that Worker's capacity on each day. The plan
// panel beside it proposes the changes that bring every row back
// under its line, and previews each one on the chart before it is
// written.
//
// Scope:
//   - Standalone (Sustainment): Domains chosen in the Workload sidebar
//   - Embedded in Object Detail tab: pass scopeOverride.objectIds
//   - Embedded in Domain Detail tab: pass scopeOverride.domainIds
// =============================================================

const WORKER_COL_W = 240;
const MONTH_HEADER_H = 22;
const DAY_HEADER_H = 22;
const ROW_H = 56;
const CHART_H = 36;
const CHART_TOP_PAD = 8;       // px from top of row to chart top
const MAX_DISPLAY_HOURS = 16;  // y-axis max (clip overflow)

export interface ResourceViewProps {
  /** Override the scope. When omitted, the view follows the Workload
   *  sidebar's Domain choice (Sustainment behavior). */
  scopeOverride?: { domainIds?: string[]; objectIds?: string[] };
  /** Hide the title (use when embedded in another shell that owns it).
   *  The zoom, the date controls and the plan stay. */
  hideHeader?: boolean;
  /** Header title. The same surface serves as the embedded "Resource" tab
   *  and the Sustainment layer's standalone "Workload" view. */
  title?: string;
  /** Opens the existing Execution detail surface from a workload finding. */
  onElementClick?: (element: ElementWithDetails) => void;
  /** An explicitly scoped roster supplied by Team, including idle Workers. */
  roster?: Worker[];
  /** Narrows the chart to one Worker (chosen in the sidebar or from Team). */
  workerId?: string;
  /** Clears `workerId`; shown as the × on the focus chip. */
  onClearWorker?: () => void;
  /** The standalone surface publishes its readings for the People sidebar. */
  publish?: boolean;
  /** Under the chart, with its own scroll — a focused Worker's profile. */
  below?: React.ReactNode;
}

type Row = { worker: Worker; elements: ElementWithDetails[]; daily: number[] };
type LoadedRow = Row & { capacity: number[]; spans: WorkerAvailability[]; utilization: number | null; overDays: number; dueAway: number };

export function ResourceView({ scopeOverride, hideHeader, title = 'Resource', onElementClick, roster, workerId, onClearWorker, publish = false, below }: ResourceViewProps = {}) {
  const { t } = useI18n();
  const { contextKey, domains, selectedDomainIds, elements, loading, error, retry } = useWorkloadData(scopeOverride);
  const { range, anchor } = useWorkloadRange();
  const cfg = WORKLOAD_RANGES[range];
  const dayW = cfg.dayW;
  const planOpen = useWorkloadPlanOpen();
  const today = toDateOnlyString(new Date());

  const days = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - cfg.past + anchor);
    return Array.from({ length: cfg.days }, (_, i) => {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [cfg.past, cfg.days, anchor]);

  // Today index within the visible window (-1 if not visible)
  const todayIdx = useMemo(() => days.findIndex(d => toDateOnlyString(d) === today), [days, today]);
  // Readings look forward: from today (when it is in view) to the end of the
  // window. Yesterday's overload is a record, not something to act on. A
  // window wholly in the past is read as it stands, and labelled so.
  const from = todayIdx > 0 ? todayIdx : 0;
  const ahead = todayIdx >= 0 || toDateOnlyString(days[0]) > today;

  // A Space roster can supply idle Workers in its full scope. Narrow Domain
  // filters only show assignments known to belong to those Domains.
  const showIdleWorkers = !scopeOverride && selectedDomainIds.length === domains.length;
  // Who holds what, independent of the window — so zooming or paging the
  // dates does not rebuild the plan's inputs.
  const holdings = useMemo(() => {
    const byWorker = new Map<string, { worker: Worker; elements: ElementWithDetails[] }>();
    if (showIdleWorkers) {
      for (const worker of roster ?? []) byWorker.set(worker.id, { worker, elements: [] });
    }
    for (const el of elements) {
      for (const a of el.assignees ?? []) {
        if (!a.worker) continue;
        const wid = a.worker.id;
        if (!byWorker.has(wid)) byWorker.set(wid, { worker: a.worker, elements: [] });
        byWorker.get(wid)!.elements.push(el);
      }
    }
    return [...byWorker.values()];
  }, [elements, roster, showIdleWorkers]);
  const grouped: Row[] = useMemo(
    () => holdings.map(({ worker, elements: els }) => ({ worker, elements: els, daily: computeDailyHours(els, days) })),
    [holdings, days],
  );

  // Every Worker in scope, not just the focused one: the plan hands work to
  // whoever has room, and the sidebar lists everybody.
  const scopeWorkers = useMemo(() => holdings.map((h) => h.worker), [holdings]);
  const workerIds = useMemo(() => scopeWorkers.map((w) => w.id), [scopeWorkers]);
  const { byWorker: availability, add: addAvailability, remove: removeAvailability, loading: availabilityLoading, error: availabilityError, refetch: retryAvailability } =
    useWorkerAvailability(workerIds);

  // Capacity is a curve, not a number: a Worker away from the 5th through the
  // 7th has no hours those days and their standing day on either side. Every
  // "is this too much" question below reads this array, so an absence and an
  // overload are the same comparison.
  const allRows: LoadedRow[] = useMemo(() => {
    const out = grouped.map((r) => {
      const spans = availability[r.worker.id] ?? [];
      const capacity = dailyCapacity(r.worker, spans, days);
      const dueAway = dueWhileAway(r.worker, spans, r.elements)
        .filter(({ element, day }) => day >= today && isOpenStatus(element.status)).length;
      return {
        ...r, spans, capacity, dueAway,
        utilization: workloadUtilization(r.daily.slice(from), capacity.slice(from)),
        overDays: workloadOverDays(r.daily.slice(from), capacity.slice(from)),
      };
    });
    // Order: by type (human → ai_agent → robot), then by total load desc
    const typeOrder = { human: 0, ai_agent: 1, robot: 2 } as const;
    out.sort((a, b) => {
      const t = (typeOrder[a.worker.type] ?? 3) - (typeOrder[b.worker.type] ?? 3);
      if (t !== 0) return t;
      return (b.utilization ?? 0) - (a.utilization ?? 0) || a.worker.name.localeCompare(b.worker.name);
    });
    return out;
  }, [grouped, availability, days, today, from]);
  const rows = useMemo(() => workerId ? allRows.filter((r) => r.worker.id === workerId) : allRows, [allRows, workerId]);

  // Unstaffed work stays visible, including Elements still needing dates.
  const unassignedAll = useMemo(() => elements.filter((el) => (el.assignees ?? []).length === 0), [elements]);
  const unassigned = workerId ? [] : unassignedAll;
  const unassignedDaily = useMemo(() => computeDailyHours(unassignedAll, days), [unassignedAll, days]);
  const unassignedHours = unassignedDaily.reduce((s, h) => s + h, 0);

  const team: WorkloadTeamSummary = useMemo(
    () => summarizeWorkload(allRows.map((r) => ({ type: r.worker.type, daily: r.daily.slice(from), capacity: r.capacity.slice(from) }))),
    [allRows, from],
  );
  const dueAwayTotal = useMemo(() => allRows.reduce((s, r) => s + r.dueAway, 0), [allRows]);

  // ---- The plan ----------------------------------------------------------
  // The plan hands work to whoever has room, so it needs everyone's whole
  // load. A Domain filter or an embedded Domain/Object tab hides the work
  // people hold elsewhere — a plan there would promise free hours it cannot
  // see. It is offered only over the whole Space.
  const canPlan = !scopeOverride && showIdleWorkers;
  const ready = !loading && !availabilityLoading && !error && !availabilityError;
  const [dismissed, setDismissed] = useState<{ contextKey: string; ids: Set<string> }>({ contextKey, ids: new Set() });
  const dismissedIds = dismissed.contextKey === contextKey ? dismissed.ids : EMPTY_SET;
  const fullPlan = useMemo(() => canPlan && ready
    ? planRebalance({ workers: scopeWorkers, spans: availability, elements, today, dismissed: dismissedIds })
    : null, [canPlan, ready, scopeWorkers, availability, elements, today, dismissedIds]);
  // Focused, the plan is worked out again with the restriction, so every
  // proposal shown stands only on proposals that are also shown.
  const focusPlan = useMemo(() => fullPlan && workerId
    ? planRebalance({ workers: scopeWorkers, spans: availability, elements, today, dismissed: dismissedIds, focusWorkerId: workerId })
    : null, [fullPlan, workerId, scopeWorkers, availability, elements, today, dismissedIds]);
  const plan = focusPlan ?? fullPlan;
  const [preview, setPreview] = useState<Proposal[] | null>(null);
  const workerById = useMemo(() => new Map(scopeWorkers.map((w) => [w.id, w])), [scopeWorkers]);
  const previewDaily = useMemo(() => {
    if (!preview || preview.length === 0) return null;
    const after = applyProposals(elements, preview, (id) => workerById.get(id));
    const out = new Map<string, number[]>();
    for (const wid of new Set(preview.flatMap(proposalWorkers))) {
      out.set(wid, computeDailyHours(after.filter((el) => (el.assignees ?? []).some((a) => a.worker_id === wid)), days));
    }
    return out;
  }, [preview, elements, workerById, days]);

  // ---- Readings for the sidebar --------------------------------------------
  const failedReading = Boolean(error || availabilityError);
  useEffect(() => {
    if (!publish) return;
    publishWorkload(ready || failedReading ? {
      people: ready ? allRows.map((r) => ({ worker: r.worker, utilization: r.utilization, overDays: r.overDays, awayDays: awayDayCount(r.capacity), dueAway: r.dueAway })) : [],
      team,
      ahead,
      failed: failedReading,
      proposals: fullPlan ? fullPlan.proposals.length : null,
    } : null);
  }, [publish, ready, failedReading, allRows, team, ahead, fullPlan]);
  useEffect(() => () => { if (publish) publishWorkload(null); }, [publish]);

  // Per-Worker expansion. Clicking a row reveals its assigned
  // Elements as mini-rows on the same date axis below.
  const [expansion, setExpansion] = useState({ contextKey, workerId, ids: new Set<string>(workerId ? [workerId] : []) });
  const expanded = expansion.contextKey === contextKey && expansion.workerId === workerId
    ? expansion.ids : new Set<string>(workerId ? [workerId] : []);
  const toggleExpanded = (targetId: string) => {
    setExpansion(() => {
      const next = new Set(expanded);
      if (next.has(targetId)) next.delete(targetId);
      else next.add(targetId);
      return { contextKey, workerId, ids: next };
    });
  };

  const totalW = dayW * cfg.days;
  const focusName = workerId ? allRows.find((r) => r.worker.id === workerId)?.worker.name ?? roster?.find((w) => w.id === workerId)?.name : null;
  const busy = loading || availabilityLoading;
  const failed = Boolean(error || availabilityError);

  return (
    <div className="flex flex-col h-full bg-card">
      <Header
        title={hideHeader ? null : title}
        range={range}
        anchor={anchor}
        step={cfg.step}
        planOpen={planOpen && canPlan}
        canPlan={canPlan}
        embedded={Boolean(scopeOverride)}
        proposals={plan ? plan.proposals.length : null}
        focusName={focusName ?? null}
        onClearWorker={onClearWorker}
      />
      <KpiStrip
        loading={busy || failed}
        ahead={ahead}
        team={team}
        dueAway={dueAwayTotal}
        unassignedHours={unassignedHours}
        unassignedCount={unassignedAll.length}
      />

      <div className={`flex min-h-0 ${below ? 'max-h-[45%] shrink-0' : 'flex-1'}`}>
        <div className="min-w-0 flex-1 overflow-auto" aria-busy={busy}>
          {failed ? (
            <div role="alert" className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-[13px] text-muted-foreground">
              <p>{error ? t('Could not load the work in this scope.') : t('Could not load Worker availability.')}</p>
              <Button variant="secondary" onClick={() => { void retry(); void retryAvailability(); }}>{t('Retry')}</Button>
            </div>
          ) : busy ? (
            <CenterMessage>{t('Loading workload…')}</CenterMessage>
          ) : rows.length === 0 && unassigned.length === 0 ? (
            <CenterMessage>
              {!scopeOverride && selectedDomainIds.length === 0
                ? t('Choose a Domain to see its workload.')
                : workerId ? t('This Worker has no assignments in the selected scope.')
                  : t('No Workers or Elements in this scope yet.')}
            </CenterMessage>
          ) : (
            <div className="min-w-fit">
              <DateHeader days={days} todayIdx={todayIdx} totalW={totalW} dayW={dayW} range={range} />
              {rows.map((r) => {
                const isOpen = expanded.has(r.worker.id);
                const sortedElements = sortedForWindow(r.elements, days);
                return (
                  <Fragment key={r.worker.id}>
                    <WorkerRow
                      key={`${contextKey}:${r.worker.id}`}
                      row={r}
                      days={days}
                      today={today}
                      todayIdx={todayIdx}
                      totalW={totalW}
                      dayW={dayW}
                      previewDaily={previewDaily?.get(r.worker.id) ?? null}
                      expanded={isOpen}
                      onToggle={() => toggleExpanded(r.worker.id)}
                      onAddSpan={addAvailability}
                      onRemoveSpan={removeAvailability}
                      onElementClick={onElementClick}
                    />
                    {isOpen && sortedElements.length === 0 && (
                      <ElementSubEmpty totalW={totalW} />
                    )}
                    {isOpen && sortedElements.map((el) => (
                      <ElementSubRow
                        key={el.id}
                        element={el}
                        days={days}
                        todayIdx={todayIdx}
                        totalW={totalW}
                        dayW={dayW}
                        onElementClick={onElementClick}
                      />
                    ))}
                  </Fragment>
                );
              })}
              {unassigned.length > 0 && (
                <Fragment>
                  <UnassignedRow
                    elements={unassigned}
                    daily={unassignedDaily}
                    days={days}
                    todayIdx={todayIdx}
                    totalW={totalW}
                    dayW={dayW}
                    expanded={expanded.has('unassigned')}
                    onToggle={() => toggleExpanded('unassigned')}
                  />
                  {expanded.has('unassigned') && sortedForWindow(unassigned, days).map((el) => (
                    <ElementSubRow
                      key={el.id}
                      element={el}
                      days={days}
                      todayIdx={todayIdx}
                      totalW={totalW}
                      dayW={dayW}
                      onElementClick={onElementClick}
                    />
                  ))}
                </Fragment>
              )}
            </div>
          )}
        </div>
        {planOpen && canPlan && (
          <WorkloadPlanPanel
            plan={plan}
            proposals={plan?.proposals ?? []}
            elements={elements}
            workers={workerById}
            focusName={focusName ?? null}
            onPreview={setPreview}
            onDismiss={(id) => setDismissed({ contextKey, ids: new Set([...dismissedIds, id]) })}
            onElementClick={onElementClick}
            onClose={() => setWorkloadPlanOpen(false)}
          />
        )}
      </div>
      {below && <div className="min-h-0 flex-1 overflow-y-auto border-t border-border/60">{below}</div>}
    </div>
  );
}

const EMPTY_SET: Set<string> = new Set();

// =============================================================
// Header — zoom, date controls, the plan toggle
// =============================================================
const RANGE_LABELS: { id: WorkloadRange; label: string }[] = [
  { id: '2w', label: '2 weeks' },
  { id: 'month', label: 'Month' },
  { id: 'quarter', label: 'Quarter' },
];

function Header({
  title,
  range,
  anchor,
  step,
  planOpen,
  canPlan,
  embedded,
  proposals,
  focusName,
  onClearWorker,
}: {
  title: string | null;
  range: WorkloadRange;
  anchor: number;
  step: number;
  planOpen: boolean;
  /** The plan needs the whole Space; a Domain filter disables it. */
  canPlan: boolean;
  /** Inside a Domain/Object tab, where the plan is not offered at all. */
  embedded: boolean;
  /** Open proposals; null while the plan cannot be read yet. */
  proposals: number | null;
  focusName: string | null;
  onClearWorker?: () => void;
}) {
  const { t } = useI18n();
  // The path, as every island's: the surface (everyone), then the Worker in focus.
  const crumbs = [
    ...(title ? [{ id: 'all', label: t(title), onClick: focusName ? onClearWorker : undefined }] : []),
    ...(focusName ? [{ id: 'worker', label: focusName }] : []),
  ];
  return (
    <IslandHeader crumbs={crumbs} actions={<>
      {!embedded && <WorkloadDomainsMenu />}

      <div className="flex items-center gap-1" role="group" aria-label={t('Zoom')}>
        {RANGE_LABELS.map((r) => (
          <Button key={r.id} type="button" size="xs" shape="tab" variant={range === r.id ? 'secondary' : 'ghost'}
            aria-pressed={range === r.id} onClick={() => setWorkloadRange(r.id)}>
            {t(r.label)}
          </Button>
        ))}
      </div>

      <ButtonAppearanceProvider appearance="navigation">
        <div className="flex items-center gap-0.5">
          <Button type="button" variant="ghost" size="icon-xs" onClick={() => shiftWorkloadAnchor(-step)}
            title={t('Earlier')} aria-label={t('Earlier')}>
            <ChevronLeft size={CONTROL.icon.xs} />
          </Button>
          <Button type="button" variant={anchor === 0 ? 'secondary' : 'ghost'} size="xs" onClick={() => shiftWorkloadAnchor(null)}>
            {t('Today')}
          </Button>
          <Button type="button" variant="ghost" size="icon-xs" onClick={() => shiftWorkloadAnchor(step)}
            title={t('Later')} aria-label={t('Later')}>
            <ChevronRight size={CONTROL.icon.xs} />
          </Button>
        </div>
      </ButtonAppearanceProvider>

      {!embedded && (
        <Button type="button" size="xs" variant={planOpen ? 'secondary' : 'ghost'} aria-pressed={planOpen}
          disabled={!canPlan}
          title={canPlan ? undefined : t('Rebalancing reads everyone’s whole load. Choose All Domains to plan.')}
          onClick={() => setWorkloadPlanOpen(!planOpen)}>
          <Scale size={CONTROL.icon.xs} />
          {t('Rebalance')}
          {canPlan && proposals !== null && proposals > 0 && (
            <span className="tabular-nums text-muted-foreground">{proposals}</span>
          )}
        </Button>
      )}
    </>} />
  );
}

// =============================================================
// KPI strip — the window at a glance
// =============================================================
function KpiStrip({
  loading,
  ahead,
  team,
  dueAway,
  unassignedHours,
  unassignedCount,
}: {
  loading: boolean;
  /** Readings run from today; false when the whole window is in the past. */
  ahead: boolean;
  team: WorkloadTeamSummary;
  dueAway: number;
  unassignedHours: number;
  unassignedCount: number;
}) {
  const { t } = useI18n();
  const dash = '—';
  const util = team.utilization;
  return (
    <dl className="grid flex-shrink-0 grid-cols-2 gap-x-8 gap-y-4 bg-card px-4 pb-6 pt-5 sm:grid-cols-3 sm:px-8 lg:grid-cols-5">
      <Kpi label={t('Team load')} hint={ahead ? t('Booked hours ÷ available hours from today to the end of the view') : t('Booked hours ÷ available hours in this window')}
        value={loading || util === null ? dash : pct(util)}
        tone={!loading && util !== null && util > 1 ? 'danger' : 'neutral'} />
      <Kpi label={t('Overloaded')} hint={t('People over their hours on at least one day')}
        value={loading ? dash : t('{n} people', { n: team.overloadedPeople })}
        sub={loading || team.overDays === 0 ? null : t('{n} days over', { n: team.overDays })}
        tone={!loading && team.overloadedPeople > 0 ? 'danger' : 'neutral'} />
      <Kpi label={t('Due while away')} hint={t('Open Elements due on a day their owner has no hours')}
        value={loading ? dash : dueAway} tone={!loading && dueAway > 0 ? 'danger' : 'neutral'} />
      <Kpi label={t('Unassigned')} hint={t('Work nobody holds yet')}
        value={loading ? dash : `${Math.round(unassignedHours)}h`}
        sub={loading || unassignedCount === 0 ? null : t('{n} Elements', { n: unassignedCount })}
        tone="neutral" />
      <Kpi label={t('AI agents')} hint={t('Share of the booked hours held by AI agents')}
        value={loading || team.aiShare === null ? dash : pct(team.aiShare)}
        sub={loading ? null : t('of {h}h booked', { h: Math.round(team.hours) })} tone="neutral" />
    </dl>
  );
}

/** A key number: label, figure, one quiet line. Red only when it asks for action. */
function Kpi({ label, hint, value, sub, tone }: {
  label: string;
  hint: string;
  value: React.ReactNode;
  sub?: string | null;
  tone: 'danger' | 'neutral';
}) {
  return (
    <div className="min-w-0 space-y-0.5" title={hint}>
      <dt className={`${FONT.sm} truncate text-muted-foreground`}>{label}</dt>
      <dd className={`${FONT['2xl']} truncate tabular-nums ${tone === 'danger' ? 'text-[var(--status-danger)]' : 'text-foreground'}`}>{value}</dd>
      {sub && <dd className={`${FONT.sm} truncate text-muted-foreground`}>{sub}</dd>}
    </div>
  );
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

// =============================================================
// Date header — month strip + day numbers
// =============================================================
function DateHeader({ days, todayIdx, totalW, dayW, range }: { days: Date[]; todayIdx: number; totalW: number; dayW: number; range: WorkloadRange }) {
  const { locale } = useI18n();
  // Month spans: consecutive runs of the same month
  const spans = useMemo(() => {
    const arr: { label: string; start: number; len: number }[] = [];
    for (let i = 0; i < days.length; i++) {
      const monthLabel = days[i].toLocaleDateString(locale, { month: 'short' });
      const last = arr[arr.length - 1];
      if (last && last.label === monthLabel) last.len += 1;
      else arr.push({ label: monthLabel, start: i, len: 1 });
    }
    return arr;
  }, [days, locale]);

  return (
    <div
      className="sticky top-0 z-20 bg-card border-b border-border/60"
      style={{ paddingLeft: WORKER_COL_W }}
    >
      <div className="flex" style={{ width: totalW, height: MONTH_HEADER_H }}>
        {spans.map((s, i) => (
          <div
            key={i}
            className="flex-shrink-0 overflow-hidden whitespace-nowrap text-[11px] text-muted-foreground font-medium px-2 flex items-center"
            style={{ width: s.len * dayW }}
          >
            {s.len * dayW >= 28 ? s.label : ''}
          </div>
        ))}
      </div>
      <div className="flex relative" style={{ width: totalW, height: DAY_HEADER_H }}>
        {days.map((d, i) => {
          const isWeekend = d.getDay() === 0 || d.getDay() === 6;
          const isToday = i === todayIdx;
          // A quarter is too narrow for every date: label the Mondays.
          const label = range === 'quarter' ? (d.getDay() === 1 || isToday ? d.getDate() : '') : range === '2w'
            ? `${d.toLocaleDateString(locale, { weekday: 'narrow' })} ${d.getDate()}` : d.getDate();
          return (
            <div
              key={i}
              className={`flex-shrink-0 overflow-visible whitespace-nowrap text-[10px] flex items-center justify-center tabular-nums ${
                isToday
                  ? 'text-foreground font-semibold'
                  : isWeekend
                    ? 'text-muted-foreground/40'
                    : 'text-muted-foreground'
              }`}
              style={{ width: dayW }}
            >
              {label}
            </div>
          );
        })}
        {todayIdx >= 0 && (
          <div
            className="absolute top-1 w-1.5 h-1.5 rounded-full bg-[var(--accent-default)]"
            style={{ left: todayIdx * dayW + dayW / 2 - 3 }}
          />
        )}
      </div>
    </div>
  );
}

// =============================================================
// Day grid — weekend tint, today column and line, shared by rows
// =============================================================
function DayGrid({ days, todayIdx, dayW }: { days: Date[]; todayIdx: number; dayW: number }) {
  return (
    <>
      {days.map((d, i) => {
        const isWeekend = d.getDay() === 0 || d.getDay() === 6;
        const isToday = i === todayIdx;
        if (!isToday && !isWeekend) return null;
        return (
          <div
            key={i}
            className={`absolute top-0 bottom-0 ${isToday ? 'bg-[var(--accent-subtle)]' : 'bg-muted/15'}`}
            style={{ left: i * dayW, width: dayW }}
          />
        );
      })}
      {todayIdx >= 0 && (
        <div
          className="absolute top-0 bottom-0 border-l border-[var(--accent-default)]/60"
          style={{ left: todayIdx * dayW + dayW / 2 }}
        />
      )}
    </>
  );
}

// =============================================================
// Worker row — left meta col + SVG area chart on the right
// =============================================================
function WorkerRow({
  row,
  days,
  today,
  todayIdx,
  totalW,
  dayW,
  previewDaily,
  expanded,
  onToggle,
  onAddSpan,
  onRemoveSpan,
  onElementClick,
}: {
  row: LoadedRow;
  days: Date[];
  today: string;
  todayIdx: number;
  totalW: number;
  dayW: number;
  /** The load this row would carry if the hovered proposal were applied. */
  previewDaily: number[] | null;
  expanded: boolean;
  onToggle: () => void;
  onAddSpan: (span: AvailabilityDraft) => Promise<void>;
  onRemoveSpan: (span: WorkerAvailability) => Promise<void>;
  onElementClick?: (element: ElementWithDetails) => void;
}) {
  const { t } = useI18n();
  const { worker, elements, daily, capacity, spans, utilization } = row;
  const isOverloaded = row.overDays > 0;
  const awayDays = awayDayCount(capacity);
  const subtitle = workerSubtitle(worker, elements, t);
  // Work whose date falls on a day this Worker has none. The chart already
  // draws it as a red band over a hatched stretch, which says a collision
  // exists without saying which Elements are in it; the count carries into the
  // availability menu, where they are listed under the period they land in.
  const dueAway = row.dueAway;
  const [hover, setHover] = useState<number | null>(null);

  return (
    <div
      className="flex items-stretch border-b border-border/30 hover:bg-muted/5"
      style={{ height: ROW_H }}
    >
      {/* Sticky left meta column — the name area toggles, the calendar button
          opens this Worker's availability. Two jobs, so two controls: nesting
          the second inside the first would make one press mean either. */}
      <div
        className="sticky left-0 z-[2] bg-card flex items-center pr-1 border-r border-border/40 flex-shrink-0"
        style={{ width: WORKER_COL_W }}
      >
        <Button
          type="button"
          variant="ghost"
          align="start"
          onClick={onToggle}
          aria-expanded={expanded}
          className="gap-2 pl-2 pr-1 h-full min-w-0 flex-1 rounded-none border-0"
        >
          <span
            className={`w-4 h-4 flex items-center justify-center text-muted-foreground transition-transform ${
              expanded ? 'rotate-0' : '-rotate-90'
            }`}
          >
            <ChevronDown size={12} />
          </span>
          <ResourceWorkerAvatar worker={worker} />
          <div className="min-w-0 flex-1 text-left">
            <div className="flex items-center gap-1.5">
              <span className="text-[13px] font-medium text-foreground truncate">{worker.name}</span>
              {isOverloaded && <OverloadFlag label={t('Overloaded')} />}
              <span className="flex-1" />
              {utilization !== null && (
                <span className={`text-[11px] tabular-nums ${utilization > 1 ? 'text-[var(--status-danger)] font-semibold' : 'text-muted-foreground'}`}>
                  {pct(utilization)}
                </span>
              )}
            </div>
            <div className="text-[11px] text-muted-foreground truncate" title={loadNote(subtitle, awayDays, dueAway, t)}>
              {dueAway > 0 ? (
                <>
                  {subtitle}
                  <span className="text-[var(--status-danger)]">
                    {` · ${t('{n} due while away', { n: dueAway })}`}
                  </span>
                </>
              ) : awayDays > 0 ? (
                `${subtitle} · ${t('away {n}d', { n: awayDays })}`
              ) : (
                subtitle
              )}
            </div>
          </div>
        </Button>
        <AvailabilityMenu
          worker={worker}
          spans={spans}
          elements={elements}
          onAdd={onAddSpan}
          onRemove={onRemoveSpan}
          onElementClick={onElementClick}
        />
      </div>

      {/* Chart cell — hovering a day reads it out: hours against hours
          available, and the Elements that make up the day. */}
      <div
        className="relative flex-shrink-0"
        style={{ width: totalW, height: ROW_H }}
        onMouseMove={(e) => {
          const x = e.clientX - e.currentTarget.getBoundingClientRect().left;
          const i = Math.floor(x / dayW);
          setHover(i >= 0 && i < days.length ? i : null);
        }}
        onMouseLeave={() => setHover(null)}
      >
        <DayGrid days={days} todayIdx={todayIdx} dayW={dayW} />
        <AreaChart
          daily={daily}
          capacity={capacity}
          previewDaily={previewDaily}
          dayW={dayW}
          width={totalW}
          height={CHART_H}
          topPad={CHART_TOP_PAD}
          rowHeight={ROW_H}
          isAgent={worker.type === 'ai_agent'}
        />
        {hover !== null && (
          <DayReadout
            day={days[hover]}
            index={hover}
            hours={daily[hover]}
            capacity={capacity[hover]}
            elements={elements}
            today={today}
            dayW={dayW}
            totalW={totalW}
          />
        )}
      </div>
    </div>
  );
}

/** What one day of one Worker is made of. */
function DayReadout({ day, index, hours, capacity, elements, today, dayW, totalW }: {
  day: Date;
  index: number;
  hours: number;
  capacity: number;
  elements: ElementWithDetails[];
  today: string;
  dayW: number;
  totalW: number;
}) {
  const { t, locale } = useI18n();
  const iso = toDateOnlyString(day);
  const parts = useMemo(() => elements
    .filter((el) => {
      const span = elementSpan(el);
      return span !== null && span.start <= iso && iso <= span.end && countsOnDay(el, iso, today);
    })
    .map((el) => ({ el, h: hoursPerDay(el) }))
    .sort((a, b) => b.h - a.h), [elements, iso, today]);
  const W = 220;
  const left = Math.min(Math.max(0, index * dayW + dayW / 2 - W / 2), Math.max(0, totalW - W));
  const over = hours > capacity + 0.01;
  return (
    <div className="pointer-events-none absolute top-full z-30 mt-1 rounded-lg border border-border bg-popover px-3 py-2 shadow-xl" style={{ left, width: W }}>
      <div className="flex items-baseline gap-2">
        <span className="flex-1 text-[12px] font-medium text-foreground">
          {day.toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' })}
        </span>
        <span className={`text-[12px] tabular-nums ${over ? 'font-semibold text-[var(--status-danger)]' : 'text-muted-foreground'}`}>
          {capacity <= 0 ? t('Away') : `${round1(hours)}h / ${round1(capacity)}h`}
        </span>
      </div>
      {parts.length === 0 ? (
        <div className="mt-1 text-[11px] text-muted-foreground">{t('Nothing booked')}</div>
      ) : (
        <ul className="mt-1 space-y-0.5">
          {parts.slice(0, 4).map(({ el, h }) => (
            <li key={el.id} className="flex items-center gap-2 text-[11px]">
              <span className="min-w-0 flex-1 truncate text-foreground">{el.title}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{round1(h)}h</span>
            </li>
          ))}
          {parts.length > 4 && <li className="text-[11px] text-muted-foreground">{t('and {n} more', { n: parts.length - 4 })}</li>}
        </ul>
      )}
    </div>
  );
}

function round1(n: number): string {
  return (Math.round(n * 10) / 10).toString();
}

// =============================================================
// Unassigned row — same shape as WorkerRow but for the pool of
// dated Elements nobody owns yet. Neutral grey chart, no capacity
// line (there is no one to overload).
// =============================================================
function UnassignedRow({
  elements,
  daily,
  days,
  todayIdx,
  totalW,
  dayW,
  expanded,
  onToggle,
}: {
  elements: ElementWithDetails[];
  daily: number[];
  days: Date[];
  todayIdx: number;
  totalW: number;
  dayW: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  const unscheduled = elements.filter(element => !elementSpan(element)).length;
  return (
    <div
      className="flex items-stretch border-b border-border/30 hover:bg-muted/5"
      style={{ height: ROW_H }}
    >
      <Button
        type="button"
        variant="ghost"
        align="start"
        onClick={onToggle}
        aria-expanded={expanded}
        className="sticky left-0 z-[2] bg-card gap-2 h-full pl-2 pr-3 rounded-none border-0 border-r border-[var(--border-subtle)]"
        style={{ width: WORKER_COL_W }}
      >
        <span
          className={`w-4 h-4 flex items-center justify-center text-muted-foreground transition-transform ${
            expanded ? 'rotate-0' : '-rotate-90'
          }`}
        >
          <ChevronDown size={12} />
        </span>
        <div className="w-8 h-8 rounded-full border border-dashed border-border flex items-center justify-center text-muted-foreground flex-shrink-0">
          <UserRound size={CONTROL.icon.xs} />
        </div>
        <div className="min-w-0 flex-1 text-left">
          <div className="text-[13px] font-medium text-muted-foreground truncate">{t('Unassigned')}</div>
          <div className="text-[11px] text-muted-foreground/70 truncate">
            {t('{n} Elements', { n: elements.length })}
            {unscheduled > 0 && ` · ${t('{n} unscheduled', { n: unscheduled })}`}
          </div>
        </div>
      </Button>

      <div className="relative flex-shrink-0" style={{ width: totalW, height: ROW_H }}>
        <DayGrid days={days} todayIdx={todayIdx} dayW={dayW} />
        <AreaChart
          daily={daily}
          capacity={daily.map(() => DEFAULT_CAPACITY_PER_DAY)}
          previewDaily={null}
          dayW={dayW}
          width={totalW}
          height={CHART_H}
          topPad={CHART_TOP_PAD}
          rowHeight={ROW_H}
          isAgent={false}
          neutral
        />
      </div>
    </div>
  );
}

// =============================================================
// SVG area chart
// =============================================================
function AreaChart({
  daily,
  capacity,
  previewDaily,
  dayW,
  width,
  height,
  topPad,
  rowHeight,
  isAgent,
  neutral = false,
}: {
  daily: number[];
  /** Hours available each day. An absence is the days where it drops to zero. */
  capacity: number[];
  /** The load after a proposal, drawn as a line over the current fill. */
  previewDaily: number[] | null;
  dayW: number;
  width: number;
  height: number;
  topPad: number;
  rowHeight: number;
  isAgent: boolean;
  /** Grey informational fill with no capacity line / overload band —
   *  used by the Unassigned pseudo-row where "too much" has no meaning. */
  neutral?: boolean;
}) {
  const uid = useId();
  const hatchId = `${uid}-hatch`;
  const overId = `${uid}-over`;
  const previewClipId = `${uid}-preview`;
  const baseY = topPad + height;
  // A 16h agent day would sit on the ceiling with its overload clipped away;
  // the scale grows to keep every row's capacity line inside the row.
  const maxH = Math.max(MAX_DISPLAY_HOURS, ...capacity.map((c) => c * 1.15));
  const yFor = (h: number) => topPad + height - (clamp(h, 0, maxH) / maxH) * height;

  // Load and capacity are drawn as smooth curves through each day's centre.
  // A day is still a day — the readout and the hatching keep day columns —
  // but the shape reads as a flow of work rather than a stack of bricks.
  const loadLine = smoothPath(daily.map(yFor), dayW);
  const loadArea = `${loadLine} L ${width} ${baseY} L 0 ${baseY} Z`;
  const capLine = smoothPath(capacity.map(yFor), dayW);
  // Everything above the capacity curve: the overload is the load area
  // clipped to this region, so the red follows both curves exactly.
  const aboveCap = `${capLine} L ${width} 0 L 0 0 Z`;
  const anyOver = !neutral && daily.some((h, i) => h > capacity[i] + 0.01);

  // Only the days the proposal changes: a line along every untouched day
  // would draw the whole row and bury the part that moves.
  const changed: { x: number; w: number }[] = [];
  if (previewDaily) {
    for (let i = 0; i < previewDaily.length; i++) {
      if (Math.abs(previewDaily[i] - daily[i]) <= 0.01) continue;
      const x = Math.max(0, i * dayW - dayW / 2);
      const last = changed[changed.length - 1];
      if (last && x <= last.x + last.w) last.w = Math.min(width, (i + 1.5) * dayW) - last.x;
      else changed.push({ x, w: Math.min(width, (i + 1.5) * dayW) - x });
    }
  }
  const previewLine = previewDaily && changed.length > 0 ? smoothPath(previewDaily.map(yFor), dayW) : '';

  // Days with no hours at all, marked whether or not work landed on them —
  // an empty week off is a fact about the plan even when nothing collides.
  const awaySpans: { x: number; w: number }[] = [];
  for (let i = 0; i < capacity.length; i++) {
    if (neutral || capacity[i] > 0) continue;
    const last = awaySpans[awaySpans.length - 1];
    if (last && last.x + last.w === i * dayW) last.w += dayW;
    else awaySpans.push({ x: i * dayW, w: dayW });
  }

  const fill = neutral ? 'var(--text-tertiary)' : 'var(--accent-default)';

  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      width={width}
      height={rowHeight}
      viewBox={`0 0 ${width} ${rowHeight}`}
    >
      <defs>
        <pattern
          id={hatchId}
          width={6}
          height={6}
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <line x1={0} y1={0} x2={0} y2={6} stroke="var(--text-tertiary)" strokeWidth={1} />
        </pattern>
        {anyOver && <clipPath id={overId}><path d={aboveCap} /></clipPath>}
        {previewLine && (
          <clipPath id={previewClipId}>
            {changed.map((c) => <rect key={c.x} x={c.x} y={0} width={c.w} height={rowHeight} />)}
          </clipPath>
        )}
      </defs>
      {awaySpans.map((s) => (
        <rect
          key={s.x}
          x={s.x}
          y={0}
          width={s.w}
          height={rowHeight}
          fill={`url(#${hatchId})`}
          opacity={0.35}
        />
      ))}
      {/* Capacity reference */}
      {!neutral && (
        <path d={capLine} fill="none" stroke="var(--border-default)" strokeDasharray="2 3" strokeWidth={1} />
      )}
      {/* Load — faded while a proposal is previewed */}
      <path d={loadArea} fill={fill} opacity={(neutral ? 0.18 : isAgent ? 0.25 : 0.22) * (previewDaily ? 0.5 : 1)} />
      <path d={loadLine} fill="none" stroke={fill} strokeWidth={1.25} opacity={(neutral ? 0.35 : 0.6) * (previewDaily ? 0.5 : 1)} />
      {/* Overload — the load area above the capacity curve */}
      {anyOver && (
        <path d={loadArea} fill="var(--status-danger)" opacity={previewDaily ? 0.2 : 0.45} clipPath={`url(#${overId})`} />
      )}
      {/* The load after the previewed proposal */}
      {previewLine && (
        <path d={previewLine} fill="none" stroke="var(--accent-default)" strokeWidth={2} clipPath={`url(#${previewClipId})`} />
      )}
    </svg>
  );
}

/**
 * A smooth line through one value per day, each at its day's centre, held
 * flat to both edges. Monotone cubic (Fritsch–Carlson): the curve never
 * overshoots its points, so a quiet day between two busy ones never dips
 * below zero and a peak is never drawn higher than it is.
 */
function smoothPath(ys: number[], dayW: number): string {
  if (ys.length === 0) return '';
  const xs = ys.map((_, i) => i * dayW + dayW / 2);
  const n = ys.length;
  const m: number[] = new Array(n).fill(0);
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  if (n > 1) { m[0] = d[0]; m[n - 1] = d[n - 2]; }
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const h = a * a + b * b;
    if (h > 9) { const t = 3 / Math.sqrt(h); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  let path = `M 0 ${ys[0]} L ${xs[0]} ${ys[0]}`;
  for (let i = 0; i < n - 1; i++) {
    const dx = (xs[i + 1] - xs[i]) / 3;
    path += ` C ${xs[i] + dx} ${ys[i] + m[i] * dx} ${xs[i + 1] - dx} ${ys[i + 1] - m[i + 1] * dx} ${xs[i + 1]} ${ys[i + 1]}`;
  }
  path += ` L ${n * dayW} ${ys[n - 1]}`;
  return path;
}

// =============================================================
// Availability menu — the Worker's absences, added and removed
// from the row they change.
// =============================================================
export type AvailabilityDraft = {
  worker_id: string;
  start_date: string;
  end_date: string;
  kind: WorkerAvailabilityKind;
  capacity_hours_per_day: number;
  note: string | null;
};

const AVAILABILITY_KINDS: { id: WorkerAvailabilityKind; label: string }[] = [
  { id: 'leave', label: 'Leave' },
  { id: 'rotation', label: 'Rotation' },
  { id: 'assignment', label: 'Assignment' },
  { id: 'other', label: 'Other' },
];

function AvailabilityMenu({
  worker,
  spans,
  elements,
  onAdd,
  onRemove,
  onElementClick,
}: {
  worker: Worker;
  spans: WorkerAvailability[];
  /** Everything this Worker holds — read here so each period can name the work
   *  that comes due inside it. */
  elements: ElementWithDetails[];
  onAdd: (span: AvailabilityDraft) => Promise<void>;
  onRemove: (span: WorkerAvailability) => Promise<void>;
  onElementClick?: (element: ElementWithDetails) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState<string | null>(null);
  const [end, setEnd] = useState<string | null>(null);
  const [kind, setKind] = useState<WorkerAvailabilityKind>('leave');
  const [hours, setHours] = useState('0');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);

  // The end defaults to the start, so a single day off is one click and a
  // save rather than the same date typed twice.
  const effectiveEnd = end ?? start;
  const capacity = Number(hours);
  const valid = Boolean(start && effectiveEnd && effectiveEnd >= start)
    && hours.trim() !== '' && Number.isFinite(capacity) && capacity >= 0 && capacity <= 24;

  const reset = () => {
    setStart(null);
    setEnd(null);
    setKind('leave');
    setHours('0');
    setNote('');
    setError(null);
  };

  const submit = async () => {
    if (!valid || !start || !effectiveEnd || saving) return;
    const requestId = ++request.current;
    setSaving(true);
    setError(null);
    try {
      await onAdd({
        worker_id: worker.id,
        start_date: start,
        end_date: effectiveEnd,
        kind,
        capacity_hours_per_day: capacity,
        note: note.trim() || null,
      });
      if (request.current === requestId) reset();
    } catch (e) {
      if (request.current === requestId) setError(e instanceof Error ? t(e.message) : t('Could not save this period. Try again.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          request.current += 1;
          setError(null);
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={t('Availability for {name}', { name: worker.name })}
          title={t('Availability')}
          className={spans.length > 0 ? 'text-[var(--text-primary)]' : undefined}
        >
          <CalendarClock size={CONTROL.icon.xs} />
        </Button>
      </PopoverTrigger>
      <MenuShell width="wide" align="start">
        <MenuSectionLabel>{t('Away and part-time')}</MenuSectionLabel>
        {spans.length === 0 ? (
          <div className="px-2 py-1.5 text-[12px] text-muted-foreground">
            {t('Nothing booked. {name} is at full capacity throughout.', { name: worker.name })}
          </div>
        ) : (
          spans.map((s) => (
            <div key={s.id} className="rounded-sm px-2 py-1.5 hover:bg-[var(--surface-strong)]">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px]">{spanLabel(s)}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {spanDetail(s, t)}
                  </span>
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  disabled={s.id.startsWith('temp-')}
                  onClick={() => {
                    const requestId = request.current;
                    setError(null);
                    void onRemove(s).catch(e => {
                      if (request.current === requestId) setError(e instanceof Error ? t(e.message) : t('Could not remove this period. Try again.'));
                    });
                  }}
                  aria-label={t('Remove {name}', { name: spanLabel(s) })}
                >
                  <X size={CONTROL.icon.xs} />
                </Button>
              </div>
              <DueInSpan span={s} elements={elements} onElementClick={onElementClick ? element => {
                setOpen(false);
                request.current += 1;
                onElementClick(element);
              } : undefined} />
            </div>
          ))
        )}

        <div className={MENU_SEPARATOR} />

        <div className="flex items-center gap-1 px-2 py-1">
          <DateField
            value={start}
            onChange={setStart}
            placeholder={t('From')}
            variant="secondary"
            block
            aria-label={t('Away from')}
          />
          <span className="text-[var(--text-tertiary)]">→</span>
          <DateField
            value={effectiveEnd}
            onChange={setEnd}
            placeholder={t('To')}
            variant="secondary"
            block
            aria-label={t('Away to')}
          />
        </div>

        <div className="flex flex-wrap gap-1 px-2 py-1">
          {AVAILABILITY_KINDS.map((k) => (
            <Button
              key={k.id}
              type="button"
              size="xs"
              shape="tab"
              variant={kind === k.id ? 'secondary' : 'ghost'}
              aria-pressed={kind === k.id}
              onClick={() => setKind(k.id)}
            >
              {t(k.label)}
            </Button>
          ))}
        </div>

        <label className="flex items-center gap-2 px-2 py-1 text-[12px] text-muted-foreground">
          <span className="flex-1">{t('Hours per day')}</span>
          <input
            type="number"
            min={0}
            max={24}
            step={1}
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            aria-label={t('Hours per day while away')}
            className="w-14 rounded-md border-none bg-muted/40 px-2 py-1 text-right text-[13px] text-foreground tabular-nums"
          />
        </label>

        <div className="px-2 py-1">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('Add a note…')}
            className="w-full rounded-md border-none bg-muted/40 px-2 py-1 text-[13px] placeholder:text-muted-foreground/60"
          />
        </div>

        <div className="px-2 pb-1 pt-1">
          {error && <p role="alert" className="mb-2 text-[12px] text-[var(--status-danger)]">{error}</p>}
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={!valid || saving}
            onClick={() => { void submit(); }}
            className="w-full"
          >
            {saving ? t('Saving…') : t('Add period')}
          </Button>
        </div>
      </MenuShell>
    </Popover>
  );
}

/** Names shown before the list collapses to a count. */
const DUE_IN_SPAN_VISIBLE = 4;

/**
 * The work that comes due inside one booked period.
 *
 * The exercise this answers knew the medical lead was rotating out on D+5 and
 * still had no way to ask which deadlines sat in those days. A hatched stretch
 * on the chart shows that something is wrong there; only a list of names can be
 * acted on, so it sits directly under the period rather than in a separate
 * report somebody has to think to open.
 */
function DueInSpan({
  span,
  elements,
  onElementClick,
}: {
  span: WorkerAvailability;
  elements: ElementWithDetails[];
  onElementClick?: (element: ElementWithDetails) => void;
}) {
  const { t } = useI18n();
  const due = useMemo(() => elementsDueInSpan(span, elements), [span, elements]);
  if (due.length === 0) return null;
  const away = span.capacity_hours_per_day <= 0;
  const visible = due.slice(0, DUE_IN_SPAN_VISIBLE);
  const rest = due.length - visible.length;

  return (
    <div className="mt-1 pl-2 border-l border-[var(--border-subtle)]">
      <div className={`text-[11px] ${away ? 'text-[var(--status-danger)]' : 'text-muted-foreground'}`}>
        {away ? t('{n} Elements come due while away', { n: due.length }) : t('{n} Elements come due in this period', { n: due.length })}
      </div>
      {visible.map((el) => (
        <Button key={el.id} variant="ghost" size="xs" align="start" className="w-full gap-2 px-0" disabled={!onElementClick}
          onClick={() => onElementClick?.(el)} title={el.title}>
          <span className="min-w-0 flex-1 truncate">{el.title}</span>
          <span className="shrink-0 tabular-nums">
            {formatElementDate(fromDateOnlyString(el.due_date), 'short') ?? el.due_date}
          </span>
        </Button>
      ))}
      {rest > 0 && (
        <div className="text-[11px] text-muted-foreground/70">{t('and {n} more', { n: rest })}</div>
      )}
    </div>
  );
}

function spanLabel(span: WorkerAvailability): string {
  const from = formatElementDate(fromDateOnlyString(span.start_date), 'short') ?? span.start_date;
  if (span.start_date === span.end_date) return from;
  const to = formatElementDate(fromDateOnlyString(span.end_date), 'short') ?? span.end_date;
  return `${from} – ${to}`;
}

function spanDetail(span: WorkerAvailability, t: Translate): string {
  const kind = t(AVAILABILITY_KINDS.find((k) => k.id === span.kind)?.label ?? 'Other');
  const load = span.capacity_hours_per_day > 0
    ? t('{h} h/day', { h: span.capacity_hours_per_day })
    : t('Away');
  return span.note ? `${kind} · ${load} · ${span.note}` : `${kind} · ${load}`;
}

// =============================================================
// =============================================================
// Element sub-row — rendered under an expanded worker. Shows
// the Element title + a thin bar aligned to the same date axis
// so the user can see which Element contributes to which peak.
// =============================================================
const SUB_ROW_H = 28;
const SUB_BAR_H = 10;

function ElementSubRow({
  element,
  days,
  todayIdx,
  totalW,
  dayW,
  onElementClick,
}: {
  element: ElementWithDetails;
  days: Date[];
  todayIdx: number;
  totalW: number;
  dayW: number;
  onElementClick?: (element: ElementWithDetails) => void;
}) {
  const { t } = useI18n();
  const bar = useMemo(() => barFor(element, days, dayW), [element, days, dayW]);
  const statusColor =
    SEMANTIC_COLORS.status[element.status as keyof typeof SEMANTIC_COLORS.status]
    ?? SEMANTIC_COLORS.status.todo;
  const statusLabel = t(STATUS[element.status as keyof typeof STATUS]?.label ?? element.status ?? 'To Do');
  const hours = elementHours(element);

  return (
    <Button
      variant="ghost"
      align="start"
      onClick={() => onElementClick?.(element)}
      disabled={!onElementClick}
      aria-label={t('Open {title}', { title: element.title })}
      className="flex w-full items-stretch gap-0 rounded-none border-0 border-b border-[var(--border-subtle)] p-0"
      style={{ height: SUB_ROW_H }}
    >
      <span
        className="sticky left-0 z-[2] bg-card flex items-center gap-2 pr-3 border-r border-[var(--border-subtle)] flex-shrink-0 text-left"
        style={{ width: WORKER_COL_W, paddingLeft: 32 }}
      >
        <span
          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
          style={{ background: statusColor }}
          aria-hidden
        />
        <span className="text-[12px] text-foreground truncate flex-1">{element.title}</span>
        <span className="text-[11px] text-muted-foreground tabular-nums flex-shrink-0"
          title={element.estimated_hours == null ? t('Approximate hours based on priority; set an estimate in the Element.') : t('Estimated hours')}>
          {element.estimated_hours == null ? '~' : ''}{hours}h
        </span>
      </span>

      <span className="relative flex-shrink-0" style={{ width: totalW, height: SUB_ROW_H }}>
        {todayIdx >= 0 && (
          <span
            className="absolute top-0 bottom-0 border-l border-[var(--accent-default)]/30"
            style={{ left: todayIdx * dayW + dayW / 2 }}
          />
        )}
        {bar && (
          <span
            className="absolute rounded-sm truncate"
            style={{
              left: bar.left,
              width: Math.max(bar.width, 6),
              top: (SUB_ROW_H - SUB_BAR_H) / 2,
              height: SUB_BAR_H,
              background: statusColor,
              lineHeight: `${SUB_BAR_H}px`,
            }}
            title={`${element.title} · ${statusLabel} · ${hours}h`}
          />
        )}
        {!bar && !elementSpan(element) && <span className="flex h-full items-center px-3 text-[11px] text-muted-foreground">{t('Unscheduled')}</span>}
      </span>
    </Button>
  );
}

function ElementSubEmpty({ totalW }: { totalW: number }) {
  const { t } = useI18n();
  return (
    <div
      className="flex items-stretch border-b border-border/20 bg-muted/5"
      style={{ height: SUB_ROW_H }}
    >
      <div
        className="sticky left-0 z-[2] bg-card flex items-center text-[11px] text-muted-foreground italic"
        style={{ width: WORKER_COL_W, paddingLeft: 32 }}
      >
        {t('No Elements in this window')}
      </div>
      <div className="flex-shrink-0" style={{ width: totalW, height: SUB_ROW_H }} />
    </div>
  );
}

// =============================================================
// Worker avatar + bits
// =============================================================
// Deliberately NOT the shared WorkerAvatar: resource rows color the circle by
// worker type (human / ai_agent / robot) and use 2-letter initials at 32px.
// It does share WorkerAvatar's no-account mark, so a Worker whose load is
// being planned here and whose chip is elsewhere carries the same ring.
function ResourceWorkerAvatar({ worker }: { worker: Worker }) {
  const initials = (worker.name || '?').slice(0, 2).toUpperCase();
  const mark = unreachableMarkProps(worker, worker.name);
  const bg =
    worker.type === 'ai_agent'
      ? 'bg-[var(--accent-default)] text-primary-foreground'
      : worker.type === 'robot'
        ? 'bg-[var(--surface-raised)] text-[var(--text-tertiary)]'
        : 'bg-muted text-foreground';
  return (
    <UnreachableAvatarTooltip worker={worker} name={worker.name}>
      <div
        className={`w-8 h-8 rounded-full ${bg} flex items-center justify-center text-[11px] font-semibold flex-shrink-0 ${mark.ringClass}`}
        title={mark.title}
        tabIndex={mark.tabIndex}
        aria-label={mark.ariaLabel}
        data-unreachable={mark.unreachable}
      >
        {initials}
      </div>
    </UnreachableAvatarTooltip>
  );
}

function OverloadFlag({ label }: { label: string }) {
  return (
    <svg
      width={11}
      height={11}
      viewBox="0 0 24 24"
      fill="var(--status-danger)"
      stroke="var(--status-danger)"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-label={label}
      className="flex-shrink-0"
    >
      <path d="M4 22V4h14l-2 5 2 5H4" />
    </svg>
  );
}

function CenterMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full flex items-center justify-center text-muted-foreground text-[13px] px-6 text-center">
      <p className="max-w-md">{children}</p>
    </div>
  );
}

// =============================================================
// Helpers
// =============================================================

type Translate = (message: string, values?: Record<string, string | number>) => string;

/** Returns Elements ordered by their start_date (then due_date) so the
 *  expanded sub-rows feel chronological. Elements with no dates fall
 *  to the bottom — the area chart already excludes them, but we still
 *  list them here so the user can give them dates. */
function sortedForWindow(elements: ElementWithDetails[], days: Date[]): ElementWithDetails[] {
  return workloadElementsInWindow(elements, days.map(toDateOnlyString));
}

/** Compute the screen position of an Element's bar within the visible
 *  window. Returns null if the Element has no dates or is fully outside
 *  the window. */
function barFor(
  element: ElementWithDetails,
  days: Date[],
  dayW: number,
): { left: number; width: number } | null {
  const bar = workloadBar(element, days.map(toDateOnlyString));
  return bar ? { left: bar.offset * dayW, width: bar.length * dayW } : null;
}

function computeDailyHours(elements: ElementWithDetails[], days: Date[]): number[] {
  return workloadDailyHours(elements, days.map(toDateOnlyString), toDateOnlyString(new Date()));
}

/** The whole of the subtitle line, for the hover the truncation makes necessary. */
function loadNote(subtitle: string, awayDays: number, dueAway: number, t: Translate): string {
  const parts = [subtitle];
  if (awayDays > 0) parts.push(t('away {n} days in this window', { n: awayDays }));
  if (dueAway > 0) parts.push(t('{n} Elements come due while away', { n: dueAway }));
  return parts.join(' · ');
}

function workerSubtitle(worker: Worker, elements: ElementWithDetails[], t: Translate): string {
  const count = elements.length;
  const unscheduled = elements.filter(element => !elementSpan(element)).length;
  const role = worker.role ?? (worker.type === 'ai_agent' ? (worker.ai_model ? `AI · ${worker.ai_model}` : t('AI agent')) : worker.type === 'robot' ? t('Robot') : null);
  return [role ?? t('{n} Elements', { n: count }), unscheduled > 0 ? t('{n} unscheduled', { n: unscheduled }) : null].filter(Boolean).join(' · ');
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
