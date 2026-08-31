'use client';

// THE date control. Every place a person picks a day goes through `DateField`
// — there is no second way to open a calendar, and no raw `<input type="date">`
// anywhere in `src/`.
//
// What was there before this file (measured, 9 occurrences across 7 files):
//
//   4 of them were *visible* native inputs — PhaseView's start/end, the Strategy
//     timeline marker, and the two in the Filter panel's due-date row. They
//     rendered the browser's own `yyyy/mm/dd` chrome: a spin-stepper, a locale
//     that follows the OS rather than the app, a grey placeholder no token
//     controls, and — in Chrome — a calendar glyph the app never asked for.
//     None of them matched the Calendar popover the *other* six date surfaces
//     in the app already used.
//   3 of them were `sr-only` inputs hidden behind a styled `<label>`
//     (ElementTableRow, ElementPropertiesPanel's due pill, QuickAddObjectPopup).
//     Those looked right until clicked, at which point the native picker
//     appeared — positioned by the browser, unthemed, and unable to offer a
//     "clear".
//   2 more were the visible pair inside ElementPropertiesPanel's Properties
//     rows.
//
// So the app already owned a themed calendar (`ui/calendar.tsx`, a documented
// house override) and used it in six places via a Popover — the native inputs
// were the leftovers, not the convention. This file makes the convention the
// only option.
//
// The popover surface deliberately does NOT go through `MenuShell`: a calendar
// is not a menu. It is the same kind of surface as ListTable's cell editors and
// carries the same `CELL_POPOVER_RADIUS`, so a date opened from a table cell
// and a date opened from a filter panel are the same object.

import * as React from 'react';
import { CalendarIcon, Check } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/ui/button';
import { Calendar } from '@/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover';
import { CELL_POPOVER_RADIUS } from '@/alcon/property/CustomColumnCell';
import { CONTROL, type ControlSize } from '@/shared/designTokens';
import { MENU_ROW, MENU_SEPARATOR } from '@/alcon/shared/menu';
import {
  formatElementDate,
  fromDateOnlyString,
  toDateOnlyString,
} from '@/alcon/shared/dateUtils';
import {
  DUE_DATE_PRESETS,
  dueDateRangeFor,
  matchDueDatePreset,
  type DueDateRange,
} from './dueDatePresets';

export type { DueDateRange };

interface DateFieldProps {
  /** `yyyy-MM-dd`, or null for "not set". */
  value: string | null | undefined;
  onChange: (next: string | null) => void;
  /** Shown when there is no value. */
  placeholder?: string;
  size?: ControlSize;
  /** `ghost` for inline/table use, `secondary` when it sits on a form. */
  variant?: 'ghost' | 'secondary';
  /** Offer a "Clear" footer once a date is set. */
  clearable?: boolean;
  /** Stretch the trigger to its container (form rows). */
  block?: boolean;
  disabled?: boolean;
  align?: 'start' | 'center' | 'end';
  className?: string;
  'aria-label'?: string;
}

/**
 * The calendar surface plus its open/close state, with the trigger supplied by
 * the caller.
 *
 * Three of the nine native inputs were `sr-only` `<input type="date">`s hidden
 * inside a styled `<label>` — a table cell, an Element pill, a quick-add chip.
 * Each already had a trigger that looked right for where it sat; what was wrong
 * was the picker behind it. `DatePopover` replaces only the picker, so those
 * three keep their own shape and stop opening the browser's own widget.
 */
export function DatePopover({
  value,
  onChange,
  clearable = true,
  align = 'start',
  children,
}: {
  value: string | null | undefined;
  onChange: (next: string | null) => void;
  clearable?: boolean;
  align?: 'start' | 'center' | 'end';
  /** The trigger. Rendered `asChild`, so it must forward ref and props. */
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const selected = fromDateOnlyString(value) ?? undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align={align} className={`w-auto p-0 ${CELL_POPOVER_RADIUS}`}>
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected}
          autoFocus
          onSelect={(d) => {
            onChange(d ? toDateOnlyString(d) : null);
            setOpen(false);
          }}
        />
        {clearable && value ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              onChange(null);
              setOpen(false);
            }}
            className="w-full rounded-none rounded-b-xl border-t border-border/60"
          >
            Clear
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

/**
 * A trigger that shows the chosen day and opens the app's calendar.
 *
 * The trigger is a `Button` with `align="start"`: it opens something rather
 * than doing something, and Primer distinguishes the two by where the label
 * sits (DESIGN.md §5.2). Its height, padding, type and radius come from
 * `CONTROL`, so a date field standing next to any other control lines up.
 */
export function DateField({
  value,
  onChange,
  placeholder = 'Set date',
  size = 'sm',
  variant = 'ghost',
  clearable = true,
  block = false,
  disabled,
  align = 'start',
  className,
  'aria-label': ariaLabel,
}: DateFieldProps) {
  const selected = fromDateOnlyString(value) ?? undefined;
  const label = value ? formatElementDate(selected, 'short') ?? placeholder : placeholder;

  return (
    <DatePopover value={value} onChange={onChange} clearable={clearable} align={align}>
      <Button
        type="button"
        variant={variant}
        size={size}
        align="start"
        disabled={disabled}
        aria-label={ariaLabel ?? placeholder}
        className={cn('font-normal', block && 'w-full', !value && 'text-[var(--text-tertiary)]', className)}
      >
        <CalendarIcon size={CONTROL.icon[size]} className="shrink-0" />
        <span className="truncate">{label}</span>
      </Button>
    </DatePopover>
  );
}

/**
 * The due-date section of the Filter panel: relative presets first, absolute
 * range only when asked for.
 *
 * Written to live inside a `MenuShell`, so its rows are `MENU_ROW` — the same
 * row every other facet in the panel uses. Before this, the section was two
 * bare `<input type="date">`s wedged between menu rows, which is why the panel
 * had a native widget sitting in the middle of a themed surface.
 */
export function DueDateFilter({
  value,
  onChange,
}: {
  value: DueDateRange;
  onChange: (next: DueDateRange) => void;
}) {
  const active = matchDueDatePreset(value);
  const hasRange = Boolean(value.from || value.to);
  // Custom stays open while a range is set that no preset explains, and can be
  // opened deliberately. It is not a preset — it is the escape hatch.
  const [customOpen, setCustomOpen] = React.useState(hasRange && !active);

  const choose = (id: (typeof DUE_DATE_PRESETS)[number]['id']) => {
    setCustomOpen(false);
    onChange(active === id ? { from: null, to: null } : dueDateRangeFor(id));
  };

  return (
    <div>
      {DUE_DATE_PRESETS.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => choose(p.id)}
          aria-pressed={active === p.id}
          className={cn(MENU_ROW, 'justify-between')}
        >
          <span>{p.label}</span>
          {active === p.id ? <Check size={12} className="text-foreground" /> : null}
        </button>
      ))}

      <button
        type="button"
        onClick={() => setCustomOpen((v) => !v)}
        aria-expanded={customOpen}
        className={cn(MENU_ROW, 'justify-between')}
      >
        <span>Custom range…</span>
        {customOpen || (hasRange && !active) ? (
          <Check size={12} className="text-foreground" />
        ) : null}
      </button>

      {customOpen ? (
        <>
          <div className={MENU_SEPARATOR} />
          <div className="flex items-center gap-1 px-2 pb-1">
            <DateField
              value={value.from}
              onChange={(from) => onChange({ ...value, from })}
              placeholder="From"
              variant="secondary"
              block
              aria-label="Due date from"
            />
            <span className="text-[var(--text-tertiary)]">→</span>
            <DateField
              value={value.to}
              onChange={(to) => onChange({ ...value, to })}
              placeholder="To"
              variant="secondary"
              block
              aria-label="Due date to"
            />
          </div>
        </>
      ) : null}
    </div>
  );
}
