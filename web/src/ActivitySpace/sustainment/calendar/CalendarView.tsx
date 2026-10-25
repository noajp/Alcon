'use client';

import { toDateOnlyString as fmtDateOnly, dayNumberOf, shiftDateOnly, isSameDay, isOverdue as isDueDayPast } from '@/Function/shared/dateUtils';
import { useState, useMemo, useEffect, useRef } from 'react';
import { CalendarPlus, ChevronLeft, ChevronRight, ChevronDown, X } from 'lucide-react';
import { Button, ButtonAppearanceProvider } from '@/ui/button';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuRadioGroup, DropdownMenuRadioItem } from '@/ui/dropdown-menu';
import { MenuShell } from '@/Function/shared/menu';
import { ObjectIcon } from '@/Function/shared/conceptIcons';
import { useEscapeLayer } from '@/Function/shared/keyboard';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover';
import type { ElementWithDetails, AlconObject } from '@/types/database';
import { calendarEntries, occursOn, layoutTimedEntries, layoutWeekSpans, type CalendarEntry } from './schedule';
import { COLOR_PALETTE } from './calendarColorPalette';
import { updateElement } from '@/hooks/useSupabase';
import { STATUS, statusColor, statusLabel, type StatusKey } from '@/shared/designTokens';
import { getCachedWeekStartsOn, usePreference } from '@/Function/settings/preferencesStore';
import { useI18n } from '@/Function/i18n/I18nProvider';

interface CalendarViewProps {
  elements: ElementWithDetails[];
  objects?: AlconObject[];
  onObjectClick?: (object: AlconObject) => void;
  onElementClick?: (element: ElementWithDetails) => void;
  onRefresh?: () => void;
  /** The day the grid is on, when a parent (the Calendar sidebar) owns it. */
  date?: Date;
  onDateChange?: (date: Date) => void;
}

type CalendarMode = 'day' | 'week' | 'month';

// Soft card pair per status — the subtle ground plus the status hue, straight
// off the STATUS table so a calendar card and a list-row mark agree.
function statusCardClasses(status?: string | null): string {
  const meta = STATUS[status as StatusKey] ?? STATUS.todo;
  return `${meta.bg} text-foreground`;
}

// Day names follow the interface language (Settings > Language); `day` is
// getDay()'s Sun-first index.
function weekdayLabel(locale: string, day: number): string {
  return new Date(2023, 0, 1 + day).toLocaleDateString(locale, { weekday: 'short' });
}

// Convert hex to soft pastel inline style (bg + text)
function pastelFromHex(hex: string): { backgroundColor: string; color: string; dotColor: string } {
  return {
    backgroundColor: `color-mix(in srgb, ${hex} 16%, var(--surface-bg))`,
    color: 'var(--text-primary)',
    dotColor: hex,
  };
}

// Month grid: bands are stacked in lanes under the date row; a day showing
// more than this many collapses the rest into "+N more".
const MONTH_MAX_LANES = 3;
const MONTH_LANE_HEIGHT = 22;   // px per lane
const MONTH_LANE_TOP = 34;      // px from the row's top to the first lane (date row + gap)

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

// Day names rotated to start from Settings > Preferences > "First day of the
// week" — used only for the month-grid header row. Everywhere else looks up
// a specific date's label via weekdayLabel(locale, d.getDay()).
function orderedWeekdayLabels(locale: string, weekStartsOn: number): string[] {
  return Array.from({ length: 7 }, (_, i) => weekdayLabel(locale, (weekStartsOn + i) % 7));
}

function parseTimeToMinutes(timeStr: string | null | undefined): number | null {
  if (!timeStr) return null;
  const parts = timeStr.split(':').map(Number);
  if (parts.length < 2 || parts.some(n => Number.isNaN(n))) return null;
  return parts[0] * 60 + parts[1];
}

function formatHourLabel(locale: string, hour: number): string {
  return new Date(2023, 0, 1, hour).toLocaleTimeString(locale, { hour: 'numeric' });
}

function formatTimeShort(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function CalendarView({ elements: sourceElements, objects, onObjectClick, onElementClick: openElement, onRefresh, date, onDateChange }: CalendarViewProps) {
  const { t, locale } = useI18n();
  const elements = useMemo(() => calendarEntries(sourceElements, objects), [sourceElements, objects]);
  const onElementClick = (entry: CalendarEntry) => {
    if (entry.object) onObjectClick?.(entry.object);
    else openElement?.(entry.element);
  };
  const [ownDate, setOwnDate] = useState(new Date());
  const currentDate = date ?? ownDate;
  const setCurrentDate = (next: Date | ((prev: Date) => Date)) => {
    const value = typeof next === 'function' ? next(currentDate) : next;
    setOwnDate(value);
    onDateChange?.(value);
  };
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
  // kept view, via the shell's parallel mounting) has to move the grid without
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

  // The month grid as rows of seven, each laid out on its own.
  const weekRows = useMemo(() => Array.from({ length: calendarData.length / 7 }, (_, w) => calendarData.slice(w * 7, w * 7 + 7)), [calendarData]);

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

  const isOverdue = (element: CalendarEntry): boolean => isDueDayPast(element.due_date, element.status === 'done');

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

  // Dragging a chip to another day moves the whole Element, not just its end:
  // an Element that runs a week stays a week long, shifted by the days the
  // chip travelled. Grabbing it on any of the days it covers works — the day
  // under the pointer at pick-up is the anchor, so the shift is what the hand
  // actually did rather than a jump measured from the end date.
  const [dragging, setDragging] = useState<{ id: string; from: string } | null>(null);
  const [dragError, setDragError] = useState<string | null>(null);

  const moveTo = async (entry: CalendarEntry, grabbedOn: string, dropOn: string) => {
    if (!entry.element || grabbedOn === dropOn) return;
    // The Element can move underneath a drag — another tab, or the sync
    // stream. The shift is measured from the day the chip was picked up, so
    // once that day is no longer one the Element covers, the measurement is of
    // a position nobody is looking at any more.
    if (!occursOn(entry, grabbedOn)) {
      setDragError(t('{title} changed dates while you were dragging it. Nothing was moved.', { title: entry.title }));
      return;
    }
    const shift = dayNumberOf(dropOn) - dayNumberOf(grabbedOn);
    if (!shift) return;
    const patch: { start_date?: string; due_date?: string } = {};
    if (entry.start_date) patch.start_date = shiftDateOnly(entry.start_date, shift);
    if (entry.due_date) patch.due_date = shiftDateOnly(entry.due_date, shift);
    if (!patch.start_date && !patch.due_date) return;
    setDragError(null);
    try {
      await updateElement(entry.id, patch);
      onRefresh?.();
    } catch (e) {
      console.error('Failed to move element:', e);
      setDragError(t('{title} could not be moved. It is still on its original date.', { title: entry.title }));
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
      return currentDate.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
    }
    if (mode === 'day') {
      return currentDate.toLocaleDateString(locale, {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    }
    // week — formatRange collapses the shared parts the way each language
    // does it ("Sep 13 – 19, 2026" / "2026年9月13日～19日").
    return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric' })
      .formatRange(weekDays[0], weekDays[6]);
  }, [mode, currentDate, weekDays, locale]);

  return (
    <div className="flex flex-col h-full bg-card">
      {dragError && (
        // A move that did not land has to say so: the chip springs back to
        // where it was, which on its own looks like the drag was never taken.
        <p role="alert" className="flex items-center gap-2 px-4 py-2 text-sm text-destructive">
          {dragError}
          <Button size="xs" variant="ghost" onClick={() => setDragError(null)}>{t('Dismiss')}</Button>
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-[var(--border-subtle)] bg-card">
        <Button size="sm" variant="secondary" onClick={goToToday}>{t('Today')}</Button>
        <ButtonAppearanceProvider appearance="navigation">
          <Button size="icon-sm" variant="ghost" onClick={goToPrevious} aria-label={t('Previous period')}><ChevronLeft size={16} /></Button>
          <Button size="icon-sm" variant="ghost" onClick={goToNext} aria-label={t('Next period')}><ChevronRight size={16} /></Button>
        </ButtonAppearanceProvider>
        <h2 className="text-base font-semibold flex-1 min-w-0">{headerTitle}</h2>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button size="sm" variant="secondary">{t({ day: 'Day', week: 'Week', month: 'Month' }[mode])}<ChevronDown size={12} /></Button></DropdownMenuTrigger>
          <MenuShell as="dropdown" align="end">
            <DropdownMenuRadioGroup value={mode} onValueChange={value => setMode(value as CalendarMode)}>
              <DropdownMenuRadioItem value="day">{t('Day')}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="week">{t('Week')}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="month">{t('Month')}</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </MenuShell>
        </DropdownMenu>
      </div>

      {/* Calendar Grid */}
      {mode === 'month' ? (
      <div className="flex-1 overflow-auto relative">
        {/* Weekday headers */}
        <div className="grid grid-cols-7 border-b border-border/60 bg-card/95 backdrop-blur sticky top-0 z-10">
          {orderedWeekdayLabels(locale, weekStartsOn).map((day, i) => (
            <div
              key={`${day}-${i}`}
              className="px-2 py-2 text-center text-[11px] font-medium text-muted-foreground"
            >
              {day}
            </div>
          ))}
        </div>

        {/* Calendar weeks — each week is one row: seven day cells carry the
            date, the hover "+" / right-click scheduler and the drop target,
            and over them the Elements are drawn as bands from their first
            day to their last (clipped to the week), so a span reads as one
            thing rather than a chip repeated in every cell. */}
        {weekRows.map((week, w) => {
          const days = week.map(day => fmtDateOnly(day.date));
          const spans = layoutWeekSpans(elements, days);
          const visibleSpans = spans.filter(span => span.lane < MONTH_MAX_LANES);
          const hiddenByCol = week.map((_, col) => spans.filter(span => span.lane >= MONTH_MAX_LANES && span.startCol <= col && col <= span.endCol).length);
          // Which day a pointer is over inside this row — bands cover the
          // cells, so their drags and drops resolve the day from the x.
          const dayAt = (row: HTMLElement, clientX: number) => {
            const rect = row.getBoundingClientRect();
            const col = Math.min(6, Math.max(0, Math.floor(((clientX - rect.left) / rect.width) * 7)));
            return days[col];
          };
          const dropOn = (e: React.DragEvent<HTMLElement>, day: string) => {
            e.preventDefault();
            if (!dragging) return;
            const entry = elements.find((el) => el.id === dragging.id);
            const from = dragging.from;
            setDragging(null);
            if (entry) void moveTo(entry, from, day);
          };
          return (
            <div key={w} className="relative grid grid-cols-7">
              {week.map((day, col) => {
                const dateKey = day.date.toDateString();
                const dayElements = elementsByDate[dateKey] || [];
                const isWeekend = day.date.getDay() === 0 || day.date.getDay() === 6;
                const hidden = hiddenByCol[col];
                const openPicker = (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); setDayPicker({ date: day.date, x: e.clientX, y: e.clientY }); };
                return (
                  <div
                    key={col}
                    onContextMenu={openPicker}
                    onDragOver={(e) => { if (dragging) e.preventDefault(); }}
                    onDrop={(e) => dropOn(e, days[col])}
                    className={`
                      group min-h-28 border-b border-r border-[var(--border-subtle)] p-2
                      transition-colors duration-150 flex flex-col
                      ${
                        !day.isCurrentMonth
                          ? 'bg-muted/20'
                          : isWeekend
                          ? 'bg-muted/10 hover:bg-muted/30'
                          : 'hover:bg-muted/30'
                      }
                    `}
                  >
                    {/* Date number + the scheduler "+" (hover / right-click) */}
                    <div className="mb-1 flex h-6 items-center justify-between">
                      {day.isToday ? (
                        <span className="bg-[var(--accent-default)] text-primary-foreground w-6 h-6 pt-0.5 rounded-full flex items-center justify-center text-[12px] font-semibold leading-none tabular-nums">
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
                      <button
                        type="button"
                        onClick={openPicker}
                        title={t('Schedule an Element on this day')}
                        aria-label={t('Schedule an Element on {date}', { date: day.date.toLocaleDateString(locale, { month: 'short', day: 'numeric' }) })}
                        className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-muted/40 hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
                      >
                        <CalendarPlus size={13} />
                      </button>
                    </div>
                    {/* Room for the bands drawn over this row */}
                    <div style={{ height: MONTH_MAX_LANES * MONTH_LANE_HEIGHT }} aria-hidden="true" />
                    {hidden > 0 && (
                      <Popover>
                        <PopoverTrigger asChild>
                          <button
                            onClick={(e) => e.stopPropagation()}
                            className="self-start text-[10px] text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded-md hover:bg-muted transition-colors duration-150 cursor-pointer font-medium"
                          >
                            {t('+{n} more', { n: hidden })}
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-72 p-3" align="start">
                          <div className="mb-2.5 pb-2 border-b border-border/60">
                            <div className="text-sm font-semibold tracking-tight">
                              {day.date.toLocaleDateString(locale, {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                              })}{' '}
                              <span className="text-muted-foreground font-normal">
                                ({day.date.toLocaleDateString(locale, { weekday: 'short' })})
                              </span>
                            </div>
                            <div className="text-[11px] text-muted-foreground mt-0.5">
                              {t(dayElements.length === 1 ? '{n} item' : '{n} items', { n: dayElements.length })}
                            </div>
                          </div>
                          <div className="space-y-0.5 max-h-[280px] overflow-y-auto -mx-1 px-1">
                            {dayElements.map(element => {
                              const statusKey = element.status || 'todo';
                              const dotColor = element.color || statusColor(statusKey);
                              return (
                                <button
                                  key={element.id}
                                  // The overflow list is where a crowded day
                                  // keeps its Elements, which is exactly the day
                                  // somebody wants to move one off.
                                  draggable={Boolean(element.element)}
                                  onDragStart={(e) => {
                                    e.stopPropagation();
                                    e.dataTransfer.effectAllowed = 'move';
                                    e.dataTransfer.setData('text/plain', element.id);
                                    setDragging({ id: element.id, from: fmtDateOnly(day.date) });
                                  }}
                                  onDragEnd={() => setDragging(null)}
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
                                      {t(statusLabel(statusKey))}
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
                );
              })}

              {/* Bands — one per Element per week, spanning its days */}
              {visibleSpans.map(span => {
                const element = span.entry;
                const cardStyle = getCardStyle(element);
                const overdue = isOverdue(element);
                const isDone = element.status === 'done';
                const isHighPriority = element.priority === 'high' || element.priority === 'urgent';
                const priorityDotColor = element.priority === 'urgent' ? 'bg-[var(--status-danger)]' : 'bg-orange-400';
                const width = span.endCol - span.startCol + 1;
                return (
                  <button
                    key={`${element.id}:${span.startCol}`}
                    draggable={Boolean(element.element)}
                    onDragStart={(e) => {
                      e.stopPropagation();
                      e.dataTransfer.effectAllowed = 'move';
                      // Firefox refuses to start a drag without payload.
                      e.dataTransfer.setData('text/plain', element.id);
                      setDragging({ id: element.id, from: dayAt(e.currentTarget.parentElement as HTMLElement, e.clientX) });
                    }}
                    onDragEnd={() => setDragging(null)}
                    onDragOver={(e) => { if (dragging) e.preventDefault(); }}
                    onDrop={(e) => dropOn(e, dayAt(e.currentTarget.parentElement as HTMLElement, e.clientX))}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedElement(element);
                      onElementClick?.(element);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setSelectedElement(element);
                      setShowColorPicker(Boolean(element.element));
                    }}
                    className={`
                      group/chip absolute text-left px-2 transition-colors hover:brightness-95
                      rounded-l-none ${span.continuesAfter ? 'rounded-r-none' : 'rounded-r-md'}
                      ${cardStyle.className}
                      ${overdue ? 'ring-1 ring-[var(--status-danger)]/60' : ''}
                      ${isDone ? 'opacity-70' : ''}
                      ${dragging?.id === element.id ? 'opacity-40' : ''}
                      ${element.element ? 'cursor-grab active:cursor-grabbing' : ''}
                    `}
                    // The left edge is a straight line: the status / colour
                    // mark is a vertical rule, not a curve, and a band that
                    // continues from the previous week has no mark at all so
                    // it reads as the middle of something.
                    style={{
                      ...cardStyle.style,
                      ...(span.continuesBefore ? { borderLeft: 'none' } : {}),
                      top: MONTH_LANE_TOP + span.lane * MONTH_LANE_HEIGHT,
                      height: MONTH_LANE_HEIGHT - 2,
                      left: `calc(${(span.startCol / 7) * 100}% + ${span.continuesBefore ? 0 : 6}px)`,
                      width: `calc(${(width / 7) * 100}% - ${(span.continuesBefore ? 0 : 6) + (span.continuesAfter ? 0 : 6)}px)`,
                    }}
                    title={`${overdue ? t('{title} (Overdue)', { title: element.title }) : element.title}\n${t('Right-click to change color')}`}
                  >
                    <div className="flex h-full items-center gap-1.5 min-w-0">
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
            </div>
          );
        })}
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
                {t('Schedule on {date}', { date: dayPicker.date.toLocaleDateString(locale, { month: 'short', day: 'numeric' }) })}
              </span>
              <button
                onClick={() => setDayPicker(null)}
                className="text-muted-foreground hover:text-foreground p-0.5 rounded-md hover:bg-muted/40 transition-colors"
                aria-label={t('Close')}
              >
                <X size={13} />
              </button>
            </div>
            {unscheduled.length === 0 ? (
              <div className="px-1 py-3 text-[11px] text-muted-foreground flex items-center gap-1.5">
                <CalendarPlus size={13} className="shrink-0" />
                {t('Every Element already has a due date.')}
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
              <h3 className="font-medium text-sm">{t('Change color')}</h3>
              <button
                onClick={() => setShowColorPicker(false)}
                className="text-muted-foreground hover:text-foreground"
                aria-label={t('Close')}
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
                  title={t(color.name)}
                />
              ))}
            </div>
            <button
              onClick={() => handleColorChange(null)}
              className="w-full mt-3 px-3 py-2 text-xs text-muted-foreground hover:bg-muted rounded transition-colors"
            >
              {t('Reset to default (status-based)')}
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
  const { t, locale } = useI18n();
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
    // Land on an hour line, a few hours back, with room above it: a label
    // sits across its line, so a scroll that stops on the line cuts the
    // first label in half under the all-day row.
    const hour = Math.floor((minutes - startMin) / 60) - 2;
    const top = hour * HOUR_HEIGHT - 10;
    scrollRef.current.scrollTop = Math.max(0, top);
    // Run only once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hours = useMemo(() => {
    const arr: number[] = [];
    for (let h = GRID_START_HOUR; h < GRID_END_HOUR; h++) arr.push(h);
    return arr;
  }, []);

  // Bucket timed elements per day (all-day ones are laid out as bands above
  // the hour grid, see the all-day row)
  const perDay = useMemo(() => {
    return days.map(day => {
      const timed: CalendarEntry[] = [];
      elements.forEach(el => {
        if (!occursOn(el, fmtDateOnly(day))) return;
        if (el.start_time || el.due_time) timed.push(el);
      });
      // Sort timed by start
      timed.sort((a, b) => {
        const am = parseTimeToMinutes(a.start_time ?? a.due_time) ?? 0;
        const bm = parseTimeToMinutes(b.start_time ?? b.due_time) ?? 0;
        return am - bm;
      });
      return { timed };
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
      <div className="flex border-b border-[var(--border-subtle)] bg-card/95 backdrop-blur sticky top-0 z-10">
        <div className="w-14 flex-shrink-0" />
        {days.map((d, i) => {
          const isTodayCol = isSameDay(d, today);
          return (
            <div
              key={i}
              className={`${colWidthClass} px-2 py-2 text-center`}
            >
              <div className="text-[10px] text-muted-foreground">
                {weekdayLabel(locale, d.getDay())}
              </div>
              <div className="mt-0.5 inline-flex items-center justify-center">
                {isTodayCol ? (
                  <span className="bg-[var(--accent-default)] text-primary-foreground w-6 h-6 pt-0.5 rounded-full flex items-center justify-center text-[12px] font-semibold leading-none tabular-nums">
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

      {/* All-day row — the same bands as the month grid: an Element that
          runs over several of the shown days is one band from its first to
          its last, clipped to the range with a square edge where it
          continues, stacked into lanes so bands never overlap. */}
      {(() => {
        const dayKeys = days.map(d => fmtDateOnly(d));
        const spans = layoutWeekSpans(elements.filter(el => !el.start_time && !el.due_time), dayKeys);
        const lanes = spans.reduce((max, span) => Math.max(max, span.lane + 1), 0);
        const height = Math.max(28, 4 + lanes * MONTH_LANE_HEIGHT + 4);
        return (
          <div className="flex border-b border-[var(--border-subtle)] bg-card">
            <div className="w-14 flex-shrink-0 px-2 py-1.5 text-[10px] text-muted-foreground text-right">
              {t('All day')}
            </div>
            <div className="relative flex flex-1 min-w-0" style={{ height }}>
              {days.map((_, i) => (
                <div key={i} className={`${colWidthClass} border-l border-[var(--border-subtle)]`} />
              ))}
              {spans.map(span => {
                const el = span.entry;
                const cs = getCardStyle(el);
                const overdue = isOverdue(el);
                const isDone = el.status === 'done';
                const width = span.endCol - span.startCol + 1;
                return (
                  <button
                    key={`${el.id}:${span.startCol}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onElementClick(el);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      onElementContextMenu(el);
                    }}
                    className={`absolute text-left px-2 transition-colors hover:brightness-95 rounded-l-none ${
                      span.continuesAfter ? 'rounded-r-none' : 'rounded-r-md'
                    } ${cs.className} ${overdue ? 'ring-1 ring-[var(--status-danger)]/60' : ''} ${isDone ? 'opacity-70' : ''}`}
                    style={{
                      ...cs.style,
                      ...(span.continuesBefore ? { borderLeft: 'none' } : {}),
                      top: 4 + span.lane * MONTH_LANE_HEIGHT,
                      height: MONTH_LANE_HEIGHT - 2,
                      left: `calc(${(span.startCol / days.length) * 100}% + ${span.continuesBefore ? 0 : 4}px)`,
                      width: `calc(${(width / days.length) * 100}% - ${(span.continuesBefore ? 0 : 4) + (span.continuesAfter ? 0 : 4)}px)`,
                    }}
                    title={el.title}
                  >
                    <div className="flex h-full items-center min-w-0">
                      <span
                        className={`text-[11px] font-medium leading-tight truncate flex-1 ${
                          isDone ? 'line-through' : ''
                        }`}
                      >
                        {el.title}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Scrollable hour grid */}
      <div ref={scrollRef} className="flex-1 overflow-auto relative">
        <div className="flex" style={{ height: TOTAL_GRID_HEIGHT }}>
          {/* Hour rail */}
          <div className="w-14 flex-shrink-0 relative">
            {hours.filter(h => h !== GRID_START_HOUR).map(h => (
              <div
                key={h}
                className="absolute left-0 right-0 px-1 text-right text-[10px] text-muted-foreground"
                style={{ top: (h - GRID_START_HOUR) * HOUR_HEIGHT - 6, height: HOUR_HEIGHT }}
              >
                {formatHourLabel(locale, h)}
              </div>
            ))}
          </div>

          {/* Day columns */}
          {perDay.map((bucket, colIdx) => {
            const isTodayCol = todayColIdx === colIdx;
            return (
              <div
                key={colIdx}
                className={`${colWidthClass} relative border-l border-[var(--border-subtle)]`}
              >
                {/* Hour grid lines */}
                {hours.map(h => (
                  <div
                    key={h}
                    className="absolute left-0 right-0 border-t border-[var(--border-subtle)]"
                    style={{ top: (h - GRID_START_HOUR) * HOUR_HEIGHT }}
                  />
                ))}

                {/* Now line */}
                {isTodayCol && showNowLine && (
                  <div
                    className="absolute left-0 right-0 z-20 pointer-events-none"
                    style={{ top: nowLineTop }}
                  >
                    <div className="relative">
                      <div className="absolute -left-1 -top-[4px] w-2 h-2 rounded-full bg-[var(--status-danger)]" />
                      <div className="h-px bg-[var(--status-danger)]" />
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
                        overdue ? 'ring-1 ring-[var(--status-danger)]/60' : ''
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
