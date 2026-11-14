'use client';

import { railModeOf } from '@/Frame/railApps';
import { PanelBody } from '@/Function/shared/PanelLayout';
import { AiSidebar } from '@/AIP/ai/AiSidebar';
import { SlidesSidebar } from '@/ActivitySpace/artifacts/slides/SlidesSidebar';
import { InboxList } from '@/ActivitySpace/home/InboxList';
import type { NavigationState } from '@/types/navigation';
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
  const mode = railModeOf(activeView);

  let body: React.ReactNode = null;
  switch (mode) {
    // Note needs no list beside it: it opens on its notebooks, and an open
    // notebook carries its Sections inside its own page.
    case 'inbox':
      body = <InboxList onNavigate={onNavigate} onViewChange={onViewChange} onOpen={() => onViewChange('inbox')} />;
      break;
    // Calendar needs no list beside it either: whose Elements it shows and
    // the day it is on are chosen in its own bars (CalendarPickers).
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
      {/* The Inbox list is read, not just picked from: its subjects need the
          room to show a line, so it is wider than the other panels. */}
      <aside className={`flex ${mode === 'inbox' ? 'w-[320px] max-w-[40%]' : 'w-[var(--sidebar-width)]'} shrink-0 flex-col overflow-hidden border-r border-[var(--gloss-rim)] bg-[var(--surface-well)]`}>{body}</aside>
    </ButtonAppearanceProvider>
  );
}
