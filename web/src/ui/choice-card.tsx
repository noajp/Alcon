'use client';

import type { ComponentProps, ReactNode } from 'react';
import { Check } from 'lucide-react';
import { Button } from '@/ui/button';
import { cn } from '@/lib/utils';

/** A selectable comparison, with room for a label and supporting information. */
export function ChoiceCard({ selected, label, children, className, ...props }: Omit<ComponentProps<'button'>, 'children'> & {
  selected: boolean;
  label: string;
  children: ReactNode;
}) {
  return <Button {...props} variant="ghost" shape="tab" multiline align="start" aria-pressed={selected}
    className={cn('w-full min-w-0 flex-col items-stretch gap-3 p-3 text-left leading-normal aria-pressed:border-[var(--accent-default)]', selected ? 'bg-[var(--accent-subtle)]' : 'bg-muted/20', className)}>
    <span className="flex w-full items-center justify-between gap-3 text-[13px] font-medium">
      <span>{label}</span>
      <Check size={14} aria-hidden="true" className={selected ? 'text-[var(--accent-default)]' : 'invisible'} />
    </span>
    <span className="block w-full min-w-0">{children}</span>
  </Button>;
}
