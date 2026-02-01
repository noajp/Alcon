'use client';

import { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight, Circle, CheckCircle2, X, Calendar, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
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

// Day names
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function CalendarView({ elements, onElementClick, onRefresh }: CalendarViewProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedElement, setSelectedElement] = useState<ElementWithDetails | null>(null);
  const [showColorPicker, setShowColorPicker] = useState(false);

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
    year: 'numeric'
  });

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={goToToday}>
              Today
            </Button>
            <div className="flex items-center">
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={goToPreviousMonth}>
                <ChevronLeft size={16} />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={goToNextMonth}>
                <ChevronRight size={16} />
              </Button>
            </div>
            <h2 className="text-lg font-semibold">{monthYear}</h2>
          </div>

          {/* Stats */}
          <div className="flex items-center gap-3 text-xs">
            <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-muted/50">
              <Calendar size={12} className="text-muted-foreground" />
              <span className="text-muted-foreground">{stats.total} scheduled</span>
            </div>
            {stats.dueToday > 0 && (
              <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-blue-500/10">
                <Clock size={12} className="text-blue-500" />
                <span className="text-blue-600">{stats.dueToday} due today</span>
              </div>
            )}
            {stats.overdue > 0 && (
              <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-red-500/10">
                <Clock size={12} className="text-red-500" />
                <span className="text-red-600">{stats.overdue} overdue</span>
              </div>
            )}
          </div>
        </div>

        {/* Color Legend */}
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="font-medium">Colors:</span>
          {COLOR_PALETTE.slice(0, 5).map(color => (
            <div key={color.value} className="flex items-center gap-1">
              <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: color.value }} />
              <span>{color.name}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Calendar Grid */}
      <div className="flex-1 overflow-auto">
        {/* Weekday headers */}
        <div className="grid grid-cols-7 border-b border-border bg-muted/30 sticky top-0 z-10">
          {WEEKDAYS.map(day => (
            <div
              key={day}
              className="px-2 py-2 text-center text-xs font-medium text-muted-foreground"
            >
              {day}
            </div>
          ))}
        </div>

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
                  min-h-[120px] border-b border-r border-border p-1.5
                  ${!day.isCurrentMonth ? 'bg-muted/20' : ''}
                  ${isWeekend && day.isCurrentMonth ? 'bg-muted/10' : ''}
                `}
              >
                {/* Date number */}
                <div className="flex justify-end mb-1">
                  <span
                    className={`
                      text-sm px-1.5 py-0.5 rounded-full
                      ${day.isToday
                        ? 'bg-primary text-primary-foreground font-semibold'
                        : day.isCurrentMonth
                          ? 'text-foreground'
                          : 'text-muted-foreground/50'
                      }
                    `}
                  >
                    {day.date.getDate()}
                  </span>
                </div>

                {/* Elements */}
                <div className="space-y-0.5 overflow-y-auto max-h-[85px]">
                  {dayElements.slice(0, 4).map(element => {
                    const color = getElementColor(element);
                    const overdue = isOverdue(element);

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
                          w-full text-left px-1.5 py-1 text-xs rounded
                          transition-all hover:opacity-80 truncate
                          ${overdue ? 'ring-1 ring-red-400' : ''}
                        `}
                        style={{
                          backgroundColor: `${color}20`,
                          borderLeft: `3px solid ${color}`,
                        }}
                        title={`${element.title}${overdue ? ' (Overdue)' : ''}\nRight-click to change color`}
                      >
                        <div className="flex items-center gap-1">
                          {element.status === 'done' ? (
                            <CheckCircle2 size={10} className="flex-shrink-0" style={{ color }} />
                          ) : (
                            <Circle size={10} className="flex-shrink-0" style={{ color }} />
                          )}
                          <span className={`truncate ${element.status === 'done' ? 'line-through opacity-60' : ''}`}>
                            {element.title}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                  {dayElements.length > 4 && (
                    <div className="text-[10px] text-muted-foreground px-1.5 py-0.5">
                      +{dayElements.length - 4} more
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Color Picker Modal */}
      {showColorPicker && selectedElement && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowColorPicker(false)}>
          <div className="bg-background rounded-lg shadow-xl p-4 w-[280px]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-medium text-sm">Change Color</h3>
              <button onClick={() => setShowColorPicker(false)} className="text-muted-foreground hover:text-foreground">
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
