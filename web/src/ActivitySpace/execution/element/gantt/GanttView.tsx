'use client';

import { parseDateOnly, toDateOnlyString as fmtDateOnly, addDays, daysBetween, startOfDay, DAY_MS } from '@/Function/shared/dateUtils';
import { DisclosureTriangle } from '@/Function/shared/DisclosureTriangle';
import React, { useState, useMemo, useRef, useEffect, useCallback, type ReactNode } from 'react';
import type { ElementWithDetails } from '@/hooks/useSupabase';
import type { ClaywareObjectWithChildren, Phase, ObjectMilestone } from '@/types/database';
import { updateElement } from '@/hooks/useSupabase';
import { CalendarDays, X, ZoomIn, ZoomOut } from '@/ui/icons';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import { ObjectIcon } from '@/Frame/icons';
import { statusColor, statusLabel, statusTint } from '@/shared/designTokens';
import { ElementProgressMark, getElementProgress } from '@/Function/shared/ElementProgressMark';
import { WorkerAvatarStack } from '@/Function/shared/WorkerAvatar';
import { phaseWindowMs } from '@/Function/shared/phaseWindow';
import { MilestoneDiamond } from '@/Function/shared/MilestoneDiamond';
import { ItemIcon } from '@/Function/shared/itemIcon/ItemIcon';
import { dragRange } from './ganttRange';
import { useI18n } from '@/Function/i18n/I18nProvider';

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
  object?: ClaywareObjectWithChildren;
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
  /** Domain Phases to draw as background bands across the timeline. Omit
   *  where there's no Domain to scope them to (or none exist yet) — bands
   *  simply don't render. */
  phases?: Phase[];
  /** object_milestones rows to draw as ◇ markers across the timeline. Read-only
   *  here — the Object Overview's Milestones widget owns add/rename/move/delete. */
  milestones?: ObjectMilestone[];
  /** Opens an Element's detail from its row or bar. A drag on the bar never
   *  opens it. Omit and a click only selects the row. */
  onElementOpen?: (element: ElementWithDetails) => void;
  /** The zoom it opens at. A Strategy's Gantt opens by quarter. */
  defaultZoom?: ZoomLevel;
  /** What a row stands for. 'object' rows are roomier with a thicker bar
   *  and carry no Status mark (an Object has no Status of its own). */
  rowScale?: keyof typeof ROW_SCALE;
  /** Dependencies between rows, by row id: `to` waits for `from`. Drawn as a
   *  curve from the end of one bar to the start of the other, in the danger
   *  color when `conflict` (the dates break the order). */
  links?: GanttLink[];
  /** Present when the viewer may add a dependency: a bar grows a handle at
   *  its end; dragging it onto another bar asks for `to` to wait for `from`. */
  onLinkCreate?: (from: string, to: string) => void;
  /** Present when the viewer may remove one, from the mark on its line. */
  onLinkRemove?: (link: GanttLink) => void;
}

export interface GanttLink { id?: string; from: string; to: string; conflict?: boolean }

type ZoomLevel = 'day' | 'week' | 'month' | 'quarter';

// One shared horizontal scale: pixels per day. Headers, grid, bars, the
// today-line and drag math all derive from this so every zoom level stays
// aligned (the old per-zoom "column = 1 unit" header drifted off the bars).
const PX_PER_DAY: Record<ZoomLevel, number> = { day: 40, week: 12, month: 4.5, quarter: 2 };

// Stable empty-array default so an omitted `phases` prop doesn't hand the
// Phase-band memo a fresh reference (and a re-render) every render.
const EMPTY_PHASES: Phase[] = [];
const EMPTY_MILESTONES: ObjectMilestone[] = [];
// Pointer travel under this many pixels still counts as a click on a bar.
const DRAG_CLICK_TOLERANCE_PX = 3;

function formatDate(date: Date, format: 'short' | 'full' | 'pill', locale: string): string {
  if (format === 'full') {
    return date.toLocaleDateString(locale, { year: 'numeric', month: '2-digit', day: '2-digit' });
  }
  return date.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
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
      const d = parseDateOnly(raw, null);
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
function buildHeaderSpans(start: Date, totalDays: number, zoom: ZoomLevel, locale: string): HeaderSpan[] {
  const spans: HeaderSpan[] = [];
  let cursor = 0;
  while (cursor < totalDays) {
    const date = addDays(start, cursor);
    let next: Date;
    let label: string;
    if (zoom === 'day' || zoom === 'week') {
      next = new Date(date.getFullYear(), date.getMonth() + 1, 1);
      label = date.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
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
function buildHeaderUnits(start: Date, totalDays: number, zoom: ZoomLevel, locale: string): HeaderUnit[] {
  const units: HeaderUnit[] = [];
  const today = startOfDay(new Date());
  let cursor = 0;
  while (cursor < totalDays) {
    const date = addDays(start, cursor);
    if (zoom === 'day') {
      units.push({
        label: String(date.getDate()),
        sub: date.toLocaleDateString(locale, { weekday: 'narrow' }),
        days: 1,
        startDay: cursor,
        isWeekend: date.getDay() === 0 || date.getDay() === 6,
        isToday: daysBetween(date, today) === 0,
      });
      cursor += 1;
    } else if (zoom === 'week') {
      const days = Math.min(7, totalDays - cursor);
      units.push({ label: formatDate(date, 'pill', locale), days, startDay: cursor });
      cursor += days;
    } else if (zoom === 'month') {
      const next = new Date(date.getFullYear(), date.getMonth() + 1, 1);
      const days = Math.min(daysBetween(date, next), totalDays - cursor);
      units.push({
        label: date.toLocaleDateString(locale, { month: 'short' }),
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

// Row and bar heights by what a row stands for: an Element's row is
// compact; an Object is a bigger unit of work, so its rows stand further
// apart and its bar is thicker.
// An Object row is laid out as Linear lays out a project: its name on a
// line of its own, a quiet bar under it, and its milestones' names under
// the bar — so the row is tall and the bar is slim.
const EMPTY_LINKS: GanttLink[] = [];
const ROW_SCALE = { element: { row: 36, bar: 24 }, object: { row: 88, bar: 30 } } as const;
const OBJECT_TITLE_TOP = 8;   // px from the row's top to the name line
const OBJECT_BAR_TOP = 32;    // px from the row's top to the bar
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
  onElementOpen,
  phases = EMPTY_PHASES,
  milestones = EMPTY_MILESTONES,
  defaultZoom = 'day',
  rowScale = 'element',
  links = EMPTY_LINKS,
  onLinkCreate,
  onLinkRemove,
}: GanttViewProps) {
  const ROW_H = ROW_SCALE[rowScale].row;
  const BAR_H = ROW_SCALE[rowScale].bar;
  const objectRows = rowScale === 'object';
  // Drawing a dependency: from a bar's end handle to wherever the pointer is,
  // in the timeline's own coordinates; released over another bar, it links.
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [linking, setLinking] = useState<{ from: string; x: number; y: number } | null>(null);
  const linkCreateRef = useRef(onLinkCreate);
  useEffect(() => { linkCreateRef.current = onLinkCreate; }, [onLinkCreate]);
  const linkingFrom = linking?.from ?? null;
  useEffect(() => {
    if (!linkingFrom) return;
    const point = (e: MouseEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      return rect ? { x: e.clientX - rect.left, y: e.clientY - rect.top } : null;
    };
    const move = (e: MouseEvent) => { const p = point(e); if (p) setLinking({ from: linkingFrom, ...p }); };
    const up = (e: MouseEvent) => {
      const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-bar-id]')?.getAttribute('data-bar-id');
      if (target && target !== linkingFrom) linkCreateRef.current?.(linkingFrom, target);
      setLinking(null);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, [linkingFrom]);

  /** Where a row's bar starts, from the row's top. */
  const barTopOf = (rowTop: number) => rowTop + (objectRows ? OBJECT_BAR_TOP : (ROW_H - BAR_H) / 2);
  // Bars persist their dates through this callback. Defaults to updateElement
  // for the Element Gantt; the Domain Objects-tab Gantt overrides it with
  // updateObject so dragging an Object bar writes objects.start_date /
  // objects.due_date. Wrapped in useCallback so the drag effects' deps stay
  // stable (otherwise every parent render would re-attach window listeners).
  const { t, locale } = useI18n();
  const persistDates = useCallback(
    (id: string, u: { start_date?: string | null; due_date?: string | null }) =>
      onItemUpdate ? onItemUpdate(id, u) : updateElement(id, u),
    [onItemUpdate],
  );
  const [zoom, setZoom] = useState<ZoomLevel>(defaultZoom);
  const [zoomScale, setZoomScale] = useState(1);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [selectedElement, setSelectedElement] = useState<string | null>(null);
  // Set on a mouseup that moved the bar, so the click that follows the drag
  // does not also open the Element. Cleared on the next mousedown on a bar.
  const draggedRef = useRef(false);
  const activateElement = (element: ElementWithDetails) => {
    if (onElementOpen) {
      setSelectedElement(element.id);
      onElementOpen(element);
    } else {
      setSelectedElement(selectedElement === element.id ? null : element.id);
    }
  };
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
    () => buildHeaderSpans(dateRange.start, totalDays, zoom, locale),
    [dateRange.start, totalDays, zoom, locale]
  );
  const headerUnits = useMemo(
    () => buildHeaderUnits(dateRange.start, totalDays, zoom, locale),
    [dateRange.start, totalDays, zoom, locale]
  );

  // The current Object supplies the fallback section's name.
  const objectNameMap = useMemo(
    () => new Map(object ? [[object.id, object.name]] : []),
    [object],
  );

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
  }, [elementsBySection, collapsedSections, ROW_H]);

  // Calculate position for an Element bar (with drag offset applied)
  const getBarPosition = useCallback((element: ElementWithDetails): { left: number; width: number } | null => {
    let startDate = parseDateOnly(element.start_date, null);
    let endDate = parseDateOnly(element.due_date, null);

    if (!startDate && !endDate) return null;

    // The element being dragged previews where the drag would put it.
    if (dragging && dragging.elementId === element.id && dragDaysDelta !== 0) {
      ({ start: startDate, end: endDate } = dragRange({ start: startDate, end: endDate }, dragging.type, dragDaysDelta));
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

  /** A dependency's line: out of the blocker's end, into the waiting bar's
   *  start, as an S-curve that loops back when the waiting bar starts early. */
  const linkGeometry = (link: GanttLink) => {
    const source = elements.find((el) => el.id === link.from);
    const target = elements.find((el) => el.id === link.to);
    const sourcePos = source && getBarPosition(source);
    const targetPos = target && getBarPosition(target);
    const sourceTop = layout.tops.get(link.from);
    const targetTop = layout.tops.get(link.to);
    if (!sourcePos || !targetPos || sourceTop === undefined || targetTop === undefined) return null;
    const sx = sourcePos.left + Math.max(sourcePos.width, 20);
    const sy = barTopOf(sourceTop) + BAR_H / 2;
    const tx = targetPos.left;
    const ty = barTopOf(targetTop) + BAR_H / 2;
    const reach = Math.min(90, Math.max(36, Math.abs(tx - sx) / 2));
    return {
      sx, sy, tx, ty,
      d: `M ${sx} ${sy} C ${sx + reach} ${sy}, ${tx - reach} ${ty}, ${tx} ${ty}`,
      stroke: link.conflict ? 'var(--status-danger)' : 'color-mix(in oklab, var(--accent-default) 80%, transparent)',
    };
  };

  // Handle drag start
  const handleDragStart = (e: React.MouseEvent, elementId: string, type: 'move' | 'resize-start' | 'resize-end') => {
    e.preventDefault();
    e.stopPropagation();
    draggedRef.current = false;

    const element = elements.find(el => el.id === elementId);
    if (!element) return;

    setDragging({
      elementId,
      type,
      startX: e.clientX,
      originalStart: parseDateOnly(element.start_date, null),
      originalEnd: parseDateOnly(element.due_date, null),
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
      // At month/quarter zoom a few pixels already move the dates; any move
      // of the dates is a drag, never a click.
      draggedRef.current = daysDelta !== 0 || Math.abs(deltaX) > DRAG_CLICK_TOLERANCE_PX;

      if (daysDelta !== 0) {
        const { start: newStartDate, end: newEndDate } = dragRange(
          { start: dragging.originalStart, end: dragging.originalEnd }, dragging.type, daysDelta);

        // Save to database. A range pulled back to one day is a due date
        // alone, as the list's date cell stores it.
        try {
          const updates: { start_date?: string | null; due_date?: string } = {};
          if (newEndDate) updates.due_date = fmtDateOnly(newEndDate);
          if (newStartDate) {
            updates.start_date = newEndDate && fmtDateOnly(newStartDate) === fmtDateOnly(newEndDate) ? null : fmtDateOnly(newStartDate);
          }

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


  /** Compact "Jun 8 – Jun 19" range text for the left row (— when undated). */
  const rowDateLabel = (el: ElementWithDetails): string | null => {
    const s = parseDateOnly(el.start_date, null);
    const d = parseDateOnly(el.due_date, null);
    if (!s && !d) return null;
    if (s && d && daysBetween(s, d) !== 0) return `${formatDate(s, 'pill', locale)} – ${formatDate(d, 'pill', locale)}`;
    return formatDate((d ?? s)!, 'pill', locale);
  };

  return (
    <div className="flex flex-col h-full bg-card">
      {/* Sticky Toolbar */}
      <div className="sticky top-0 z-30 flex items-center justify-between px-4 py-2.5 border-b border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-foreground">{t('Timeline')}</span>
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
              title={t('Zoom out')}
              aria-label={t('Zoom out')}
              className="w-7 h-6 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 disabled:pointer-events-none transition-colors"
            >
              <ZoomOut size={14} />
            </button>
            <button
              onClick={() => setZoomScale(1)}
              title={t('Reset zoom')}
              aria-label={t('Reset zoom')}
              className="px-1.5 h-6 inline-flex items-center justify-center text-[10px] font-medium tabular-nums text-muted-foreground hover:text-foreground rounded transition-colors min-w-[34px]"
            >
              {Math.round(zoomScale * 100)}%
            </button>
            <button
              onClick={() => zoomBy(ZOOM_STEP)}
              disabled={zoomScale >= ZOOM_MAX - 1e-6}
              title={t('Zoom in')}
              aria-label={t('Zoom in')}
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
                {z === 'day' ? t('Day') : z === 'week' ? t('Week') : z === 'month' ? t('Month') : t('Quarter')}
              </button>
            ))}
          </div>
          <button
            onClick={() => scrollToToday(true)}
            className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium text-foreground bg-muted/50 hover:bg-muted rounded-md transition-colors"
          >
            <CalendarDays size={13} />
            {t('Today')}
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden" ref={containerRef}>
        {/* Left panel — Element list. Object rows carry their names on the
            timeline itself, so they have no list beside it. */}
        <div className={`w-64 min-w-64 border-r border-border/60 flex-col bg-card ${objectRows ? 'hidden' : 'flex'}`}>
          {/* Header */}
          <div className="flex items-center px-3 border-b border-border/60" style={{ height: HEADER_TIER1_H + HEADER_TIER2_H }}>
            <span className="text-[11px] font-semibold text-muted-foreground">{t(leftHeaderLabel)}</span>
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
                      className="w-full flex items-center gap-1.5 px-2.5 h-8 text-left bg-foreground/[0.025] hover:bg-foreground/[0.05] transition-colors group"
                      title={isCollapsed ? t('Expand') : t('Collapse')}
                    >
                      <span className="w-3.5 h-3.5 flex items-center justify-center text-muted-foreground shrink-0">
                        {icon ?? <ObjectIcon size={12} />}
                      </span>
                      <span className="text-[12px] font-medium text-foreground truncate flex-1">{name}</span>
                      <span className="w-3.5 h-3.5 flex items-center justify-center text-muted-foreground/70 group-hover:text-foreground transition-colors">
                        <DisclosureTriangle open={!isCollapsed} />
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
                        role="button"
                        tabIndex={0}
                        onClick={() => activateElement(element)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activateElement(element); }
                        }}
                        className={`flex items-center gap-2 px-3 cursor-pointer transition-colors outline-none focus-visible:bg-muted/30 ${
                          selectedElement === element.id ? 'bg-primary/10' : 'hover:bg-muted/30'
                        }`}
                        style={{ height: ROW_H }}
                      >
                        {/* The same status mark as the list row, so a change
                            in either reads the same here. */}
                        {!objectRows && (
                          <span className="shrink-0 flex items-center">
                            <ElementProgressMark status={element.status} progress={getElementProgress(element)} size={14} />
                          </span>
                        )}
                        <span className={`${objectRows ? 'text-[13px] font-medium' : 'text-xs'} truncate flex-1 ${isDone ? 'text-muted-foreground' : 'text-foreground'}`}>
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
            className="border-b border-border/60 overflow-x-hidden"
            ref={timelineRef}
            style={{ scrollbarWidth: 'none', height: HEADER_TIER1_H + HEADER_TIER2_H }}
          >
            <div className="relative" style={{ width: timelineWidth }}>
              {zoom !== 'day' && (() => {
                const left = daysBetween(dateRange.start, startOfDay(new Date())) * pxPerDay + pxPerDay / 2;
                if (left <= 0 || left >= timelineWidth) return null;
                // Today, named in the date row itself — where the line below points.
                return (
                  <span className="absolute z-10 -translate-x-1/2 whitespace-nowrap rounded-md bg-[var(--accent-default)] px-1.5 text-[10px] font-semibold leading-[18px] text-white"
                    style={{ left, top: HEADER_TIER1_H + (HEADER_TIER2_H - 18) / 2 }}>
                    {formatDate(new Date(), 'pill', locale)}
                  </span>
                );
              })()}
              <div className="flex" style={{ height: HEADER_TIER1_H }}>
                {headerSpans.map((span, idx) => (
                  <div
                    key={idx}
                    className="flex-shrink-0 flex items-center border-l border-border/40 first:border-l-0 overflow-hidden"
                    style={{ width: span.days * pxPerDay }}
                  >
                    <span className="sticky left-0 px-2 text-[10px] font-semibold text-muted-foreground whitespace-nowrap">
                      {span.label}
                    </span>
                  </div>
                ))}
              </div>
              <div className="flex" style={{ height: HEADER_TIER2_H }}>
                {headerUnits.map((unit, idx) => (
                  <div
                    key={idx}
                    className={`flex-shrink-0 flex flex-col items-center justify-center leading-none ${
                      unit.isWeekend && !unit.isToday ? 'opacity-60' : ''
                    }`}
                    style={{ width: unit.days * pxPerDay }}
                  >
                    {zoom === 'day' ? (
                      <>
                        <span className={`text-[9px] mb-0.5 ${unit.isToday ? 'text-[var(--accent-default)] font-semibold' : 'text-muted-foreground/70'}`}>
                          {unit.sub}
                        </span>
                        {unit.isToday ? (
                          <span className="min-w-[20px] h-[18px] px-1 rounded-md bg-[var(--accent-default)] text-white text-[11px] font-semibold flex items-center justify-center">
                            {unit.label}
                          </span>
                        ) : (
                          <span className="text-[11px] font-medium text-muted-foreground">{unit.label}</span>
                        )}
                      </>
                    ) : (
                      <span className="text-[11px] font-medium text-muted-foreground whitespace-nowrap px-1 truncate max-w-full">
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
              ref={canvasRef}
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
                    className={`flex-shrink-0 border-r border-border/25 ${
                      unit.isWeekend ? 'bg-foreground/[0.015]' : ''
                    }`}
                    style={{ width: unit.days * pxPerDay }}
                  />
                ))}
              </div>

              {/* Phase bands — each Domain Phase's date range as a background
                  band across the full timeline height. Reads the window
                  through phaseWindowMs (phaseWindow.ts) so "how wide is the
                  band" agrees with every other Phase-date reading in the app
                  (burn-up, forecast) — end_date is the Phase's last working
                  day, not the divider after it. */}
              {phases.map((phase, idx) => {
                const win = phaseWindowMs(phase);
                if (!win) return null;
                const left = ((win.t0 - dateRange.start.getTime()) / DAY_MS) * pxPerDay;
                const right = ((win.t1 - dateRange.start.getTime()) / DAY_MS) * pxPerDay;
                if (right <= 0 || left >= timelineWidth) return null;
                const clampedLeft = Math.max(0, left);
                const clampedWidth = Math.min(timelineWidth, right) - clampedLeft;
                return (
                  <div
                    key={phase.id}
                    className={`absolute top-0 bottom-0 pointer-events-none border-x border-border/30 ${
                      idx % 2 === 0 ? 'bg-primary/[0.04]' : 'bg-foreground/[0.03]'
                    }`}
                    style={{ left: clampedLeft, width: clampedWidth }}
                  >
                    <span className="absolute top-1 left-1.5 text-[10px] font-medium text-muted-foreground/70 truncate max-w-[calc(100%-8px)]">
                      {phase.name}
                    </span>
                  </div>
                );
              })}

              {/* Section row tints */}
              {elementsBySection.map(({ key, name }) => {
                if (!name) return null;
                const top = layout.sectionTops.get(key);
                if (top === undefined) return null;
                return (
                  <div
                    key={`tint-${key}`}
                    className="absolute left-0 right-0 bg-foreground/[0.025] pointer-events-none"
                    style={{ top, height: SECTION_HEADER_H, width: timelineWidth }}
                  />
                );
              })}

              {/* A group's whole span: from its first start to its last due,
                  drawn as a bracket on the group's own row, with the dates
                  beside it — the Object's schedule read off its Elements. */}
              {elementsBySection.map(({ key, name, elements: sectionElements }) => {
                if (!name) return null;
                const top = layout.sectionTops.get(key);
                if (top === undefined) return null;
                let first: Date | null = null;
                let last: Date | null = null;
                for (const el of sectionElements) {
                  const a = parseDateOnly(el.start_date, null) ?? parseDateOnly(el.due_date, null);
                  const b = parseDateOnly(el.due_date, null) ?? parseDateOnly(el.start_date, null);
                  if (a && (!first || a < first)) first = a;
                  if (b && (!last || b > last)) last = b;
                }
                if (!first || !last) return null;
                const left = daysBetween(dateRange.start, first) * pxPerDay;
                const width = Math.max((daysBetween(first, last) + 1) * pxPerDay, 12);
                const color = 'color-mix(in oklab, var(--accent-default) 75%, transparent)';
                return (
                  <div key={`span-${key}`} className="pointer-events-none absolute z-[5]" style={{ left, width, top: top + 7 }}>
                    <div className="h-[5px] rounded-[1px]" style={{ backgroundColor: color }} />
                    <span className="absolute left-0 top-[5px] h-[6px] w-[6px]" style={{ backgroundColor: color, clipPath: 'polygon(0 0, 100% 0, 0 100%)' }} />
                    <span className="absolute right-0 top-[5px] h-[6px] w-[6px]" style={{ backgroundColor: color, clipPath: 'polygon(0 0, 100% 0, 100% 100%)' }} />
                    <span className="absolute left-1/2 top-[8px] -translate-x-1/2 whitespace-nowrap text-[10px] tabular-nums text-muted-foreground">
                      {formatDate(first, 'pill', locale)} – {formatDate(last, 'pill', locale)}
                    </span>
                  </div>
                );
              })}

              {/* Today line with pill label */}
              {(() => {
                const daysFromStart = daysBetween(dateRange.start, startOfDay(new Date()));
                const leftPos = daysFromStart * pxPerDay + (pxPerDay / 2);
                if (leftPos > 0 && leftPos < timelineWidth) {
                  return (
                    // The line alone marks today: a label on it sat over the
                    // dates in the header above. The header already tints today.
                    <div
                      className="absolute top-0 bottom-0 z-10 pointer-events-none"
                      style={{ left: leftPos - 0.5, width: 1, backgroundColor: 'color-mix(in oklab, var(--accent-default) 70%, transparent)' }}
                    />
                  );
                }
                return null;
              })()}

              {/* Milestones — one ◇ per object_milestones row, drawn chart-wide
                  (not tied to a row/section) since a milestone date matters
                  regardless of the current grouping. Same MilestoneDiamond
                  atom the Strategy Timeline uses; read-only here (no onClick),
                  so add/delete stays that view's job. */}
              {!objectRows && milestones.map((m) => {
                const date = parseDateOnly(m.date, null);
                if (!date) return null;
                const left = daysBetween(dateRange.start, date) * pxPerDay + pxPerDay / 2;
                if (left < 0 || left > timelineWidth) return null;
                return (
                  <React.Fragment key={m.id}>
                    <div
                      className="absolute top-0 bottom-0 z-10 pointer-events-none"
                      style={{ left: left - 0.5, width: 1, borderLeft: '1px dashed var(--border-strong)' }}
                    />
                    <MilestoneDiamond left={left} top={4} label={m.label} date={m.date} className="z-20" />
                  </React.Fragment>
                );
              })}

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
                    // An undated Object only names itself: its dates are set on
                    // the Object, not swept onto the timeline.
                    if (objectRows) {
                      return (
                        <div key={element.id} className="pointer-events-none absolute" style={{ left: 0, width: timelineWidth, top: top + OBJECT_TITLE_TOP }}>
                          <span className="sticky left-3 inline-flex max-w-[320px] items-center gap-1.5 text-[13px] font-medium text-muted-foreground">
                            <span className="flex shrink-0"><ItemIcon icon={element.icon ?? null} color={element.color ?? null} size={13} fallback={<ObjectIcon size={13} />} /></span>
                            <span className="truncate">{element.title}</span>
                            <span className="shrink-0 text-[11px] font-normal text-muted-foreground/70">{t('No dates')}</span>
                          </span>
                        </div>
                      );
                    }
                    const isCreatingThis = creating?.elementId === element.id;
                    const previewFrom = isCreatingThis ? Math.min(creating.anchorDay, creating.currentDay) : 0;
                    const previewTo = isCreatingThis ? Math.max(creating.anchorDay, creating.currentDay) : 0;
                    return (
                      <div key={element.id}>
                        <div
                          className="absolute cursor-crosshair hover:bg-muted/20 transition-colors"
                          style={{ left: 0, width: timelineWidth, top, height: ROW_H }}
                          title={t('Drag to schedule')}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            const rect = e.currentTarget.getBoundingClientRect();
                            const day = Math.max(0, Math.min(totalDays - 1, Math.floor((e.clientX - rect.left) / pxPerDay)));
                            setCreating({ elementId: element.id, anchorDay: day, currentDay: day, laneLeft: rect.left });
                          }}
                        />
                        {isCreatingThis && (
                          <div
                            className="absolute rounded-md border-2 border-dashed pointer-events-none z-10"
                            style={{
                              height: BAR_H,
                              left: previewFrom * pxPerDay,
                              width: Math.max((previewTo - previewFrom + 1) * pxPerDay, 8),
                              top: barTopOf(top),
                              borderColor: statusColor(element.status),
                              backgroundColor: statusTint(element.status),
                            }}
                          />
                        )}
                      </div>
                    );
                  }

                  const barColor = statusColor(element.status);
                  const isDraggingThis = dragging?.elementId === element.id;
                  const isDone = element.status === 'done';
                  const isBlocked = element.status === 'blocked';
                  const showLabel = barPos.width > 50;
                  const showDueDate = barPos.width > 100 && element.due_date;
                  const progress = getElementProgress(element);
                  const assignedWorkers = (element.assignees ?? [])
                    .map((a) => a.worker)
                    .filter((w): w is NonNullable<typeof w> => !!w);
                  const barWidth = Math.max(barPos.width, 20);

                  return (
                    <React.Fragment key={element.id}>
                    {objectRows && (
                      // The name rides above its bar and stays in view while
                      // any of the bar is: the wrapper spans the bar, the
                      // name sticks to the pane's left edge inside it.
                      <div className="pointer-events-none absolute" style={{ left: barPos.left, width: Math.max(barWidth, 260), top: top + OBJECT_TITLE_TOP }}>
                        <span className="sticky left-3 inline-flex max-w-full items-center gap-1.5 text-[13px] font-medium text-foreground">
                          <span className="flex shrink-0 text-muted-foreground"><ItemIcon icon={element.icon ?? null} color={element.color ?? null} size={13} fallback={<ObjectIcon size={13} />} /></span>
                          <span className="truncate">{element.title}</span>
                          {assignedWorkers.length > 0 && <WorkerAvatarStack workers={assignedWorkers} max={2} size={16} itemClassName="border-card" />}
                          {progress > 0 && <span className="shrink-0 text-[11px] font-normal tabular-nums text-muted-foreground">{Math.round(progress)}%</span>}
                          {element.due_date && (
                            <span className="flex shrink-0 items-center gap-1 text-[11px] font-normal tabular-nums text-muted-foreground">
                              <CalendarDays size={10} />
                              {formatDate(parseDateOnly(element.due_date, null)!, 'pill', locale)}
                            </span>
                          )}
                        </span>
                      </div>
                    )}
                    {objectRows && milestones.filter((m) => m.object_id === element.id).map((m) => {
                      const date = parseDateOnly(m.date, null);
                      if (!date) return null;
                      const left = daysBetween(dateRange.start, date) * pxPerDay + pxPerDay / 2;
                      if (left < 0 || left > timelineWidth) return null;
                      return (
                        // A milestone is a diamond on its Object's bar, named under it.
                        <div key={m.id} className="pointer-events-none absolute z-20 flex -translate-x-1/2 flex-col items-center" style={{ left, top: barTopOf(top) + (BAR_H - 8) / 2 }}
                          title={m.label ?? undefined}>
                          <span className="size-2 rotate-45 rounded-[1px] bg-[var(--text-secondary)]" />
                          {m.label && <span className="mt-[9px] max-w-[120px] truncate text-[10px] text-muted-foreground">{m.label}</span>}
                        </div>
                      );
                    })}
                    {isDraggingThis && (() => {
                      // While a bar is dragged or stretched, the date each moving
                      // edge lands on is named above it.
                      const dayAt = (offset: number) => { const d = new Date(dateRange.start); d.setDate(d.getDate() + offset); return d; };
                      const startDay = Math.round(barPos.left / pxPerDay);
                      const endDay = startDay + Math.max(1, Math.round(barPos.width / pxPerDay)) - 1;
                      const pill = 'pointer-events-none absolute z-30 -translate-x-1/2 whitespace-nowrap rounded-md bg-[var(--accent-default)] px-1.5 text-[10px] font-semibold leading-[18px] text-white';
                      const pillTop = barTopOf(top) - 22;
                      return (
                        <>
                          {dragging.type !== 'resize-end' && <span className={pill} style={{ left: barPos.left, top: pillTop }}>{formatDate(dayAt(startDay), 'pill', locale)}</span>}
                          {dragging.type !== 'resize-start' && <span className={pill} style={{ left: barPos.left + barWidth, top: pillTop }}>{formatDate(dayAt(endDay), 'pill', locale)}</span>}
                        </>
                      );
                    })()}
                    {/* A bar is a quiet surface with a fine edge, as a card is:
                        the status speaks through its mark and the wash of
                        its progress, not by painting the whole bar. */}
                    <div
                      className={`absolute rounded-md cursor-pointer group border ${objectRows ? 'bg-[color-mix(in_oklab,var(--foreground)_7%,transparent)]' : 'bg-[var(--surface-strong)]'} transition-[border-color,box-shadow] overflow-hidden ${
                        selectedElement === element.id ? 'border-[var(--accent-default)] ring-1 ring-[var(--accent-default)]/40'
                          : isBlocked ? 'border-[var(--status-danger)]/50' : 'border-border/70 hover:border-[var(--border-strong)]'
                      } ${isDraggingThis ? 'border-[var(--accent-default)] shadow-lg' : ''}`}
                      data-bar-id={element.id}
                      style={{
                        left: barPos.left,
                        width: barWidth,
                        height: BAR_H,
                        top: barTopOf(top),
                        boxShadow: isDraggingThis ? undefined : '0 1px 2px var(--gantt-bar-shadow)',
                      }}
                      onClick={() => { if (!draggedRef.current) activateElement(element); }}
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
                      {/* Progress fill — a lighter wash over the status color,
                          not a second hue, so the bar's color keeps meaning
                          "status" and the fill alone reads as "how much". */}
                      {/* Done needs no wash: its mark and muted title say so. */}
                      {progress > 0 && !isDone && (
                        <div
                          className="absolute inset-y-0 left-0 pointer-events-none"
                          style={{ width: `${Math.min(100, progress)}%`, backgroundColor: `color-mix(in oklab, ${barColor} 16%, transparent)` }}
                        />
                      )}

                      {/* Resize handles */}
                      <div
                        className="absolute left-0 top-0 bottom-0 w-2.5 cursor-ew-resize opacity-0 group-hover:opacity-100 rounded-l-md"
                        style={{ backgroundColor: 'var(--gantt-resize-handle-tint)' }}
                        onMouseDown={(e) => { e.stopPropagation(); handleDragStart(e, element.id, 'resize-start'); }}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <div
                        className="absolute right-0 top-0 bottom-0 w-2.5 cursor-ew-resize opacity-0 group-hover:opacity-100 rounded-r-md"
                        style={{ backgroundColor: 'var(--gantt-resize-handle-tint)' }}
                        onMouseDown={(e) => { e.stopPropagation(); handleDragStart(e, element.id, 'resize-end'); }}
                        onClick={(e) => e.stopPropagation()}
                      />

                      {/* Inner label + optional due date */}
                      {showLabel && !objectRows && (
                        <div className="absolute inset-0 flex items-center justify-between px-2 overflow-hidden gap-2 pointer-events-none">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <ElementProgressMark status={element.status} progress={progress} size={12} />
                            <span className={`text-[11.5px] font-medium truncate ${isDone ? 'text-muted-foreground' : 'text-foreground'}`}>
                              {element.title}
                            </span>
                          </span>
                          {showDueDate && element.due_date && (
                            <span className="flex flex-shrink-0 items-center gap-1 text-[10px] tabular-nums text-muted-foreground">
                              <CalendarDays size={10} className="shrink-0" />
                              {formatDate(parseDateOnly(element.due_date, null)!, 'pill', locale)}
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    {onLinkCreate && !dragging && (
                      // The dependency handle: drag it onto the bar that waits for this one.
                      <button type="button" title={t('Drag to add dependency')} aria-label={t('Drag to add dependency')}
                        className="absolute z-20 size-3 cursor-crosshair rounded-full border border-[var(--accent-default)] bg-card opacity-40 transition-opacity hover:opacity-100"
                        style={{ left: barPos.left + barWidth + 8, top: barTopOf(top) + (BAR_H - 12) / 2 }}
                        onMouseDown={(e) => {
                          e.preventDefault(); e.stopPropagation();
                          const rect = canvasRef.current?.getBoundingClientRect();
                          if (rect) setLinking({ from: element.id, x: e.clientX - rect.left, y: e.clientY - rect.top });
                        }} />
                    )}
                    {/* Assignee avatars — sibling of the bar, not a child:
                        the bar has overflow-hidden (for the progress fill's
                        clip) and this deliberately overlaps its right edge,
                        so it has to sit outside that boundary. */}
                    {assignedWorkers.length > 0 && !objectRows && (
                      <div
                        className="absolute flex items-center pointer-events-none"
                        style={{ left: barPos.left + barWidth - 4, top: top + (ROW_H - 18) / 2 }}
                      >
                        <WorkerAvatarStack
                          workers={assignedWorkers}
                          max={2}
                          size={18}
                          itemClassName="border-card"
                        />
                      </div>
                    )}
                    </React.Fragment>
                  );
                });
              })}

              {/* Dependency arrows */}
              <svg className="absolute inset-0 pointer-events-none" style={{ width: timelineWidth, height: layout.totalHeight }}>
                <defs>
                  <marker
                    id="arrowhead"
                    markerWidth="6"
                    markerHeight="6"
                    refX="5"
                    refY="3"
                    orient="auto"
                  >
                    <path d="M0.5 0.5 5 3 0.5 5.5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"
                      className="text-muted-foreground/60" />
                  </marker>
                </defs>
                {links.map((link) => {
                  const g = linkGeometry(link);
                  if (!g) return null;
                  return (
                    <g key={`link-${link.from}-${link.to}`}>
                      <path d={g.d} fill="none" stroke={g.stroke} strokeWidth="1.5" strokeLinecap="round" strokeDasharray="1 5" />
                      <circle cx={g.sx} cy={g.sy} r="2.5" fill={g.stroke} />
                      <circle cx={g.tx} cy={g.ty} r="2.5" fill={g.stroke} />
                    </g>
                  );
                })}
                {linking && (() => {
                  const source = elements.find((el) => el.id === linking.from);
                  const pos = source && getBarPosition(source);
                  const top = layout.tops.get(linking.from);
                  if (!pos || top === undefined) return null;
                  const sx = pos.left + Math.max(pos.width, 20);
                  const sy = barTopOf(top) + BAR_H / 2;
                  const reach = Math.min(90, Math.max(36, Math.abs(linking.x - sx) / 2));
                  return <path d={`M ${sx} ${sy} C ${sx + reach} ${sy}, ${linking.x - reach} ${linking.y}, ${linking.x} ${linking.y}`}
                    fill="none" stroke="var(--accent-default)" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="1 5" />;
                })()}
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
                          d={elbowPath(sourceX, sourceY, targetX, targetY, ROW_H)}
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.25"
                          strokeLinejoin="round"
                          className="text-muted-foreground/45"
                          markerEnd="url(#arrowhead)"
                        />
                      </g>
                    );
                  });
                })}
              </svg>

              {/* Each dependency's mark, at the middle of its line: what waits
                  for what, and the way to remove it. */}
              {links.map((link) => {
                const g = linkGeometry(link);
                if (!g) return null;
                const source = elements.find((el) => el.id === link.from);
                const target = elements.find((el) => el.id === link.to);
                return (
                  <DropdownMenu key={`mark-${link.from}-${link.to}`}>
                    <DropdownMenuTrigger asChild>
                      <button type="button" aria-label={`${source?.title ?? ''} → ${target?.title ?? ''}`}
                        className="absolute z-20 flex size-3.5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border bg-card transition-transform hover:scale-125"
                        style={{ left: (g.sx + g.tx) / 2, top: (g.sy + g.ty) / 2, borderColor: g.stroke }}>
                        <span className="h-px w-1.5" style={{ backgroundColor: g.stroke }} />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="min-w-[240px]">
                      <div className="flex items-center gap-2 px-2 py-1.5 text-[13px] text-foreground">
                        <ItemIcon icon={source?.icon ?? null} color={source?.color ?? null} size={14} fallback={<ObjectIcon size={14} />} />
                        <span className="min-w-0 truncate">{source?.title}</span>
                      </div>
                      <div className="px-2 py-1 text-[12px] text-muted-foreground">{t('Blocking')}</div>
                      <div className="flex items-center gap-2 px-2 py-1.5 text-[13px] text-foreground">
                        <ItemIcon icon={target?.icon ?? null} color={target?.color ?? null} size={14} fallback={<ObjectIcon size={14} />} />
                        <span className="min-w-0 truncate">{target?.title}</span>
                      </div>
                      {link.conflict && <div className="px-2 py-1 text-[12px] text-[var(--status-danger)]">{t('Dates overlap')}</div>}
                      {onLinkRemove && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="gap-2 text-[13px]" onSelect={() => onLinkRemove(link)}>
                            <X size={14} />{t('Remove dependency')}
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                );
              })}
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
              style={{ backgroundColor: statusColor(tooltip.element.status) }}
            />
            <span>{t(statusLabel(tooltip.element.status))}</span>
          </div>
          <div className="text-[11px] text-muted-foreground mt-1">
            {tooltip.element.start_date
              ? formatDate(parseDateOnly(tooltip.element.start_date, null)!, 'full', locale)
              : t('(no start)')}
            {' → '}
            {tooltip.element.due_date
              ? formatDate(parseDateOnly(tooltip.element.due_date, null)!, 'full', locale)
              : t('(no due date)')}
          </div>
        </div>
      )}
    </div>
  );
}

/** A dependency drawn as an elbow with rounded corners: out of the source's
 *  end, down (or up) to the target's row, into its start. A target that
 *  starts before the source ends is reached by going round, between rows. */
function elbowPath(sx: number, sy: number, tx: number, ty: number, rowH: number): string {
  const out = 10;
  const pts: [number, number][] = tx - out >= sx + out
    ? [[sx, sy], [Math.round((sx + tx) / 2), sy], [Math.round((sx + tx) / 2), ty], [tx, ty]]
    : (() => {
        const midY = sy + Math.sign(ty - sy || 1) * rowH / 2;
        return [[sx, sy], [sx + out, sy], [sx + out, midY], [tx - out, midY], [tx - out, ty], [tx, ty]];
      })();
  const radius = 6;
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1];
    const [cx, cy] = pts[i];
    const [nx, ny] = pts[i + 1];
    const r1 = Math.min(radius, Math.hypot(cx - px, cy - py) / 2, Math.hypot(nx - cx, ny - cy) / 2);
    const ax = cx - Math.sign(cx - px) * r1, ay = cy - Math.sign(cy - py) * r1;
    const bx = cx + Math.sign(nx - cx) * r1, by = cy + Math.sign(ny - cy) * r1;
    d += ` L ${ax} ${ay} Q ${cx} ${cy} ${bx} ${by}`;
  }
  const [ex, ey] = pts[pts.length - 1];
  return `${d} L ${ex} ${ey}`;
}

