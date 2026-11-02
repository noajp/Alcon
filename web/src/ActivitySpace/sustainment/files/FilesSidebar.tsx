'use client';

import type { ReactNode } from 'react';
import { Folder as FolderIcon, Trash2 } from '@/ui/icons';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { FilesIcon } from '@/Function/shared/conceptIcons';
import { SidebarRow, SidebarSectionLabel } from '@/Function/shared/SidebarRow';
import { GroupTree } from '@/Function/shared/folders/GroupTree';
import type { FilesRoute } from '@/Function/files/filesRoute';
import type { NavigationState } from '@/types/navigation';

/** A Domain as the sidebar shows it. */
export interface SidebarDomain { id: string; name: string; mark: ReactNode }

// The Files sidebar, as Execution's: every file in the Space and the trash,
// then each Domain unfolding onto its Folders and Files (pages of the main
// pane). The Domains come last; nothing sits below them.

export function FilesSidebar({ navigation, onNavigate, domains }: {
  navigation: NavigationState; onNavigate: (nav: Partial<NavigationState>) => void; domains: SidebarDomain[];
}) {
  const { t } = useI18n();
  const route = navigation.files ?? {};
  const go = (next: FilesRoute) => onNavigate({ files: next });
  const page = route.view === 'trash' ? 'trash' : !route.domainId ? 'all' : route.folderId ? 'folders' : route.view ?? 'home';
  return (
    <div className="mt-1 pb-4">
      <SidebarSectionLabel>{t('Artifacts')}</SidebarSectionLabel>
      <div className="mt-1">
        <SidebarRow active={page === 'all'} icon={<FilesIcon size={16} />} label={t('All artifacts')} onClick={() => go({})} />
        {/* Removed files stay restorable for their days; the way back is here. */}
        <SidebarRow active={page === 'trash'} icon={<Trash2 size={16} />} label={t('Deleted')} onClick={() => go({ view: 'trash' })} />
      </div>
      <div className="mt-3">
        {domains.map((d) => (
          <GroupTree key={d.id} name={d.name} mark={d.mark} defaultOpen={route.domainId === d.id}
            homeActive={route.domainId === d.id && page === 'home'} onOpenHome={() => go({ domainId: d.id })}
            items={[
              { id: 'folders', label: t('Folders'), icon: FolderIcon, active: route.domainId === d.id && page === 'folders', onClick: () => go({ domainId: d.id, view: 'folders' }) },
              { id: 'files', label: t('Artifacts'), icon: FilesIcon, active: route.domainId === d.id && page === 'files', onClick: () => go({ domainId: d.id, view: 'files' }) },
            ]} />
        ))}
      </div>
    </div>
  );
}
