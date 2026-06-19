'use client';

import React, { useState, useMemo, useRef, useEffect, useCallback, type ReactNode } from 'react';
import type { ElementWithDetails } from '@/hooks/useSupabase';
import type { AlconObjectWithChildren } from '@/types/database';
import { updateElement } from '@/hooks/useSupabase';
import { ChevronRight, ChevronDown, CalendarDays, ZoomIn, ZoomOut } from 'lucide-react';
import { ObjectIcon } from '@/shell/icons';
import { SEMANTIC_COLORS, STATUS } from '@/shared/designTokens';

/** Pre-grouped band (e.g. ElementsListView's Domain / per-Object
 *  sections). When provided it wins over the legacy `object`-tree grouping. */
export interface GanttSection {
  id: string;
  name: string | null;
  icon?: ReactNode;
  elements?: ElementWithDetails[];
}

interface GanttViewProps {
  elements: ElementWithDetails[];
  object?: AlconObjectWithChildren;
  sections?: GanttSection[];
  onRefresh?: () => void;
  /** Left-pane header label. Defaults to "Elements" — caller passes
   *  "Objects" when feeding Object-shaped bars (Domain Objects-tab Gantt). */
  leftHeaderLabel?: string;
  /** Persistence override for drag-to-move / drag-to-resize / drag-to-schedule.
   *  Default = updateElement (Element bars). The Domain Objects-tab Gantt
   *  passes updateObject here so dragging an Object bar writes
   *  objects.start_date / objects.due_date instead. */
  onItemUpdate?: (id: string, updates: { start_date?: string | null; due_date?: string | null }) => Promise<unknown>;
}

type ZoomLevel = 'day' | 'week' | 'month' | 'quarter';

// One shared horizontal scale: pixels per day. Headers, grid, bars, the
// today-line and drag math all derive from this so every zoom level stays
// aligned (the old per-zoom "column = 1 unit" header drifted off the bars).
const PX_PER_DAY: Record<ZoomLevel, number> = { day: 40, week: 12, month: 4.5, quarter: 2 };

const WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

// ---- date-only helpers (local midnight, immune to TZ off-by-one) ----

function parseDateOnly(value: string | null | undefined): Date | null {
  if (!value) return null;
  const [y, m, d] = value.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  const date = new Date(y, m - 1, d);
  return Number.isNaN(date.getTime()) ? null : date;
}

function fmtDateOnly(date: Date): string {
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${m}-${d}`;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

/** Whole days from a to b — both are local-midnight dates so this is exact. */
function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

function formatDate(date: Date, format: 'short' | 'full' | 'pill' = 'short'): string {
  if (format === 'full') {
    return date.toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' });
  }
  if (format === 'pill') {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  return date.toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' });
}

// Visible horizon per zoom — the range is data-driven but never narrower
// than today−back … today+ahead, so coarse zooms (month / quarter) always
// show future runway instead of collapsing to the few dated elements.
const RANGE_HORIZON: Record<ZoomLevel, { back: number; ahead: number; pad: number }> = {
  day: { back: 7, ahead: 30, pad: 7 },
  week: { back: 28, ahead: 120, pad: 14 },
  month: { back: 90, ahead: 365, pad: 30 },
  quarter: { back: 180, ahead: 730, pad: 90 },
};

function getDateRange(elements: ElementWithDetails[], zoom: ZoomLevel): { start: Date; end: Date } {
  const today = startOfDay(new Date());
  const horizon = RANGE_HORIZON[zoom];
  let minDate = today;
  let maxDate = today;

  elements.forEach((el) => {
    for (const raw of [el.start_date, el.due_date]) {
      const d = parseDateOnly(raw);
      if (!d) continue;
      if (d < minDate) minDate = d;
      if (d > maxDate) maxDate = d;
    }
  });

  const start = addDays(minDate, -horizon.pad);
  const end = addDays(maxDate, horizon.pad);
  const floorStart = addDays(today, -horizon.back);
  const ceilEnd = addDays(today, horizon.ahead);
  return {
    start: start < floorStart ? start : floorStart,
    end: end > ceilEnd ? end : ceilEnd,
  };
}

// ---- two-tier timeline header ----

interface HeaderSpan { label: string; days: number }
interface HeaderUnit {
  label: string;
  sub?: string;
  days: number;
  startDay: number;
  isWeekend?: boolean;
  isToday?: boolean;
}

/** Tier 1 — context band. Months for day/week zoom, years for month/quarter. */
function buildHeaderSpans(start: Date, totalDays: number, zoom: ZoomLevel): HeaderSpan[] {
  const spans: HeaderSpan[] = [];
  let cursor = 0;
  while (cursor < totalDays) {
    const date = addDays(start, cursor);
    let next: Date;
    let label: string;
    if (zoom === 'day' || zoom === 'week') {
      next = new Date(date.getFullYear(), date.getMonth() + 1, 1);
      label = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    } else {
      next = new Date(date.getFullYear() + 1, 0, 1);
      label = String(date.getFullYear());
    }
    const days = Math.min(daysBetween(date, next), totalDays - cursor);
    spans.push({ label, days });
    cursor += days;
  }
  return spans;
}

/** Tier 2 — unit cells. Day numbers / week starts / months / quarters. */
function buildHeaderUnits(start: Date, totalDays: number, zoom: ZoomLevel): HeaderUnit[] {
  const units: HeaderUnit[] = [];
  const today = startOfDay(new Date());
  let cursor = 0;
  while (cursor < totalDays) {
    const date = addDays(start, cursor);
    if (zoom === 'day') {
      units.push({
        label: String(date.getDate()),
        sub: WEEKDAY_INITIALS[date.getDay()],
        days: 1,
        startDay: cursor,
        isWeekend: date.getDay() === 0 || date.getDay() === 6,
        isToday: daysBetween(date, today) === 0,
      });
      cursor += 1;
    } else if (zoom === 'week') {
      const days = Math.min(7, totalDays - cursor);
      units.push({ label: formatDate(date, 'pill'), days, startDay: cursor });
      cursor += days;
    } else if (zoom === 'month') {
      const next = new Date(date.getFullYear(), date.getMonth() + 1, 1);
      const days = Math.min(daysBetween(date, next), totalDays - cursor);
      units.push({
        label: date.toLocaleDateString('en-US', { month: 'short' }),
        days,
        startDay: cursor,
      });
      cursor += days;
    } else {
      const q = Math.floor(date.getMonth() / 3);
      const next = new Date(date.getFullYear(), (q + 1) * 3, 1);
      const days = Math.min(daysBetween(date, next), totalDays - cursor);
      units.push({ label: `Q${q + 1}`, days, startDay: cursor });
      cursor += days;
    }
  }
  return units;
}

// Status colors for Gantt bars (inline hex from design tokens)
const statusBarColors: Record<string, string> = SEMANTIC_COLORS.status;

// Status labels for tooltip display
const statusLabels: Record<string, string> = Object.fromEntries(
  Object.entries(STATUS).map(([key, val]) => [key, val.label])
);

const ROW_H = 36;
const SECTION_HEADER_H = 32;
const SECTION_GAP = 8;
const HEADER_TIER1_H = 20;
const HEADER_TIER2_H = 28;

// Continuous zoom multiplier applied on top of the preset px/day. The
// magnifier +/− steps through it; clamped so bars stay usable.
const ZOOM_MIN = 0.35;
const ZOOM_MAX = 4;
const ZOOM_STEP = 1.25;

export function GanttView({
  elements,
  object,
  sections,
  onRefresh,
  leftHeaderLabel = 'Elements',
  onItemUpdate,
}: GanttViewProps) {
  // Bars persist their dates through this callback. Defaults to updateElement
  // for the Element Gantt; the Domain Objects-tab Gantt overrides it with
  // updateObject so dragging an Object bar writes objects.start_date /
  // objects.due_date. Wrapped in useCallback so the drag effects' deps stay
  // stable (otherwise every parent render would re-attach window listeners).
  const persistDates = useCallback(
    (id: string, u: { start_date?: string | null; due_date?: string | null }) =>
      onItemUpdate ? onItemUpdate(id, u) : updateElement(id, u),
    [onItemUpdate],
  );
  const [zoom, setZoom] = useState<ZoomLevel>('day');
  const [zoomScale, setZoomScale] = useState(1);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [selectedElement, setSelectedElement] = useState<string | null>(null);
  const [dragging, setDragging] = useState<{ elementId: string; type: 'move' | 'resize-start' | 'resize-end'; startX: number; originalStart: Date | null; originalEnd: Date | null } | null>(null);
  const [dragDaysDelta, setDragDaysDelta] = useState(0);
  // Drag-to-schedule an undated row: anchor day + current day while dragging
  // across its empty lane. laneLeft is the lane's viewport x at mousedown.
  const [creating, setCreating] = useState<{ elementId: string; anchorDay: number; currentDay: number; laneLeft: number } | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; element: ElementWithDetails } | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const bodyScrollRef = useRef<HTMLDivElement>(null);
  const leftListRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const pxPerDay = PX_PER_DAY[zoom] * zoomScale;
  const zoomBy = (factor: number) =>
    setZoomScale((s) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, s * factor)));

  // Calculate date range
  const dateRange = useMemo(() => getDateRange(elements, zoom), [elements, zoom]);
  const totalDays = daysBetween(dateRange.start, dateRange.end);
  const timelineWidth = totalDays * pxPerDay;

  const headerSpans = useMemo(
    () => buildHeaderSpans(dateRange.start, totalDays, zoom),
    [dateRange.start, totalDays, zoom]
  );
  const headerUnits = useMemo(
    () => buildHeaderUnits(dateRange.start, totalDays, zoom),
    [dateRange.start, totalDays, zoom]
  );

  // Build object_id → name mapping from the object tree (legacy grouping)
  const objectNameMap = useMemo(() => {
    const map = new Map<string, string>();
    const traverse = (obj: AlconObjectWithChildren) => {
      map.set(obj.id, obj.name);
      obj.children?.forEach(traverse);
    };
    if (object) traverse(object);
    return map;
  }, [object]);

  // Bands: explicit `sections` prop when given (keeps the caller's order and
  // names, e.g. Domain / Phase 1 / Phase 2), else group by parent Object name.
  const elementsBySection = useMemo(() => {
    if (sections) {
      return sections
        .filter((s) => (s.elements?.length ?? 0) > 0)
        .map((s) => ({ key: s.id, name: s.name || null, icon: s.icon, elements: s.elements ?? [] }));
    }
    const sectionMap = new Map<string | null, ElementWithDetails[]>();
    elements.forEach((el) => {
      const key = el.object_id ? objectNameMap.get(el.object_id) ?? null : null;
      if (!sectionMap.has(key)) sectionMap.set(key, []);
      sectionMap.get(key)!.push(el);
    });
    return Array.from(sectionMap.entries()).map(([name, els]) => ({
      key: name ?? '__no_section__',
      name,
      icon: undefined as ReactNode,
      elements: els,
    }));
  }, [sections, elements, objectNameMap]);

  // Compute vertical layout: precompute top-offsets per element id
  const layout = useMemo(() => {
    const tops = new Map<string, number>();
    const sectionTops = new Map<string, number>(); // section key → top
    let y = 0;
    elementsBySection.forEach(({ key, name, elements: sectionElements }) => {
      if (name) {
        sectionTops.set(key, y);
        y += SECTION_HEADER_H;
      }
      const isCollapsed = collapsedSections.has(key);
      if (!isCollapsed) {
        sectionElements.forEach(el => {
          tops.set(el.id, y);
          y += ROW_H;
        });
      }
      y += SECTION_GAP;
    });
    return { tops, sectionTops, totalHeight: y };
  }, [elementsBySection, collapsedSections]);

  // Calculate position for an Element bar (with drag offset applied)
  const getBarPosition = useCallback((element: ElementWithDetails): { left: number; width: number } | null => {
    let startDate = parseDateOnly(element.start_date);
    let endDate = parseDateOnly(element.due_date);

    if (!startDate && !endDate) return null;

    // Apply drag offset for the element being dragged
    if (dragging && dragging.elementId === element.id && dragDaysDelta !== 0) {
      if (dragging.type === 'move') {
        if (startDate) startDate = addDays(startDate, dragDaysDelta);
        if (endDate) endDate = addDays(endDate, dragDaysDelta);
      } else if (dragging.type === 'resize-start' && startDate) {
        startDate = addDays(startDate, dragDaysDelta);
      } else if (dragging.type === 'resize-end' && endDate) {
        endDate = addDays(endDate, dragDaysDelta);
      }
    }

    const effectiveStart = startDate ?? endDate!;
    const effectiveEnd = endDate ?? startDate!;

    const daysFromStart = daysBetween(dateRange.start, effectiveStart);
    // Due date is inclusive: a same-day bar still occupies one full day cell.
    const duration = Math.max(1, daysBetween(effectiveStart, effectiveEnd) + 1);

    return {
      left: daysFromStart * pxPerDay,
      width: duration * pxPerDay,
    };
  }, [dateRange.start, pxPerDay, dragging, dragDaysDelta]);

  // Handle drag start
  const handleDragStart = (e: React.MouseEvent, elementId: string, type: 'move' | 'resize-start' | 'resize-end') => {
    e.preventDefault();
    e.stopPropagation();

    const element = elements.find(el => el.id === elementId);
    if (!element) return;

    setDragging({
      elementId,
      type,
      startX: e.clientX,
      originalStart: parseDateOnly(element.start_date),
      originalEnd: parseDateOnly(element.due_date),
    });
  };

  // Handle drag move and mouse up
  useEffect(() => {
    if (!dragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - dragging.startX;
      const delta = Math.round(deltaX / pxPerDay);
      setDragDaysDelta(delta);
    };

    const handleMouseUp = async (e: MouseEvent) => {
      if (!dragging) return;

      const deltaX = e.clientX - dragging.startX;
      const daysDelta = Math.round(deltaX / pxPerDay);

      if (daysDelta !== 0) {
        // Calculate final dates
        let newStartDate = dragging.originalStart ? new Date(dragging.originalStart) : null;
        let newEndDate = dragging.originalEnd ? new Date(dragging.originalEnd) : null;

        if (dragging.type === 'move') {
          if (newStartDate) newStartDate = addDays(newStartDate, daysDelta);
          if (newEndDate) newEndDate = addDays(newEndDate, daysDelta);
        } else if (dragging.type === 'resize-start' && newStartDate) {
          newStartDate = addDays(newStartDate, daysDelta);
        } else if (dragging.type === 'resize-end' && newEndDate) {
          newEndDate = addDays(newEndDate, daysDelta);
        }

        // Save to database
        try {
          const updates: { start_date?: string; due_date?: string } = {};
          if (newStartDate) updates.start_date = fmtDateOnly(newStartDate);
          if (newEndDate) updates.due_date = fmtDateOnly(newEndDate);

          if (Object.keys(updates).length > 0) {
            await persistDates(dragging.elementId, updates);
            onRefresh?.();
          }
        } catch (error) {
          console.error('Failed to update element dates:', error);
        }
      }

      setDragging(null);
      setDragDaysDelta(0);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragging, pxPerDay, onRefresh, persistDates]);

  // Drag-to-schedule: track the pointer while sweeping an undated row's lane,
  // then persist [min, max] as start/due on release (single day → due only).
  useEffect(() => {
    if (!creating) return;

    const dayAtX = (clientX: number) => {
      const day = Math.floor((clientX - creating.laneLeft) / pxPerDay);
      return Math.max(0, Math.min(totalDays - 1, day));
    };

    const handleMouseMove = (e: MouseEvent) => {
      const day = dayAtX(e.clientX);
      setCreating((prev) => (prev ? { ...prev, currentDay: day } : prev));
    };

    const handleMouseUp = async (e: MouseEvent) => {
      const day = dayAtX(e.clientX);
      const from = Math.min(creating.anchorDay, day);
      const to = Math.max(creating.anchorDay, day);
      const startDate = addDays(dateRange.start, from);
      const dueDate = addDays(dateRange.start, to);
      try {
        await persistDates(
          creating.elementId,
          from === to
            ? { due_date: fmtDateOnly(dueDate) }
            : { start_date: fmtDateOnly(startDate), due_date: fmtDateOnly(dueDate) }
        );
        onRefresh?.();
      } catch (error) {
        console.error('Failed to schedule item:', error);
      }
      setCreating(null);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [creating, pxPerDay, totalDays, dateRange.start, onRefresh, persistDates]);

  const scrollToToday = useCallback((smooth: boolean) => {
    const daysFromStart = daysBetween(dateRange.start, startOfDay(new Date()));
    const containerW = containerRef.current?.clientWidth ?? 0;
    const scrollPosition = (daysFromStart * pxPerDay) - (containerW / 2);
    const target = Math.max(0, scrollPosition);
    if (bodyScrollRef.current) {
      bodyScrollRef.current.scrollTo({ left: target, behavior: smooth ? 'smooth' : 'auto' });
    }
    if (timelineRef.current) {
      timelineRef.current.scrollLeft = target;
    }
  }, [dateRange.start, pxPerDay]);

  // Scroll to today on mount
  useEffect(() => {
    scrollToToday(false);
  }, [scrollToToday]);

  // Find dependencies for drawing arrows
  const getDependencies = (element: ElementWithDetails): ElementWithDetails[] => {
    const deps: ElementWithDetails[] = [];
    if (element.edges?.incoming) {
      element.edges.incoming
        .filter(edge => edge.edge_type === 'depends_on')
        .forEach(edge => {
          const depElement = elements.find(el => el.id === edge.from_element);
          if (depElement) deps.push(depElement);
        });
    }
    return deps;
  };

  const toggleSection = (key: string) => {
    const next = new Set(collapsedSections);
    if (next.has(key)) next.delete(key); else next.add(key);
    setCollapsedSections(next);
  };

  const todayStr = formatDate(new Date(), 'pill');

  /** Compact "Jun 8 – Jun 19" range text for the left row (— when undated). */
  const rowDateLabel = (el: ElementWithDetails): string | null => {
    const s = parseDateOnly(el.start_date);
    const d = parseDateOnly(el.due_date);
    if (!s && !d) return null;
    if (s && d && daysBetween(s, d) !== 0) return `${formatDate(s, 'pill')} – ${formatDate(d, 'pill')}`;
    return formatDate((d ?? s)!, 'pill');
  };

  return (
    <div className="flex flex-col h-full bg-card">
      {/* Sticky Toolbar */}
      <div className="sticky top-0 z-30 flex items-center justify-between px-4 py-2.5 border-b border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-foreground">Timeline</span>
          {object?.name && (
            <span className="text-xs text-muted-foreground">{object.name}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Magnifier zoom — continuous in/out on top of the preset scale. */}
          <div className="flex items-center bg-muted/50 rounded-md p-0.5">
            <button
              onClick={() => zoomBy(1 / ZOOM_STEP)}
              disabled={zoomScale <= ZOOM_MIN + 1e-6}
              title="Zoom out"
              aria-label="Zoom out"
              className="w-7 h-6 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 disabled:pointer-events-none transition-colors"
            >
              <ZoomOut size={14} />
            </button>
            <button
              onClick={() => setZoomScale(1)}
              title="Reset zoom"
              className="px-1.5 h-6 inline-flex items-center justify-center text-[10px] font-medium tabular-nums text-muted-foreground hover:text-foreground rounded transition-colors min-w-[34px]"
            >
              {Math.round(zoomScale * 100)}%
            </button>
            <button
              onClick={() => zoomBy(ZOOM_STEP)}
              disabled={zoomScale >= ZOOM_MAX - 1e-6}
              title="Zoom in"
              aria-label="Zoom in"
              className="w-7 h-6 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 disabled:pointer-events-none transition-colors"
            >
              <ZoomIn size={14} />
            </button>
          </div>
          {/* Segmented zoom presets */}
          <div className="flex items-center bg-muted/50 rounded-md p-0.5">
            {(['day', 'week', 'month', 'quarter'] as ZoomLevel[]).map(z => (
              <button
                key={z}
                onClick={() => setZoom(z)}
                className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors ${
                  zoom === z
                    ? 'bg-foreground text-background shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {z === 'day' ? 'Day' : z === 'week' ? 'Week' : z === 'month' ? 'Month' : 'Quarter'}
              </button>
            ))}
          </div>
          <button
            onClick={() => scrollToToday(true)}
            className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium text-foreground bg-muted/50 hover:bg-muted rounded-md transition-colors"
          >
            <CalendarDays size={13} />
            Today
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden" ref={containerRef}>
        {/* Left panel — Element list */}
        <div className="w-64 min-w-64 border-r border-border flex flex-col bg-card">
          {/* Header */}
          <div className="flex items-center px-3 border-b border-border bg-muted/20" style={{ height: HEADER_TIER1_H + HEADER_TIER2_H }}>
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">{leftHeaderLabel}</span>
          </div>

          {/* Element list — vertical scroll kept in lock-step with the
              timeline body so rows and bars never drift apart. */}
          <div
            ref={leftListRef}
            // Scrollable but with no visible scrollbar — the timeline body's
            // scrollbar is the single control; this list is synced to it.
            className="flex-1 overflow-y-auto [&::-webkit-scrollbar]:hidden"
            style={{ scrollbarWidth: 'none' }}
            onScroll={(e) => {
              const b = bodyScrollRef.current;
              if (b && b.scrollTop !== e.currentTarget.scrollTop) b.scrollTop = e.currentTarget.scrollTop;
            }}
          >
            {elementsBySection.map(({ key, name, icon, elements: sectionElements }) => {
              const isCollapsed = collapsedSections.has(key);

              return (
                <div key={key}>
                  {/* Section header */}
                  {name && (
                    <button
                      onClick={() => toggleSection(key)}
                      className="w-full flex items-center gap-1.5 px-2.5 h-8 text-left bg-muted/40 hover:bg-muted/60 border-b border-border/60 transition-colors group"
                      title={isCollapsed ? 'Expand' : 'Collapse'}
                    >
                      <span className="w-3.5 h-3.5 flex items-center justify-center text-muted-foreground/70 group-hover:text-foreground transition-colors">
                        {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                      </span>
                      <span className="w-3.5 h-3.5 flex items-center justify-center text-muted-foreground shrink-0">
                        {icon ?? <ObjectIcon size={12} />}
                      </span>
                      <span className="text-[12px] font-medium text-foreground truncate flex-1">{name}</span>
                      <span className="text-[10px] font-medium text-muted-foreground tabular-nums shrink-0 px-1.5 py-px rounded-full bg-card/80 border border-border/40">
                        {sectionElements.length}
                      </span>
                    </button>
                  )}

                  {/* Elements */}
                  {!isCollapsed && sectionElements.map((element) => {
                    const isDone = element.status === 'done';
                    const dateLabel = rowDateLabel(element);
                    return (
                      <div
                        key={element.id}
                        onClick={() => setSelectedElement(selectedElement === element.id ? null : element.id)}
                        className={`flex items-center gap-2 px-3 border-b border-border/40 cursor-pointer transition-colors ${
                          selectedElement === element.id ? 'bg-primary/10' : 'hover:bg-muted/30'
                        }`}
                        style={{ height: ROW_H }}
                      >
                        <div
                          className="w-2 h-2 rounded-full flex-shrink-0"
                          style={{ backgroundColor: statusBarColors[element.status || 'todo'] ?? '#A3A3A3' }}
                        />
                        <span className={`text-xs truncate flex-1 ${isDone ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
                          {element.title}
                        </span>
                        <span className="text-[10px] text-muted-foreground/70 tabular-nums shrink-0">
                          {dateLabel ?? '—'}
                        </span>
                      </div>
                    );
                  })}
                  {/* Always reserve SECTION_GAP so the left rows line up with
                      the bars on the right (layout adds it unconditionally). */}
                  <div style={{ height: SECTION_GAP }} />
                </div>
              );
            })}
          </div>
        </div>

        {/* Right panel - Timeline */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {/* Timeline header — tier 1: month/year context band, tier 2: units */}
          <div
            className="border-b border-border overflow-x-hidden bg-muted/20"
            ref={timelineRef}
            style={{ scrollbarWidth: 'none', height: HEADER_TIER1_H + HEADER_TIER2_H }}
          >
            <div style={{ width: timelineWidth }}>
              <div className="flex" style={{ height: HEADER_TIER1_H }}>
                {headerSpans.map((span, idx) => (
                  <div
                    key={idx}
                    className="flex-shrink-0 flex items-center border-r border-border/60 overflow-hidden"
                    style={{ width: span.days * pxPerDay }}
                  >
                    <span className="sticky left-0 px-2 text-[10px] font-semibold text-muted-foreground whitespace-nowrap">
                      {span.label}
                    </span>
                  </div>
                ))}
              </div>
              <div className="flex border-t border-border/40" style={{ height: HEADER_TIER2_H }}>
                {headerUnits.map((unit, idx) => (
                  <div
                    key={idx}
                    className={`flex-shrink-0 flex flex-col items-center justify-center border-r border-border/40 leading-none ${
                      unit.isWeekend && !unit.isToday ? 'bg-muted/40' : ''
                    }`}
                    style={{ width: unit.days * pxPerDay }}
                  >
                    {zoom === 'day' ? (
                      <>
                        <span className={`text-[9px] mb-0.5 ${unit.isToday ? 'text-red-500 font-semibold' : 'text-muted-foreground/70'}`}>
                          {unit.sub}
                        </span>
                        {unit.isToday ? (
                          <span className="w-[18px] h-[18px] rounded-full bg-red-500 text-white text-[11px] font-semibold flex items-center justify-center">
                            {unit.label}
                          </span>
                        ) : (
                          <span className="text-[11px] font-medium text-foreground/90">{unit.label}</span>
                        )}
                      </>
                    ) : (
                      <span className="text-[11px] font-medium text-foreground/80 whitespace-nowrap px-1 truncate max-w-full">
                        {unit.label}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Timeline body */}
          <div
            ref={bodyScrollRef}
            className="flex-1 overflow-auto"
            onScroll={(e) => {
              const el = e.currentTarget;
              // Horizontal: keep the two-tier header aligned with the bars.
              if (timelineRef.current) timelineRef.current.scrollLeft = el.scrollLeft;
              // Vertical: keep the left Element list in lock-step (set only on
              // change so the two onScroll handlers don't ping-pong).
              const l = leftListRef.current;
              if (l && l.scrollTop !== el.scrollTop) l.scrollTop = el.scrollTop;
            }}
          >
            <div
              className="relative"
              // Fill to at least the scroll viewport so the day grid lines,
              // weekend tints and today-line span the full height — not just
              // down to the last row.
              style={{ width: timelineWidth, minHeight: `max(${Math.max(layout.totalHeight, 100)}px, 100%)` }}
            >
              {/* Grid background — unit boundaries + weekend tint (day zoom) */}
              <div className="absolute inset-0 flex">
                {headerUnits.map((unit, idx) => (
                  <div
                    key={idx}
                    className={`flex-shrink-0 border-r border-border/40 ${
                      unit.isWeekend ? 'bg-muted/20' : ''
                    }`}
                    style={{ width: unit.days * pxPerDay }}
                  />
                ))}
              </div>

              {/* Section row tints */}
              {elementsBySection.map(({ key, name }) => {
                if (!name) return null;
                const top = layout.sectionTops.get(key);
                if (top === undefined) return null;
                return (
                  <div
                    key={`tint-${key}`}
                    className="absolute left-0 right-0 bg-muted/30 pointer-events-none"
                    style={{ top, height: SECTION_HEADER_H, width: timelineWidth }}
                  />
                );
              })}

              {/* Today line with pill label */}
              {(() => {
                const daysFromStart = daysBetween(dateRange.start, startOfDay(new Date()));
                const leftPos = daysFromStart * pxPerDay + (pxPerDay / 2);
                if (leftPos > 0 && leftPos < timelineWidth) {
                  return (
                    <>
                      <div
                        className="absolute top-0 bottom-0 z-10 pointer-events-none"
                        style={{ left: leftPos - 1, width: 2, backgroundColor: 'rgba(239,68,68,0.7)' }}
                      />
                      <div
                        className="absolute z-20 pointer-events-none"
                        style={{ left: leftPos, top: 4, transform: 'translateX(-50%)' }}
                      >
                        <span className="inline-block text-[10px] font-semibold text-white bg-red-500 px-1.5 py-0.5 rounded-full shadow-sm whitespace-nowrap">
                          Today · {todayStr}
                        </span>
                      </div>
                    </>
                  );
                }
                return null;
              })()}

              {/* Element bars + empty-lane schedule targets */}
              {elementsBySection.map(({ key, elements: sectionElements }) => {
                const isCollapsed = collapsedSections.has(key);
                if (isCollapsed) return null;

                return sectionElements.map((element) => {
                  const top = layout.tops.get(element.id);
                  if (top === undefined) return null;

                  const barPos = getBarPosition(element);

                  // Undated row — full-width invisible lane; sweeping it
                  // schedules the element (preview bar while dragging).
                  if (!barPos) {
                    const isCreatingThis = creating?.elementId === element.id;
                    const previewFrom = isCreatingThis ? Math.min(creating.anchorDay, creating.currentDay) : 0;
                    const previewTo = isCreatingThis ? Math.max(creating.anchorDay, creating.currentDay) : 0;
                    return (
                      <div key={element.id}>
                        <div
                          className="absolute cursor-crosshair hover:bg-muted/20 transition-colors"
                          style={{ left: 0, width: timelineWidth, top, height: ROW_H }}
                          title="Drag to schedule"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            const rect = e.currentTarget.getBoundingClientRect();
                            const day = Math.max(0, Math.min(totalDays - 1, Math.floor((e.clientX - rect.left) / pxPerDay)));
                            setCreating({ elementId: element.id, anchorDay: day, currentDay: day, laneLeft: rect.left });
                          }}
                        />
                        {isCreatingThis && (
                          <div
                            className="absolute h-6 rounded-md border-2 border-dashed pointer-events-none z-10"
                            style={{
                              left: previewFrom * pxPerDay,
                              width: Math.max((previewTo - previewFrom + 1) * pxPerDay, 8),
                              top: top + (ROW_H - 24) / 2,
                              borderColor: statusBarColors[element.status || 'todo'] ?? '#A3A3A3',
                              backgroundColor: `${statusBarColors[element.status || 'todo'] ?? '#A3A3A3'}33`,
                            }}
                          />
                        )}
                      </div>
                    );
                  }

                  const barColor = statusBarColors[element.status || 'todo'] ?? '#A3A3A3';
                  const isDraggingThis = dragging?.elementId === element.id;
                  const isDone = element.status === 'done';
                  const isBlocked = element.status === 'blocked';
                  const showLabel = barPos.width > 50;
                  const showDueDate = barPos.width > 100 && element.due_date;

                  return (
                    <div
                      key={element.id}
                      className={`absolute h-6 rounded-md cursor-pointer group ring-1 ring-inset ring-white/10 transition-shadow ${
                        selectedElement === element.id ? 'ring-2 ring-primary ring-offset-1 ring-offset-background' : ''
                      } ${isBlocked ? 'ring-2 ring-red-500/40' : ''} ${isDraggingThis ? 'opacity-80 shadow-lg' : 'hover:shadow-md'}`}
                      style={{
                        left: barPos.left,
                        width: Math.max(barPos.width, 20),
                        top: top + (ROW_H - 24) / 2,
                        backgroundColor: barColor,
                        opacity: isDone ? 0.7 : 1,
                        boxShadow: isDraggingThis ? undefined : '0 1px 2px rgba(0,0,0,0.08)',
                      }}
                      onClick={() => setSelectedElement(selectedElement === element.id ? null : element.id)}
                      onMouseDown={(e) => handleDragStart(e, element.id, 'move')}
                      onMouseEnter={(e) => {
                        if (!dragging) {
                          setTooltip({ x: e.clientX, y: e.clientY, element });
                        }
                      }}
                      onMouseMove={(e) => {
                        if (!dragging && tooltip) {
                          setTooltip({ x: e.clientX, y: e.clientY, element });
                        }
                      }}
                      onMouseLeave={() => setTooltip(null)}
                    >
                      {/* Resize handles */}
                      <div
                        className="absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize opacity-0 group-hover:opacity-100 rounded-l-md"
                        style={{ backgroundColor: 'rgba(0,0,0,0.25)' }}
                        onMouseDown={(e) => { e.stopPropagation(); handleDragStart(e, element.id, 'resize-start'); }}
                      />
                      <div
                        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize opacity-0 group-hover:opacity-100 rounded-r-md"
                        style={{ backgroundColor: 'rgba(0,0,0,0.25)' }}
                        onMouseDown={(e) => { e.stopPropagation(); handleDragStart(e, element.id, 'resize-end'); }}
                      />

                      {/* Inner label + optional due date */}
                      {showLabel && (
                        <div className="absolute inset-0 flex items-center justify-between px-2 overflow-hidden gap-2 pointer-events-none">
                          <span className={`text-[11px] font-medium text-white/95 truncate ${isDone ? 'line-through' : ''}`}>
                            {element.title}
                          </span>
                          {showDueDate && element.due_date && (
                            <span className="text-[10px] text-white/80 flex-shrink-0 tabular-nums">
                              {formatDate(parseDateOnly(element.due_date)!, 'pill')}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                });
              })}

              {/* Dependency arrows */}
              <svg className="absolute inset-0 pointer-events-none" style={{ width: timelineWidth, height: layout.totalHeight }}>
                <defs>
                  <marker
                    id="arrowhead"
                    markerWidth="10"
                    markerHeight="7"
                    refX="9"
                    refY="3.5"
                    orient="auto"
                  >
                    <polygon
                      points="0 0, 10 3.5, 0 7"
                      fill="currentColor"
                      className="text-muted-foreground/50"
                    />
                  </marker>
                </defs>
                {elements.map(element => {
                  const deps = getDependencies(element);
                  const targetPos = getBarPosition(element);
                  const targetTop = layout.tops.get(element.id);
                  if (!targetPos || targetTop === undefined || deps.length === 0) return null;

                  return deps.map(dep => {
                    const sourcePos = getBarPosition(dep);
                    const sourceTop = layout.tops.get(dep.id);
                    if (!sourcePos || sourceTop === undefined) return null;

                    const sourceX = sourcePos.left + sourcePos.width;
                    const sourceY = sourceTop + ROW_H / 2;
                    const targetX = targetPos.left;
                    const targetY = targetTop + ROW_H / 2;

                    return (
                      <g key={`${dep.id}-${element.id}`}>
                        <path
                          d={`M ${sourceX} ${sourceY} C ${sourceX + 20} ${sourceY}, ${targetX - 20} ${targetY}, ${targetX} ${targetY}`}
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          className="text-muted-foreground/50"
                          markerEnd="url(#arrowhead)"
                        />
                      </g>
                    );
                  });
                })}
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* Tooltip */}
      {tooltip && !dragging && (
        <div
          className="fixed z-50 pointer-events-none px-3 py-2 rounded-lg shadow-lg border border-border bg-popover text-popover-foreground"
          style={{ left: tooltip.x + 12, top: tooltip.y - 10, maxWidth: 260 }}
        >
          <div className="text-xs font-semibold truncate mb-1">{tooltip.element.title}</div>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{ backgroundColor: statusBarColors[tooltip.element.status || 'todo'] ?? '#A3A3A3' }}
            />
            <span>{statusLabels[tooltip.element.status || 'todo'] ?? 'To Do'}</span>
          </div>
          <div className="text-[11px] text-muted-foreground mt-1">
            {tooltip.element.start_date
              ? formatDate(parseDateOnly(tooltip.element.start_date)!, 'full')
              : '(no start)'}
            {' → '}
            {tooltip.element.due_date
              ? formatDate(parseDateOnly(tooltip.element.due_date)!, 'full')
              : '(no due date)'}
          </div>
        </div>
      )}
    </div>
  );
}
