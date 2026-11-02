'use client';

import type { ReactNode } from 'react';
import { Folder as FolderIcon, Trash2 } from 'lucide-react';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { FilesIcon } from '@/Function/shared/conceptIcons';
import { SidebarRow, SidebarSectionLabel } from '@/Function/shared/SidebarRow';
import { GroupTree } from '@/Function/shared/folders/GroupTree';
import type { FilesRoute } from '@/Function/files/filesRoute';
import type { NavigationState } from '@/types/navigation';

/** A Domain as the sidebar shows it. */
export interface SidebarDomain { id: string; name: string; mark: ReactNode }

// The Files sidebar, as Execution's: every file in the Space, then each
// Domain unfolding onto its Folders and Files (pages of the main pane), and
// the trash at the foot.

export function FilesSidebar({ navigation, onNavigate, domains }: {
  navigation: NavigationState; onNavigate: (nav: Partial<NavigationState>) => void; domains: SidebarDomain[];
}) {
  const { t } = useI18n();
  const route = navigation.files ?? {};
  const go = (next: FilesRoute) => onNavigate({ files: next });
  const page = route.view === 'trash' ? 'trash' : !route.domainId ? 'all' : route.folderId ? 'folders' : route.view ?? 'home';
  return (
    <div className="mt-1 flex min-h-full flex-col pb-4">
      <SidebarSectionLabel>{t('Files')}</SidebarSectionLabel>
      <div className="mt-1">
        <SidebarRow active={page === 'all'} icon={<FilesIcon size={16} />} label={t('All files')} onClick={() => go({})} />
        {domains.map((d) => (
          <GroupTree key={d.id} name={d.name} mark={d.mark} defaultOpen={route.domainId === d.id}
            homeActive={route.domainId === d.id && page === 'home'} onOpenHome={() => go({ domainId: d.id })}
            items={[
              { id: 'folders', label: t('Folders'), icon: FolderIcon, active: route.domainId === d.id && page === 'folders', onClick: () => go({ domainId: d.id, view: 'folders' }) },
              { id: 'files', label: t('Files'), icon: FilesIcon, active: route.domainId === d.id && page === 'files', onClick: () => go({ domainId: d.id, view: 'files' }) },
            ]} />
        ))}
      </div>
      {/* Removed files stay restorable for their days; the way back is here. */}
      <div className="mt-auto border-t border-[var(--border-subtle)] pt-3">
        <SidebarRow active={page === 'trash'} icon={<Trash2 size={16} />} label={t('Deleted')} onClick={() => go({ view: 'trash' })} />
      </div>
    </div>
  );
}
