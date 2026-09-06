'use client';

import { parseDateOnly, toDateOnlyString as fmtDateOnly } from '@/alcon/shared/dateUtils';
import { useState, useMemo, useEffect, useRef } from 'react';
import { CalendarPlus, ChevronLeft, ChevronRight, ChevronDown, X } from 'lucide-react';
import { Button } from '@/ui/button';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuRadioGroup, DropdownMenuRadioItem } from '@/ui/dropdown-menu';
import { MenuShell } from '@/alcon/shared/menu';
import { ObjectIcon } from '@/alcon/shared/conceptIcons';
import { useEscapeLayer } from '@/alcon/shared/keyboard';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover';
import type { ElementWithDetails, AlconObject } from '@/types/database';
import { calendarEntries, occursOn, layoutTimedEntries, type CalendarEntry } from './schedule';
import { COLOR_PALETTE } from './calendarColorPalette';
import { updateElement } from '@/hooks/useSupabase';
import { STATUS, statusColor, statusLabel, type StatusKey } from '@/shared/designTokens';
import { getCachedWeekStartsOn, usePreference } from '@/alcon/settings/preferencesStore';

interface CalendarViewProps {
  elements: ElementWithDetails[];
  objects?: AlconObject[];
  onObjectClick?: (object: AlconObject) => void;
  onElementClick?: (element: ElementWithDetails) => void;
  onRefresh?: () => void;
}

type CalendarMode = 'day' | 'week' | 'month';


// Soft card pair per status — the subtle ground plus the status hue, straight
// off the STATUS table so a calendar card and a list-row mark agree.
function statusCardClasses(status?: string | null): string {
  const meta = STATUS[status as StatusKey] ?? STATUS.todo;
  return `${meta.bg} text-foreground`;
}

// Day names
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Convert hex to soft pastel inline style (bg + text)
function pastelFromHex(hex: string): { backgroundColor: string; color: string; dotColor: string } {
  return {
    backgroundColor: `color-mix(in srgb, ${hex} 16%, var(--surface-bg))`,
    color: 'var(--text-primary)',
    dotColor: hex,
  };
}

// Time grid constants
const GRID_START_HOUR = 0;
const GRID_END_HOUR = 24;
const HOUR_HEIGHT = 48; // px per hour
const TOTAL_GRID_HEIGHT = (GRID_END_HOUR - GRID_START_HOUR) * HOUR_HEIGHT;

function getWeekDays(date: Date, weekStartsOn: number): Date[] {
  const d = new Date(date);
  const offset = (d.getDay() - weekStartsOn + 7) % 7;
  const start = new Date(d);
  start.setDate(d.getDate() - offset);
  start.setHours(0, 0, 0, 0);
  return Array.from({ length: 7 }, (_, i) => {
    const x = new Date(start);
    x.setDate(start.getDate() + i);
    return x;
  });
}

// WEEKDAYS rotated to start from Settings > Preferences > "First day of the
// week" — used only for the month-grid header row. Everywhere else looks up
// a specific date's label via WEEKDAYS[d.getDay()], which stays Sun-first.
function orderedWeekdayLabels(weekStartsOn: number): string[] {
  return Array.from({ length: 7 }, (_, i) => WEEKDAYS[(weekStartsOn + i) % 7]);
}

function parseTimeToMinutes(timeStr: string | null | undefined): number | null {
  if (!timeStr) return null;
  const parts = timeStr.split(':').map(Number);
  if (parts.length < 2 || parts.some(n => Number.isNaN(n))) return null;
  return parts[0] * 60 + parts[1];
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatHourLabel(hour: number): string {
  const period = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12} ${period}`;
}

function formatTimeShort(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function CalendarView({ elements: sourceElements, objects, onObjectClick, onElementClick: openElement, onRefresh }: CalendarViewProps) {
  const elements = useMemo(() => calendarEntries(sourceElements, objects), [sourceElements, objects]);
  const onElementClick = (entry: CalendarEntry) => {
    if (entry.object) onObjectClick?.(entry.object);
    else openElement?.(entry.element);
  };
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedElement, setSelectedElement] = useState<CalendarEntry | null>(null);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [mode, setMode] = useState<CalendarMode>('week');
  // Day-cell scheduler — click an empty spot on a day to drop an unscheduled
  // Element there (sets its due_date). Anchored at the click position.
  const [dayPicker, setDayPicker] = useState<{ date: Date; x: number; y: number } | null>(null);
  // Esc closes whichever of the two is open — one level each.
  useEscapeLayer(dayPicker !== null, () => setDayPicker(null));
  useEscapeLayer(showColorPicker, () => setShowColorPicker(false));
  // Settings > Preferences > "First day of the week" — this is the Calendar
  // view itself, so a change while it's already open (or open in another
  // tab, via WindowTabBar's parallel mounting) has to move the grid without
  // a reload (ELE_QLT-025).
  const weekStartsOn = usePreference(getCachedWeekStartsOn);

  // Get calendar data
  const calendarData = useMemo(() => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    const firstDay = new Date(year, month, 1);
    const startingDayOfWeek = (firstDay.getDay() - weekStartsOn + 7) % 7;
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
  }, [currentDate, weekStartsOn]);

  // Group elements by date
  const elementsByDate = useMemo(() => {
    const map: Record<string, CalendarEntry[]> = {};

    for (const day of calendarData) {
      map[day.date.toDateString()] = elements.filter(element => occursOn(element, fmtDateOnly(day.date)));
    }

    return map;
  }, [elements, calendarData]);

  // Elements with no due date — offered by the day-cell scheduler.
  const unscheduled = useMemo(
    () => elements.filter(e => e.element && !e.due_date && !e.start_date),
    [elements]
  );

  const hasEventsInCurrentMonth = useMemo(() => {
    const y = currentDate.getFullYear();
    const m = currentDate.getMonth();
    return elements.some(e => {
      const start = e.start_date ?? e.due_date;
      const end = e.due_date ?? e.start_date;
      return Boolean(start && end && start <= fmtDateOnly(new Date(y, m + 1, 0)) && end >= fmtDateOnly(new Date(y, m, 1)));
    });
  }, [elements, currentDate]);

  const goToPrevious = () => {
    setCurrentDate(prev => {
      if (mode === 'month') {
        return new Date(prev.getFullYear(), prev.getMonth() - 1, 1);
      }
      if (mode === 'week') {
        const d = new Date(prev);
        d.setDate(d.getDate() - 7);
        return d;
      }
      const d = new Date(prev);
      d.setDate(d.getDate() - 1);
      return d;
    });
  };

  const goToNext = () => {
    setCurrentDate(prev => {
      if (mode === 'month') {
        return new Date(prev.getFullYear(), prev.getMonth() + 1, 1);
      }
      if (mode === 'week') {
        const d = new Date(prev);
        d.setDate(d.getDate() + 7);
        return d;
      }
      const d = new Date(prev);
      d.setDate(d.getDate() + 1);
      return d;
    });
  };

  const goToToday = () => {
    setCurrentDate(new Date());
  };

  const handleColorChange = async (color: string | null) => {
    if (!selectedElement?.element) return;
    try {
      await updateElement(selectedElement.id, { color });
      setShowColorPicker(false);
      onRefresh?.();
    } catch (e) {
      console.error('Failed to update color:', e);
    }
  };

  const isOverdue = (element: CalendarEntry): boolean => {
    const due = parseDateOnly(element.due_date, null);
    if (!due || element.status === 'done') return false;
    return due < new Date(new Date().setHours(0, 0, 0, 0));
  };

  const scheduleOn = async (element: CalendarEntry, date: Date) => {
    if (!element.element) return;
    try {
      await updateElement(element.id, { due_date: fmtDateOnly(date) });
      setDayPicker(null);
      onRefresh?.();
    } catch (e) {
      console.error('Failed to schedule element:', e);
    }
  };

  // Resolve final pastel pair for an element — custom color wins, else status pastel
  const getCardStyle = (
    element: CalendarEntry
  ): { className: string; style?: React.CSSProperties; dotColor?: string } => {
    if (element.color) {
      const p = pastelFromHex(element.color);
      return {
        className: '',
        style: { backgroundColor: p.backgroundColor, color: p.color, borderLeft: `3px solid ${p.dotColor}` },
        dotColor: p.dotColor,
      };
    }
    return { className: statusCardClasses(element.status), style: { borderLeft: `3px solid ${statusColor(element.status)}` }, dotColor: undefined };
  };

  const today = new Date();

  const weekDays = useMemo(() => getWeekDays(currentDate, weekStartsOn), [currentDate, weekStartsOn]);

  const headerTitle = useMemo(() => {
    if (mode === 'month') {
      return currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    }
    if (mode === 'day') {
      return currentDate.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    }
    // week
    const start = weekDays[0];
    const end = weekDays[6];
    const sameMonth = start.getMonth() === end.getMonth();
    const startStr = start.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
    const endStr = sameMonth
      ? end.toLocaleDateString('en-US', { day: 'numeric' })
      : end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `${startStr} – ${endStr}, ${end.getFullYear()}`;
  }, [mode, currentDate, weekDays]);

  return (
    <div className="flex flex-col h-full bg-card">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-[var(--border-subtle)] bg-card">
        <Button size="sm" variant="secondary" onClick={goToToday}>Today</Button>
        <Button size="icon-sm" variant="ghost" onClick={goToPrevious} aria-label="Previous period"><ChevronLeft size={16} /></Button>
        <Button size="icon-sm" variant="ghost" onClick={goToNext} aria-label="Next period"><ChevronRight size={16} /></Button>
        <h2 className="text-base font-semibold flex-1 min-w-0">{headerTitle}</h2>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button size="sm" variant="secondary">{{ day: 'Day', week: 'Week', month: 'Month' }[mode]}<ChevronDown size={12} /></Button></DropdownMenuTrigger>
          <MenuShell as="dropdown" align="end">
            <DropdownMenuRadioGroup value={mode} onValueChange={value => setMode(value as CalendarMode)}>
              <DropdownMenuRadioItem value="day">Day</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="week">Week</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="month">Month</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </MenuShell>
        </DropdownMenu>
      </div>

      {/* Calendar Grid */}
      {mode === 'month' ? (
      <div className="flex-1 overflow-auto relative">
        {/* Weekday headers */}
        <div className="grid grid-cols-7 border-b border-border/60 bg-card/95 backdrop-blur sticky top-0 z-10">
          {orderedWeekdayLabels(weekStartsOn).map((day, i) => (
            <div
              key={`${day}-${i}`}
              className="px-2 py-2 text-center text-[11px] font-medium text-muted-foreground"
            >
              {day}
            </div>
          ))}
        </div>

        {/* Empty state overlay */}
        {!hasEventsInCurrentMonth && (
          <div className="pointer-events-none absolute inset-0 top-9 flex items-center justify-center z-[5]">
            <div className="text-xs text-muted-foreground/70 bg-card/60 px-3 py-1.5 rounded-md">
              No events this month — click a day to schedule an Element
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
                onClick={(e) => setDayPicker({ date: day.date, x: e.clientX, y: e.clientY })}
                className={`
                  group min-h-28 border-b border-r border-[var(--border-subtle)] p-2
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
                    <span className="bg-[var(--accent-default)] text-primary-foreground w-6 h-6 rounded-full flex items-center justify-center text-[12px] font-semibold">
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
                          setShowColorPicker(Boolean(element.element));
                        }}
                        className={`
                          group/chip w-full text-left rounded-md px-2 py-1
                          transition-colors hover:brightness-95
                          ${cardStyle.className}
                          ${overdue ? 'ring-1 ring-red-400/60' : ''}
                          ${isDone ? 'opacity-70' : ''}
                        `}
                        style={cardStyle.style}
                        title={`${element.title}${overdue ? ' (Overdue)' : ''}\nRight-click to change color`}
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          {element.object && <ObjectIcon size={12} />}
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
                            const dotColor = element.color || statusColor(statusKey);
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
                                  setShowColorPicker(Boolean(element.element));
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
                                    style={{ color: statusColor(statusKey) }}
                                  >
                                    {statusLabel(statusKey)}
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
      ) : (
        <div className="flex-1 min-h-0 overflow-x-auto flex">
        <TimeGridView
          days={mode === 'day' ? [currentDate] : weekDays}
          elements={elements}
          today={today}
          getCardStyle={getCardStyle}
          isOverdue={isOverdue}
          onElementClick={(el) => {
            setSelectedElement(el);
            onElementClick?.(el);
          }}
          onElementContextMenu={(el) => {
            setSelectedElement(el);
            setShowColorPicker(Boolean(el.element));
          }}
        />
        </div>
      )}

      {/* Day scheduler — click a day, pick an unscheduled Element to place
          there (writes its due_date). Lightweight fixed panel at the click
          point; the transparent overlay closes it on outside click. */}
      {dayPicker && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setDayPicker(null)} />
          <div
            className="fixed z-50 w-64 rounded-xl border border-border bg-popover text-popover-foreground shadow-md p-2"
            style={{
              left: Math.max(8, Math.min(dayPicker.x, window.innerWidth - 272)),
              top: Math.max(8, Math.min(dayPicker.y, window.innerHeight - 300)),
            }}
          >
            <div className="flex items-center justify-between px-1 pb-1.5 mb-1 border-b border-border/60">
              <span className="text-[12px] font-semibold">
                Schedule on{' '}
                {dayPicker.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </span>
              <button
                onClick={() => setDayPicker(null)}
                className="text-muted-foreground hover:text-foreground p-0.5 rounded-md hover:bg-muted/40 transition-colors"
                aria-label="Close"
              >
                <X size={13} />
              </button>
            </div>
            {unscheduled.length === 0 ? (
              <div className="px-1 py-3 text-[11px] text-muted-foreground flex items-center gap-1.5">
                <CalendarPlus size={13} className="shrink-0" />
                Every Element already has a due date.
              </div>
            ) : (
              <div className="max-h-56 overflow-y-auto space-y-0.5">
                {unscheduled.map(el => (
                  <button
                    key={el.id}
                    onClick={() => void scheduleOn(el, dayPicker.date)}
                    className="w-full text-left px-1.5 py-1.5 text-xs rounded-md hover:bg-muted transition-colors duration-150 flex items-center gap-2 min-w-0"
                  >
                    <span
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: el.color || statusColor(el.status) }}
                    />
                    <span className="truncate flex-1">{el.title}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Color Picker Modal */}
      {showColorPicker && selectedElement && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setShowColorPicker(false)}
        >
          <div
            className="bg-card rounded-lg shadow-xl p-4 w-[280px]"
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

// ─────────────────────────────────────────────────────────────────
// TimeGridView — Lunar/Google Calendar-style hour grid
// Used for both Day (1 column) and Week (7 columns) views
// ─────────────────────────────────────────────────────────────────

interface TimeGridViewProps {
  days: Date[];
  elements: CalendarEntry[];
  today: Date;
  getCardStyle: (
    el: CalendarEntry
  ) => { className: string; style?: React.CSSProperties; dotColor?: string };
  isOverdue: (el: CalendarEntry) => boolean;
  onElementClick: (el: CalendarEntry) => void;
  onElementContextMenu: (el: CalendarEntry) => void;
}

function TimeGridView({
  days,
  elements,
  today,
  getCardStyle,
  isOverdue,
  onElementClick,
  onElementContextMenu,
}: TimeGridViewProps) {
  const [now, setNow] = useState(new Date());
  const scrollRef = useRef<HTMLDivElement>(null);

  // Tick the now-line every minute
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Auto-scroll to ~current time on mount
  useEffect(() => {
    if (!scrollRef.current) return;
    const minutes = now.getHours() * 60 + now.getMinutes();
    const startMin = GRID_START_HOUR * 60;
    const top = ((minutes - startMin) / 60) * HOUR_HEIGHT - 120;
    scrollRef.current.scrollTop = Math.max(0, top);
    // Run only once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hours = useMemo(() => {
    const arr: number[] = [];
    for (let h = GRID_START_HOUR; h < GRID_END_HOUR; h++) arr.push(h);
    return arr;
  }, []);

  // Bucket elements per day → { allDay: [], timed: [] }
  const perDay = useMemo(() => {
    return days.map(day => {
      const allDay: CalendarEntry[] = [];
      const timed: CalendarEntry[] = [];
      elements.forEach(el => {
        if (!occursOn(el, fmtDateOnly(day))) return;
        if (el.start_time || el.due_time) timed.push(el);
        else allDay.push(el);
      });
      // Sort timed by start
      timed.sort((a, b) => {
        const am = parseTimeToMinutes(a.start_time ?? a.due_time) ?? 0;
        const bm = parseTimeToMinutes(b.start_time ?? b.due_time) ?? 0;
        return am - bm;
      });
      return { allDay, timed };
    });
  }, [days, elements]);

  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const gridStartMin = GRID_START_HOUR * 60;
  const gridEndMin = GRID_END_HOUR * 60;
  const showNowLine = nowMinutes >= gridStartMin && nowMinutes <= gridEndMin;
  const nowLineTop = ((nowMinutes - gridStartMin) / 60) * HOUR_HEIGHT;
  const todayColIdx = days.findIndex(d => isSameDay(d, today));

  const colWidthClass = 'flex-1 min-w-0';

  return (
    <div className={`flex-1 flex flex-col min-h-0 ${days.length > 1 ? "min-w-[640px]" : "min-w-0"}`}>
      {/* Day-of-week header row */}
      <div className="flex border-b border-border/60 bg-card/95 backdrop-blur sticky top-0 z-10">
        <div className="w-14 flex-shrink-0" />
        {days.map((d, i) => {
          const isTodayCol = isSameDay(d, today);
          return (
            <div
              key={i}
              className={`${colWidthClass} px-2 py-2 text-center border-l border-border/40 ${
                isTodayCol ? 'bg-[var(--accent-subtle)]' : ''
              }`}
            >
              <div className="text-[10px] text-muted-foreground">
                {WEEKDAYS[d.getDay()]}
              </div>
              <div className="mt-0.5 inline-flex items-center justify-center">
                {isTodayCol ? (
                  <span className="bg-[var(--accent-default)] text-primary-foreground w-6 h-6 rounded-full flex items-center justify-center text-[12px] font-semibold">
                    {d.getDate()}
                  </span>
                ) : (
                  <span className="text-[13px] font-medium text-foreground">{d.getDate()}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* All-day band */}
      <div className="flex border-b border-border/60 bg-card">
        <div className="w-14 flex-shrink-0 px-2 py-1.5 text-[10px] text-muted-foreground text-right">
          all-day
        </div>
        {perDay.map((bucket, i) => {
          const isTodayCol = todayColIdx === i;
          return (
            <div
              key={i}
              className={`${colWidthClass} border-l border-border/40 px-1 py-1 space-y-0.5 min-h-[28px] ${
                isTodayCol ? 'bg-[var(--accent-subtle)]' : ''
              }`}
            >
              {bucket.allDay.map(el => {
                const cs = getCardStyle(el);
                const overdue = isOverdue(el);
                const isDone = el.status === 'done';
                return (
                  <button
                    key={el.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      onElementClick(el);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      onElementContextMenu(el);
                    }}
                    className={`w-full text-left rounded-md px-2 py-0.5 transition-colors hover:brightness-95 ${cs.className} ${
                      overdue ? 'ring-1 ring-red-400/60' : ''
                    } ${isDone ? 'opacity-70' : ''}`}
                    style={cs.style}
                    title={el.title}
                  >
                    <span
                      className={`text-[11px] font-medium leading-tight truncate block ${
                        isDone ? 'line-through' : ''
                      }`}
                    >
                      {el.title}
                    </span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Scrollable hour grid */}
      <div ref={scrollRef} className="flex-1 overflow-auto relative">
        <div className="flex" style={{ height: TOTAL_GRID_HEIGHT }}>
          {/* Hour rail */}
          <div className="w-14 flex-shrink-0 relative">
            {hours.map(h => (
              <div
                key={h}
                className="absolute left-0 right-0 px-1 text-right text-[10px] text-muted-foreground"
                style={{ top: (h - GRID_START_HOUR) * HOUR_HEIGHT - 6, height: HOUR_HEIGHT }}
              >
                {formatHourLabel(h)}
              </div>
            ))}
          </div>

          {/* Day columns */}
          {perDay.map((bucket, colIdx) => {
            const isTodayCol = todayColIdx === colIdx;
            return (
              <div
                key={colIdx}
                className={`${colWidthClass} relative border-l border-border/40 ${
                  isTodayCol ? 'bg-[var(--accent-subtle)]' : ''
                }`}
              >
                {/* Hour grid lines */}
                {hours.map(h => (
                  <div
                    key={h}
                    className="absolute left-0 right-0 border-t border-border/30"
                    style={{ top: (h - GRID_START_HOUR) * HOUR_HEIGHT }}
                  />
                ))}
                {/* Half-hour faint lines */}
                {hours.map(h => (
                  <div
                    key={`half-${h}`}
                    className="absolute left-0 right-0 border-t border-dashed border-border/15"
                    style={{ top: (h - GRID_START_HOUR) * HOUR_HEIGHT + HOUR_HEIGHT / 2 }}
                  />
                ))}

                {/* Now line */}
                {isTodayCol && showNowLine && (
                  <div
                    className="absolute left-0 right-0 z-20 pointer-events-none"
                    style={{ top: nowLineTop }}
                  >
                    <div className="relative">
                      <div className="absolute -left-1 -top-[4px] w-2 h-2 rounded-full bg-red-500" />
                      <div className="h-px bg-red-500" />
                    </div>
                  </div>
                )}

                {/* Timed events */}
                {layoutTimedEntries(bucket.timed, fmtDateOnly(days[colIdx])).map(({ entry: el, start: startMin, end: endMin, lane, columns }) => {
                  // Position relative to grid start
                  const topMin = startMin - gridStartMin;
                  if (endMin <= gridStartMin || startMin >= gridEndMin) return null;
                  const clampedTop = Math.max(0, topMin);
                  const clampedBottom = Math.min(gridEndMin - gridStartMin, endMin - gridStartMin);
                  const top = (clampedTop / 60) * HOUR_HEIGHT;
                  const height = Math.max(18, ((clampedBottom - clampedTop) / 60) * HOUR_HEIGHT - 2);

                  const cs = getCardStyle(el);
                  const overdue = isOverdue(el);
                  const isDone = el.status === 'done';
                  const timeLabel = `${formatTimeShort(startMin)} – ${formatTimeShort(endMin)}`;

                  return (
                    <button
                      key={el.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        onElementClick(el);
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        onElementContextMenu(el);
                      }}
                      className={`absolute z-10 text-left rounded-md px-1.5 py-1 overflow-hidden transition-colors hover:brightness-95 ${cs.className} ${
                        overdue ? 'ring-1 ring-red-400/60' : ''
                      } ${isDone ? 'opacity-70' : ''}`}
                      style={{ top, height, left: `calc(${lane / columns * 100}% + 4px)`, width: `calc(${100 / columns}% - 8px)`, ...cs.style }}
                      title={`${el.title}\n${timeLabel}`}
                    >
                      <div
                        className={`text-[11px] font-medium leading-tight truncate ${
                          isDone ? 'line-through' : ''
                        }`}
                      >
                        {el.title}
                      </div>
                      {height > 28 && (
                        <div className="text-[10px] opacity-80 leading-tight truncate">
                          {timeLabel}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
