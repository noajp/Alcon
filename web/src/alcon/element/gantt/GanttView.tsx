'use client';

import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import type { ElementWithDetails } from '@/hooks/useSupabase';
import type { AlconObjectWithChildren } from '@/types/database';
import { updateElement } from '@/hooks/useSupabase';
import { ChevronRight, ChevronDown, CalendarDays, CalendarRange } from 'lucide-react';
import { ObjectIcon } from '@/shell/icons';
import { SEMANTIC_COLORS, STATUS } from '@/shared/designTokens';

interface GanttViewProps {
  elements: ElementWithDetails[];
  object?: AlconObjectWithChildren;
  onRefresh?: () => void;
}

type ZoomLevel = 'day' | 'week' | 'month' | 'quarter';

// Helper to get date range for the timeline
function getDateRange(elements: ElementWithDetails[], padding: number = 7): { start: Date; end: Date } {
  const now = new Date();
  let minDate = new Date(now);
  let maxDate = new Date(now);
  maxDate.setDate(maxDate.getDate() + 30); // Default to 30 days ahead

  elements.forEach(el => {
    if (el.start_date) {
      const start = new Date(el.start_date);
      if (start < minDate) minDate = new Date(start);
    }
    if (el.due_date) {
      const end = new Date(el.due_date);
      if (end > maxDate) maxDate = new Date(end);
    }
  });

  // Add padding
  minDate.setDate(minDate.getDate() - padding);
  maxDate.setDate(maxDate.getDate() + padding);

  return { start: minDate, end: maxDate };
}

// Helper to calculate days between dates
function daysBetween(start: Date, end: Date): number {
  const diffTime = end.getTime() - start.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

// Helper to format date
function formatDate(date: Date, format: 'short' | 'full' | 'pill' = 'short'): string {
  if (format === 'full') {
    return date.toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' });
  }
  if (format === 'pill') {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  return date.toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' });
}

// Generate timeline headers based on zoom level
function generateTimelineHeaders(start: Date, end: Date, zoom: ZoomLevel): { date: Date; label: string; isWeekend: boolean; isToday: boolean }[] {
  const headers: { date: Date; label: string; isWeekend: boolean; isToday: boolean }[] = [];
  const current = new Date(start);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  while (current <= end) {
    const isWeekend = current.getDay() === 0 || current.getDay() === 6;
    const isToday = current.toDateString() === today.toDateString();

    let label = '';
    if (zoom === 'day') {
      label = current.getDate().toString();
    } else if (zoom === 'week') {
      label = `W${Math.ceil(current.getDate() / 7)}`;
    } else if (zoom === 'quarter') {
      const q = Math.floor(current.getMonth() / 3) + 1;
      label = `Q${q} ${current.getFullYear()}`;
    } else {
      label = current.toLocaleDateString('ja-JP', { month: 'short' });
    }

    headers.push({
      date: new Date(current),
      label,
      isWeekend,
      isToday,
    });

    if (zoom === 'day') {
      current.setDate(current.getDate() + 1);
    } else if (zoom === 'week') {
      current.setDate(current.getDate() + 7);
    } else if (zoom === 'quarter') {
      current.setMonth(current.getMonth() + 3);
    } else {
      current.setMonth(current.getMonth() + 1);
    }
  }

  return headers;
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

export function GanttView({ elements, object, onRefresh }: GanttViewProps) {
  const [zoom, setZoom] = useState<ZoomLevel>('day');
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [selectedElement, setSelectedElement] = useState<string | null>(null);
  const [dragging, setDragging] = useState<{ elementId: string; type: 'move' | 'resize-start' | 'resize-end'; startX: number; originalStart: Date | null; originalEnd: Date | null } | null>(null);
  const [dragDaysDelta, setDragDaysDelta] = useState(0);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; element: ElementWithDetails } | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const bodyScrollRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastMouseXRef = useRef(0);

  // Calculate date range
  const dateRange = useMemo(() => getDateRange(elements), [elements]);
  const totalDays = daysBetween(dateRange.start, dateRange.end);

  // Column width based on zoom
  const columnWidth = zoom === 'day' ? 40 : zoom === 'week' ? 80 : zoom === 'month' ? 120 : 200;
  const timelineWidth = totalDays * columnWidth;

  // Generate timeline headers
  const timelineHeaders = useMemo(
    () => generateTimelineHeaders(dateRange.start, dateRange.end, zoom),
    [dateRange.start, dateRange.end, zoom]
  );

  // Build object_id → name mapping from the object tree
  const objectNameMap = useMemo(() => {
    const map = new Map<string, string>();
    const traverse = (obj: AlconObjectWithChildren) => {
      map.set(obj.id, obj.name);
      obj.children?.forEach(traverse);
    };
    if (object) traverse(object);
    return map;
  }, [object]);

  // Group elements by child Object (if parent has children) or by section
  const elementsBySection = useMemo(() => {
    const grouped: { section: string | null; elements: ElementWithDetails[] }[] = [];
    const sectionMap = new Map<string | null, ElementWithDetails[]>();

    elements.forEach(el => {
      // Group by parent Object name. Sections are gone — flat grouping by
      // object_id keeps Gantt's bands stable across renames.
      const key = el.object_id ? objectNameMap.get(el.object_id) ?? null : null;
      if (!sectionMap.has(key)) {
        sectionMap.set(key, []);
      }
      sectionMap.get(key)!.push(el);
    });

    sectionMap.forEach((els, section) => {
      grouped.push({ section, elements: els });
    });

    return grouped;
  }, [elements, objectNameMap]);

  // Count of elements with at least a start or due date
  const scheduledCount = useMemo(
    () => elements.filter(el => el.start_date || el.due_date).length,
    [elements]
  );

  // Compute vertical layout: precompute top-offsets per element id
  const layout = useMemo(() => {
    const tops = new Map<string, number>();
    const sectionTops = new Map<string, number>(); // sectionKey → top
    let y = 0;
    elementsBySection.forEach(({ section, elements: sectionElements }) => {
      const sectionKey = section ?? '__no_section__';
      if (section) {
        sectionTops.set(sectionKey, y);
        y += SECTION_HEADER_H;
      }
      const isCollapsed = collapsedSections.has(sectionKey);
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

  // Calculate position for a task bar (with drag offset applied)
  const getBarPosition = useCallback((element: ElementWithDetails): { left: number; width: number } | null => {
    let startDate = element.start_date ? new Date(element.start_date) : null;
    let endDate = element.due_date ? new Date(element.due_date) : null;

    if (!startDate && !endDate) return null;

    // Apply drag offset for the element being dragged
    if (dragging && dragging.elementId === element.id && dragDaysDelta !== 0) {
      if (dragging.type === 'move') {
        if (startDate) { startDate = new Date(startDate); startDate.setDate(startDate.getDate() + dragDaysDelta); }
        if (endDate) { endDate = new Date(endDate); endDate.setDate(endDate.getDate() + dragDaysDelta); }
      } else if (dragging.type === 'resize-start' && startDate) {
        startDate = new Date(startDate);
        startDate.setDate(startDate.getDate() + dragDaysDelta);
      } else if (dragging.type === 'resize-end' && endDate) {
        endDate = new Date(endDate);
        endDate.setDate(endDate.getDate() + dragDaysDelta);
      }
    }

    const effectiveStart = startDate ?? endDate!;
    const effectiveEnd = endDate ?? startDate!;

    const daysFromStart = daysBetween(dateRange.start, effectiveStart);
    const duration = Math.max(1, daysBetween(effectiveStart, effectiveEnd));

    return {
      left: daysFromStart * columnWidth,
      width: duration * columnWidth,
    };
  }, [dateRange.start, columnWidth, dragging, dragDaysDelta]);

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
      originalStart: element.start_date ? new Date(element.start_date) : null,
      originalEnd: element.due_date ? new Date(element.due_date) : null,
    });
  };

  // Handle drag move and mouse up
  useEffect(() => {
    if (!dragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      lastMouseXRef.current = e.clientX;
      const deltaX = e.clientX - dragging.startX;
      const delta = Math.round(deltaX / columnWidth);
      setDragDaysDelta(delta);
    };

    const handleMouseUp = async (e: MouseEvent) => {
      if (!dragging) return;

      const deltaX = e.clientX - dragging.startX;
      const daysDelta = Math.round(deltaX / columnWidth);

      if (daysDelta !== 0) {
        // Calculate final dates
        let newStartDate = dragging.originalStart ? new Date(dragging.originalStart) : null;
        let newEndDate = dragging.originalEnd ? new Date(dragging.originalEnd) : null;

        if (dragging.type === 'move') {
          if (newStartDate) newStartDate.setDate(newStartDate.getDate() + daysDelta);
          if (newEndDate) newEndDate.setDate(newEndDate.getDate() + daysDelta);
        } else if (dragging.type === 'resize-start' && newStartDate) {
          newStartDate.setDate(newStartDate.getDate() + daysDelta);
        } else if (dragging.type === 'resize-end' && newEndDate) {
          newEndDate.setDate(newEndDate.getDate() + daysDelta);
        }

        // Save to database
        try {
          const updates: { start_date?: string; due_date?: string } = {};
          if (newStartDate) updates.start_date = newStartDate.toISOString().split('T')[0];
          if (newEndDate) updates.due_date = newEndDate.toISOString().split('T')[0];

          if (Object.keys(updates).length > 0) {
            await updateElement(dragging.elementId, updates);
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
  }, [dragging, columnWidth, onRefresh]);

  const scrollToToday = useCallback((smooth: boolean) => {
    const today = new Date();
    const daysFromStart = daysBetween(dateRange.start, today);
    const containerW = containerRef.current?.clientWidth ?? 0;
    const scrollPosition = (daysFromStart * columnWidth) - (containerW / 2);
    const target = Math.max(0, scrollPosition);
    if (bodyScrollRef.current) {
      bodyScrollRef.current.scrollTo({ left: target, behavior: smooth ? 'smooth' : 'auto' });
    }
    if (timelineRef.current) {
      timelineRef.current.scrollLeft = target;
    }
  }, [dateRange.start, columnWidth]);

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

  const toggleSection = (section: string | null) => {
    const key = section ?? '__no_section__';
    const next = new Set(collapsedSections);
    if (next.has(key)) next.delete(key); else next.add(key);
    setCollapsedSections(next);
  };

  const todayStr = formatDate(new Date(), 'pill');

  // Empty state
  if (scheduledCount === 0) {
    return (
      <div className="flex flex-col h-full bg-card">
        <div className="sticky top-0 z-30 flex items-center justify-between px-4 py-2.5 border-b border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-foreground">Timeline</span>
            {object?.name && <span className="text-xs text-muted-foreground">{object.name}</span>}
          </div>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
          <div className="w-12 h-12 rounded-full bg-muted/60 flex items-center justify-center mb-4">
            <CalendarRange size={22} className="text-muted-foreground" />
          </div>
          <p className="text-sm font-medium text-foreground">No scheduled items in this view</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-xs">
            Add start and due dates to elements to see them on the timeline.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-card">
      {/* Sticky Toolbar */}
      <div className="sticky top-0 z-30 flex items-center justify-between px-4 py-2.5 border-b border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-foreground">Timeline</span>
          {object?.name && (
            <span className="text-xs text-muted-foreground">{object.name}</span>
          )}
          <span className="text-[11px] text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded-full">
            {scheduledCount} {scheduledCount === 1 ? 'element' : 'elements'} scheduled
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* Segmented zoom control */}
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
        {/* Left panel - Task list */}
        <div className="w-64 min-w-64 border-r border-border flex flex-col bg-card">
          {/* Header */}
          <div className="h-12 flex items-center px-3 border-b border-border bg-muted/20">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Elements</span>
          </div>

          {/* Task list */}
          <div className="flex-1 overflow-y-auto">
            {elementsBySection.map(({ section, elements: sectionElements }) => {
              const sectionKey = section ?? '__no_section__';
              const isCollapsed = collapsedSections.has(sectionKey);

              return (
                <div key={sectionKey} className={section ? 'mb-2' : ''}>
                  {/* Section header */}
                  {section && (
                    <button
                      onClick={() => toggleSection(section)}
                      className="w-full flex items-center gap-1.5 px-2.5 h-8 text-left bg-muted/40 hover:bg-muted/60 border-b border-border/60 transition-colors group"
                      title={isCollapsed ? 'Expand' : 'Collapse'}
                    >
                      <span className="w-3.5 h-3.5 flex items-center justify-center text-muted-foreground/70 group-hover:text-foreground transition-colors">
                        {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                      </span>
                      <span className="w-3.5 h-3.5 flex items-center justify-center text-muted-foreground shrink-0">
                        <ObjectIcon size={12} />
                      </span>
                      <span className="text-[12px] font-medium text-foreground truncate flex-1">{section}</span>
                      <span className="text-[10px] font-medium text-muted-foreground tabular-nums shrink-0 px-1.5 py-px rounded-full bg-card/80 border border-border/40">
                        {sectionElements.length}
                      </span>
                    </button>
                  )}

                  {/* Tasks */}
                  {!isCollapsed && sectionElements.map((element) => {
                    const isDone = element.status === 'done';
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
                      </div>
                    );
                  })}
                  {section && <div style={{ height: SECTION_GAP }} />}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right panel - Timeline */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {/* Timeline header */}
          <div className="h-12 border-b border-border overflow-x-hidden bg-muted/20" ref={timelineRef} style={{ scrollbarWidth: 'none' }}>
            <div className="flex h-full" style={{ width: timelineWidth }}>
              {timelineHeaders.map((header, idx) => (
                <div
                  key={idx}
                  className={`flex-shrink-0 flex items-center justify-center border-r border-border/60 text-[10px] ${
                    header.isToday ? 'text-red-600 font-semibold' :
                    header.isWeekend ? 'bg-muted/40 text-muted-foreground' : 'text-muted-foreground'
                  }`}
                  style={{ width: columnWidth }}
                >
                  {header.label}
                </div>
              ))}
            </div>
          </div>

          {/* Timeline body */}
          <div
            ref={bodyScrollRef}
            className="flex-1 overflow-auto"
            onScroll={(e) => {
              // Sync header scroll with body scroll
              if (timelineRef.current) {
                timelineRef.current.scrollLeft = e.currentTarget.scrollLeft;
              }
            }}
          >
            <div className="relative" style={{ width: timelineWidth, minHeight: Math.max(layout.totalHeight, 100) }}>
              {/* Grid background */}
              <div className="absolute inset-0 flex">
                {timelineHeaders.map((header, idx) => (
                  <div
                    key={idx}
                    className={`flex-shrink-0 border-r border-border/40 ${
                      header.isWeekend ? 'bg-muted/20' : ''
                    }`}
                    style={{ width: columnWidth }}
                  />
                ))}
              </div>

              {/* Section row tints */}
              {elementsBySection.map(({ section }) => {
                if (!section) return null;
                const sectionKey = section;
                const top = layout.sectionTops.get(sectionKey);
                if (top === undefined) return null;
                return (
                  <div
                    key={`tint-${sectionKey}`}
                    className="absolute left-0 right-0 bg-muted/30 pointer-events-none"
                    style={{ top, height: SECTION_HEADER_H, width: timelineWidth }}
                  />
                );
              })}

              {/* Today line with pill label */}
              {(() => {
                const today = new Date();
                const daysFromStart = daysBetween(dateRange.start, today);
                const leftPos = daysFromStart * columnWidth + (columnWidth / 2);
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

              {/* Task bars */}
              {elementsBySection.map(({ section, elements: sectionElements }) => {
                const sectionKey = section ?? '__no_section__';
                const isCollapsed = collapsedSections.has(sectionKey);
                if (isCollapsed) return null;

                return sectionElements.map((element) => {
                  const barPos = getBarPosition(element);
                  if (!barPos) return null;
                  const top = layout.tops.get(element.id);
                  if (top === undefined) return null;

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
                              {formatDate(new Date(element.due_date), 'pill')}
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
              ? formatDate(new Date(tooltip.element.start_date), 'full')
              : '(no start)'}
            {' \u2192 '}
            {tooltip.element.due_date
              ? formatDate(new Date(tooltip.element.due_date), 'full')
              : '(no due date)'}
          </div>
        </div>
      )}
    </div>
  );
}
