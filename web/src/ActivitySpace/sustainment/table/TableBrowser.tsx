'use client';

import { useMemo } from 'react';
import { ChevronRight, FolderInput, FolderPlus } from 'lucide-react';
import { Button } from '@/ui/button';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { appDialog } from '@/Function/shared/appDialogStore';
import { formatAge } from '@/Function/shared/dateUtils';
import { DropdownMenu, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import { MenuShell } from '@/Function/shared/menu';
import { FolderList, MoveToFolderItems, useNewFolder } from '@/Function/shared/folders/FolderList';
import { NavTableIcon } from '@/shell/sidebar/NavIcons';
import { useActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { useActivitySpaces } from '@/Function/space/data';
import { useFolders } from '@/hooks/folderData';
import { updateDataTable, type DataTableWithRowCount } from '@/hooks/tableData';
import type { NavigationState } from '@/types/navigation';

type Browse = NonNullable<NavigationState['tableBrowse']>;

/**
 * Table, laid out as Execution is, while no Table is open: the Space's home
 * (its folders and the Tables touched last), Folders (each opening onto
 * its Tables) and Tables (every one). A row opens its Table; its "…"
 * moves it into a folder or out of one.
 */
export function TableBrowser({ tables, browse, onBrowse, onOpenTable, onRefresh }: {
  tables: DataTableWithRowCount[];
  browse: Browse;
  onBrowse: (next: Browse) => void;
  onOpenTable: (id: string) => void;
  onRefresh: () => void;
}) {
  const { t } = useI18n();
  const spaceId = useActiveSpaceId();
  const space = useActivitySpaces().data.find((s) => s.id === spaceId);
  const folder = useFolders('tables').data.find((f) => f.id === browse.folderId) ?? null;
  const newFolder = useNewFolder('tables');
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const tb of tables) if (tb.folder_id) m.set(tb.folder_id, (m.get(tb.folder_id) ?? 0) + 1);
    return m;
  }, [tables]);
  const recent = useMemo(() => [...tables].sort((a, b) => b.updated_at.localeCompare(a.updated_at)), [tables]);

  const rows = (list: DataTableWithRowCount[]) => list.map((tb) => (
    <div key={tb.id} className="group/table flex h-9 items-center gap-3 rounded-md px-3 hover:bg-foreground/[0.05]">
      <button type="button" onClick={() => onOpenTable(tb.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
        <NavTableIcon size={15} />
        <span className="truncate text-[13.5px] text-foreground">{tb.name}</span>
      </button>
      <span className="w-20 shrink-0 text-right text-[12px] tabular-nums text-muted-foreground">{t('{n} rows', { n: tb.rowCount })}</span>
      <span className="w-20 shrink-0 text-right text-[12px] tabular-nums text-muted-foreground">{formatAge(tb.updated_at, true)}</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon-xs" aria-label={t('Move to')} title={t('Move to')} className="opacity-0 group-hover/table:opacity-100 data-[state=open]:opacity-100"><FolderInput size={13} /></Button>
        </DropdownMenuTrigger>
        <MenuShell as="dropdown" align="end">
          <MoveToFolderItems app="tables" current={tb.folder_id} allowNone onMove={(id) => {
            void updateDataTable(tb.id, { folder_id: id }).then(onRefresh).catch((e) => void appDialog.alert(e instanceof Error ? e.message : String(e)));
          }} />
        </MenuShell>
      </DropdownMenu>
    </div>
  ));
  const head = (title: React.ReactNode, count: number, action?: React.ReactNode) => (
    <div className="flex shrink-0 items-center gap-3 px-6 pb-3 pt-5">
      <h1 className="flex min-w-0 items-center gap-1 text-[17px] font-semibold text-foreground">{title}</h1>
      <span className="text-[13px] tabular-nums text-muted-foreground">{count}</span>
      <span className="flex-1" />
      {action}
    </div>
  );
  const listPage = (title: React.ReactNode, list: DataTableWithRowCount[], empty: string) => (
    <div className="flex h-full min-h-0 flex-col">
      {head(title, list.length)}
      <div className="flex shrink-0 items-center gap-3 border-b border-border/60 px-6 pb-1.5 text-[11.5px] text-muted-foreground">
        <span className="min-w-0 flex-1">{t('Name')}</span>
        <span className="w-20 shrink-0 text-right">{t('Rows')}</span>
        <span className="w-20 shrink-0 text-right">{t('Updated')}</span>
        <span className="w-6 shrink-0" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-1">
        {list.length ? rows(list) : <p className="px-3 py-6 text-[13px] text-muted-foreground">{empty}</p>}
      </div>
    </div>
  );

  if (folder) {
    return listPage(<>
      <button type="button" onClick={() => onBrowse({ view: 'folders' })} className="font-normal text-muted-foreground hover:text-foreground">{t('Folders')}</button>
      <ChevronRight size={14} className="shrink-0 text-muted-foreground" />
      <span className="truncate">{folder.name}</span>
    </>, tables.filter((tb) => tb.folder_id === folder.id), t('No Tables in this folder. Move one here from its menu.'));
  }
  if (browse.view === 'folders') return <FolderList app="tables" counts={counts} onOpen={(id) => onBrowse({ folderId: id })} />;
  if (browse.view === 'tables') return listPage(t('Tables'), recent, t('No Tables yet.'));

  // Home: the folders, then the Tables touched last.
  return (
    <div className="h-full overflow-y-auto">
      <div className="px-6 pb-8 pt-5">
        <h1 className="text-[17px] font-semibold text-foreground">{space?.name ?? t('Table')}</h1>
        <div className="mt-6 flex items-center gap-2">
          <button type="button" onClick={() => onBrowse({ view: 'folders' })} className="text-[13px] font-medium text-foreground hover:underline">{t('Folders')}</button>
          <span className="flex-1" />
          <Button type="button" variant="ghost" size="xs" onClick={() => { void newFolder().then((id) => { if (id) onBrowse({ folderId: id }); }); }}><FolderPlus size={13} />{t('New folder')}</Button>
        </div>
        <div className="-mx-3 mt-1"><FolderList app="tables" counts={counts} onOpen={(id) => onBrowse({ folderId: id })} compact /></div>
        <div className="mt-8"><button type="button" onClick={() => onBrowse({ view: 'tables' })} className="text-[13px] font-medium text-foreground hover:underline">{t('Recent Tables')}</button></div>
        <div className="-mx-3 mt-1">{rows(recent.slice(0, 8))}</div>
      </div>
    </div>
  );
}
