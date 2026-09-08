'use client';

import { Fragment, useId, useMemo, useRef, useState } from 'react';
import {
  CalendarClock,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Filter,
  UserRound,
  X,
} from 'lucide-react';
import {
  useWorkerAvailability,
  type ElementWithDetails,
  type Worker,
  type WorkerAvailability,
  type WorkerAvailabilityKind,
} from '@/hooks/useSupabase';
import { CONTROL, SEMANTIC_COLORS, STATUS } from '@/shared/designTokens';
import { Button } from '@/ui/button';
import { Popover, PopoverTrigger } from '@/ui/popover';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/ui/command';
import { MenuSectionLabel, MenuShell, MENU_SEPARATOR } from '@/Function/shared/menu';
import { DateField } from '@/Function/shared/date/DateControl';
import { formatElementDate, fromDateOnlyString, toDateOnlyString } from '@/Function/shared/dateUtils';
import { unreachableMarkProps } from '@/Function/shared/workerReach';
import { UnreachableAvatarTooltip } from '@/Function/shared/WorkerAvatar';
import {
  DEFAULT_CAPACITY_PER_DAY,
  awayDayCount,
  dailyCapacity,
} from '@/Function/shared/workerCapacity';
import {
  dueWhileAway,
  elementHours,
  elementSpan,
  elementsDueInSpan,
} from '@/Function/shared/assignmentLoad';
import { useWorkloadData } from '@/ActivitySpace/sustainment/workload/useWorkloadData';
import { workloadBar, workloadDailyHours, workloadElementsInWindow } from '@/ActivitySpace/sustainment/workload/workloadModel';

// =============================================================
// Resource — Asana-style per-Worker daily-load area chart
// Rows are Workers. The body of each row is a small SVG area
// chart showing total assigned hours per day across the visible
// window. Aggregate over assignees + element duration so the
// shape reflects "how loaded is this worker every day".
//
// Scope:
//   - Standalone (Sustainment): user picks Domains via filter
//   - Embedded in Object Detail tab: pass scopeOverride.objectIds
//   - Embedded in Domain Detail tab: pass scopeOverride.domainIds
// =============================================================

const DAY_W = 22;
const VISIBLE_DAYS = 31;       // ~1 month
const PAST_DAYS = 6;           // anchor = today - 6
const WORKER_COL_W = 220;
const MONTH_HEADER_H = 22;
const DAY_HEADER_H = 22;
const ROW_H = 56;
const CHART_H = 36;
const CHART_TOP_PAD = 8;       // px from top of row to chart top
const MAX_DISPLAY_HOURS = 16;  // y-axis max (clip overflow)

export interface ResourceViewProps {
  /** Override the scope. When omitted, view loads via the user's
   *  Domain filter (Sustainment behavior). When provided, the
   *  filter button is hidden by default. */
  scopeOverride?: { domainIds?: string[]; objectIds?: string[] };
  /** Hide the top header bar (use when embedded in another shell
   *  that owns the title/controls). */
  hideHeader?: boolean;
  /** Force-hide the filter button even in standalone mode. */
  hideFilter?: boolean;
  /** Header title. The same surface serves as the embedded "Resource" tab
   *  and the Sustainment layer's standalone "Workload" view. */
  title?: string;
  /** Opens the existing Execution detail surface from a workload finding. */
  onElementClick?: (element: ElementWithDetails) => void;
  /** An explicitly scoped roster supplied by Team, including idle Workers. */
  roster?: Worker[];
  /** Opens one Worker's load directly from Team. */
  workerId?: string;
}

export function ResourceView({ scopeOverride, hideHeader, hideFilter, title = 'Resource', onElementClick, roster, workerId }: ResourceViewProps = {}) {
  const { contextKey, domains, selectedDomainIds, setSelectedDomainIds, elements, loading, error, retry } = useWorkloadData(scopeOverride);

  // Anchor day (= leftmost visible day). Negative offset = back in time.
  const [anchorOffset, setAnchorOffset] = useState(0); // in days from default

  const anchorDate = useMemo(() => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    t.setDate(t.getDate() - PAST_DAYS + anchorOffset);
    return t;
  }, [anchorOffset]);

  const days = useMemo(() => {
    const arr: Date[] = [];
    for (let i = 0; i < VISIBLE_DAYS; i++) {
      const d = new Date(anchorDate);
      d.setDate(d.getDate() + i);
      arr.push(d);
    }
    return arr;
  }, [anchorDate]);

  // Today index within the visible window (-1 if not visible)
  const todayIdx = useMemo(() => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return days.findIndex(d => sameDay(d, t));
  }, [days]);

  // Group elements by Worker
  type Row = { worker: Worker; elements: ElementWithDetails[]; daily: number[] };
  // A Space roster can supply idle Workers in its full scope. Narrow Domain
  // filters only show assignments known to belong to those Domains.
  const showIdleWorkers = !scopeOverride && selectedDomainIds.length === domains.length;
  const grouped: Row[] = useMemo(() => {
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
    const out: Row[] = [];
    for (const { worker, elements: els } of byWorker.values()) {
      if (workerId && worker.id !== workerId) continue;
      const daily = computeDailyHours(els, days);
      out.push({ worker, elements: els, daily });
    }
    // Order: by type (human → ai_agent → robot), then by total load desc
    const typeOrder = { human: 0, ai_agent: 1, robot: 2 } as const;
    out.sort((a, b) => {
      const t = (typeOrder[a.worker.type] ?? 3) - (typeOrder[b.worker.type] ?? 3);
      if (t !== 0) return t;
      const sa = a.daily.reduce((s, h) => s + h, 0);
      const sb = b.daily.reduce((s, h) => s + h, 0);
      return sb - sa || a.worker.name.localeCompare(b.worker.name);
    });
    return out;
  }, [elements, days, roster, showIdleWorkers, workerId]);

  const workerIds = useMemo(() => grouped.map((r) => r.worker.id), [grouped]);
  const { byWorker: availability, add: addAvailability, remove: removeAvailability, loading: availabilityLoading, error: availabilityError, refetch: retryAvailability } =
    useWorkerAvailability(workerIds);

  // Capacity is a curve, not a number: a Worker away from the 5th through the
  // 7th has no hours those days and their standing day on either side. Every
  // "is this too much" question below reads this array, so an absence and an
  // overload are the same comparison.
  type LoadedRow = Row & { capacity: number[]; spans: WorkerAvailability[] };
  const rows: LoadedRow[] = useMemo(
    () => grouped.map((r) => {
      const spans = availability[r.worker.id] ?? [];
      return { ...r, spans, capacity: dailyCapacity(r.worker, spans, days) };
    }),
    [grouped, availability, days],
  );

  // Unstaffed work stays visible, including Elements still needing dates.
  const unassigned = useMemo(
    () => workerId ? [] : elements.filter((el) => (el.assignees ?? []).length === 0),
    [elements, workerId],
  );
  const unassignedDaily = useMemo(
    () => computeDailyHours(unassigned, days),
    [unassigned, days],
  );

  // KPIs
  const stats = useMemo(() => {
    let overloadedDays = 0;
    let humans = 0;
    let agents = 0;
    for (const r of rows) {
      if (r.worker.type === 'human') humans += 1;
      else if (r.worker.type === 'ai_agent') agents += 1;
      // Work booked onto a day someone is away counts here, and should: an
      // absence with an Element sitting on it is exactly the thing the board
      // could not say before.
      for (let i = 0; i < r.daily.length; i++) if (r.daily[i] > r.capacity[i]) overloadedDays += 1;
    }
    return { humans, agents, overloadedDays };
  }, [rows]);

  const [filterOpen, setFilterOpen] = useState(false);
  const showFilterButton = !hideFilter && !scopeOverride;
  const filterActive = !scopeOverride
    && domains.length > 0
    && selectedDomainIds.length < domains.length;

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

  const totalW = DAY_W * VISIBLE_DAYS;

  return (
    <div className="flex flex-col h-full bg-card">
      {!hideHeader && (
        <Header
          title={title}
          loading={loading || availabilityLoading || Boolean(error || availabilityError)}
          stats={stats}
          anchorOffset={anchorOffset}
          setAnchorOffset={setAnchorOffset}
          showFilterButton={showFilterButton}
          filterActive={filterActive}
          filterOpen={filterOpen}
          setFilterOpen={setFilterOpen}
          domains={domains}
          selectedDomainIds={selectedDomainIds}
          setSelectedDomainIds={setSelectedDomainIds}
        />
      )}

      <div className="flex-1 overflow-auto" aria-busy={loading || availabilityLoading}>
        {error || availabilityError ? (
          <div role="alert" className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-[13px] text-muted-foreground">
            <p>{error ? 'Could not load the work in this scope.' : 'Could not load Worker availability.'}</p>
            <Button variant="secondary" onClick={() => { void retry(); void retryAvailability(); }}>Retry</Button>
          </div>
        ) : loading || availabilityLoading ? (
          <CenterMessage>Loading workload…</CenterMessage>
        ) : rows.length === 0 && unassigned.length === 0 ? (
          <CenterMessage>
            {!scopeOverride && selectedDomainIds.length === 0
              ? 'Choose a Domain to see its workload.'
              : workerId ? 'This Worker has no assignments in the selected scope.'
                : 'No Workers or Elements in this scope yet.'}
          </CenterMessage>
        ) : (
          <div className="min-w-fit">
            <DateHeader days={days} todayIdx={todayIdx} totalW={totalW} />
            {rows.map((r) => {
              const isOpen = expanded.has(r.worker.id);
              const sortedElements = sortedForWindow(r.elements, days);
              return (
                <Fragment key={r.worker.id}>
                  <WorkerRow
                    key={`${contextKey}:${r.worker.id}`}
                    worker={r.worker}
                    elements={r.elements}
                    daily={r.daily}
                    capacity={r.capacity}
                    spans={r.spans}
                    days={days}
                    todayIdx={todayIdx}
                    totalW={totalW}
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
                    onElementClick={onElementClick}
                  />
                ))}
              </Fragment>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// =============================================================
// Header
// =============================================================
function Header({
  title,
  loading,
  stats,
  anchorOffset,
  setAnchorOffset,
  showFilterButton,
  filterActive,
  filterOpen,
  setFilterOpen,
  domains,
  selectedDomainIds,
  setSelectedDomainIds,
}: {
  title: string;
  loading: boolean;
  stats: { humans: number; agents: number; overloadedDays: number };
  anchorOffset: number;
  setAnchorOffset: (fn: (prev: number) => number) => void;
  showFilterButton: boolean;
  filterActive: boolean;
  filterOpen: boolean;
  setFilterOpen: (v: boolean) => void;
  domains: { id: string; name: string }[];
  selectedDomainIds: string[];
  setSelectedDomainIds: (fn: (prev: string[]) => string[]) => void;
}) {
  return (
    <div className="min-h-10 flex flex-wrap items-center gap-2 px-4 py-1 border-b border-[var(--border-subtle)] flex-shrink-0">
      <span className="text-[12px] font-semibold text-foreground">{title}</span>
      <span className="text-[11px] text-muted-foreground">
        {loading ? 'Loading…' : `${stats.humans} humans · ${stats.agents} agents`}
      </span>
      <div className="flex-1" />

      <div className="flex items-center gap-1 mr-1">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={() => setAnchorOffset((o) => o - 7)}
          title="Back one week"
          aria-label="Back one week"
        >
          <ChevronLeft size={CONTROL.icon.xs} />
        </Button>
        <Button
          type="button"
          variant={anchorOffset === 0 ? 'secondary' : 'ghost'}
          size="xs"
          onClick={() => setAnchorOffset(() => 0)}
        >
          Today
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={() => setAnchorOffset((o) => o + 7)}
          title="Forward one week"
          aria-label="Forward one week"
        >
          <ChevronRight size={CONTROL.icon.xs} />
        </Button>
      </div>

      <KpiPill label="Overload days" value={loading ? '—' : stats.overloadedDays} tone={!loading && stats.overloadedDays > 0 ? 'red' : 'neutral'} />

      {showFilterButton && (
        <Popover open={filterOpen} onOpenChange={setFilterOpen}>
          <PopoverTrigger asChild>
            <Button variant={filterActive ? 'secondary' : 'ghost'} size="xs" align="start" aria-label="Choose workload Domains"
              title={domains.filter(domain => selectedDomainIds.includes(domain.id)).map(domain => domain.name).join(', ')}>
              <Filter size={CONTROL.icon.xs} />
              <span className="max-w-40 truncate">
                {selectedDomainIds.length === 0 ? 'No Domains'
                  : !filterActive ? 'All Domains'
                    : selectedDomainIds.length === 1 ? domains.find(domain => domain.id === selectedDomainIds[0])?.name
                      : `${selectedDomainIds.length} Domains`}
              </span>
            </Button>
          </PopoverTrigger>
          <MenuShell align="end">
            <Command>
              <CommandInput placeholder="Find a Domain…" />
              <CommandList>
                <CommandEmpty>No matching Domains.</CommandEmpty>
                <CommandItem onSelect={() => setSelectedDomainIds(() => domains.map(domain => domain.id))}>
                  <span className="flex-1">All Domains</span>
                  {!filterActive && selectedDomainIds.length > 0 && <Check size={CONTROL.icon.xs} />}
                </CommandItem>
                {domains.map(domain => {
                  const checked = selectedDomainIds.includes(domain.id);
                  return (
                    <CommandItem key={domain.id} value={`${domain.name} ${domain.id}`} onSelect={() => setSelectedDomainIds(previous =>
                      previous.includes(domain.id) ? previous.filter(id => id !== domain.id) : [...previous, domain.id])}>
                      <span className="flex-1 truncate">{domain.name}</span>
                      {checked && <Check size={CONTROL.icon.xs} />}
                    </CommandItem>
                  );
                })}
              </CommandList>
            </Command>
          </MenuShell>
        </Popover>
      )}
    </div>
  );
}

// =============================================================
// Date header — month strip + day numbers
// =============================================================
function DateHeader({ days, todayIdx, totalW }: { days: Date[]; todayIdx: number; totalW: number }) {
  // Month spans: consecutive runs of the same month
  const spans = useMemo(() => {
    const arr: { label: string; start: number; len: number }[] = [];
    for (let i = 0; i < days.length; i++) {
      const monthLabel = days[i].toLocaleDateString('en-US', { month: 'short' });
      const last = arr[arr.length - 1];
      if (last && last.label === monthLabel) last.len += 1;
      else arr.push({ label: monthLabel, start: i, len: 1 });
    }
    return arr;
  }, [days]);

  return (
    <div
      className="sticky top-0 z-20 bg-card border-b border-border/60"
      style={{ paddingLeft: WORKER_COL_W }}
    >
      <div className="flex" style={{ width: totalW, height: MONTH_HEADER_H }}>
        {spans.map((s, i) => (
          <div
            key={i}
            className="flex-shrink-0 text-[11px] text-muted-foreground font-medium px-2 flex items-center"
            style={{ width: s.len * DAY_W }}
          >
            {s.label}
          </div>
        ))}
      </div>
      <div className="flex relative" style={{ width: totalW, height: DAY_HEADER_H }}>
        {days.map((d, i) => {
          const isWeekend = d.getDay() === 0 || d.getDay() === 6;
          const isToday = i === todayIdx;
          return (
            <div
              key={i}
              className={`flex-shrink-0 text-[10px] flex items-center justify-center tabular-nums ${
                isToday
                  ? 'text-foreground font-semibold'
                  : isWeekend
                    ? 'text-muted-foreground/40'
                    : 'text-muted-foreground'
              }`}
              style={{ width: DAY_W }}
            >
              {d.getDate()}
            </div>
          );
        })}
        {todayIdx >= 0 && (
          <div
            className="absolute top-1 w-1.5 h-1.5 rounded-full bg-[var(--accent-default)]"
            style={{ left: todayIdx * DAY_W + DAY_W / 2 - 3 }}
          />
        )}
      </div>
    </div>
  );
}

// =============================================================
// Worker row — left meta col + SVG area chart on the right
// =============================================================
function WorkerRow({
  worker,
  elements,
  daily,
  capacity,
  spans,
  days,
  todayIdx,
  totalW,
  expanded,
  onToggle,
  onAddSpan,
  onRemoveSpan,
  onElementClick,
}: {
  worker: Worker;
  elements: ElementWithDetails[];
  daily: number[];
  capacity: number[];
  spans: WorkerAvailability[];
  days: Date[];
  todayIdx: number;
  totalW: number;
  expanded: boolean;
  onToggle: () => void;
  onAddSpan: (span: AvailabilityDraft) => Promise<void>;
  onRemoveSpan: (span: WorkerAvailability) => Promise<void>;
  onElementClick?: (element: ElementWithDetails) => void;
}) {
  const isOverloaded = daily.some((h, i) => h > capacity[i]);
  const peak = daily.reduce((m, h) => (h > m ? h : m), 0);
  const awayDays = awayDayCount(capacity);
  const subtitle = workerSubtitle(worker, elements);
  // Work whose date falls on a day this Worker has none. The chart already
  // draws it as a red band over a hatched stretch, which says a collision
  // exists without saying which Elements are in it; the count carries into the
  // availability menu, where they are listed under the period they land in.
  // Not clipped to the visible window — a rotation in November is still a
  // rotation when the chart happens to be showing September.
  const dueAway = dueWhileAway(worker, spans, elements);

  return (
    <div
      className="flex items-stretch border-b border-border/30 hover:bg-muted/5"
      style={{ height: ROW_H }}
    >
      {/* Sticky left meta column — the name area toggles, the calendar button
          opens this Worker's availability. Two jobs, so two controls: nesting
          the second inside the first would make one press mean either. */}
      <div
        className="sticky left-0 z-[1] bg-card flex items-center pr-1 border-r border-border/40 flex-shrink-0"
        style={{ width: WORKER_COL_W }}
      >
        <Button
          type="button"
          variant="ghost"
          align="start"
          onClick={onToggle}
          aria-expanded={expanded}
          className="gap-2 pl-2 pr-1 h-full min-w-0 flex-1 rounded-none"
        >
          <span
            className={`w-4 h-4 flex items-center justify-center text-muted-foreground transition-transform ${
              expanded ? 'rotate-0' : '-rotate-90'
            }`}
          >
            <ChevronDown size={12} />
          </span>
          <ResourceWorkerAvatar worker={worker} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="text-[13px] font-medium text-foreground truncate">{worker.name}</span>
              {isOverloaded && <OverloadFlag />}
            </div>
            {/* 220px of row, so the two facts do not both fit. Work landing on
                days with no hours takes the space when it fires — the day count
                it displaces is implied by it, and the menu one button away
                carries the dates and the names. */}
            <div className="text-[11px] text-muted-foreground truncate" title={loadNote(subtitle, awayDays, dueAway.length)}>
              {dueAway.length > 0 ? (
                <>
                  {subtitle}
                  <span className="text-[var(--status-danger)]">
                    {` · ${dueAway.length} due while away`}
                  </span>
                </>
              ) : awayDays > 0 ? (
                `${subtitle} · away ${awayDays}d`
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

      {/* Chart cell */}
      <div className="relative flex-shrink-0" style={{ width: totalW, height: ROW_H }}>
        {/* Day column dividers (weekend tint, today highlight) */}
        {days.map((d, i) => {
          const isWeekend = d.getDay() === 0 || d.getDay() === 6;
          const isToday = i === todayIdx;
          return (
            <div
              key={i}
              className={`absolute top-0 bottom-0 ${
                isToday ? 'bg-[var(--accent-subtle)]' : isWeekend ? 'bg-muted/15' : ''
              }`}
              style={{ left: i * DAY_W, width: DAY_W }}
            />
          );
        })}
        {/* Today vertical line */}
        {todayIdx >= 0 && (
          <div
            className="absolute top-0 bottom-0 border-l border-[var(--accent-default)]/60"
            style={{ left: todayIdx * DAY_W + DAY_W / 2 }}
          />
        )}

        <AreaChart
          daily={daily}
          capacity={capacity}
          width={totalW}
          height={CHART_H}
          topPad={CHART_TOP_PAD}
          rowHeight={ROW_H}
          isAgent={worker.type === 'ai_agent'}
        />

        {/* Peak tooltip data (no-op for now — visible on hover later) */}
        <span className="sr-only">Peak {peak.toFixed(1)} hours</span>
      </div>
    </div>
  );
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
  expanded,
  onToggle,
}: {
  elements: ElementWithDetails[];
  daily: number[];
  days: Date[];
  todayIdx: number;
  totalW: number;
  expanded: boolean;
  onToggle: () => void;
}) {
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
        className="sticky left-0 z-[1] bg-card gap-2 h-full pl-2 pr-3 rounded-none border-r border-[var(--border-subtle)]"
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
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-muted-foreground truncate">Unassigned</div>
          <div className="text-[11px] text-muted-foreground/70 truncate">
            {elements.length} Element{elements.length === 1 ? '' : 's'}
            {elements.some(element => !elementSpan(element)) && ` · ${elements.filter(element => !elementSpan(element)).length} unscheduled`}
          </div>
        </div>
      </Button>

      <div className="relative flex-shrink-0" style={{ width: totalW, height: ROW_H }}>
        {days.map((d, i) => {
          const isWeekend = d.getDay() === 0 || d.getDay() === 6;
          const isToday = i === todayIdx;
          return (
            <div
              key={i}
              className={`absolute top-0 bottom-0 ${
                isToday ? 'bg-[var(--accent-subtle)]' : isWeekend ? 'bg-muted/15' : ''
              }`}
              style={{ left: i * DAY_W, width: DAY_W }}
            />
          );
        })}
        {todayIdx >= 0 && (
          <div
            className="absolute top-0 bottom-0 border-l border-[var(--accent-default)]/60"
            style={{ left: todayIdx * DAY_W + DAY_W / 2 }}
          />
        )}

        <AreaChart
          daily={daily}
          capacity={daily.map(() => DEFAULT_CAPACITY_PER_DAY)}
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
  width,
  height,
  topPad,
  rowHeight,
  isAgent,
  neutral = false,
}: {
  daily: number[];
  /** Hours available each day. A step, not a level — an absence is the days
   *  where it drops to zero. */
  capacity: number[];
  width: number;
  height: number;
  topPad: number;
  rowHeight: number;
  isAgent: boolean;
  /** Grey informational fill with no capacity line / overload band —
   *  used by the Unassigned pseudo-row where "too much" has no meaning. */
  neutral?: boolean;
}) {
  const hatchId = useId();
  const baseY = topPad + height;
  const maxH = MAX_DISPLAY_HOURS;
  const yFor = (h: number) => topPad + height - (clamp(h, 0, maxH) / maxH) * height;

  // Step-shape path: rectangle per day
  let path = `M 0 ${baseY}`;
  for (let i = 0; i < daily.length; i++) {
    const x0 = i * DAY_W;
    const x1 = x0 + DAY_W;
    const y = yFor(daily[i]);
    path += ` L ${x0} ${y} L ${x1} ${y}`;
  }
  path += ` L ${daily.length * DAY_W} ${baseY} Z`;

  // The capacity reference follows the same step as the load, so a day off
  // reads as the line falling to the floor rather than as an unexplained red
  // band floating under a flat line.
  let capPath = '';
  for (let i = 0; i < capacity.length; i++) {
    const x0 = i * DAY_W;
    const y = yFor(capacity[i]);
    capPath += `${i === 0 ? 'M' : ' L'} ${x0} ${y} L ${x0 + DAY_W} ${y}`;
  }

  // Overload-only path: portions where the day's load exceeds that day's
  // capacity, drawn on top. Every segment closes along its own capacity step.
  let overloadPath = '';
  let inOverload = false;
  let segStart = 0;
  const overAt = (i: number) => !neutral && i < daily.length && daily[i] > capacity[i];
  const closeSegment = (end: number) => {
    overloadPath += ` M ${segStart * DAY_W} ${yFor(capacity[segStart])}`;
    for (let j = segStart; j < end; j++) {
      const jx0 = j * DAY_W;
      overloadPath += ` L ${jx0} ${yFor(daily[j])} L ${jx0 + DAY_W} ${yFor(daily[j])}`;
    }
    for (let j = end - 1; j >= segStart; j--) {
      const jx0 = j * DAY_W;
      overloadPath += ` L ${jx0 + DAY_W} ${yFor(capacity[j])} L ${jx0} ${yFor(capacity[j])}`;
    }
    overloadPath += ' Z';
  };
  for (let i = 0; i <= daily.length; i++) {
    const over = overAt(i);
    if (over && !inOverload) {
      segStart = i;
      inOverload = true;
    } else if (!over && inOverload) {
      closeSegment(i);
      inOverload = false;
    }
  }

  // Days with no hours at all, marked whether or not work landed on them —
  // an empty week off is a fact about the plan even when nothing collides.
  const awaySpans: { x: number; w: number }[] = [];
  for (let i = 0; i < capacity.length; i++) {
    if (neutral || capacity[i] > 0) continue;
    const last = awaySpans[awaySpans.length - 1];
    if (last && last.x + last.w === i * DAY_W) last.w += DAY_W;
    else awaySpans.push({ x: i * DAY_W, w: DAY_W });
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
      {/* Capacity reference step */}
      {!neutral && capPath && (
        <path
          d={capPath}
          fill="none"
          stroke="var(--border-default)"
          strokeDasharray="2 3"
          strokeWidth={1}
        />
      )}
      {/* Healthy area fill */}
      <path d={path} fill={fill} opacity={neutral ? 0.18 : isAgent ? 0.25 : 0.22} />
      {/* Overload band */}
      {overloadPath && (
        <path d={overloadPath} fill="var(--status-danger)" opacity={0.45} />
      )}
    </svg>
  );
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
      if (request.current === requestId) setError(e instanceof Error ? e.message : 'Could not save this period. Try again.');
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
          aria-label={`Availability for ${worker.name}`}
          title="Availability"
          className={spans.length > 0 ? 'text-[var(--text-primary)]' : undefined}
        >
          <CalendarClock size={CONTROL.icon.xs} />
        </Button>
      </PopoverTrigger>
      <MenuShell width="wide" align="start">
        <MenuSectionLabel>Away and part-time</MenuSectionLabel>
        {spans.length === 0 ? (
          <div className="px-2 py-1.5 text-[12px] text-muted-foreground">
            Nothing booked. {worker.name} is at full capacity throughout.
          </div>
        ) : (
          spans.map((s) => (
            <div key={s.id} className="rounded-sm px-2 py-1.5 hover:bg-[var(--surface-strong)]">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px]">{spanLabel(s)}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {spanDetail(s)}
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
                      if (request.current === requestId) setError(e instanceof Error ? e.message : 'Could not remove this period. Try again.');
                    });
                  }}
                  aria-label={`Remove ${spanLabel(s)}`}
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
            placeholder="From"
            variant="secondary"
            block
            aria-label="Away from"
          />
          <span className="text-[var(--text-tertiary)]">→</span>
          <DateField
            value={effectiveEnd}
            onChange={setEnd}
            placeholder="To"
            variant="secondary"
            block
            aria-label="Away to"
          />
        </div>

        <div className="flex flex-wrap gap-1 px-2 py-1">
          {AVAILABILITY_KINDS.map((k) => (
            <Button
              key={k.id}
              type="button"
              size="xs"
              variant={kind === k.id ? 'secondary' : 'ghost'}
              aria-pressed={kind === k.id}
              onClick={() => setKind(k.id)}
            >
              {k.label}
            </Button>
          ))}
        </div>

        <label className="flex items-center gap-2 px-2 py-1 text-[12px] text-muted-foreground">
          <span className="flex-1">Hours per day</span>
          <input
            type="number"
            min={0}
            max={24}
            step={1}
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            aria-label="Hours per day while away"
            className="w-14 rounded-md border-none bg-muted/40 px-2 py-1 text-right text-[13px] text-foreground tabular-nums"
          />
        </label>

        <div className="px-2 py-1">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add a note…"
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
            {saving ? 'Saving…' : 'Add period'}
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
  const due = useMemo(() => elementsDueInSpan(span, elements), [span, elements]);
  if (due.length === 0) return null;
  const away = span.capacity_hours_per_day <= 0;
  const visible = due.slice(0, DUE_IN_SPAN_VISIBLE);
  const rest = due.length - visible.length;

  return (
    <div className="mt-1 pl-2 border-l border-[var(--border-subtle)]">
      <div className={`text-[11px] ${away ? 'text-[var(--status-danger)]' : 'text-muted-foreground'}`}>
        {due.length} {due.length === 1 ? 'Element comes' : 'Elements come'} due
        {away ? ' while away' : ' in this period'}
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
        <div className="text-[11px] text-muted-foreground/70">and {rest} more</div>
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

function spanDetail(span: WorkerAvailability): string {
  const kind = AVAILABILITY_KINDS.find((k) => k.id === span.kind)?.label ?? 'Other';
  const load = span.capacity_hours_per_day > 0
    ? `${span.capacity_hours_per_day}h/day`
    : 'Away';
  return span.note ? `${kind} · ${load} · ${span.note}` : `${kind} · ${load}`;
}

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
  onElementClick,
}: {
  element: ElementWithDetails;
  days: Date[];
  todayIdx: number;
  totalW: number;
  onElementClick?: (element: ElementWithDetails) => void;
}) {
  const bar = useMemo(() => barFor(element, days), [element, days]);
  const statusColor =
    SEMANTIC_COLORS.status[element.status as keyof typeof SEMANTIC_COLORS.status]
    ?? SEMANTIC_COLORS.status.todo;
  const statusLabel = STATUS[element.status as keyof typeof STATUS]?.label ?? element.status ?? 'Todo';
  const hours = elementHours(element);

  return (
    <Button
      variant="ghost"
      align="start"
      onClick={() => onElementClick?.(element)}
      disabled={!onElementClick}
      aria-label={`Open ${element.title}`}
      className="flex w-full items-stretch gap-0 rounded-none border-b border-[var(--border-subtle)] p-0"
      style={{ height: SUB_ROW_H }}
    >
      <span
        className="sticky left-0 z-[1] bg-card flex items-center gap-2 pr-3 border-r border-[var(--border-subtle)] flex-shrink-0"
        style={{ width: WORKER_COL_W, paddingLeft: 32 }}
      >
        <span
          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
          style={{ background: statusColor }}
          aria-hidden
        />
        <span className="text-[12px] text-foreground truncate flex-1">{element.title}</span>
        <span className="text-[11px] text-muted-foreground tabular-nums flex-shrink-0"
          title={element.estimated_hours == null ? 'Approximate hours based on priority; set an estimate in the Element.' : 'Estimated hours'}>
          {element.estimated_hours == null ? '~' : ''}{hours}h
        </span>
      </span>

      <span className="relative flex-shrink-0" style={{ width: totalW, height: SUB_ROW_H }}>
        {todayIdx >= 0 && (
          <span
            className="absolute top-0 bottom-0 border-l border-[var(--accent-default)]/30"
            style={{ left: todayIdx * DAY_W + DAY_W / 2 }}
          />
        )}
        {bar && (
          <span
            className="absolute rounded-sm truncate"
            style={{
              left: bar.left,
              width: Math.max(bar.width, 12),
              top: (SUB_ROW_H - SUB_BAR_H) / 2,
              height: SUB_BAR_H,
              background: statusColor,
              lineHeight: `${SUB_BAR_H}px`,
            }}
            title={`${element.title} · ${statusLabel} · ${hours}h`}
          />
        )}
        {!bar && !elementSpan(element) && <span className="flex h-full items-center px-3 text-[11px] text-muted-foreground">Unscheduled</span>}
      </span>
    </Button>
  );
}

function ElementSubEmpty({ totalW }: { totalW: number }) {
  return (
    <div
      className="flex items-stretch border-b border-border/20 bg-muted/5"
      style={{ height: SUB_ROW_H }}
    >
      <div
        className="sticky left-0 z-[1] bg-card flex items-center text-[11px] text-muted-foreground italic"
        style={{ width: WORKER_COL_W, paddingLeft: 32 }}
      >
        No elements in this window
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
      ? 'bg-[var(--accent-default)] text-white'
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

function OverloadFlag() {
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
      aria-label="Overloaded"
    >
      <path d="M4 22V4h14l-2 5 2 5H4" />
    </svg>
  );
}

function KpiPill({
  label,
  value,
  tone,
}: { label: string; value: number | string; tone: 'red' | 'neutral' }) {
  const toneClass = tone === 'red'
    ? 'bg-[var(--status-danger-subtle)] text-[var(--status-danger)]'
    : 'bg-muted text-muted-foreground';
  return (
    <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] ${toneClass}`}>
      <span className="opacity-80">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </span>
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
): { left: number; width: number } | null {
  const bar = workloadBar(element, days.map(toDateOnlyString));
  return bar ? { left: bar.offset * DAY_W, width: bar.length * DAY_W } : null;
}

function computeDailyHours(elements: ElementWithDetails[], days: Date[]): number[] {
  return workloadDailyHours(elements, days.map(toDateOnlyString), toDateOnlyString(new Date()));
}

/** The whole of the subtitle line, for the hover the truncation makes necessary. */
function loadNote(subtitle: string, awayDays: number, dueAway: number): string {
  const parts = [subtitle];
  if (awayDays > 0) parts.push(`away ${awayDays} ${awayDays === 1 ? 'day' : 'days'} in this window`);
  if (dueAway > 0) {
    parts.push(`${dueAway} ${dueAway === 1 ? 'Element comes' : 'Elements come'} due while away`);
  }
  return parts.join(' · ');
}

function workerSubtitle(worker: Worker, elements: ElementWithDetails[]): string {
  const count = elements.length;
  const unscheduled = elements.filter(element => !elementSpan(element)).length;
  const role = worker.role ?? (worker.type === 'ai_agent' ? `AI · ${worker.ai_model ?? 'Agent'}` : worker.type === 'robot' ? 'Robot' : null);
  return [role ?? `${count} Element${count === 1 ? '' : 's'}`, unscheduled > 0 ? `${unscheduled} unscheduled` : null].filter(Boolean).join(' · ');
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}
