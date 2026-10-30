'use client';

import { PRIORITY_OPTIONS } from '@/shared/designTokens';
import type { ReactNode } from 'react';
import { Check } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/ui/dropdown-menu';
import { PriorityMark } from '@/Function/shared/PriorityMark';
import { cn } from '@/lib/utils';
import { useI18n } from '@/Function/i18n/I18nProvider';

// Priority values in display order (highest → lowest). `null` = no priority.

interface PriorityPickerProps {
  /** Current priority; null renders the "No priority" row as selected. */
  value: string | null;
  /** Fired with the chosen priority (null when "No priority" is picked). */
  onChange: (priority: string | null) => void;
  /** Element that opens the menu — a pill, a cell button, etc. */
  trigger: ReactNode;
  /** Controlled open state. Pass both to drive externally (e.g. the quick-add
   *  popup's one-menu-at-a-time logic); omit for self-managed. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  align?: 'start' | 'center' | 'end';
  /** Extra content classes (e.g. min-width). Corner radius is fixed so every
   *  surface's Priority menu matches the list cell menus. */
  className?: string;
}

// The single Priority menu, shared by every surface (quick-add pill, list
// cell, …): Urgent / High / Medium / Low + a "No priority" row, each with its
// PriorityMark and a check on the current value. One source of truth so the
// options, order, and styling never drift between surfaces.
export function PriorityPicker({
  value, onChange, trigger, open, onOpenChange, align = 'start', className,
}: PriorityPickerProps) {
  const { t } = useI18n();
  const controlled = open !== undefined ? { open, onOpenChange } : {};
  return (
    <DropdownMenu {...controlled}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align={align} className={cn('rounded-xl min-w-[160px]', className)}>
        {PRIORITY_OPTIONS.map((opt) => (
          <DropdownMenuItem
            key={opt.value}
            onSelect={() => onChange(opt.value)}
            className="text-[13px] gap-2 rounded-md"
          >
            <span className="flex w-5 items-center justify-center">
              <PriorityMark priority={opt.value} />
            </span>
            <span className="flex-1">{t(opt.label)}</span>
            {value === opt.value && <Check size={12} className="text-muted-foreground" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem
          onSelect={() => onChange(null)}
          className="text-[13px] gap-2 rounded-md"
        >
          <span className="flex w-5 items-center justify-center">
            <PriorityMark priority={null} />
          </span>
          <span className="flex-1 text-muted-foreground">{t('No priority')}</span>
          {value === null && <Check size={12} className="text-muted-foreground" />}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
