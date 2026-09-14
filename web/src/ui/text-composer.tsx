import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { CONTROL } from '@/shared/designTokens';
import { Textarea } from './textarea';

/** One framed surface connects a multiline request to its primary action. */
export function TextComposer({ action, hint, secondaryAction, className, ...props }:
  ComponentProps<typeof Textarea> & { action: ReactNode; hint?: ReactNode; secondaryAction?: ReactNode }) {
  return <div className={cn(CONTROL.border, 'rounded-[var(--control-field-radius)] bg-muted/30')}>
    <Textarea {...props} className={cn('block border-0 bg-transparent', className)} />
    <div className="flex flex-wrap items-center gap-2 px-3 pb-3 pt-1">
      {hint && <span className="mr-auto text-xs text-muted-foreground">{hint}</span>}
      <div className="ml-auto flex flex-wrap items-center justify-end gap-2">{secondaryAction}{action}</div>
    </div>
  </div>;
}
