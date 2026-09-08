'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  fetchStrategyElements,
  useObjects,
  useStrategies,
  type AlconObject,
  type ElementWithDetails,
  type StrategyWithObjects,
} from '@/hooks/useSupabase';
import { ObjectIcon } from '@/shell/icons';
import { NavStrategyIcon, NavTimelineIcon } from '@/shell/sidebar/NavIcons';
import { completionOf } from '@/Function/shared/completion';

// =============================================================
// Timeline — Linear-Roadmap-style portfolio timeline for the
// Strategy layer. One row per top-level Initiative, grouped in the
// left list by the quarter its span ends in ("Q3 2026"…), with
// undated Initiatives collected under "Upcoming". The right side is
// a month-scale axis; each Initiative draws as a rounded band whose
// inner fill shows its done-Element progress. Expanding a row
// reveals its member Objects as thinner bars on the same axis.
//
// A Initiative's span = the union of its Objects' spans, where each
// Object uses its own start/due dates and falls back to the union
// of its Elements' dates.
// =============================================================

const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_W = 4;               // month-scale: ~120px per month
const VISIBLE_MONTHS = 12;
const PAST_MONTHS = 2;         // window starts 2 months back
const LEFT_COL_W = 260;
const MONTH_HEADER_H = 28;
const GROUP_ROW_H = 32;
const INITIATIVE_ROW_H = 36;
const OBJECT_ROW_H = 28;
const INITIATIVE_BAR_H = 20;
const OBJECT_BAR_H = 14;

interface DateRange { start: Date; end: Date }

export function TimelineView({
  onSelectStrategy,
  onOpenObject,
}: {
  /** Open a Initiative's detail page (the 'strategy' view). */
  onSelectStrategy?: (id: string) => void;
  /** Jump to an Object's detail (the Execution "objects" view). */
  onOpenObject?: (objectId: string, domainId: string | null) => void;
} = {}) {
  const { data: strategies, loading: strategiesLoading } = useStrategies();
  const { data: { objects: explorerObjects } } = useObjects(null);

  const objectsById = useMemo(() => {
    return new Map<string, AlconObject>(explorerObjects.map((o) => [o.id, o]));
  }, [explorerObjects]);

  // Portfolio scope: top-level Initiatives only — nested ones are part of
  // their parent's story, same rule as the Initiative portfolio list.
  const rootStrategies = useMemo(
    () => strategies.filter((s) => s.parentIds.length === 0),
    [strategies],
  );

  // Loading is derived, not a second state: the result remembers which
  // strategy set it was fetched for, and we're loading whenever the current
  // set differs (also keeps this effect free of sync setState calls).
  const scopeKey = useMemo(() => rootStrategies.map((s) => s.id).join(','), [rootStrategies]);
  const [elementsResult, setElementsResult] = useState<{ key: string; map: Map<string, ElementWithDetails[]> }>(
    { key: '', map: new Map() },
  );
  const elementsByStrategy = elementsResult.map;
  const elementsLoading = rootStrategies.length > 0 && elementsResult.key !== scopeKey;

  useEffect(() => {
    let cancelled = false;
    if (rootStrategies.length === 0) return;
    Promise.all(
      rootStrategies.map(async (s) => {
        if (s.objectIds.length === 0) return [s.id, [] as ElementWithDetails[]] as const;
        const res = await fetchStrategyElements({ domainIds: [], objectIds: s.objectIds });
        return [s.id, res.elements] as const;
      }),
    )
      .then((pairs) => { if (!cancelled) setElementsResult({ key: scopeKey, map: new Map(pairs) }); })
      .catch((e) => {
        console.error('TimelineView fetch failed:', e);
        // Settle the key so a failed fetch reads as empty, not eternal loading.
        if (!cancelled) setElementsResult({ key: scopeKey, map: new Map() });
      });
    return () => { cancelled = true; };
  }, [rootStrategies, scopeKey]);

  // ── Month window ───────────────────────────────────────────
  const [anchorOffset, setAnchorOffset] = useState(0); // in months
  const windowStart = useMemo(() => {
    const t = new Date();
    return new Date(t.getFullYear(), t.getMonth() - PAST_MONTHS + anchorOffset, 1);
  }, [anchorOffset]);

  const months = useMemo(() => {
    const arr: { label: string; x: number; w: number }[] = [];
    let x = 0;
    for (let i = 0; i < VISIBLE_MONTHS; i++) {
      const d = new Date(windowStart.getFullYear(), windowStart.getMonth() + i, 1);
      const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      const w = daysInMonth * DAY_W;
      // Year tag on the first visible month and on every January so long
      // scrolls stay oriented.
      const label = (i === 0 || d.getMonth() === 0)
        ? d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
        : d.toLocaleDateString('en-US', { month: 'short' });
      arr.push({ label, x, w });
      x += w;
    }
    return arr;
  }, [windowStart]);

  const totalW = useMemo(() => months.reduce((s, m) => s + m.w, 0), [months]);
  const windowEnd = useMemo(
    () => new Date(windowStart.getFullYear(), windowStart.getMonth() + VISIBLE_MONTHS, 0),
    [windowStart],
  );

  const todayX = useMemo(() => {
    const t = stripTime(new Date());
    if (t < windowStart || t > windowEnd) return null;
    return daysBetween(windowStart, t) * DAY_W + DAY_W / 2;
  }, [windowStart, windowEnd]);

  // ── Rows: span + progress per Initiative, grouped by quarter ─
  type InitiativeRow = {
    strategy: StrategyWithObjects;
    range: DateRange | null;
    progress: number; // 0-100
    objects: { obj: AlconObject; range: DateRange | null }[];
  };

  const groups = useMemo(() => {
    const rows: InitiativeRow[] = rootStrategies.map((s) => {
      const els = elementsByStrategy.get(s.id) ?? [];
      const elsByObject = new Map<string, ElementWithDetails[]>();
      for (const el of els) {
        const ids = el.objectIds ?? (el.object_id ? [el.object_id] : []);
        for (const oid of ids) {
          if (!elsByObject.has(oid)) elsByObject.set(oid, []);
          elsByObject.get(oid)!.push(el);
        }
      }
      const objects = s.objectIds
        .map((oid) => objectsById.get(oid))
        .filter((o): o is AlconObject => !!o)
        .map((obj) => ({ obj, range: objectRange(obj, elsByObject.get(obj.id) ?? []) }));
      const range = unionRanges(objects.map((o) => o.range));
      const progress = completionOf(els).pct;
      return { strategy: s, range, progress, objects };
    });

    // Bucket by the quarter each Initiative lands in (its end date);
    // undated Initiatives go to a trailing "Upcoming" bucket.
    const byQuarter = new Map<string, { label: string; order: number; rows: InitiativeRow[] }>();
    for (const row of rows) {
      const key = row.range ? quarterKey(row.range.end) : 'upcoming';
      if (!byQuarter.has(key)) {
        byQuarter.set(key, {
          label: row.range ? quarterLabel(row.range.end) : 'Upcoming',
          order: row.range ? row.range.end.getFullYear() * 4 + quarterOf(row.range.end) : Infinity,
          rows: [],
        });
      }
      byQuarter.get(key)!.rows.push(row);
    }
    const out = Array.from(byQuarter.entries()).map(([key, g]) => ({ key, ...g }));
    out.sort((a, b) => a.order - b.order);
    for (const g of out) {
      g.rows.sort((a, b) => {
        if (!a.range) return 1;
        if (!b.range) return -1;
        return a.range.start.getTime() - b.range.start.getTime();
      });
    }
    return out;
  }, [rootStrategies, elementsByStrategy, objectsById]);

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleIn = (set: Set<string>, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };

  const loading = strategiesLoading || elementsLoading;

  return (
    <div className="flex flex-col h-full bg-card">
      {/* Top bar — mirrors the other Strategy-layer surfaces */}
      <div className="h-[50px] flex items-center gap-1.5 pl-4 pr-2 border-b border-border/60 bg-card flex-shrink-0">
        <NavTimelineIcon size={12} />
        <span className="text-[12px] font-semibold text-foreground">Timeline</span>
        <span className="text-[11px] text-muted-foreground ml-1">
          {loading ? 'Loading…' : `${rootStrategies.length} initiative${rootStrategies.length === 1 ? '' : 's'}`}
        </span>
        <div className="flex-1" />
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setAnchorOffset((o) => o - 1)}
            className="w-[24px] h-[24px] rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40 flex items-center justify-center"
            title="Back one month"
            aria-label="Back one month"
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
            onClick={() => setAnchorOffset((o) => o + 1)}
            className="w-[24px] h-[24px] rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40 flex items-center justify-center"
            title="Forward one month"
            aria-label="Forward one month"
          >
            <ChevronRight size={13} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {!loading && rootStrategies.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-6 gap-3">
            <NavTimelineIcon size={28} />
            <p className="text-[13px] text-muted-foreground max-w-md">
              No Initiatives yet. Create one in the Initiative view and give its
              Objects start / due dates to see them on the timeline.
            </p>
          </div>
        ) : (
          <div className="min-w-fit">
            {/* Month axis */}
            <div
              className="sticky top-0 z-20 bg-card border-b border-border/60"
              style={{ paddingLeft: LEFT_COL_W }}
            >
              <div className="relative" style={{ width: totalW, height: MONTH_HEADER_H }}>
                {months.map((m, i) => (
                  <div
                    key={i}
                    className="absolute top-0 bottom-0 flex items-center px-2 text-[11px] text-muted-foreground font-medium border-l border-border/30 first:border-l-0"
                    style={{ left: m.x, width: m.w }}
                  >
                    {m.label}
                  </div>
                ))}
                {todayX !== null && (
                  <div
                    className="absolute top-1.5 w-1.5 h-1.5 rounded-full bg-[var(--accent-default)]"
                    style={{ left: todayX - 3 }}
                  />
                )}
              </div>
            </div>

            {groups.map((g) => (
              <Fragment key={g.key}>
                {/* Quarter group header */}
                <div className="flex items-stretch border-b border-border/30" style={{ height: GROUP_ROW_H }}>
                  <button
                    type="button"
                    onClick={() => setCollapsed((prev) => toggleIn(prev, g.key))}
                    aria-expanded={!collapsed.has(g.key)}
                    className="sticky left-0 z-[1] bg-card flex items-center gap-1.5 pl-2 pr-3 border-r border-border/40 flex-shrink-0 text-left hover:bg-muted/20 transition-colors"
                    style={{ width: LEFT_COL_W }}
                  >
                    <span
                      className={`w-4 h-4 flex items-center justify-center text-muted-foreground transition-transform ${
                        collapsed.has(g.key) ? '-rotate-90' : 'rotate-0'
                      }`}
                    >
                      <ChevronDown size={12} />
                    </span>
                    <span className="text-[12px] font-semibold text-foreground">{g.label}</span>
                    <span className="text-[11px] text-muted-foreground tabular-nums">{g.rows.length}</span>
                  </button>
                  <GridCell totalW={totalW} height={GROUP_ROW_H} months={months} todayX={todayX} tinted />
                </div>

                {!collapsed.has(g.key) && g.rows.map((row) => (
                  <Fragment key={row.strategy.id}>
                    <InitiativeTimelineRow
                      row={row}
                      months={months}
                      totalW={totalW}
                      todayX={todayX}
                      windowStart={windowStart}
                      windowEnd={windowEnd}
                      isOpen={expanded.has(row.strategy.id)}
                      onToggle={() => setExpanded((prev) => toggleIn(prev, row.strategy.id))}
                      onOpen={() => onSelectStrategy?.(row.strategy.id)}
                    />
                    {expanded.has(row.strategy.id) && row.objects.map(({ obj, range }) => (
                      <ObjectTimelineRow
                        key={obj.id}
                        obj={obj}
                        range={range}
                        months={months}
                        totalW={totalW}
                        todayX={todayX}
                        windowStart={windowStart}
                        windowEnd={windowEnd}
                        onOpen={() => onOpenObject?.(obj.id, obj.domain_id)}
                      />
                    ))}
                    {expanded.has(row.strategy.id) && row.objects.length === 0 && (
                      <div className="flex items-stretch border-b border-border/20 bg-muted/5" style={{ height: OBJECT_ROW_H }}>
                        <div
                          className="sticky left-0 z-[1] bg-card flex items-center text-[11px] text-muted-foreground italic border-r border-border/30 flex-shrink-0"
                          style={{ width: LEFT_COL_W, paddingLeft: 36 }}
                        >
                          No Objects in this Initiative yet
                        </div>
                        <div className="flex-shrink-0" style={{ width: totalW }} />
                      </div>
                    )}
                  </Fragment>
                ))}
              </Fragment>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// =============================================================
// Initiative row — rounded band with a progress fill inside
// =============================================================
function InitiativeTimelineRow({
  row,
  months,
  totalW,
  todayX,
  windowStart,
  windowEnd,
  isOpen,
  onToggle,
  onOpen,
}: {
  row: {
    strategy: StrategyWithObjects;
    range: DateRange | null;
    progress: number;
    objects: { obj: AlconObject; range: DateRange | null }[];
  };
  months: { x: number; w: number }[];
  totalW: number;
  todayX: number | null;
  windowStart: Date;
  windowEnd: Date;
  isOpen: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const { strategy, range, progress } = row;
  const bar = range ? rangeToBar(range, windowStart, windowEnd) : null;
  const color = strategy.color ?? 'var(--accent-default)';

  return (
    <div className="flex items-stretch border-b border-border/30 group/row" style={{ height: INITIATIVE_ROW_H }}>
      <div
        className="sticky left-0 z-[1] bg-card flex items-center gap-1.5 pl-2 pr-3 border-r border-border/40 flex-shrink-0"
        style={{ width: LEFT_COL_W }}
      >
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={isOpen}
          aria-label={isOpen ? 'Collapse objects' : 'Expand objects'}
          className="w-4 h-4 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
        >
          {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        <span className="flex-shrink-0" style={{ color }}>
          <NavStrategyIcon size={13} />
        </span>
        <button
          type="button"
          onClick={onOpen}
          className="text-[13px] font-medium text-foreground truncate flex-1 text-left hover:underline underline-offset-2"
          title={strategy.name}
        >
          {strategy.name}
        </button>
        <span className="text-[11px] text-muted-foreground tabular-nums flex-shrink-0">
          {progress}%
        </span>
      </div>

      <div className="relative flex-shrink-0" style={{ width: totalW, height: INITIATIVE_ROW_H }}>
        <GridLines months={months} todayX={todayX} />
        {bar && (
          <div
            className="absolute overflow-hidden rounded-md border border-[var(--timeline-bar-border)] bg-[var(--timeline-bar-fill-bg)]"
            style={{
              left: bar.left,
              width: Math.max(bar.width, 16),
              top: (INITIATIVE_ROW_H - INITIATIVE_BAR_H) / 2,
              height: INITIATIVE_BAR_H,
            }}
          >
            <div
              className="absolute inset-y-0 left-0"
              style={{ width: `${progress}%`, background: color, opacity: 0.35 }}
            />
            <span
              className="absolute left-2 top-1/2 -translate-y-1/2 text-[11px] text-foreground/90 truncate pr-2"
              style={{ maxWidth: Math.max(bar.width - 12, 0) }}
            >
              {strategy.name}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// =============================================================
// Object sub-row — thinner bar on the same axis
// =============================================================
function ObjectTimelineRow({
  obj,
  range,
  months,
  totalW,
  todayX,
  windowStart,
  windowEnd,
  onOpen,
}: {
  obj: AlconObject;
  range: DateRange | null;
  months: { x: number; w: number }[];
  totalW: number;
  todayX: number | null;
  windowStart: Date;
  windowEnd: Date;
  onOpen: () => void;
}) {
  const bar = range ? rangeToBar(range, windowStart, windowEnd) : null;
  const color = obj.color ?? 'var(--accent-default)';

  return (
    <div className="flex items-stretch border-b border-border/20 bg-muted/5 hover:bg-muted/10" style={{ height: OBJECT_ROW_H }}>
      <div
        className="sticky left-0 z-[1] bg-card flex items-center gap-1.5 pr-3 border-r border-border/30 flex-shrink-0"
        style={{ width: LEFT_COL_W, paddingLeft: 24 }}
      >
        <ObjectIcon size={12} />
        <button
          type="button"
          onClick={onOpen}
          className="text-[12px] text-foreground truncate flex-1 text-left hover:underline underline-offset-2"
          title={obj.name}
        >
          {obj.name}
        </button>
      </div>
      <div className="relative flex-shrink-0" style={{ width: totalW, height: OBJECT_ROW_H }}>
        <GridLines months={months} todayX={todayX} />
        {bar ? (
          <div
            className="absolute rounded border border-[var(--timeline-bar-border)]"
            style={{
              left: bar.left,
              width: Math.max(bar.width, 12),
              top: (OBJECT_ROW_H - OBJECT_BAR_H) / 2,
              height: OBJECT_BAR_H,
              background: color,
              opacity: 0.3,
            }}
            title={obj.name}
          />
        ) : (
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground/60 italic">
            No dates
          </span>
        )}
      </div>
    </div>
  );
}

// =============================================================
// Shared grid bits
// =============================================================
function GridLines({ months, todayX }: { months: { x: number; w: number }[]; todayX: number | null }) {
  return (
    <>
      {months.map((m, i) => (
        <div
          key={i}
          className="absolute top-0 bottom-0 border-l border-border/20 first:border-l-0"
          style={{ left: m.x }}
        />
      ))}
      {todayX !== null && (
        <div
          className="absolute top-0 bottom-0 border-l border-[var(--accent-default)]/40"
          style={{ left: todayX }}
        />
      )}
    </>
  );
}

function GridCell({
  totalW,
  height,
  months,
  todayX,
  tinted,
}: {
  totalW: number;
  height: number;
  months: { x: number; w: number }[];
  todayX: number | null;
  tinted?: boolean;
}) {
  return (
    <div
      className={`relative flex-shrink-0 ${tinted ? 'bg-muted/10' : ''}`}
      style={{ width: totalW, height }}
    >
      <GridLines months={months} todayX={todayX} />
    </div>
  );
}

// =============================================================
// Date helpers
// =============================================================
function stripTime(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / DAY_MS);
}

function quarterOf(d: Date): number {
  return Math.floor(d.getMonth() / 3) + 1;
}

function quarterKey(d: Date): string {
  return `${d.getFullYear()}-q${quarterOf(d)}`;
}

function quarterLabel(d: Date): string {
  return `Q${quarterOf(d)} ${d.getFullYear()}`;
}

/** An Object's span: its own start/due dates, falling back to the union
 *  of its Elements' dates when it has none of its own. */
function objectRange(obj: AlconObject, elements: ElementWithDetails[]): DateRange | null {
  const s = obj.start_date ? stripTime(new Date(obj.start_date)) : null;
  const d = obj.due_date ? stripTime(new Date(obj.due_date)) : null;
  if (s || d) return { start: s ?? d!, end: d ?? s! };
  let min: Date | null = null;
  let max: Date | null = null;
  for (const el of elements) {
    const es = el.start_date ? stripTime(new Date(el.start_date)) : null;
    const ed = el.due_date ? stripTime(new Date(el.due_date)) : null;
    const lo = es ?? ed;
    const hi = ed ?? es;
    if (lo && (!min || lo < min)) min = lo;
    if (hi && (!max || hi > max)) max = hi;
  }
  if (!min || !max) return null;
  return { start: min, end: max };
}

function unionRanges(ranges: (DateRange | null)[]): DateRange | null {
  let min: Date | null = null;
  let max: Date | null = null;
  for (const r of ranges) {
    if (!r) continue;
    if (!min || r.start < min) min = r.start;
    if (!max || r.end > max) max = r.end;
  }
  if (!min || !max) return null;
  return { start: min, end: max };
}

function rangeToBar(
  range: DateRange,
  windowStart: Date,
  windowEnd: Date,
): { left: number; width: number } | null {
  if (range.end < windowStart || range.start > windowEnd) return null;
  const start = range.start < windowStart ? windowStart : range.start;
  const end = range.end > windowEnd ? windowEnd : range.end;
  const left = daysBetween(windowStart, start) * DAY_W;
  const width = (daysBetween(start, end) + 1) * DAY_W;
  return { left, width };
}
