'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Filter } from 'lucide-react';
import {
  fetchStrategyElements,
  useDomains,
  type ElementWithDetails,
  type Worker,
} from '@/hooks/useSupabase';
import { SEMANTIC_COLORS, STATUS } from '@/shared/designTokens';

// =============================================================
// Workload — capacity view: workers × time
// One row per Worker; bars are the Elements assigned to them
// across an 8-week sliding window starting at "Today".
// =============================================================

const DAY_MS = 24 * 60 * 60 * 1000;
const VISIBLE_WEEKS = 8;
const WORKER_COL_W = 200;
const WEEK_COL_W = 110;
const BAR_H = 14;
const LANE_GAP = 4;
const ROW_MIN_H = 44;

const OVERLOAD_LANE_THRESHOLD = 5; // > N concurrent bars in window = overloaded (human only)

type WorkerRow = { worker: Worker; elements: ElementWithDetails[] };

function startOfWeek(d: Date): Date {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  const day = date.getDay(); // 0=Sun, 1=Mon
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return date;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function formatWeekLabel(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function WorkloadView() {
  const { data: domains } = useDomains();
  const [selectedDomainIds, setSelectedDomainIds] = useState<string[]>([]);

  useEffect(() => {
    if (selectedDomainIds.length === 0 && domains.length > 0) {
      setSelectedDomainIds(domains.map(d => d.id));
    }
  }, [domains, selectedDomainIds.length]);

  const [elements, setElements] = useState<ElementWithDetails[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (selectedDomainIds.length === 0) { setElements([]); return; }
    setLoading(true);
    fetchStrategyElements({ domainIds: selectedDomainIds, objectIds: [] })
      .then(({ elements }) => { if (!cancelled) setElements(elements); })
      .catch(err => { console.error('fetchStrategyElements failed:', err); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selectedDomainIds]);

  // 0 = current week. Negative = past, positive = future.
  const [anchorOffset, setAnchorOffset] = useState(0);

  const anchor = useMemo(() => {
    const a = startOfWeek(new Date());
    a.setDate(a.getDate() + anchorOffset * 7);
    return a;
  }, [anchorOffset]);

  const windowEnd = useMemo(() => {
    const e = new Date(anchor);
    e.setDate(e.getDate() + VISIBLE_WEEKS * 7);
    return e;
  }, [anchor]);

  const weeks = useMemo(() => {
    const arr: Date[] = [];
    for (let i = 0; i < VISIBLE_WEEKS; i++) {
      const w = new Date(anchor);
      w.setDate(w.getDate() + i * 7);
      arr.push(w);
    }
    return arr;
  }, [anchor]);

  const grouped = useMemo(() => {
    const byWorker = new Map<string, WorkerRow>();
    for (const el of elements) {
      const assignees = el.assignees ?? [];
      for (const a of assignees) {
        if (!a.worker) continue;
        const wid = a.worker.id;
        if (!byWorker.has(wid)) byWorker.set(wid, { worker: a.worker, elements: [] });
        byWorker.get(wid)!.elements.push(el);
      }
    }
    const rows = Array.from(byWorker.values());
    rows.sort((a, b) => a.worker.name.localeCompare(b.worker.name));
    return {
      humans: rows.filter(r => r.worker.type === 'human'),
      agents: rows.filter(r => r.worker.type === 'ai_agent'),
      robots: rows.filter(r => r.worker.type === 'robot'),
    };
  }, [elements]);

  // Header KPI: count humans with more concurrent in-window load than threshold
  const stats = useMemo(() => {
    let overloaded = 0;
    for (const row of grouped.humans) {
      const concurrentMax = maxConcurrentInWindow(row.elements, anchor, windowEnd);
      if (concurrentMax > OVERLOAD_LANE_THRESHOLD) overloaded += 1;
    }
    return {
      humans: grouped.humans.length,
      agents: grouped.agents.length,
      overloaded,
    };
  }, [grouped, anchor, windowEnd]);

  const [filterOpen, setFilterOpen] = useState(false);
  const filterActive = domains.length > 0 && selectedDomainIds.length < domains.length;

  const totalRows = grouped.humans.length + grouped.agents.length + grouped.robots.length;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="h-10 flex items-center gap-2 px-4 border-b border-border/60 bg-card flex-shrink-0">
        <span className="text-[12px] font-semibold text-foreground">Workload</span>
        <span className="text-[11px] text-muted-foreground">
          {loading ? 'Loading…' : `${stats.humans} humans · ${stats.agents} agents`}
        </span>
        <div className="flex-1" />

        <div className="flex items-center gap-1 mr-1">
          <button
            type="button"
            onClick={() => setAnchorOffset(o => o - 1)}
            className="w-[24px] h-[24px] rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40 flex items-center justify-center"
            title="Previous week"
            aria-label="Previous week"
          >
            <ChevronLeft size={13} />
          </button>
          <button
            type="button"
            onClick={() => setAnchorOffset(0)}
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
            onClick={() => setAnchorOffset(o => o + 1)}
            className="w-[24px] h-[24px] rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40 flex items-center justify-center"
            title="Next week"
            aria-label="Next week"
          >
            <ChevronRight size={13} />
          </button>
        </div>

        <KpiPill label="Overloaded" value={stats.overloaded} tone={stats.overloaded > 0 ? 'red' : 'neutral'} />

        <div className="relative">
          <button
            type="button"
            onClick={() => setFilterOpen(o => !o)}
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
                  {domains.map(d => {
                    const checked = selectedDomainIds.includes(d.id);
                    return (
                      <button
                        type="button"
                        key={d.id}
                        onClick={() => setSelectedDomainIds(prev =>
                          checked ? prev.filter(x => x !== d.id) : [...prev, d.id]
                        )}
                        className="w-full flex items-center gap-2 px-2 py-1.5 text-[12px] hover:bg-accent text-left rounded"
                      >
                        <span className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center ${checked ? 'bg-primary border-primary' : 'border-border'}`}>
                          {checked && <span className="text-[9px] text-primary-foreground leading-none">✓</span>}
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
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="h-full flex items-center justify-center text-muted-foreground text-[13px]">
            Loading workload…
          </div>
        ) : totalRows === 0 ? (
          <EmptyHint />
        ) : (
          <WorkloadGrid
            weeks={weeks}
            anchor={anchor}
            windowEnd={windowEnd}
            humans={grouped.humans}
            agents={grouped.agents}
            robots={grouped.robots}
          />
        )}
      </div>
    </div>
  );
}

// =============================================================
// Grid
// =============================================================
function WorkloadGrid({
  weeks,
  anchor,
  windowEnd,
  humans,
  agents,
  robots,
}: {
  weeks: Date[];
  anchor: Date;
  windowEnd: Date;
  humans: WorkerRow[];
  agents: WorkerRow[];
  robots: WorkerRow[];
}) {
  const totalW = WEEK_COL_W * weeks.length;

  return (
    <div className="min-w-fit">
      {/* Week header — sticky top */}
      <div
        className="sticky top-0 z-20 bg-card border-b border-border/60 flex"
        style={{ paddingLeft: WORKER_COL_W }}
      >
        {weeks.map((w, i) => {
          const isCurrent = isThisWeek(w);
          return (
            <div
              key={i}
              className={`flex-shrink-0 px-2 py-1.5 text-[11px] border-r border-border/40 ${
                isCurrent
                  ? 'text-foreground font-semibold bg-muted/30'
                  : 'text-muted-foreground'
              }`}
              style={{ width: WEEK_COL_W }}
            >
              {formatWeekLabel(w)}
            </div>
          );
        })}
      </div>

      {humans.length > 0 && (
        <Section title="Humans" rows={humans} weeks={weeks} anchor={anchor} windowEnd={windowEnd} totalW={totalW} kind="human" />
      )}
      {agents.length > 0 && (
        <Section title="AI Agents" rows={agents} weeks={weeks} anchor={anchor} windowEnd={windowEnd} totalW={totalW} kind="agent" />
      )}
      {robots.length > 0 && (
        <Section title="Robots" rows={robots} weeks={weeks} anchor={anchor} windowEnd={windowEnd} totalW={totalW} kind="robot" />
      )}
    </div>
  );
}

function Section({
  title,
  rows,
  weeks,
  anchor,
  windowEnd,
  totalW,
  kind,
}: {
  title: string;
  rows: WorkerRow[];
  weeks: Date[];
  anchor: Date;
  windowEnd: Date;
  totalW: number;
  kind: 'human' | 'agent' | 'robot';
}) {
  return (
    <div>
      <div className="sticky left-0 z-10 px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground bg-muted/20 border-b border-border/40">
        {title}
        <span className="text-muted-foreground/60 ml-1.5">({rows.length})</span>
      </div>
      {rows.map(({ worker, elements }) => (
        <WorkerRowView
          key={worker.id}
          worker={worker}
          elements={elements}
          weeks={weeks}
          anchor={anchor}
          windowEnd={windowEnd}
          totalW={totalW}
          kind={kind}
        />
      ))}
    </div>
  );
}

function WorkerRowView({
  worker,
  elements,
  weeks,
  anchor,
  windowEnd,
  totalW,
  kind,
}: {
  worker: Worker;
  elements: ElementWithDetails[];
  weeks: Date[];
  anchor: Date;
  windowEnd: Date;
  totalW: number;
  kind: 'human' | 'agent' | 'robot';
}) {
  const bars = useMemo(
    () => buildBars(elements, anchor, windowEnd),
    [elements, anchor, windowEnd],
  );

  const lanes = useMemo(() => assignLanes(bars), [bars]);
  const rowH = Math.max(ROW_MIN_H, lanes.count * (BAR_H + LANE_GAP) + LANE_GAP);
  const isOverloaded = kind === 'human' && lanes.count > OVERLOAD_LANE_THRESHOLD;

  return (
    <div
      className="flex items-stretch border-b border-border/30 hover:bg-muted/10"
      style={{ minHeight: rowH }}
    >
      {/* Worker name (sticky left) */}
      <div
        className="sticky left-0 z-[1] bg-card flex items-center gap-2 px-3 border-r border-border/40 flex-shrink-0"
        style={{ width: WORKER_COL_W }}
      >
        <WorkerAvatar worker={worker} kind={kind} />
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-medium text-foreground truncate">{worker.name}</div>
          <div className="text-[10px] text-muted-foreground">
            {bars.length} element{bars.length === 1 ? '' : 's'}
            {isOverloaded && (
              <span className="ml-1 text-[var(--status-danger)] font-semibold">· overloaded</span>
            )}
          </div>
        </div>
      </div>

      {/* Bars */}
      <div className="relative flex-shrink-0" style={{ width: totalW, height: rowH }}>
        {weeks.map((w, i) => (
          <div
            key={i}
            className={`absolute top-0 bottom-0 border-r border-border/30 ${isThisWeek(w) ? 'bg-muted/15' : ''}`}
            style={{ left: i * WEEK_COL_W, width: WEEK_COL_W }}
          />
        ))}
        {lanes.items.map(({ el, left, width, lane }) => {
          const top = LANE_GAP + lane * (BAR_H + LANE_GAP);
          const color =
            SEMANTIC_COLORS.status[el.status as keyof typeof SEMANTIC_COLORS.status] ??
            SEMANTIC_COLORS.status.todo;
          return (
            <div
              key={el.id}
              className="absolute rounded-[3px] text-[10px] text-white px-1.5 truncate cursor-default transition-opacity hover:opacity-80"
              style={{
                left,
                width: Math.max(width, 10),
                top,
                height: BAR_H,
                background: color,
                lineHeight: `${BAR_H}px`,
              }}
              title={`${el.title} · ${STATUS[el.status as keyof typeof STATUS]?.label ?? el.status}`}
            >
              {el.title}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WorkerAvatar({ worker, kind }: { worker: Worker; kind: 'human' | 'agent' | 'robot' }) {
  const initials = (worker.name || '?').slice(0, 2).toUpperCase();
  // AI agents stand out — they're the available capacity the PM can route to.
  const bg = kind === 'agent'
    ? 'bg-[var(--accent-default)] text-white'
    : kind === 'robot'
      ? 'bg-[var(--surface-raised)] text-[var(--text-tertiary)]'
      : 'bg-muted text-foreground';
  return (
    <div className={`w-7 h-7 rounded-full ${bg} flex items-center justify-center text-[10px] font-semibold flex-shrink-0`}>
      {initials}
    </div>
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

function EmptyHint() {
  return (
    <div className="h-full flex flex-col items-center justify-center text-muted-foreground text-[13px] gap-2 px-6 text-center">
      <p className="max-w-md">
        No workers with assignments in the selected scope. Assign workers to Elements with start/due dates to see their capacity here.
      </p>
    </div>
  );
}

// =============================================================
// Helpers
// =============================================================

type Bar = { el: ElementWithDetails; left: number; width: number };

function buildBars(elements: ElementWithDetails[], anchor: Date, windowEnd: Date): Bar[] {
  const out: Bar[] = [];
  for (const el of elements) {
    const s = el.start_date ? new Date(el.start_date) : null;
    const d = el.due_date ? new Date(el.due_date) : null;
    if (!s && !d) continue;
    const start = s ?? d!;
    const end = d ?? s!;
    if (end < anchor || start >= windowEnd) continue;
    const clampedStart = start < anchor ? anchor : start;
    const clampedEnd = end >= windowEnd ? new Date(windowEnd.getTime() - DAY_MS) : end;
    const offsetDays = Math.max(0, Math.floor((clampedStart.getTime() - anchor.getTime()) / DAY_MS));
    const spanDays = Math.max(1, Math.floor((clampedEnd.getTime() - clampedStart.getTime()) / DAY_MS) + 1);
    out.push({
      el,
      left: (offsetDays / 7) * WEEK_COL_W,
      width: (spanDays / 7) * WEEK_COL_W,
    });
  }
  return out;
}

function assignLanes(bars: Bar[]): { items: Array<Bar & { lane: number }>; count: number } {
  const sorted = [...bars].sort((a, b) => a.left - b.left);
  const laneEnds: number[] = [];
  const items: Array<Bar & { lane: number }> = [];
  for (const bar of sorted) {
    let placed = false;
    for (let i = 0; i < laneEnds.length; i++) {
      if (laneEnds[i] <= bar.left) {
        laneEnds[i] = bar.left + bar.width;
        items.push({ ...bar, lane: i });
        placed = true;
        break;
      }
    }
    if (!placed) {
      items.push({ ...bar, lane: laneEnds.length });
      laneEnds.push(bar.left + bar.width);
    }
  }
  return { items, count: Math.max(1, laneEnds.length) };
}

function maxConcurrentInWindow(
  elements: ElementWithDetails[],
  anchor: Date,
  windowEnd: Date,
): number {
  const bars = buildBars(elements, anchor, windowEnd);
  return assignLanes(bars).count;
}

function isThisWeek(d: Date): boolean {
  const now = startOfWeek(new Date());
  return isSameDay(d, now);
}
