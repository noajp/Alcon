'use client';

import { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight, X, LayoutGrid } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { ElementWithDetails } from '@/hooks/useSupabase';
import { updateElement } from '@/hooks/useSupabase';

interface CalendarViewProps {
  elements: ElementWithDetails[];
  onElementClick?: (element: ElementWithDetails) => void;
  onRefresh?: () => void;
}

// Predefined color palette
const COLOR_PALETTE = [
  { name: 'Blue', value: '#3b82f6' },
  { name: 'Green', value: '#22c55e' },
  { name: 'Yellow', value: '#eab308' },
  { name: 'Orange', value: '#f97316' },
  { name: 'Red', value: '#ef4444' },
  { name: 'Pink', value: '#ec4899' },
  { name: 'Purple', value: '#a855f7' },
  { name: 'Indigo', value: '#6366f1' },
  { name: 'Teal', value: '#14b8a6' },
  { name: 'Gray', value: '#6b7280' },
];

// Status colors for fallback
const STATUS_COLORS: Record<string, string> = {
  todo: '#94a3b8',
  in_progress: '#3b82f6',
  review: '#a855f7',
  done: '#22c55e',
  blocked: '#ef4444',
};

const STATUS_LABELS: Record<string, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  review: 'Review',
  done: 'Done',
  blocked: 'Blocked',
};

// Day names
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function CalendarView({ elements, onElementClick, onRefresh }: CalendarViewProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedElement, setSelectedElement] = useState<ElementWithDetails | null>(null);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [groupByStatus, setGroupByStatus] = useState(false);

  // Get calendar data
  const calendarData = useMemo(() => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    const firstDay = new Date(year, month, 1);
    const startingDayOfWeek = firstDay.getDay();
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const prevMonthLastDay = new Date(year, month, 0).getDate();

    const days: { date: Date; isCurrentMonth: boolean; isToday: boolean }[] = [];

    // Previous month days
    for (let i = startingDayOfWeek - 1; i >= 0; i--) {
      days.push({
        date: new Date(year, month - 1, prevMonthLastDay - i),
        isCurrentMonth: false,
        isToday: false,
      });
    }

    // Current month days
    const today = new Date();
    for (let i = 1; i <= daysInMonth; i++) {
      const date = new Date(year, month, i);
      days.push({
        date,
        isCurrentMonth: true,
        isToday: date.toDateString() === today.toDateString(),
      });
    }

    // Next month days
    const remainingDays = 42 - days.length;
    for (let i = 1; i <= remainingDays; i++) {
      days.push({
        date: new Date(year, month + 1, i),
        isCurrentMonth: false,
        isToday: false,
      });
    }

    return days;
  }, [currentDate]);

  // Group elements by date
  const elementsByDate = useMemo(() => {
    const map: Record<string, ElementWithDetails[]> = {};

    elements.forEach(element => {
      if (element.due_date) {
        const dateKey = new Date(element.due_date).toDateString();
        if (!map[dateKey]) {
          map[dateKey] = [];
        }
        map[dateKey].push(element);
      }
    });

    return map;
  }, [elements]);

  // Stats
  const stats = useMemo(() => {
    const withDueDate = elements.filter(e => e.due_date);
    const overdue = withDueDate.filter(e => {
      if (!e.due_date || e.status === 'done') return false;
      return new Date(e.due_date) < new Date(new Date().setHours(0, 0, 0, 0));
    });
    const dueToday = withDueDate.filter(e => {
      if (!e.due_date) return false;
      return new Date(e.due_date).toDateString() === new Date().toDateString();
    });
    return { total: withDueDate.length, overdue: overdue.length, dueToday: dueToday.length };
  }, [elements]);

  // Whether any events fall in the currently displayed month
  const hasEventsInCurrentMonth = useMemo(() => {
    const y = currentDate.getFullYear();
    const m = currentDate.getMonth();
    return elements.some(e => {
      if (!e.due_date) return false;
      const d = new Date(e.due_date);
      return d.getFullYear() === y && d.getMonth() === m;
    });
  }, [elements, currentDate]);

  const goToPreviousMonth = () => {
    setCurrentDate(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  };

  const goToNextMonth = () => {
    setCurrentDate(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  };

  const goToToday = () => {
    setCurrentDate(new Date());
  };

  const handleColorChange = async (color: string | null) => {
    if (!selectedElement) return;
    try {
      await updateElement(selectedElement.id, { color });
      setShowColorPicker(false);
      onRefresh?.();
    } catch (e) {
      console.error('Failed to update color:', e);
    }
  };

  const getElementColor = (element: ElementWithDetails): string => {
    if (element.color) return element.color;
    return STATUS_COLORS[element.status || 'todo'];
  };

  const isOverdue = (element: ElementWithDetails): boolean => {
    if (!element.due_date || element.status === 'done') return false;
    return new Date(element.due_date) < new Date(new Date().setHours(0, 0, 0, 0));
  };

  const monthYear = currentDate.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });

  // Is currentDate on the same month as today?
  const today = new Date();
  const isSameMonthAsToday =
    currentDate.getFullYear() === today.getFullYear() &&
    currentDate.getMonth() === today.getMonth();

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header / toolbar */}
      <div className="sticky top-0 z-20 flex items-center justify-between gap-4 px-4 py-2.5 border-b border-border/60 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <div className="flex items-center gap-3">
          {/* Segmented Prev / Today / Next */}
          <div className="inline-flex items-center rounded-md border border-border/60 bg-muted/40 overflow-hidden">
            <button
              onClick={goToPreviousMonth}
              className="h-7 w-7 inline-flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors duration-150"
              aria-label="Previous month"
            >
              <ChevronLeft size={14} />
            </button>
            <button
              onClick={goToToday}
              className={`h-7 px-2.5 text-[12px] font-medium border-x border-border/60 transition-colors duration-150 ${
                isSameMonthAsToday
                  ? 'text-foreground hover:bg-muted'
                  : 'bg-foreground text-background hover:bg-foreground/90'
              }`}
            >
              Today
            </button>
            <button
              onClick={goToNextMonth}
              className="h-7 w-7 inline-flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors duration-150"
              aria-label="Next month"
            >
              <ChevronRight size={14} />
            </button>
          </div>

          <h2 className="text-base font-semibold tracking-tight">{monthYear}</h2>

          {/* Group by status visual chip */}
          <button
            onClick={() => setGroupByStatus(v => !v)}
            className={`hidden md:inline-flex items-center gap-1.5 h-7 px-2 rounded-md text-[11px] font-medium border transition-colors duration-150 ${
              groupByStatus
                ? 'border-foreground/20 bg-muted text-foreground'
                : 'border-border/60 bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
            title="Group by status"
          >
            <LayoutGrid size={12} />
            Group by status
          </button>
        </div>

        {/* Stats pill */}
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60" />
            <span className="tabular-nums text-foreground/80 font-medium">{stats.total}</span>
            <span>scheduled</span>
          </span>
          <span className="text-border">·</span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
            <span className="tabular-nums text-foreground/80 font-medium">{stats.dueToday}</span>
            <span>due today</span>
          </span>
          <span className="text-border">·</span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
            <span className={`tabular-nums font-medium ${stats.overdue > 0 ? 'text-red-600' : 'text-foreground/80'}`}>
              {stats.overdue}
            </span>
            <span>overdue</span>
          </span>
        </div>
      </div>

      {/* Calendar Grid */}
      <div className="flex-1 overflow-auto relative">
        {/* Weekday headers */}
        <div className="grid grid-cols-7 border-b border-border/60 bg-background/95 backdrop-blur sticky top-0 z-10">
          {WEEKDAYS.map(day => (
            <div
              key={day}
              className="px-2 py-2 text-center text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
            >
              {day}
            </div>
          ))}
        </div>

        {/* Empty state overlay */}
        {!hasEventsInCurrentMonth && (
          <div className="pointer-events-none absolute inset-0 top-9 flex items-center justify-center z-[5]">
            <div className="text-xs text-muted-foreground/70 bg-background/60 px-3 py-1.5 rounded-md">
              No events this month
            </div>
          </div>
        )}

        {/* Calendar days */}
        <div className="grid grid-cols-7">
          {calendarData.map((day, index) => {
            const dateKey = day.date.toDateString();
            const dayElements = elementsByDate[dateKey] || [];
            const isWeekend = day.date.getDay() === 0 || day.date.getDay() === 6;

            return (
              <div
                key={index}
                className={`
                  group min-h-[120px] border-b border-r border-border/40 p-1.5
                  transition-colors duration-150 cursor-pointer
                  ${!day.isCurrentMonth ? 'bg-muted/20' : isWeekend ? 'bg-muted/10 hover:bg-muted/30' : 'hover:bg-muted/30'}
                `}
              >
                {/* Date number */}
                <div className="flex justify-start mb-1">
                  {day.isToday ? (
                    <span className="bg-blue-500 text-white w-6 h-6 rounded-full flex items-center justify-center text-[12px] font-semibold">
                      {day.date.getDate()}
                    </span>
                  ) : (
                    <span
                      className={`text-[12px] font-medium px-1 ${
                        day.isCurrentMonth ? 'text-foreground' : 'text-muted-foreground/40'
                      }`}
                    >
                      {day.date.getDate()}
                    </span>
                  )}
                </div>

                {/* Elements */}
                <div className="space-y-1 overflow-y-auto max-h-[85px]">
                  {dayElements.slice(0, 4).map(element => {
                    const color = getElementColor(element);
                    const overdue = isOverdue(element);
                    const isDone = element.status === 'done';

                    return (
                      <button
                        key={element.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedElement(element);
                          onElementClick?.(element);
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setSelectedElement(element);
                          setShowColorPicker(true);
                        }}
                        className={`
                          group/chip w-full text-left px-1.5 py-0.5 text-[11px] rounded-md font-medium truncate
                          transition-all duration-150 hover:brightness-110 hover:ring-1 hover:ring-foreground/10
                          ${overdue ? 'ring-1 ring-red-400/60' : ''}
                        `}
                        style={
                          isDone
                            ? { backgroundColor: color, color: '#ffffff' }
                            : { backgroundColor: `${color}26`, color: color }
                        }
                        title={`${element.title}${overdue ? ' (Overdue)' : ''}\nRight-click to change color`}
                      >
                        <div className="flex items-center gap-1.5">
                          <span
                            className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                            style={{ backgroundColor: isDone ? '#ffffff' : color }}
                          />
                          <span className={`truncate ${isDone ? 'line-through opacity-90' : ''}`}>
                            {element.title}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                  {dayElements.length > 4 && (
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          onClick={(e) => e.stopPropagation()}
                          className="text-[10px] text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded-md hover:bg-muted transition-colors duration-150 cursor-pointer font-medium"
                        >
                          +{dayElements.length - 4} more
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="w-72 p-3" align="start">
                        <div className="mb-2.5 pb-2 border-b border-border/60">
                          <div className="text-sm font-semibold tracking-tight">
                            {day.date.toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                            })}{' '}
                            <span className="text-muted-foreground font-normal">
                              ({day.date.toLocaleDateString('en-US', { weekday: 'short' })})
                            </span>
                          </div>
                          <div className="text-[11px] text-muted-foreground mt-0.5">
                            {dayElements.length} {dayElements.length === 1 ? 'item' : 'items'}
                          </div>
                        </div>
                        <div className="space-y-0.5 max-h-[280px] overflow-y-auto -mx-1 px-1">
                          {dayElements.map(element => {
                            const elColor = getElementColor(element);
                            const statusKey = element.status || 'todo';
                            return (
                              <button
                                key={element.id}
                                onClick={() => {
                                  setSelectedElement(element);
                                  onElementClick?.(element);
                                }}
                                onContextMenu={(e) => {
                                  e.preventDefault();
                                  setSelectedElement(element);
                                  setShowColorPicker(true);
                                }}
                                className="w-full text-left px-2 py-1.5 text-xs rounded-md hover:bg-muted transition-colors duration-150"
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <span
                                    className="w-2 h-2 rounded-full flex-shrink-0"
                                    style={{ backgroundColor: elColor }}
                                  />
                                  <span
                                    className={`truncate flex-1 ${
                                      element.status === 'done' ? 'line-through opacity-60' : ''
                                    }`}
                                  >
                                    {element.title}
                                  </span>
                                  <span
                                    className="text-[10px] text-muted-foreground flex-shrink-0"
                                    style={{ color: STATUS_COLORS[statusKey] }}
                                  >
                                    {STATUS_LABELS[statusKey] || statusKey}
                                  </span>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </PopoverContent>
                    </Popover>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Color Picker Modal */}
      {showColorPicker && selectedElement && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setShowColorPicker(false)}
        >
          <div
            className="bg-background rounded-lg shadow-xl p-4 w-[280px]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-medium text-sm">Change Color</h3>
              <button
                onClick={() => setShowColorPicker(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X size={16} />
              </button>
            </div>
            <p className="text-xs text-muted-foreground mb-3 truncate">{selectedElement.title}</p>
            <div className="grid grid-cols-5 gap-2">
              {COLOR_PALETTE.map(color => (
                <button
                  key={color.value}
                  onClick={() => handleColorChange(color.value)}
                  className={`w-10 h-10 rounded-lg transition-transform hover:scale-110 ${
                    selectedElement.color === color.value ? 'ring-2 ring-primary ring-offset-2' : ''
                  }`}
                  style={{ backgroundColor: color.value }}
                  title={color.name}
                />
              ))}
            </div>
            <button
              onClick={() => handleColorChange(null)}
              className="w-full mt-3 px-3 py-2 text-xs text-muted-foreground hover:bg-muted rounded transition-colors"
            >
              Reset to default (status-based)
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
