'use client';

import { NotebookTree } from './sidebar/NotebookTree';
import { railModeOf } from '@/Frame/railApps';
import { SidebarSectionLabel } from '@/Function/shared/SidebarRow';
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
export function ModePanel({ activeView, navigation, onNavigate, onViewChange }: {
  activeView: string;
  navigation: NavigationState;
  onNavigate: (nav: Partial<NavigationState>) => void;
  onViewChange: (view: string) => void;
}) {
  const { t } = useI18n();
  const mode = railModeOf(activeView);

  let body: React.ReactNode = null;
  switch (mode) {
    case 'notebook':
      body = <NotebookTree activeFolderId={navigation.noteFolderId ?? null} activeSectionId={navigation.noteSectionId ?? null}
        activeFileId={navigation.noteId ?? null} onNavigate={onNavigate} onViewChange={onViewChange} />;
      break;
    case 'inbox':
      body = <InboxList onNavigate={onNavigate} onViewChange={onViewChange} onOpen={() => onViewChange('inbox')} />;
      break;
    case 'calendar':
      body = <><SidebarSectionLabel>{t('Calendar')}</SidebarSectionLabel><CalendarSidebar /></>;
      break;
    // Artifacts, People and Table need no list beside them: the page itself is the list.
    case 'ai':
      body = <AiSidebar onOpen={() => { if (activeView !== 'ai') onViewChange('ai'); }} />;
      break;
    case 'slides':
      body = <SlidesSidebar onOpen={() => { if (activeView !== 'slides') onViewChange('slides'); }} />;
      break;
    default:
      body = null;
  }
  if (!body) return null;
  return (
    <ButtonAppearanceProvider appearance="navigation">
      {/* The Inbox's rows are sentences (a question, a report), not names:
          they get the width to be read without opening each one. */}
      <aside className={`${mode === 'inbox' ? 'w-[320px]' : 'w-[240px]'} shrink-0 overflow-y-auto border-r border-[var(--gloss-rim)] bg-[var(--surface-well)] px-1.5 pb-3 pt-1`}>{body}</aside>
    </ButtonAppearanceProvider>
  );
}
