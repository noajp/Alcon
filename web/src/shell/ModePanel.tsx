'use client';

import { useMemo } from 'react';
import { ReviewsSidebar } from '@/ActivitySpace/execution/code/ReviewsSidebar';
import { useActiveSpaceScope } from '@/Function/space/data';
import { NotebookTree } from './sidebar/NotebookTree';
import { useSustainmentDomains } from '@/hooks/useSustainmentDomains';
import { NavTableIcon } from '@/shell/sidebar/NavIcons';
import { railModeOf } from '@/shell/railApps';
import { GroupTree } from '@/Function/shared/folders/GroupTree';
import type { SidebarDomain } from '@/ActivitySpace/sustainment/files/FilesSidebar';
import { SidebarRow, SidebarSectionLabel } from '@/Function/shared/SidebarRow';
import { Folder as FolderIcon } from '@/ui/icons';
import { FilesSidebar } from '@/ActivitySpace/sustainment/files/FilesSidebar';
import { AuditSidebar } from '@/ActivitySpace/sustainment/audit/AuditSidebar';
import { AiSidebar } from '@/ActivitySpace/home/ai/AiSidebar';
import { SlidesSidebar } from '@/ActivitySpace/sustainment/slides/SlidesSidebar';
import { InboxList } from '@/ActivitySpace/home/InboxList';
import { CalendarSidebar } from '@/ActivitySpace/sustainment/calendar/CalendarSidebar';
import { PeopleSidebar } from '@/ActivitySpace/sustainment/team/PeopleSidebar';
import type { NavigationState } from '@/types/navigation';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { ButtonAppearanceProvider } from '@/ui/button';
import { DomainMark } from './AppSidebar';

// A tool's own list — the Tables, the Artifacts, the people, the audit log's
// sections — as a column inside the main pane, left of what it opens. The
// app's sidebar stays the Workspace on every screen; this column is the tool's.

// Table mode's sidebar — the list of the user's Tables. Picking one opens it
// in the main pane (columns + rows); the "+" fires an event the TableView
// listens for to open its New Table dialog. The main pane shows a placeholder
// until a table is chosen here.
function TableSidebar({
  activeTableId,
  browse,
  domains,
  onNavigate,
  onViewChange,
}: {
  activeTableId: string | null;
  browse: NonNullable<NavigationState['tableBrowse']>;
  domains: SidebarDomain[];
  onNavigate: (nav: Partial<NavigationState>) => void;
  onViewChange: (view: string) => void;
}) {
  const { t } = useI18n();

  // As Execution's: every Table in the Space, then each Domain unfolding
  // onto its Folders and Tables, each a page of the main pane (a Table opens
  // from those pages).
  const go = (next: NonNullable<NavigationState['tableBrowse']>) => { onViewChange('tables'); onNavigate({ tableId: null, tableBrowse: next }); };
  const page = activeTableId ? null : !browse.domainId ? 'all' : browse.folderId ? 'folders' : browse.view ?? 'home';
  return (
    <div className="mt-1">
      <SidebarSectionLabel>{t('Table')}</SidebarSectionLabel>
      <div className="mt-1">
        <SidebarRow active={page === 'all'} icon={<NavTableIcon size={16} />} label={t('All Tables')} onClick={() => go({})} />
        {domains.map((d) => (
          <GroupTree key={d.id} name={d.name} mark={d.mark} defaultOpen={browse.domainId === d.id}
            homeActive={browse.domainId === d.id && page === 'home'} onOpenHome={() => go({ domainId: d.id })}
            items={[
              { id: 'folders', label: t('Folders'), icon: FolderIcon, active: browse.domainId === d.id && page === 'folders', onClick: () => go({ domainId: d.id, view: 'folders' }) },
              { id: 'tables', label: t('Tables'), icon: NavTableIcon, active: browse.domainId === d.id && page === 'tables', onClick: () => go({ domainId: d.id, view: 'tables' }) },
            ]} />
        ))}
      </div>
    </div>
  );
}

/** The open tool's list, or nothing for the Workspace and personal pages. */
export function ModePanel({ activeView, navigation, onNavigate, onViewChange }: {
  activeView: string;
  navigation: NavigationState;
  onNavigate: (nav: Partial<NavigationState>) => void;
  onViewChange: (view: string) => void;
}) {
  const { t } = useI18n();
  const mode = railModeOf(activeView);
  const spaceScope = useActiveSpaceScope();
  const { data: visibleDomains } = useSustainmentDomains();
  const sidebarDomains = useMemo<SidebarDomain[]>(() => [...visibleDomains]
    .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))
    .map((d) => ({ id: d.id, name: d.name, mark: <DomainMark domain={d} size={16} /> })), [visibleDomains]);

  let body: React.ReactNode = null;
  switch (mode) {
    case 'notebook':
      body = <NotebookTree activeFolderId={navigation.noteFolderId ?? null} activeSectionId={navigation.noteSectionId ?? null}
        activeFileId={navigation.noteId ?? null} onNavigate={onNavigate} onViewChange={onViewChange} />;
      break;
    case 'tables':
      body = <TableSidebar activeTableId={navigation.tableId ?? null} browse={navigation.tableBrowse ?? {}} domains={sidebarDomains}
        onNavigate={onNavigate} onViewChange={onViewChange} />;
      break;
    case 'inbox':
      body = <InboxList onNavigate={onNavigate} onViewChange={onViewChange} onOpen={() => onViewChange('inbox')} />;
      break;
    case 'calendar':
      body = <><SidebarSectionLabel>{t('Calendar')}</SidebarSectionLabel><CalendarSidebar /></>;
      break;
    case 'team':
      // An audit Space (ADR 0048) lists its people without their load.
      body = spaceScope === 'audit' ? null
        : <PeopleSidebar navigation={navigation} onNavigate={onNavigate} onOpen={() => { if (activeView !== 'team' && activeView !== 'workload') onViewChange('team'); }} />;
      break;
    case 'files':
      body = <FilesSidebar navigation={navigation} onNavigate={onNavigate} domains={sidebarDomains} />;
      break;
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
