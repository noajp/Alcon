'use client';

import { useEffect, useMemo, useState } from 'react';
import { Briefcase, Building2, Handshake, Target, Trash2 } from 'lucide-react';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { ToolSidebar, type ToolNavItem } from '@/Function/shared/tool/ToolSidebar';
import { ElementIcon, FilesIcon, ObjectIcon } from '@/Function/shared/conceptIcons';
import { useActiveSpaceId } from '@/Function/space/activeSpaceStore';
import type { FilesRoute } from '@/Function/files/filesRoute';
import { moveFileToFolder, ownerOf, useSpaceAttachments, type AttachmentOwnerKind, type SpaceFile } from '@/hooks/attachmentData';
import { useTrashFile } from './useTrashFile';
import { FolderTree } from '@/Function/shared/folders/FolderTree';
import { FileTypeIcon } from '@/Function/office/fileTypeIcon';
import type { NavigationState } from '@/types/navigation';

// The Files sidebar, on the shared ToolSidebar: every file; the Space's
// folders, each with its files (two levels — a folder and what is in it);
// the files attached to work, by what they are attached to (only what the
// Space has, so no empty filter to click into); and, at the foot, the trash.

export const WHERE: { id: AttachmentOwnerKind; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
  { id: 'element', label: 'Elements', icon: ElementIcon },
  { id: 'object', label: 'Objects', icon: ObjectIcon },
  { id: 'strategy', label: 'Initiatives', icon: Target },
  { id: 'portfolio', label: 'Portfolios', icon: Briefcase },
  { id: 'deal', label: 'Deals', icon: Handshake },
  { id: 'company', label: 'Companies', icon: Building2 },
];

export function FilesSidebar({ navigation, onNavigate }: { navigation: NavigationState; onNavigate: (nav: Partial<NavigationState>) => void }) {
  const { t } = useI18n();
  const route = navigation.files ?? {};
  const [trashing, setTrashing] = useState<SpaceFile | null>(null);
  const { data: files } = useSpaceAttachments(useActiveSpaceId());
  const present = useMemo(() => ({ where: new Set(files.map((f) => ownerOf(f).kind)) }), [files]);
  const go = (next: FilesRoute) => onNavigate({ files: { ...next, fileId: null } });

  // Attached files are grouped by what they are attached to; a folder's
  // files are the folder's, listed under it.
  const whereItems: ToolNavItem[] = WHERE.filter((w) => w.id !== 'folder' && present.where.has(w.id)).map((w) => ({
    id: `where:${w.id}`, label: t(w.label), icon: w.icon, active: route.where === w.id, onClick: () => go({ where: w.id }),
  }));

  return <ToolSidebar
    title={t('Files')}
    scope={{
      value: null, options: [{ id: null, name: t('All files') }], label: t('All files'), icon: FilesIcon,
      active: !route.where && !route.trash && !route.folderId, onOpen: () => go({}), onChange: () => go({}),
    }}
    // Removed files stay restorable for their days; the way back is here.
    footer={[{ id: 'trash', label: t('Deleted'), icon: Trash2, active: !!route.trash, onClick: () => go({ trash: true }) }]}
    sections={whereItems.length ? [{ id: 'where', label: t('Attached to'), items: whereItems }] : []}
  >
    <FolderTree app="files" title={t('Folders')} activeFolderId={route.folderId && !route.fileId ? route.folderId : null} activeItemId={route.fileId ?? null}
      items={files.filter((f) => f.folder_id).map((f) => ({ id: f.id, name: f.name, folderId: f.folder_id, icon: <FileTypeIcon name={f.name} mime={f.mime_type} size={14} /> }))}
      onOpenFolder={(id) => go({ folderId: id })}
      onOpenItem={(id) => onNavigate({ files: { folderId: files.find((f) => f.id === id)?.folder_id ?? null, fileId: id } })}
      onMoveItem={async (id, folderId) => { const f = files.find((x) => x.id === id); if (f && folderId) await moveFileToFolder(f, folderId); }}
      onDeleteItem={(id) => setTrashing(files.find((x) => x.id === id) ?? null)} />
    {trashing && <TrashAsk file={trashing} onDone={() => setTrashing(null)} />}
  </ToolSidebar>;
}

/** Asks, then moves one file to the trash (a hook per file needs a component). */
function TrashAsk({ file, onDone }: { file: SpaceFile; onDone: () => void }) {
  const trash = useTrashFile(file);
  useEffect(() => { void trash().finally(onDone); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
