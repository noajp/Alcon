'use client';

import type { ReactNode } from 'react';
import { Button } from '@/ui/button';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { EmptyArt, type EmptyArtKind } from './EmptyArt';

// The one "nothing here yet" surface for a list — Domains, Objects, Elements,
// and the Strategy pages (Strategies, Phases, Timeline).
// Laid out the way an empty list reads in Linear: the concept's line drawing,
// one heading, a sentence or two, and then the one decisive action that
// starts the list, as the accent-blue primary button (with its key, when it
// has one). One fixed-width, left-aligned column in the middle of the pane,
// so two empty views side by side line up.
export function EmptyState({ art, title, description, cta, shortcut, onCta }: {
  art: EmptyArtKind;
  title: string;
  description: ReactNode;
  /** The action that starts the list; absent where there is nothing to do here. */
  cta?: string;
  /** The key that does the same as the button, shown inside it. */
  shortcut?: string;
  onCta?: () => void;
}) {
  // Callers pass English; plain strings are translated here so every empty
  // state follows the viewer's language without wiring `t` at each call site.
  const { t } = useI18n();
  const tr = (value: ReactNode) => (typeof value === 'string' ? t(value) : value);
  return (
    // flex-1 for a flex-column host, h-full for a plain block host — either
    // way the column fills the pane.
    <div className="flex-1 h-full flex flex-col items-center justify-center py-20 px-8 select-none">
      <div className="w-full max-w-[380px]">
        <div className="mb-6"><EmptyArt kind={art} /></div>
        <div>
          <h2 className="mb-2 text-[16px] font-semibold text-foreground">{t(title)}</h2>
        </div>
        <div>
          <p className="text-[14px] leading-[22px] text-muted-foreground">{tr(description)}</p>
        </div>
        {cta && onCta && (
          <div>
            <Button variant="primary" onClick={onCta} className="mt-6 gap-1.5">
              {t(cta)}
              {shortcut && (
                <kbd className="ml-1 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-white/40 px-1 font-sans text-[11px] font-medium leading-none">
                  {shortcut}
                </kbd>
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
