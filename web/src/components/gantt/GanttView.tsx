'use client';

import React, { useState, useMemo, useRef, useEffect } from 'react';
import type { ElementWithDetails } from '@/hooks/useSupabase';
import type { AlconObjectWithChildren } from '@/types/database';
import { updateElement } from '@/hooks/useSupabase';
import { ChevronRight, ChevronDown, ZoomIn, ZoomOut, Calendar, ArrowRight } from 'lucide-react';

interface GanttViewProps {
  elements: ElementWithDetails[];
  object?: AlconObjectWithChildren;
  onRefresh?: () => void;
}

type ZoomLevel = 'day' | 'week' | 'month';

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
function formatDate(date: Date, format: 'short' | 'full' = 'short'): string {
  if (format === 'full') {
    return date.toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' });
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
    } else {
      current.setMonth(current.getMonth() + 1);
    }
  }

  return headers;
}

// Status colors for Gantt bars
const statusColors: Record<string, string> = {
  todo: 'bg-gray-400',
  in_progress: 'bg-yellow-500',
  review: 'bg-cyan-400',
  done: 'bg-green-500',
  blocked: 'bg-red-500',
  backlog: 'bg-gray-300',
  cancelled: 'bg-gray-300',
};

export function GanttView({ elements, object, onRefresh }: GanttViewProps) {
  const [zoom, setZoom] = useState<ZoomLevel>('day');
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['__all__']));
  const [selectedElement, setSelectedElement] = useState<string | null>(null);
  const [dragging, setDragging] = useState<{ elementId: string; type: 'move' | 'resize-start' | 'resize-end'; startX: number; originalStart: Date | null; originalEnd: Date | null } | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Calculate date range
  const dateRange = useMemo(() => getDateRange(elements), [elements]);
  const totalDays = daysBetween(dateRange.start, dateRange.end);

  // Column width based on zoom
  const columnWidth = zoom === 'day' ? 40 : zoom === 'week' ? 80 : 120;
  const timelineWidth = totalDays * columnWidth;

  // Generate timeline headers
  const timelineHeaders = useMemo(
    () => generateTimelineHeaders(dateRange.start, dateRange.end, zoom),
    [dateRange.start, dateRange.end, zoom]
  );

  // Group elements by section
  const elementsBySection = useMemo(() => {
    const grouped: { section: string | null; elements: ElementWithDetails[] }[] = [];
    const sectionMap = new Map<string | null, ElementWithDetails[]>();

    elements.forEach(el => {
      const section = el.section || null;
      if (!sectionMap.has(section)) {
        sectionMap.set(section, []);
      }
      sectionMap.get(section)!.push(el);
    });

    sectionMap.forEach((els, section) => {
      grouped.push({ section, elements: els });
    });

    return grouped;
  }, [elements]);

  // Calculate position for a task bar
  const getBarPosition = (element: ElementWithDetails): { left: number; width: number } | null => {
    const startDate = element.start_date ? new Date(element.start_date) : null;
    const endDate = element.due_date ? new Date(element.due_date) : null;

    if (!startDate && !endDate) return null;

    const effectiveStart = startDate || endDate!;
    const effectiveEnd = endDate || startDate!;

    // Calculate days from timeline start
    const daysFromStart = daysBetween(dateRange.start, effectiveStart);
    const duration = Math.max(1, daysBetween(effectiveStart, effectiveEnd));

    return {
      left: daysFromStart * columnWidth,
      width: duration * columnWidth,
    };
  };

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

  // Handle drag move
  useEffect(() => {
    if (!dragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - dragging.startX;
      const daysDelta = Math.round(deltaX / columnWidth);

      if (daysDelta === 0) return;

      const element = elements.find(el => el.id === dragging.elementId);
      if (!element) return;

      // Calculate new dates based on drag type
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

      // Update element temporarily (visual feedback)
      // Actual save happens on mouse up
    };

    const handleMouseUp = async () => {
      if (!dragging) return;

      const deltaX = document.body.style.cursor === 'grabbing' ? 0 : 0;
      const daysDelta = Math.round((dragging.startX - dragging.startX) / columnWidth);

      // Calculate final dates
      let newStartDate = dragging.originalStart ? new Date(dragging.originalStart) : null;
      let newEndDate = dragging.originalEnd ? new Date(dragging.originalEnd) : null;

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

      setDragging(null);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragging, elements, columnWidth, onRefresh]);

  // Scroll to today on mount
  useEffect(() => {
    if (timelineRef.current && containerRef.current) {
      const today = new Date();
      const daysFromStart = daysBetween(dateRange.start, today);
      const scrollPosition = (daysFromStart * columnWidth) - (containerRef.current.clientWidth / 2);
      timelineRef.current.scrollLeft = Math.max(0, scrollPosition);
    }
  }, [dateRange.start, columnWidth]);

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
    const key = section || '__no_section__';
    const newExpanded = new Set(expandedSections);
    if (newExpanded.has(key)) {
      newExpanded.delete(key);
    } else {
      newExpanded.add(key);
    }
    setExpandedSections(newExpanded);
  };

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">Gantt Chart</span>
          {object?.description && (
            <span className="text-xs text-muted-foreground">{object.description}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Zoom controls */}
          <div className="flex items-center gap-1 bg-muted rounded-md p-0.5">
            <button
              onClick={() => setZoom('day')}
              className={`px-2 py-1 text-xs rounded ${zoom === 'day' ? 'bg-background shadow-sm' : 'hover:bg-background/50'}`}
            >
              日
            </button>
            <button
              onClick={() => setZoom('week')}
              className={`px-2 py-1 text-xs rounded ${zoom === 'week' ? 'bg-background shadow-sm' : 'hover:bg-background/50'}`}
            >
              週
            </button>
            <button
              onClick={() => setZoom('month')}
              className={`px-2 py-1 text-xs rounded ${zoom === 'month' ? 'bg-background shadow-sm' : 'hover:bg-background/50'}`}
            >
              月
            </button>
          </div>
          <button
            onClick={() => {
              if (timelineRef.current && containerRef.current) {
                const today = new Date();
                const daysFromStart = daysBetween(dateRange.start, today);
                const scrollPosition = (daysFromStart * columnWidth) - (containerRef.current.clientWidth / 2);
                timelineRef.current.scrollTo({ left: Math.max(0, scrollPosition), behavior: 'smooth' });
              }
            }}
            className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted rounded"
          >
            <Calendar size={14} />
            今日
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden" ref={containerRef}>
        {/* Left panel - Task list */}
        <div className="w-64 min-w-64 border-r border-border flex flex-col bg-background">
          {/* Header */}
          <div className="h-12 flex items-center px-3 border-b border-border bg-muted/30">
            <span className="text-xs font-medium text-muted-foreground">タスク名</span>
          </div>

          {/* Task list */}
          <div className="flex-1 overflow-y-auto">
            {elementsBySection.map(({ section, elements: sectionElements }) => {
              const sectionKey = section || '__no_section__';
              const isExpanded = expandedSections.has(sectionKey) || expandedSections.has('__all__');

              return (
                <div key={sectionKey}>
                  {/* Section header */}
                  {section && (
                    <button
                      onClick={() => toggleSection(section)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/50 border-b border-border"
                    >
                      {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      <span className="text-xs font-semibold text-foreground">{section}</span>
                      <span className="text-[10px] text-muted-foreground">({sectionElements.length})</span>
                    </button>
                  )}

                  {/* Tasks */}
                  {isExpanded && sectionElements.map((element) => (
                    <div
                      key={element.id}
                      onClick={() => setSelectedElement(selectedElement === element.id ? null : element.id)}
                      className={`flex items-center gap-2 px-3 py-2 border-b border-border cursor-pointer transition-colors ${
                        selectedElement === element.id ? 'bg-primary/10' : 'hover:bg-muted/30'
                      }`}
                    >
                      <div className={`w-2 h-2 rounded-full ${statusColors[element.status || 'todo']}`} />
                      <span className="text-xs text-foreground truncate flex-1">{element.title}</span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right panel - Timeline */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {/* Timeline header */}
          <div className="h-12 border-b border-border overflow-x-auto" ref={timelineRef} style={{ scrollbarWidth: 'none' }}>
            <div className="flex h-full" style={{ width: timelineWidth }}>
              {timelineHeaders.map((header, idx) => (
                <div
                  key={idx}
                  className={`flex-shrink-0 flex items-center justify-center border-r border-border text-[10px] ${
                    header.isToday ? 'bg-primary/20 text-primary font-semibold' :
                    header.isWeekend ? 'bg-muted/50 text-muted-foreground' : 'text-muted-foreground'
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
            className="flex-1 overflow-auto"
            onScroll={(e) => {
              // Sync header scroll with body scroll
              if (timelineRef.current) {
                timelineRef.current.scrollLeft = e.currentTarget.scrollLeft;
              }
            }}
          >
            <div className="relative" style={{ width: timelineWidth, minHeight: '100%' }}>
              {/* Grid background */}
              <div className="absolute inset-0 flex">
                {timelineHeaders.map((header, idx) => (
                  <div
                    key={idx}
                    className={`flex-shrink-0 border-r border-border/50 ${
                      header.isWeekend ? 'bg-muted/30' : ''
                    }`}
                    style={{ width: columnWidth }}
                  />
                ))}
              </div>

              {/* Today line */}
              {(() => {
                const today = new Date();
                const daysFromStart = daysBetween(dateRange.start, today);
                const leftPos = daysFromStart * columnWidth + (columnWidth / 2);
                if (leftPos > 0 && leftPos < timelineWidth) {
                  return (
                    <div
                      className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-10"
                      style={{ left: leftPos }}
                    />
                  );
                }
                return null;
              })()}

              {/* Task bars */}
              {elementsBySection.map(({ section, elements: sectionElements }) => {
                const sectionKey = section || '__no_section__';
                const isExpanded = expandedSections.has(sectionKey) || expandedSections.has('__all__');
                if (!isExpanded && section) return null;

                // Calculate vertical offset
                let rowIndex = 0;
                if (section) rowIndex++; // Account for section header

                return sectionElements.map((element, elIdx) => {
                  const barPos = getBarPosition(element);
                  if (!barPos) {
                    rowIndex++;
                    return null;
                  }

                  const currentRow = rowIndex;
                  rowIndex++;

                  const topOffset = section
                    ? (elementsBySection.findIndex(s => s.section === section) + 1) * 36 + currentRow * 36
                    : currentRow * 36;

                  return (
                    <div
                      key={element.id}
                      className={`absolute h-6 rounded-md cursor-pointer transition-all group ${
                        statusColors[element.status || 'todo']
                      } ${selectedElement === element.id ? 'ring-2 ring-primary ring-offset-1' : 'hover:brightness-110'}`}
                      style={{
                        left: barPos.left,
                        width: Math.max(barPos.width, 20),
                        top: topOffset + 5,
                      }}
                      onClick={() => setSelectedElement(selectedElement === element.id ? null : element.id)}
                      onMouseDown={(e) => handleDragStart(e, element.id, 'move')}
                    >
                      {/* Resize handles */}
                      <div
                        className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize opacity-0 group-hover:opacity-100 bg-black/20 rounded-l-md"
                        onMouseDown={(e) => handleDragStart(e, element.id, 'resize-start')}
                      />
                      <div
                        className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize opacity-0 group-hover:opacity-100 bg-black/20 rounded-r-md"
                        onMouseDown={(e) => handleDragStart(e, element.id, 'resize-end')}
                      />

                      {/* Task label */}
                      <div className="absolute inset-0 flex items-center px-2 overflow-hidden">
                        <span className="text-[10px] text-white font-medium truncate drop-shadow-sm">
                          {barPos.width > 60 ? element.title : ''}
                        </span>
                      </div>

                      {/* Progress indicator */}
                      {element.status === 'done' && (
                        <div className="absolute inset-0 bg-black/10 rounded-md" />
                      )}
                    </div>
                  );
                });
              })}

              {/* Dependency arrows */}
              <svg className="absolute inset-0 pointer-events-none" style={{ width: timelineWidth, height: '100%' }}>
                {elements.map(element => {
                  const deps = getDependencies(element);
                  const targetPos = getBarPosition(element);
                  if (!targetPos || deps.length === 0) return null;

                  return deps.map(dep => {
                    const sourcePos = getBarPosition(dep);
                    if (!sourcePos) return null;

                    // Calculate arrow coordinates
                    const sourceX = sourcePos.left + sourcePos.width;
                    const sourceY = 20; // Approximate
                    const targetX = targetPos.left;
                    const targetY = 20;

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
              </svg>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
