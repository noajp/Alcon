'use client';

import { formatError } from '@/Function/shared/formatError';
import { useMemo } from 'react';
import { FolderInput } from '@/ui/icons';
import { Button } from '@/ui/button';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { appDialog } from '@/Function/shared/appDialogStore';
import { formatAge } from '@/Function/shared/dateUtils';
import { DropdownMenu, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import { MenuShell } from '@/Function/shared/menu';
import { FolderList, MoveToFolderItems, NewFolderButton } from '@/Function/shared/folders/FolderList';
import { IslandColumns, MainIsland, type IslandCrumb } from '@/Function/shared/MainIsland';
import { NavTableIcon } from '@/Frame/sidebar/NavIcons';
import { useSustainmentDomains } from '@/hooks/useSustainmentDomains';
import { useFolders } from '@/hooks/folderData';
import { updateDataTable, type DataTableWithRowCount } from '@/hooks/tableData';
import type { NavigationState } from '@/types/navigation';

type Browse = NonNullable<NavigationState['tableBrowse']>;

/**
 * Table, laid out as Execution is, while no Table is open: every Table in
 * the Space; or a Domain's home (its folders and its Tables touched last),
 * its Folders (each opening onto its Tables) and its Tables. A row opens
 * its Table; its menu moves it into one of its Domain's folders or out.
 */
export function TableBrowser({ tables, browse, onBrowse, onOpenTable, onRefresh }: {
  tables: DataTableWithRowCount[];
  browse: Browse;
  onBrowse: (next: Browse) => void;
  onOpenTable: (id: string) => void;
  onRefresh: () => void;
}) {
  const { t } = useI18n();
  const domainId = browse.domainId ?? null;
  const domainName = useSustainmentDomains().data.find((d) => d.id === domainId)?.name ?? '';
  const domainFolders = useFolders('tables', domainId).data;
  const folder = domainFolders.find((f) => f.id === browse.folderId) ?? null;
  const inDomain = useMemo(() => (domainId ? tables.filter((tb) => tb.domain_id === domainId) : tables), [tables, domainId]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const tb of tables) if (tb.folder_id) m.set(tb.folder_id, (m.get(tb.folder_id) ?? 0) + 1);
    return m;
  }, [tables]);
  const recent = useMemo(() => [...inDomain].sort((a, b) => b.updated_at.localeCompare(a.updated_at)), [inDomain]);
  // The path: the Domain (opening its home), then the page.
  const path = (...rest: IslandCrumb[]): IslandCrumb[] => [{ id: 'domain', label: domainName, onClick: () => onBrowse({ domainId }) }, ...rest];
  const openFolder = (id: string) => onBrowse({ domainId, folderId: id });
  const newFolder = <NewFolderButton app="tables" domainId={domainId} onOpen={openFolder} />;

  const rows = (list: DataTableWithRowCount[]) => list.map((tb) => (
    <div key={tb.id} className="group/table flex h-9 items-center gap-3 rounded-md px-[18px] hover:bg-foreground/[0.05]">
      <button type="button" onClick={() => onOpenTable(tb.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
        <NavTableIcon size={15} />
        <span className="truncate text-[13.5px] text-foreground">{tb.name}</span>
      </button>
      <span className="w-20 shrink-0 text-right text-[12px] tabular-nums text-muted-foreground">{t('{n} rows', { n: tb.rowCount })}</span>
      <span className="w-20 shrink-0 text-right text-[12px] tabular-nums text-muted-foreground">{formatAge(tb.updated_at, true)}</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon-xs" aria-label={t('Move to')} title={t('Move to')} className="opacity-0 focus-visible:opacity-100 group-hover/table:opacity-100 data-[state=open]:opacity-100"><FolderInput size={13} /></Button>
        </DropdownMenuTrigger>
        <MenuShell as="dropdown" align="end">
          <MoveToFolderItems app="tables" domainId={tb.domain_id} current={tb.folder_id} allowNone onMove={(id) => {
            void updateDataTable(tb.id, { folder_id: id }).then(onRefresh).catch((e) => void appDialog.alert(formatError(e)));
          }} />
        </MenuShell>
      </DropdownMenu>
    </div>
  ));
  const listPage = (crumbs: IslandCrumb[], list: DataTableWithRowCount[], empty: string, actions?: React.ReactNode) => (
    <MainIsland crumbs={crumbs} actions={actions}>
      <IslandColumns>
        <span className="min-w-0 flex-1">{t('Name')}</span>
        <span className="w-20 shrink-0 text-right">{t('Rows')}</span>
        <span className="w-20 shrink-0 text-right">{t('Updated')}</span>
        <span className="w-6 shrink-0" />
      </IslandColumns>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-1">
        {list.length ? rows(list) : <p className="px-[18px] py-6 text-[13px] text-muted-foreground">{empty}</p>}
      </div>
    </MainIsland>
  );

  if (!domainId) return listPage([{ id: 'all', label: t('All Tables') }], [...tables].sort((a, b) => b.updated_at.localeCompare(a.updated_at)), t('No Tables yet.'));
  if (folder) {
    return listPage(path({ id: 'folders', label: t('Folders'), onClick: () => onBrowse({ domainId, view: 'folders' }) }, { id: 'folder', label: folder.name }), tables.filter((tb) => tb.folder_id === folder.id), t('No Tables in this folder. Move one here from its menu.'));
  }
  if (browse.view === 'folders') {
    return (
      <MainIsland crumbs={path({ id: 'folders', label: t('Folders') })} actions={newFolder}>
        <FolderList app="tables" domainId={domainId} counts={counts} onOpen={openFolder} />
      </MainIsland>
    );
  }
  if (browse.view === 'tables') return listPage(path({ id: 'tables', label: t('Tables') }), recent, t('No Tables in this Domain yet.'));

  // A Domain's home: its folders, then its Tables touched last.
  return (
    <MainIsland crumbs={[{ id: 'domain', label: domainName }]} actions={newFolder}>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="px-3 pb-8 pt-5">
          <div className="px-[18px]"><button type="button" onClick={() => onBrowse({ domainId, view: 'folders' })} className="text-[13px] font-medium text-foreground hover:underline">{t('Folders')}</button></div>
          <div className="mt-1"><FolderList app="tables" domainId={domainId} counts={counts} onOpen={openFolder} compact /></div>
          <div className="mt-8 px-[18px]"><button type="button" onClick={() => onBrowse({ domainId, view: 'tables' })} className="text-[13px] font-medium text-foreground hover:underline">{t('Recent Tables')}</button></div>
          <div className="mt-1">{rows(recent.slice(0, 8))}</div>
        </div>
      </div>
    </MainIsland>
  );
}
