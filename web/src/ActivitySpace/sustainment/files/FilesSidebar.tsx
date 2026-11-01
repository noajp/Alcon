'use client';

import { Folder as FolderIcon, Trash2 } from 'lucide-react';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { FilesIcon } from '@/Function/shared/conceptIcons';
import { SidebarRow, SidebarSectionLabel } from '@/Function/shared/SidebarRow';
import { SpaceHomeTree } from '@/Function/shared/folders/SpaceHomeTree';
import type { FilesRoute } from '@/Function/files/filesRoute';
import type { NavigationState } from '@/types/navigation';

// The Files sidebar, as Execution's: the Space's row (its name opens the
// Space's home in Files) unfolding onto Folders and Files, each a page of
// the main pane; the trash at the foot.

export function FilesSidebar({ navigation, onNavigate }: { navigation: NavigationState; onNavigate: (nav: Partial<NavigationState>) => void }) {
  const { t } = useI18n();
  const route = navigation.files ?? {};
  const go = (next: FilesRoute) => onNavigate({ files: next });
  const view = route.folderId ? 'folders' : route.view ?? 'home';
  return (
    <div className="mt-1 flex min-h-full flex-col pb-4">
      <SidebarSectionLabel>{t('Files')}</SidebarSectionLabel>
      <div className="mt-1">
        <SpaceHomeTree homeActive={view === 'home'} onOpenHome={() => go({ view: 'home' })} items={[
          { id: 'folders', label: t('Folders'), icon: FolderIcon, active: view === 'folders', onClick: () => go({ view: 'folders' }) },
          { id: 'files', label: t('Files'), icon: FilesIcon, active: view === 'files', onClick: () => go({ view: 'files' }) },
        ]} />
      </div>
      {/* Removed files stay restorable for their days; the way back is here. */}
      <div className="mt-auto border-t border-[var(--border-subtle)] pt-3">
        <SidebarRow active={view === 'trash'} icon={<Trash2 size={16} />} label={t('Deleted')} onClick={() => go({ view: 'trash' })} />
      </div>
    </div>
  );
}
