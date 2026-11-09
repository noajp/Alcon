'use client';

import { createContext, useContext } from 'react';
import { PanelLeft } from '@/ui/icons';
import { useI18n } from '@/Function/i18n/I18nProvider';

// The sidebar closes by dragging the main island left over it; once closed,
// every page's title row starts with this button to bring it back (⌘\ too).
// The shell says whether the sidebar is hidden and how to show it.

interface SidebarReveal { hidden: boolean; show: () => void }

export const SidebarRevealContext = createContext<SidebarReveal>({ hidden: false, show: () => {} });

/** The title row's first control while the sidebar is hidden; nothing otherwise. */
export function SidebarReveal() {
  const { t } = useI18n();
  const { hidden, show } = useContext(SidebarRevealContext);
  if (!hidden) return null;
  return (
    <button type="button" onClick={show} title={`${t('Show sidebar')} (⌘\\)`} aria-label={t('Show sidebar')}
      className="-ml-1 mr-1 flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
      <PanelLeft size={15} />
    </button>
  );
}
