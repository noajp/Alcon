'use client';

import { useEffect } from 'react';
import { Button } from '@/ui/button';
import { FONT } from '@/shared/designTokens';
import { useI18n } from '@/Function/i18n/I18nProvider';

// The last line of defence: an exception no inner boundary caught replaces the
// page with this instead of a blank screen. It renders inside the root layout,
// so the providers (language, theme) are still there.
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useI18n();
  useEffect(() => { console.error('[app error]', error); }, [error]);
  return (
    <main role="alert" className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-background px-4 text-center text-foreground">
      <h1 className={FONT.lg}>{t('Something went wrong.')}</h1>
      <p className={`${FONT.base} max-w-[420px] text-muted-foreground`}>{t('This screen stopped because of an error. Try again, or reload the page.')}</p>
      <div className="flex gap-2">
        <Button variant="secondary" onClick={() => window.location.reload()}>{t('Reload')}</Button>
        <Button variant="primary" onClick={reset}>{t('Try again')}</Button>
      </div>
    </main>
  );
}
