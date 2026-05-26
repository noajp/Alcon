'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Filter } from 'lucide-react';
import {
  fetchStrategyElements,
  useDomains,
  type ElementWithDetails,
  type Worker,
} from '@/hooks/useSupabase';
import { SEMANTIC_COLORS, STATUS } from '@/shared/designTokens';

// =============================================================
// Resource — Asana-style per-Worker daily-load area chart
// Rows are Workers. The body of each row is a small SVG area
// chart showing total assigned hours per day across the visible
// window. Aggregate over assignees + element duration so the
// shape reflects "how loaded is this worker every day".
//
// Scope:
//   - Standalone (Action Space): user picks Domains via filter
//   - Embedded in Object Detail tab: pass scopeOverride.objectIds
//   - Embedded in Domain Detail tab: pass scopeOverride.domainIds
// =============================================================

const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_W = 22;
const VISIBLE_DAYS = 31;       // ~1 month
const PAST_DAYS = 6;           // anchor = today - 6
const WORKER_COL_W = 220;
const MONTH_HEADER_H = 22;
const DAY_HEADER_H = 22;
const ROW_H = 56;
const CHART_H = 36;
const CHART_TOP_PAD = 8;       // px from top of row to chart top
const DEFAULT_CAPACITY_PER_DAY = 8;
const MAX_DISPLAY_HOURS = 16;  // y-axis max (clip overflow)

const HOURS_BY_PRIORITY: Record<string, number> = {
  urgent: 8, high: 4, medium: 2, low: 1,
};

export interface ResourceViewProps {
  /** Override the scope. When omitted, view loads via the user's
   *  Domain filter (Action Space behavior). When provided, the
   *  filter button is hidden by default. */
  scopeOverride?: { domainIds?: string[]; objectIds?: string[] };
  /** Hide the top header bar (use when embedded in another shell
   *  that owns the title/controls). */
  hideHeader?: boolean;
  /** Force-hide the filter button even in standalone mode. */
  hideFilter?: boolean;
}

export function ResourceView({ scopeOverride, hideHeader, hideFilter }: ResourceViewProps = {}) {
  const { data: domains } = useDomains();
  const [selectedDomainIds, setSelectedDomainIds] = useState<string[]>([]);

  // Seed Domain selection (only matters when no scopeOverride)
  useEffect(() => {
    if (selectedDomainIds.length === 0 && domains.length > 0) {
      setSelectedDomainIds(domains.map(d => d.id));
    }
  }, [domains, selectedDomainIds.length]);

  const [elements, setElements] = useState<ElementWithDetails[]>([]);
  const [loading, setLoading] = useState(false);

  // Effective scope: override wins; otherwise use Domain filter
  const effectiveScope = useMemo(() => {
    if (scopeOverride) {
      return {
        domainIds: scopeOverride.domainIds ?? [],
        objectIds: scopeOverride.objectIds ?? [],
      };
    }
    return { domainIds: selectedDomainIds, objectIds: [] };
  }, [scopeOverride, selectedDomainIds]);

  useEffect(() => {
    let cancelled = false;
    const { domainIds, objectIds } = effectiveScope;
    if (domainIds.length === 0 && objectIds.length === 0) {
      setElements([]);
      return;
    }
    setLoading(true);
    fetchStrategyElements({ domainIds, objectIds })
      .then(({ elements }) => { if (!cancelled) setElements(elements); })
      .catch(err => { console.error('fetchStrategyElements failed:', err); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [effectiveScope]);

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
  const rows: Row[] = useMemo(() => {
    const byWorker = new Map<string, { worker: Worker; elements: ElementWithDetails[] }>();
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
      return sb - sa;
    });
    return out;
  }, [elements, days]);

  // KPIs
  const stats = useMemo(() => {
    let overloadedDays = 0;
    let humans = 0;
    let agents = 0;
    for (const r of rows) {
      if (r.worker.type === 'human') humans += 1;
      else if (r.worker.type === 'ai_agent') agents += 1;
      const cap = capacityForWorker(r.worker);
      for (const h of r.daily) if (h > cap) overloadedDays += 1;
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
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpanded = (workerId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(workerId)) next.delete(workerId);
      else next.add(workerId);
      return next;
    });
  };

  const totalW = DAY_W * VISIBLE_DAYS;

  return (
    <div className="flex flex-col h-full bg-card">
      {!hideHeader && (
        <Header
          loading={loading}
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

      <div className="flex-1 overflow-auto">
        {loading ? (
          <CenterMessage>Loading resource…</CenterMessage>
        ) : rows.length === 0 ? (
          <CenterMessage>
            No workers with assignments in this scope. Assign Workers to
            Elements with start / due dates to see their load here.
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
                    worker={r.worker}
                    elements={r.elements}
                    daily={r.daily}
                    days={days}
                    todayIdx={todayIdx}
                    totalW={totalW}
                    expanded={isOpen}
                    onToggle={() => toggleExpanded(r.worker.id)}
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
                    />
                  ))}
                </Fragment>
              );
            })}
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
    <div className="h-10 flex items-center gap-2 px-4 border-b border-border/60 flex-shrink-0">
      <span className="text-[12px] font-semibold text-foreground">Resource</span>
      <span className="text-[11px] text-muted-foreground">
        {loading ? 'Loading…' : `${stats.humans} humans · ${stats.agents} agents`}
      </span>
      <div className="flex-1" />

      <div className="flex items-center gap-1 mr-1">
        <button
          type="button"
          onClick={() => setAnchorOffset((o) => o - 7)}
          className="w-[24px] h-[24px] rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40 flex items-center justify-center"
          title="Back one week"
          aria-label="Back one week"
        >
          <ChevronLeft size={13} />
        </button>
        <button
          type="button"
          onClick={() => setAnchorOffset(() => 0)}
          className={`px-2 h-[24px] rounded-md text-[11px] transition-colors ${
            anchorOffset === 0
              ? 'bg-muted/60 text-foreground'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
          }`}
        >
          Today
        </button>
        <button
          type="button"
          onClick={() => setAnchorOffset((o) => o + 7)}
          className="w-[24px] h-[24px] rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40 flex items-center justify-center"
          title="Forward one week"
          aria-label="Forward one week"
        >
          <ChevronRight size={13} />
        </button>
      </div>

      <KpiPill label="Overload days" value={stats.overloadedDays} tone={stats.overloadedDays > 0 ? 'red' : 'neutral'} />

      {showFilterButton && (
        <div className="relative">
          <button
            type="button"
            onClick={() => setFilterOpen(!filterOpen)}
            className={`relative inline-flex items-center justify-center w-[26px] h-[26px] rounded-md transition-colors ${
              filterActive
                ? 'text-foreground bg-muted/60'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
            }`}
            title="Filter scope"
            aria-label="Filter"
          >
            <Filter size={13} />
            {filterActive && (
              <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-orange-500" />
            )}
          </button>
          {filterOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setFilterOpen(false)} />
              <div className="absolute right-0 top-full mt-1 z-50 w-64 bg-popover border border-border rounded-md shadow-xl overflow-hidden p-2">
                <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide px-1 pb-1">
                  Domains
                </div>
                <div className="max-h-64 overflow-auto py-1">
                  {domains.map((d) => {
                    const checked = selectedDomainIds.includes(d.id);
                    return (
                      <button
                        type="button"
                        key={d.id}
                        onClick={() =>
                          setSelectedDomainIds((prev) =>
                            checked ? prev.filter((x) => x !== d.id) : [...prev, d.id],
                          )
                        }
                        className="w-full flex items-center gap-2 px-2 py-1.5 text-[12px] hover:bg-accent text-left rounded"
                      >
                        <span
                          className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center ${
                            checked ? 'bg-primary border-primary' : 'border-border'
                          }`}
                        >
                          {checked && (
                            <span className="text-[9px] text-primary-foreground leading-none">✓</span>
                          )}
                        </span>
                        <span className="flex-1 truncate">{d.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
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
  days,
  todayIdx,
  totalW,
  expanded,
  onToggle,
}: {
  worker: Worker;
  elements: ElementWithDetails[];
  daily: number[];
  days: Date[];
  todayIdx: number;
  totalW: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const capacity = capacityForWorker(worker);
  const isOverloaded = daily.some((h) => h > capacity);
  const peak = daily.reduce((m, h) => (h > m ? h : m), 0);
  const subtitle = workerSubtitle(worker, elements);

  return (
    <div
      className="flex items-stretch border-b border-border/30 hover:bg-muted/5"
      style={{ height: ROW_H }}
    >
      {/* Sticky left meta column — entire area is the expand toggle */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="sticky left-0 z-[1] bg-card flex items-center gap-2 pl-2 pr-3 border-r border-border/40 flex-shrink-0 text-left hover:bg-muted/20 transition-colors"
        style={{ width: WORKER_COL_W }}
      >
        <span
          className={`w-4 h-4 flex items-center justify-center text-muted-foreground transition-transform ${
            expanded ? 'rotate-0' : '-rotate-90'
          }`}
        >
          <ChevronDown size={12} />
        </span>
        <WorkerAvatar worker={worker} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[13px] font-medium text-foreground truncate">{worker.name}</span>
            {isOverloaded && <OverloadFlag />}
          </div>
          <div className="text-[11px] text-muted-foreground truncate">{subtitle}</div>
        </div>
      </button>

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
}: {
  daily: number[];
  capacity: number;
  width: number;
  height: number;
  topPad: number;
  rowHeight: number;
  isAgent: boolean;
}) {
  const baseY = topPad + height;
  const maxH = MAX_DISPLAY_HOURS;
  const yFor = (h: number) => topPad + height - (clamp(h, 0, maxH) / maxH) * height;
  const capY = yFor(capacity);

  // Step-shape path: rectangle per day
  let path = `M 0 ${baseY}`;
  for (let i = 0; i < daily.length; i++) {
    const x0 = i * DAY_W;
    const x1 = x0 + DAY_W;
    const y = yFor(daily[i]);
    path += ` L ${x0} ${y} L ${x1} ${y}`;
  }
  path += ` L ${daily.length * DAY_W} ${baseY} Z`;

  // Overload-only path: portions where daily > capacity, drawn on top
  let overloadPath = '';
  let inOverload = false;
  let segStart = 0;
  for (let i = 0; i <= daily.length; i++) {
    const over = i < daily.length && daily[i] > capacity;
    if (over && !inOverload) {
      segStart = i;
      inOverload = true;
    } else if (!over && inOverload) {
      // Close segment from segStart .. i-1
      const x0 = segStart * DAY_W;
      const xEnd = i * DAY_W;
      overloadPath += ` M ${x0} ${capY}`;
      for (let j = segStart; j < i; j++) {
        const jx0 = j * DAY_W;
        const jx1 = jx0 + DAY_W;
        const y = yFor(daily[j]);
        overloadPath += ` L ${jx0} ${y} L ${jx1} ${y}`;
      }
      overloadPath += ` L ${xEnd} ${capY} Z`;
      inOverload = false;
    }
  }

  const fill = isAgent ? 'var(--accent-default)' : 'var(--accent-default)';

  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      width={width}
      height={rowHeight}
      viewBox={`0 0 ${width} ${rowHeight}`}
    >
      {/* Capacity reference line */}
      <line
        x1={0}
        x2={width}
        y1={capY}
        y2={capY}
        stroke="var(--border-default)"
        strokeDasharray="2 3"
        strokeWidth={1}
      />
      {/* Healthy area fill */}
      <path d={path} fill={fill} opacity={isAgent ? 0.25 : 0.22} />
      {/* Overload band */}
      {overloadPath && (
        <path d={overloadPath} fill="var(--status-danger)" opacity={0.45} />
      )}
    </svg>
  );
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
}: {
  element: ElementWithDetails;
  days: Date[];
  todayIdx: number;
  totalW: number;
}) {
  const bar = useMemo(() => barFor(element, days), [element, days]);
  const statusColor =
    SEMANTIC_COLORS.status[element.status as keyof typeof SEMANTIC_COLORS.status]
    ?? SEMANTIC_COLORS.status.todo;
  const statusLabel = STATUS[element.status as keyof typeof STATUS]?.label ?? element.status ?? 'Todo';
  const hours = element.estimated_hours ?? HOURS_BY_PRIORITY[element.priority ?? 'medium'] ?? 2;

  return (
    <div
      className="flex items-stretch border-b border-border/20 bg-muted/5 hover:bg-muted/15"
      style={{ height: SUB_ROW_H }}
    >
      <div
        className="sticky left-0 z-[1] bg-card flex items-center gap-1.5 pr-3 border-r border-border/30 flex-shrink-0"
        style={{ width: WORKER_COL_W, paddingLeft: 32 }}
      >
        <span
          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
          style={{ background: statusColor }}
          aria-hidden
        />
        <span className="text-[12px] text-foreground truncate flex-1">{element.title}</span>
        <span className="text-[10px] text-muted-foreground tabular-nums flex-shrink-0">{hours}h</span>
      </div>

      <div className="relative flex-shrink-0" style={{ width: totalW, height: SUB_ROW_H }}>
        {todayIdx >= 0 && (
          <div
            className="absolute top-0 bottom-0 border-l border-[var(--accent-default)]/30"
            style={{ left: todayIdx * DAY_W + DAY_W / 2 }}
          />
        )}
        {bar && (
          <div
            className="absolute rounded-[3px] text-[10px] text-white px-1.5 truncate transition-opacity hover:opacity-80"
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
      </div>
    </div>
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
function WorkerAvatar({ worker }: { worker: Worker }) {
  const initials = (worker.name || '?').slice(0, 2).toUpperCase();
  const bg =
    worker.type === 'ai_agent'
      ? 'bg-[var(--accent-default)] text-white'
      : worker.type === 'robot'
        ? 'bg-[var(--surface-raised)] text-[var(--text-tertiary)]'
        : 'bg-muted text-foreground';
  return (
    <div
      className={`w-8 h-8 rounded-full ${bg} flex items-center justify-center text-[11px] font-semibold flex-shrink-0`}
    >
      {initials}
    </div>
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
}: { label: string; value: number; tone: 'red' | 'neutral' }) {
  const toneClass = tone === 'red'
    ? 'bg-red-500/15 text-red-300'
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
  if (days.length === 0) return elements;
  const windowStart = days[0];
  const windowEnd = days[days.length - 1];
  const visible: ElementWithDetails[] = [];
  for (const el of elements) {
    const s = el.start_date ? new Date(el.start_date) : null;
    const d = el.due_date ? new Date(el.due_date) : null;
    if (!s && !d) continue;
    const start = stripTime(s ?? d!);
    const end = stripTime(d ?? s!);
    if (end < windowStart || start > windowEnd) continue;
    visible.push(el);
  }
  visible.sort((a, b) => {
    const aStart = a.start_date ?? a.due_date ?? '';
    const bStart = b.start_date ?? b.due_date ?? '';
    return aStart.localeCompare(bStart);
  });
  return visible;
}

/** Compute the screen position of an Element's bar within the visible
 *  window. Returns null if the Element has no dates or is fully outside
 *  the window. */
function barFor(
  element: ElementWithDetails,
  days: Date[],
): { left: number; width: number } | null {
  if (days.length === 0) return null;
  const windowStart = days[0];
  const windowEnd = days[days.length - 1];
  const s = element.start_date ? new Date(element.start_date) : null;
  const d = element.due_date ? new Date(element.due_date) : null;
  if (!s && !d) return null;
  const start = stripTime(s ?? d!);
  const end = stripTime(d ?? s!);
  if (end < windowStart || start > windowEnd) return null;
  const clampedStart = start < windowStart ? windowStart : start;
  const clampedEnd = end > windowEnd ? windowEnd : end;
  const offsetDays = Math.max(0, daysBetween(windowStart, clampedStart));
  const spanDays = Math.max(1, daysBetween(clampedStart, clampedEnd) + 1);
  return {
    left: offsetDays * DAY_W,
    width: spanDays * DAY_W,
  };
}

function computeDailyHours(elements: ElementWithDetails[], days: Date[]): number[] {
  const out = new Array(days.length).fill(0);
  if (days.length === 0) return out;
  const windowStart = days[0];
  const windowEnd = days[days.length - 1];
  const wsMs = windowStart.getTime();

  for (const el of elements) {
    const s = el.start_date ? new Date(el.start_date) : null;
    const d = el.due_date ? new Date(el.due_date) : null;
    if (!s && !d) continue;
    const start = stripTime(s ?? d!);
    const end = stripTime(d ?? s!);
    if (end < windowStart || start > windowEnd) continue;
    const duration = Math.max(1, daysBetween(start, end) + 1);
    const totalHours = el.estimated_hours ?? HOURS_BY_PRIORITY[el.priority ?? 'medium'] ?? 2;
    const perDay = totalHours / duration;

    // Iterate just the intersection
    const fromDay = Math.max(0, Math.floor((start.getTime() - wsMs) / DAY_MS));
    const toDay = Math.min(days.length - 1, Math.floor((end.getTime() - wsMs) / DAY_MS));
    for (let i = fromDay; i <= toDay; i++) {
      out[i] += perDay;
    }
  }
  return out;
}

function capacityForWorker(worker: Worker): number {
  // Future: per-worker capacity_hours_per_week / 5. For now, fixed.
  if (worker.type === 'ai_agent') return DEFAULT_CAPACITY_PER_DAY * 2; // AI runs more parallel
  return DEFAULT_CAPACITY_PER_DAY;
}

function workerSubtitle(worker: Worker, elements: ElementWithDetails[]): string {
  if (worker.role) return worker.role;
  if (worker.type === 'ai_agent') return `AI · ${worker.ai_model ?? 'Claude'}`;
  if (worker.type === 'robot') return 'Robot';
  const count = elements.length;
  return `${count} element${count === 1 ? '' : 's'}`;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function stripTime(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / DAY_MS);
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}
