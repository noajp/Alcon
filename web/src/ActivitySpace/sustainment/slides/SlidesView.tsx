'use client';

import { useActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { AppShell } from './kata/components/shell/AppShell';
import { useSlidesSync } from './sync';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { useKataLocale } from './useKataLocale';

/**
 * Slides: the presentation editor (formerly the Kata app) on a Space's decks.
 * Notes and documents go in, and come out as pages with a storyline, a logic
 * per page and a look (ADR 0042 in docs/architecture.md).
 */
export function SlidesView() {
  const { t } = useI18n();
  useKataLocale();
  const spaceId = useActiveSpaceId();
  const { ready, error } = useSlidesSync(spaceId);
  if (!spaceId) return <p className="p-6 text-sm text-muted-foreground">{t('Open a Space to work on its decks.')}</p>;
  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-auto bg-background">
      {error && <p role="alert" className="shrink-0 px-4 py-2 text-xs text-destructive">{error}</p>}
      {ready ? <div className="min-h-0 flex-1"><AppShell /></div> : <p className="p-6 text-sm text-muted-foreground">{t('Loading decks…')}</p>}
    </div>
  );
}
