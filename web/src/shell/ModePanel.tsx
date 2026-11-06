'use client';

import { ReviewsSidebar } from '@/ActivitySpace/execution/code/ReviewsSidebar';
import { NotebookTree } from './sidebar/NotebookTree';
import { railModeOf } from '@/shell/railApps';
import { SidebarSectionLabel } from '@/Function/shared/SidebarRow';
import { AuditSidebar } from '@/ActivitySpace/sustainment/audit/AuditSidebar';
import { AiSidebar } from '@/ActivitySpace/home/ai/AiSidebar';
import { SlidesSidebar } from '@/ActivitySpace/sustainment/slides/SlidesSidebar';
import { InboxList } from '@/ActivitySpace/home/InboxList';
import { CalendarSidebar } from '@/ActivitySpace/sustainment/calendar/CalendarSidebar';
import type { NavigationState } from '@/types/navigation';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { ButtonAppearanceProvider } from '@/ui/button';

// A tool's own list — the audit log's sections, the reviews, the inbox, the
// notebooks — as a column inside the main pane, left of what it opens. The
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
    case 'reviews':
      body = <ReviewsSidebar navigation={navigation} onNavigate={onNavigate} onOpen={() => { if (activeView !== 'reviews') onViewChange('reviews'); }} />;
      break;
    case 'audit':
      body = <AuditSidebar navigation={navigation} onNavigate={onNavigate} />;
      break;
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
      <aside className="w-[240px] shrink-0 overflow-y-auto border-r border-border/60 px-1.5 pb-3 pt-1">{body}</aside>
    </ButtonAppearanceProvider>
  );
}
