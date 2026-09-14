import * as React from 'react';
import { cn } from '@/lib/utils';
import { FIELD } from '@/shared/designTokens';

/** Standalone multiline field. Framed composers keep their own input surface. */
export function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return <textarea data-slot="textarea" className={cn(
    FIELD.base,
    'w-full min-w-0 resize-y bg-muted/30 p-3 text-sm',
    className,
  )} {...props} />;
}
