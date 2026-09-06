'use client';

import { Button } from '@/ui/button';

/** Every Note editor exposes the same save state and recovery action. */
export function NoteContentStatus({ loading, saving, error, errorKind, onRetry }: {
  loading: boolean;
  saving: boolean;
  error: Error | null;
  errorKind: 'read' | 'write' | null;
  onRetry: () => void;
}) {
  return (
    <div role={error ? 'alert' : 'status'} className={`flex min-h-8 items-center gap-2 px-3 py-1 text-xs ${error ? 'text-destructive' : 'text-muted-foreground'}`}>
      <span className="min-w-0 flex-1 break-words">{error
        ? `${errorKind === 'write' ? 'Changes are not saved. Your draft is kept here.' : 'Could not load this Note.'} ${error.message}`
        : loading ? 'Loading…' : saving ? 'Saving…' : 'Saved'}</span>
      {error && <Button variant="ghost" size="xs" onClick={onRetry}>Retry</Button>}
    </div>
  );
}
