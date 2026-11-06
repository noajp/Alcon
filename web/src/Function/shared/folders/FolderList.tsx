'use client';

import { Folder as FolderIcon, FolderPlus, MoreHorizontal } from '@/ui/icons';
import { Button } from '@/ui/button';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { appDialog } from '@/Function/shared/appDialogStore';
import { DropdownMenu, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import { MenuShell, MenuSectionLabel, MENU_SEPARATOR } from '@/Function/shared/menu';
import { useFolderActions, useFolders, type Folder, type FolderApp } from '@/hooks/folderData';
import { IslandColumns } from '@/Function/shared/MainIsland';


/** Asks for a name and makes a folder; resolves the new folder's id. */
function useNewFolder(app: FolderApp, domainId: string | null) {
  const { t } = useI18n();
  const { create } = useFolderActions(app, domainId);
  return async () => {
    const name = (await appDialog.prompt(t('Folder name')))?.trim();
    if (!name) return null;
    try { return (await create.mutateAsync(name)).id; } catch { return null; }
  };
}

/** "New folder", for a page's header: makes one and opens it. */
export function NewFolderButton({ app, domainId, onOpen }: { app: FolderApp; domainId: string | null; onOpen: (folderId: string) => void }) {
  const { t } = useI18n();
  const newFolder = useNewFolder(app, domainId);
  return (
    <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" onClick={() => { void newFolder().then((id) => { if (id) onOpen(id); }); }}>
      <FolderPlus size={14} />{t('New folder')}
    </Button>
  );
}

/**
 * An app's folders as a list under the island's header: one row each — its
 * name, how many things it holds — that opens the folder, and each row's
 * "…" renames or deletes it. `compact` draws only the rows (a home page's
 * section).
 */
export function FolderList({ app, domainId, counts, onOpen, compact = false }: {
  app: FolderApp;
  /** The Domain whose folders these are. */
  domainId: string | null;
  /** How many things each folder holds. */
  counts: Map<string, number>;
  onOpen: (folderId: string) => void;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const { data: folders, loading } = useFolders(app, domainId);
  const { rename, remove } = useFolderActions(app, domainId);

  const rows = folders.map((f) => (
    <div key={f.id} className="group/folder flex h-9 items-center gap-3 rounded-md px-[18px] hover:bg-foreground/[0.05]">
      <button type="button" onClick={() => onOpen(f.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
        <FolderIcon size={15} className="shrink-0 text-muted-foreground" />
        <span className="truncate text-[13.5px] text-foreground">{f.name}</span>
      </button>
      <span className="w-20 shrink-0 text-right text-[12px] tabular-nums text-muted-foreground">{counts.get(f.id) ?? 0}</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon-xs" aria-label={t('More')} title={t('More')} className="opacity-0 group-hover/folder:opacity-100 data-[state=open]:opacity-100"><MoreHorizontal size={14} /></Button>
        </DropdownMenuTrigger>
        <MenuShell as="dropdown" align="end">
          <DropdownMenuItem onSelect={async () => {
            const name = (await appDialog.prompt(t('Folder name'), f.name))?.trim();
            if (name && name !== f.name) rename.mutate({ id: f.id, name });
          }}>{t('Rename')}</DropdownMenuItem>
          <div className={MENU_SEPARATOR} />
          <DropdownMenuItem onSelect={async () => {
            if (!await appDialog.confirm(t('Delete the folder “{name}”?', { name: f.name }))) return;
            remove.mutate(f.id);
          }}>{t('Delete')}</DropdownMenuItem>
        </MenuShell>
      </DropdownMenu>
    </div>
  ));

  if (compact) return <>{rows}</>;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <IslandColumns>
        <span className="min-w-0 flex-1">{t('Name')}</span>
        <span className="w-20 shrink-0 text-right">{t('Items')}</span>
        <span className="w-6 shrink-0" />
      </IslandColumns>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-1">
        {loading ? <p className="px-[18px] py-6 text-[13px] text-muted-foreground">{t('Loading…')}</p>
          : !folders.length ? <p className="px-[18px] py-6 text-[13px] text-muted-foreground">{t('No folders yet. Make one with New folder.')}</p>
          : rows}
      </div>
    </div>
  );
}

/** The items of a "Move to" menu: every other folder of the Domain (and,
 *  where an item may sit in none, out of its folder). */
export function MoveToFolderItems({ app, domainId, current, onMove, allowNone = false }: {
  app: FolderApp; domainId: string | null; current: string | null; onMove: (folderId: string | null) => void; allowNone?: boolean;
}) {
  const { t } = useI18n();
  const { data: folders } = useFolders(app, domainId);
  const others = folders.filter((f) => f.id !== current);
  // Artifacts' folders nest: each is named by its path.
  const label = (f: Folder) => {
    const names = [f.name];
    const seen = new Set([f.id]);
    let up = folders.find((x) => x.id === f.parent_id);
    while (up && !seen.has(up.id)) { seen.add(up.id); names.unshift(up.name); up = folders.find((x) => x.id === up!.parent_id); }
    return names.join(' / ');
  };
  return <>
    <MenuSectionLabel>{t('Move to')}</MenuSectionLabel>
    {others.map((f) => <DropdownMenuItem key={f.id} onSelect={() => onMove(f.id)}><FolderIcon size={13} />{label(f)}</DropdownMenuItem>)}
    {allowNone && current && <DropdownMenuItem onSelect={() => onMove(null)}>{t('Out of the folder')}</DropdownMenuItem>}
    {!others.length && !(allowNone && current) && <div className="px-2 py-1.5 text-[12px] text-muted-foreground">{t('No other folders.')}</div>}
  </>;
}
