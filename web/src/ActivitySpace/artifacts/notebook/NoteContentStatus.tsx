'use client';

import { Button } from '@/ui/button';
import { useI18n } from '@/Function/i18n/I18nProvider';

/** Every Note editor exposes the same save state and recovery action.
 *  `quiet` is for the full page, where a line above the toolbar that says
 *  "Saved" all day is noise: nothing shows while all is well, "Saving…"
 *  rests in the pane's corner without moving the page (the caller's pane is
 *  `relative`), and only a problem takes a line of its own. */
export function NoteContentStatus({ loading, saving, error, errorKind, onRetry, quiet = false }: {
  loading: boolean;
  saving: boolean;
  error: Error | null;
  errorKind: 'read' | 'write' | null;
  onRetry: () => void;
  quiet?: boolean;
}) {
  const { t } = useI18n();
  if (quiet && !error) {
    if (!loading && !saving) return null;
    return (
      <div role="status" className="pointer-events-none absolute bottom-2 right-3 z-10 text-[11px] text-muted-foreground">
        {loading ? t('Loading…') : t('Saving…')}
      </div>
    );
  }
  return (
    <div role={error ? 'alert' : 'status'} className={`flex min-h-8 items-center gap-2 px-3 py-1 text-xs ${error ? 'text-destructive' : 'text-muted-foreground'}`}>
      <span className="min-w-0 flex-1 break-words">{error
        ? `${errorKind === 'write' ? t('Changes are not saved. Your draft is kept here.') : t('Could not load this Note.')} ${error.message}`
        : loading ? t('Loading…') : saving ? t('Saving…') : t('Saved')}</span>
      {error && <Button variant="ghost" size="xs" onClick={onRetry}>{t('Retry')}</Button>}
    </div>
  );
}
