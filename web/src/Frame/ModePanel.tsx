'use client';

import { railModeOf } from '@/Frame/railApps';
import { SidebarSectionLabel } from '@/Function/shared/SidebarRow';
import { PanelBody } from '@/Function/shared/PanelLayout';
import { AiSidebar } from '@/AIP/ai/AiSidebar';
import { SlidesSidebar } from '@/ActivitySpace/artifacts/slides/SlidesSidebar';
import { InboxList } from '@/ActivitySpace/home/InboxList';
import { CalendarSidebar } from '@/ActivitySpace/calendar/CalendarSidebar';
import type { NavigationState } from '@/types/navigation';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { ButtonAppearanceProvider } from '@/ui/button';

// A tool's own list — the inbox, the calendar, the notebooks — as a column inside the main pane, left of what it opens. The
// app's sidebar stays the Workspace on every screen; this column is the tool's.

/** The open tool's list, or nothing for the Workspace and personal pages. */
export function ModePanel({ activeView, onNavigate, onViewChange }: {
  activeView: string;
  navigation: NavigationState;
  onNavigate: (nav: Partial<NavigationState>) => void;
  onViewChange: (view: string) => void;
}) {
  const { t } = useI18n();
  const mode = railModeOf(activeView);

  let body: React.ReactNode = null;
  switch (mode) {
    // Note needs no list beside it: it opens on its notebooks, and an open
    // notebook carries its Sections inside its own page.
    case 'inbox':
      body = <InboxList onNavigate={onNavigate} onViewChange={onViewChange} onOpen={() => onViewChange('inbox')} />;
      break;
    case 'calendar':
      body = <PanelBody><SidebarSectionLabel>{t('Calendar')}</SidebarSectionLabel><CalendarSidebar /></PanelBody>;
      break;
    // Artifacts, People and Table need no list beside them: the page itself is the list.
    case 'ai':
      body = <AiSidebar onOpen={() => { if (activeView !== 'ai') onViewChange('ai'); }} />;
      break;
    case 'slides':
      body = <PanelBody><SlidesSidebar onOpen={() => { if (activeView !== 'slides') onViewChange('slides'); }} /></PanelBody>;
      break;
    default:
      body = null;
  }
  if (!body) return null;
  return (
    <ButtonAppearanceProvider appearance="navigation">
      <aside className="flex w-[var(--sidebar-width)] shrink-0 flex-col overflow-hidden border-r border-[var(--gloss-rim)] bg-[var(--surface-well)]">{body}</aside>
    </ButtonAppearanceProvider>
  );
}
