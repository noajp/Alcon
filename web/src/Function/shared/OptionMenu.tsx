'use client';

import { Check, ChevronDown } from '@/ui/icons';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import { cn } from '@/lib/utils';

export interface OptionMenuItem<T extends string> {
  value: T;
  label: string;
  /** A quiet second line under the label in the menu. */
  hint?: string;
}

/** A choice shown as its current value in plain text, opening a menu — in
 *  place of a native select box where a line of a page sets something. Stops
 *  the pointer from reaching a card or row underneath. */
export function OptionMenu<T extends string>({ value, options, onChange, disabled, label, className }: {
  value: T;
  options: OptionMenuItem<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  /** What is being chosen, for screen readers. */
  label: string;
  className?: string;
}) {
  const current = options.find((o) => o.value === value);
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button type="button" aria-label={label} onPointerDown={stop} onClick={stop}
          className={cn('inline-flex h-6 min-w-0 max-w-full items-center gap-1 rounded-md px-1.5 text-[12px] text-foreground transition-colors hover:bg-muted/60 disabled:pointer-events-none disabled:text-muted-foreground data-[state=open]:bg-muted/60', className)}>
          <span className="truncate">{current?.label ?? '—'}</span>
          {!disabled && <ChevronDown size={12} className="shrink-0 text-muted-foreground" />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[200px] max-w-[320px]" onClick={stop}>
        {options.map((o) => (
          <DropdownMenuItem key={o.value} onSelect={() => { if (o.value !== value) onChange(o.value); }} className="items-start gap-2 py-1.5 text-[13px]">
            <span className="min-w-0 flex-1">
              <span className="block truncate">{o.label}</span>
              {o.hint && <span className="block text-[11px] leading-4 text-muted-foreground">{o.hint}</span>}
            </span>
            <Check size={13} className={o.value === value ? 'mt-0.5 shrink-0' : 'invisible mt-0.5 shrink-0'} />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
