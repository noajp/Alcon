'use client';

import { useMemo } from 'react';
import { Briefcase, Building2, File, FileImage, FileSpreadsheet, FileText, Handshake, Presentation, Target } from 'lucide-react';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { ToolSidebar, type ToolNavItem } from '@/Function/shared/tool/ToolSidebar';
import { ElementIcon, FilesIcon, ObjectIcon } from '@/Function/shared/conceptIcons';
import { useActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { fileKindOf, type FileKind, type FilesRoute } from '@/Function/files/filesRoute';
import { ownerOf, useSpaceAttachments, type AttachmentOwnerKind } from '@/hooks/attachmentData';
import type { NavigationState } from '@/types/navigation';

// The Files sidebar, on the shared ToolSidebar: every file, then the files
// by what they are attached to and by their kind. Only what the Space has
// is listed — no empty filters to click into.

export const WHERE: { id: AttachmentOwnerKind; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
  { id: 'element', label: 'Elements', icon: ElementIcon },
  { id: 'object', label: 'Objects', icon: ObjectIcon },
  { id: 'strategy', label: 'Initiatives', icon: Target },
  { id: 'portfolio', label: 'Portfolios', icon: Briefcase },
  { id: 'deal', label: 'Deals', icon: Handshake },
  { id: 'company', label: 'Companies', icon: Building2 },
];
export const KINDS: { id: FileKind; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
  { id: 'doc', label: 'Documents', icon: FileText },
  { id: 'sheet', label: 'Spreadsheets', icon: FileSpreadsheet },
  { id: 'deck', label: 'Presentations', icon: Presentation },
  { id: 'pdf', label: 'PDF', icon: FileText },
  { id: 'image', label: 'Images', icon: FileImage },
  { id: 'other', label: 'Other', icon: File },
];

export function FilesSidebar({ navigation, onNavigate }: { navigation: NavigationState; onNavigate: (nav: Partial<NavigationState>) => void }) {
  const { t } = useI18n();
  const route = navigation.files ?? {};
  const { data: files } = useSpaceAttachments(useActiveSpaceId());
  const present = useMemo(() => ({
    where: new Set(files.map((f) => ownerOf(f).kind)),
    kind: new Set(files.map((f) => fileKindOf(f.name, f.mime_type))),
  }), [files]);
  const go = (next: FilesRoute) => onNavigate({ files: { ...next, fileId: null } });

  const whereItems: ToolNavItem[] = WHERE.filter((w) => present.where.has(w.id)).map((w) => ({
    id: `where:${w.id}`, label: t(w.label), icon: w.icon, active: route.where === w.id, onClick: () => go({ where: w.id }),
  }));
  const kindItems: ToolNavItem[] = KINDS.filter((k) => present.kind.has(k.id)).map((k) => ({
    id: `kind:${k.id}`, label: k.id === 'pdf' ? 'PDF' : t(k.label), icon: k.icon, active: route.kind === k.id, onClick: () => go({ kind: k.id }),
  }));

  return <ToolSidebar
    title={t('Files')}
    scope={{
      value: null, options: [{ id: null, name: t('All files') }], label: t('All files'), icon: FilesIcon,
      active: !route.where && !route.kind, onOpen: () => go({}), onChange: () => go({}),
    }}
    sections={[
      ...(whereItems.length ? [{ id: 'where', label: t('Attached to'), items: whereItems }] : []),
      ...(kindItems.length ? [{ id: 'kind', label: t('Kind'), items: kindItems }] : []),
    ]}
  />;
}
