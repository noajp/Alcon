'use client';

import { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight, X, Plus } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { ElementWithDetails } from '@/hooks/useSupabase';
import { updateElement } from '@/hooks/useSupabase';

interface CalendarViewProps {
  elements: ElementWithDetails[];
  onElementClick?: (element: ElementWithDetails) => void;
  onRefresh?: () => void;
}

type CalendarMode = 'day' | 'week' | 'month';

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

// Status fallback dot color (used in popover)
const STATUS_COLORS: Record<string, string> = {
  todo: '#94a3b8',
  in_progress: '#3b82f6',
  review: '#a855f7',
  done: '#22c55e',
  blocked: '#ef4444',
};

// Pastel pair (background + text) per status — Lunar/Linear style soft cards
const STATUS_PASTEL: Record<string, { bg: string; text: string; dot: string }> = {
  todo: { bg: 'bg-slate-100', text: 'text-slate-700', dot: 'bg-slate-400' },
  in_progress: { bg: 'bg-blue-100', text: 'text-blue-700', dot: 'bg-blue-500' },
  review: { bg: 'bg-purple-100', text: 'text-purple-700', dot: 'bg-purple-500' },
  done: { bg: 'bg-emerald-100', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  blocked: { bg: 'bg-rose-100', text: 'text-rose-700', dot: 'bg-rose-500' },
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

// Convert hex to soft pastel inline style (bg + text)
function pastelFromHex(hex: string): { backgroundColor: string; color: string; dotColor: string } {
  // Parse #rrggbb
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  // Lighter pastel (mix with white ~85%)
  const mix = (c: number) => Math.round(c + (255 - c) * 0.82);
  const bgR = mix(r);
  const bgG = mix(g);
  const bgB = mix(b);
  // Darker text (mix with black ~30%)
  const dark = (c: number) => Math.round(c * 0.55);
  const tR = dark(r);
  const tG = dark(g);
  const tB = dark(b);
  return {
    backgroundColor: `rgb(${bgR}, ${bgG}, ${bgB})`,
    color: `rgb(${tR}, ${tG}, ${tB})`,
    dotColor: hex,
  };
}

export function CalendarView({ elements, onElementClick, onRefresh }: CalendarViewProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedElement, setSelectedElement] = useState<ElementWithDetails | null>(null);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [mode, setMode] = useState<CalendarMode>('month');

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

    for (let i = startingDayOfWeek - 1; i >= 0; i--) {
      days.push({
        date: new Date(year, month - 1, prevMonthLastDay - i),
        isCurrentMonth: false,
        isToday: false,
      });
    }

    const today = new Date();
    for (let i = 1; i <= daysInMonth; i++) {
      const date = new Date(year, month, i);
      days.push({
        date,
        isCurrentMonth: true,
        isToday: date.toDateString() === today.toDateString(),
      });
    }

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

  const isOverdue = (element: ElementWithDetails): boolean => {
    if (!element.due_date || element.status === 'done') return false;
    return new Date(element.due_date) < new Date(new Date().setHours(0, 0, 0, 0));
  };

  // Resolve final pastel pair for an element — custom color wins, else status pastel
  const getCardStyle = (
    element: ElementWithDetails
  ): { className: string; style?: React.CSSProperties; dotColor?: string } => {
    if (element.color) {
      const p = pastelFromHex(element.color);
      return {
        className: '',
        style: { backgroundColor: p.backgroundColor, color: p.color },
        dotColor: p.dotColor,
      };
    }
    const statusKey = element.status || 'todo';
    const pastel = STATUS_PASTEL[statusKey] || STATUS_PASTEL.todo;
    return { className: `${pastel.bg} ${pastel.text}`, dotColor: undefined };
  };

  const monthYear = currentDate.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });

  const today = new Date();
  const isSameMonthAsToday =
    currentDate.getFullYear() === today.getFullYear() &&
    currentDate.getMonth() === today.getMonth();

  const handleModeChange = (next: CalendarMode) => {
    if (next === 'month') {
      setMode('month');
      return;
    }
    // Day / Week not implemented yet
    if (typeof window !== 'undefined') {
      window.alert(`${next === 'day' ? 'Day' : 'Week'} view is coming soon.`);
    }
  };

  const handleAddEvent = () => {
    if (typeof window !== 'undefined') {
      window.alert('Click any day to add an event (coming soon).');
    }
  };

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

          {/* Day / Week / Month segmented toggle */}
          <div className="inline-flex items-center rounded-md bg-muted/40 p-0.5">
            {(['day', 'week', 'month'] as CalendarMode[]).map(m => {
              const isActive = mode === m;
              const isDisabled = m !== 'month';
              return (
                <button
                  key={m}
                  onClick={() => handleModeChange(m)}
                  title={isDisabled ? 'Coming soon' : undefined}
                  className={`h-6 px-2.5 text-[11px] font-medium rounded-[5px] transition-colors duration-150 capitalize ${
                    isActive
                      ? 'bg-foreground text-background shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  } ${isDisabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  {m}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-3">
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
              <span
                className={`tabular-nums font-medium ${
                  stats.overdue > 0 ? 'text-red-600' : 'text-foreground/80'
                }`}
              >
                {stats.overdue}
              </span>
              <span>overdue</span>
            </span>
          </div>

          {/* Add event */}
          <button
            onClick={handleAddEvent}
            className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-[11px] font-medium bg-foreground text-background hover:bg-foreground/90 transition-colors duration-150"
            title="Add event"
          >
            <Plus size={12} />
            New
          </button>
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
                  group min-h-[110px] border-b border-r border-border/40 p-1.5
                  transition-colors duration-150 cursor-pointer flex flex-col
                  ${
                    !day.isCurrentMonth
                      ? 'bg-muted/20'
                      : isWeekend
                      ? 'bg-muted/10 hover:bg-muted/30'
                      : 'hover:bg-muted/30'
                  }
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
                <div className="space-y-0.5 flex-1 overflow-hidden">
                  {dayElements.slice(0, 3).map(element => {
                    const cardStyle = getCardStyle(element);
                    const overdue = isOverdue(element);
                    const isDone = element.status === 'done';
                    const isHighPriority =
                      element.priority === 'high' || element.priority === 'urgent';
                    const priorityDotColor =
                      element.priority === 'urgent' ? 'bg-red-500' : 'bg-orange-400';

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
                          group/chip w-full text-left rounded-md px-2 py-1
                          transition-all duration-150 hover:brightness-95 hover:shadow-sm
                          ${cardStyle.className}
                          ${overdue ? 'ring-1 ring-red-400/60' : ''}
                          ${isDone ? 'opacity-70' : ''}
                        `}
                        style={cardStyle.style}
                        title={`${element.title}${overdue ? ' (Overdue)' : ''}\nRight-click to change color`}
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span
                            className={`text-[11px] font-medium leading-tight truncate flex-1 ${
                              isDone ? 'line-through' : ''
                            }`}
                          >
                            {element.title}
                          </span>
                          {isHighPriority && (
                            <span
                              className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${priorityDotColor}`}
                              title={element.priority || ''}
                            />
                          )}
                        </div>
                      </button>
                    );
                  })}
                  {dayElements.length > 3 && (
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          onClick={(e) => e.stopPropagation()}
                          className="text-[10px] text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded-md hover:bg-muted transition-colors duration-150 cursor-pointer font-medium"
                        >
                          +{dayElements.length - 3} more
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
                            const statusKey = element.status || 'todo';
                            const dotColor = element.color || STATUS_COLORS[statusKey];
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
                                    style={{ backgroundColor: dotColor }}
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
