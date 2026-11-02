'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, FolderInput, Loader2, RotateCcw, Search, Trash2, X } from '@/ui/icons';
import { Button } from '@/ui/button';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { AttachmentPreview } from '@/Function/shared/attachments/AttachmentList';
import { FileTypeIcon } from '@/Function/office/fileTypeIcon';
import { useElementSize } from '@/Function/office/officeViewParts';
import { openAttachmentOwner } from '@/Function/shared/attachments/openOwner';
import { formatAge } from '@/Function/shared/dateUtils';
import { useActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { TRASH_DAYS, indexSpaceFiles, ownerOf, searchAttachments, trashDaysLeft, useAttachmentActions, useSpaceAttachments, type AttachmentOwnerKind, type SpaceFile } from '@/hooks/attachmentData';
import { appDialog } from '@/Function/shared/appDialogStore';
import { useWorkers } from '@/hooks/teamData';
import type { NavigationState } from '@/types/navigation';
import { FileImportActions, canImport } from '@/ActivitySpace/execution/element/FileImportActions';
import { useTrashFile } from './useTrashFile';
import { AttachButton } from '@/Function/shared/attachments/AttachButton';
import { useFolders } from '@/hooks/folderData';
import { moveFileToFolder } from '@/hooks/attachmentData';
import { FolderList, MoveToFolderItems, NewFolderButton } from '@/Function/shared/folders/FolderList';
import { IslandColumns, MainIsland, type IslandCrumb } from '@/Function/shared/MainIsland';
import { DropdownMenu, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import { MenuShell } from '@/Function/shared/menu';
import { useSustainmentDomains } from '@/hooks/useSustainmentDomains';
import type { FilesRoute } from '@/Function/files/filesRoute';

const OWNER_LABEL: Record<AttachmentOwnerKind, string> = {
  element: 'Element', object: 'Object', strategy: 'Initiative', portfolio: 'Portfolio', deal: 'Deal', company: 'Company', folder: 'Folder',
};

const nameOf = (f: SpaceFile) => { const dot = f.name.lastIndexOf('.'); return dot > 0 ? f.name.slice(0, dot) : f.name; };

/**
 * Files, laid out as Execution is: every file in the Space; each Domain's
 * home (its folders and its latest files), its Folders (each opening onto
 * what it holds) and its Files (those in its folders and those attached to
 * its Elements and Objects); and the trash. A file stays where it is (a
 * folder's, or the evidence of what it is attached to, seen by whoever can
 * see that); a row opens it beside the list (Word and Excel editable, with
 * versions).
 */
export function FilesView({ navigation, onNavigate }: { navigation: NavigationState; onNavigate: (nav: Partial<NavigationState>) => void }) {
  const route = useMemo(() => navigation.files ?? {}, [navigation.files]);
  const go = (next: FilesRoute) => onNavigate({ files: next });
  // A folder opened from elsewhere (search, a file's owner) names only the
  // folder: fill in its Domain, so the page and the sidebar sit under it.
  const folderDomain = useFolders('files').data.find((f) => f.id === route.folderId)?.domain_id ?? null;
  useEffect(() => {
    if (route.folderId && !route.domainId && folderDomain) onNavigate({ files: { ...route, domainId: folderDomain } });
  }, [route, folderDomain, onNavigate]);
  if (route.view === 'trash') return <TrashList />;
  if (!route.domainId || route.folderId || route.view === 'files') return <FileList navigation={navigation} onNavigate={onNavigate} />;
  if (route.view === 'folders') return <FoldersPage domainId={route.domainId} go={go} />;
  return <FilesHome domainId={route.domainId} go={go} />;
}

/** A Domain's name, for titles. */
function useDomainName(domainId: string | null | undefined) {
  return useSustainmentDomains().data.find((d) => d.id === domainId)?.name ?? '';
}

/** The path's first step: the Domain, opening its home. */
function useDomainCrumb(domainId: string, go: (next: FilesRoute) => void): IslandCrumb {
  return { id: 'domain', label: useDomainName(domainId), onClick: () => go({ domainId }) };
}

function FoldersPage({ domainId, go }: { domainId: string; go: (next: FilesRoute) => void }) {
  const { t } = useI18n();
  const domain = useDomainCrumb(domainId, go);
  const open = (id: string) => go({ domainId, folderId: id });
  return (
    <MainIsland crumbs={[domain, { id: 'folders', label: t('Folders') }]} count={useFolders('files', domainId).data.length}
      actions={<NewFolderButton app="files" domainId={domainId} onOpen={open} />}>
      <FolderList app="files" domainId={domainId} counts={useFolderCounts()} onOpen={open} />
    </MainIsland>
  );
}

/** How many live files each folder holds. */
function useFolderCounts() {
  const { data: files } = useSpaceAttachments(useActiveSpaceId());
  return useMemo(() => {
    const m = new Map<string, number>();
    for (const f of files) if (f.folder_id) m.set(f.folder_id, (m.get(f.folder_id) ?? 0) + 1);
    return m;
  }, [files]);
}

/** A Domain's home in Files: its folders, and its files added last. */
function FilesHome({ domainId, go }: { domainId: string; go: (next: FilesRoute) => void }) {
  const { t } = useI18n();
  const spaceId = useActiveSpaceId();
  const name = useDomainName(domainId);
  const files = useSpaceAttachments(spaceId).data.filter((f) => f.domain_id === domainId);
  const counts = useFolderCounts();
  return (
    <MainIsland crumbs={[{ id: 'domain', label: name }]}
      actions={<NewFolderButton app="files" domainId={domainId} onOpen={(id) => go({ domainId, folderId: id })} />}>
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="px-3 pb-8 pt-5">
        <div className="flex items-center gap-2 px-[18px]">
          <button type="button" onClick={() => go({ domainId, view: 'folders' })} className="text-[13px] font-medium text-foreground hover:underline">{t('Folders')}</button>
        </div>
        <div className="mt-1"><FolderList app="files" domainId={domainId} counts={counts} onOpen={(id) => go({ domainId, folderId: id })} compact /></div>
        <div className="mt-8 flex items-center gap-2 px-[18px]">
          <button type="button" onClick={() => go({ domainId, view: 'files' })} className="text-[13px] font-medium text-foreground hover:underline">{t('Recent artifacts')}</button>
        </div>
        <div className="mt-1">
          {files.slice(0, 8).map((f) => (
            <button key={f.id} type="button" onClick={() => go({ domainId, view: 'files', fileId: f.id })}
              className="flex h-9 w-full items-center gap-3 rounded-md px-[18px] text-left hover:bg-foreground/[0.05]">
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <FileTypeIcon name={f.name} mime={f.mime_type} />
                <span className="truncate text-[13.5px] text-foreground">{nameOf(f)}</span>
              </span>
              <span className="hidden w-56 shrink-0 truncate text-[12.5px] text-muted-foreground md:block">
                <span className="text-muted-foreground/70">{t(OWNER_LABEL[ownerOf(f).kind])} · </span>{f.owner_label ?? '—'}
              </span>
              <span className="w-20 shrink-0 text-right text-[12px] tabular-nums text-muted-foreground">{formatAge(f.created_at, true)}</span>
            </button>
          ))}
          {!files.length && <p className="px-[18px] py-4 text-[13px] text-muted-foreground">{t('No artifacts yet. Make a folder and drop files into it, or attach them to Elements, Objects, Initiatives or CRM records.')}</p>}
        </div>
      </div>
    </div>
    </MainIsland>
  );
}

function FileList({ navigation, onNavigate }: { navigation: NavigationState; onNavigate: (nav: Partial<NavigationState>) => void }) {
  const { t } = useI18n();
  const route = navigation.files ?? {};
  const spaceId = useActiveSpaceId();
  const { data: files, loading } = useSpaceAttachments(spaceId);
  const workers = useWorkers().data;
  const [query, setQuery] = useState('');
  // The search reads a file's text as well as its name and owner. Files not
  // read yet are read in the background while Files is open; the search
  // waits for a pause in typing.
  useEffect(() => { if (spaceId) void indexSpaceFiles(spaceId); }, [spaceId, files.length]);
  const [settled, setSettled] = useState('');
  useEffect(() => { const id = setTimeout(() => setSettled(query.trim()), 250); return () => clearTimeout(id); }, [query]);
  const found = useQuery({
    queryKey: ['attachments-search', spaceId, settled],
    enabled: !!spaceId && settled.length > 0,
    queryFn: () => searchAttachments(spaceId!, settled, 100),
  });
  const snippets = useMemo(() => new Map((found.data ?? []).map((h) => [h.id, h.snippet])), [found.data]);

  const shown = useMemo(() => {
    const q = settled.toLowerCase();
    const matches = (f: SpaceFile) => !q || snippets.has(f.id) || f.name.toLowerCase().includes(q) || (f.owner_label ?? '').toLowerCase().includes(q);
    return files.filter((f) => (!route.domainId || f.domain_id === route.domainId) && (!route.folderId || f.folder_id === route.folderId) && matches(f));
  }, [files, settled, snippets, route.domainId, route.folderId]);
  const open = files.find((f) => f.id === route.fileId) ?? null;
  const select = (f: SpaceFile | null) => onNavigate({ files: { ...route, fileId: f?.id ?? null } });
  const folder = useFolders('files').data.find((f) => f.id === route.folderId) ?? null;

  const { upload } = useAttachmentActions({ kind: 'folder', id: folder?.id ?? '' });
  // A folder takes files dropped on its list, as well as through the paperclip.
  const [dropping, setDropping] = useState(false);
  const drop = (list: FileList) => {
    if (!folder) return;
    for (const f of Array.from(list)) upload.mutate(f);
  };
  const who = (f: SpaceFile) => workers.find((w) => w.user_id === f.uploaded_by)?.name ?? t('Someone');

  const go = (next: FilesRoute) => onNavigate({ files: next });
  const domainName = useDomainName(route.domainId);
  const crumbs: IslandCrumb[] = !route.domainId ? [{ id: 'all', label: t('All artifacts') }] : [
    { id: 'domain', label: domainName, onClick: () => go({ domainId: route.domainId }) },
    ...(folder ? [{ id: 'folders', label: t('Folders'), onClick: () => go({ domainId: route.domainId, view: 'folders' as const }) }, { id: 'folder', label: folder.name }]
      : [{ id: 'files', label: t('Artifacts') }]),
  ];

  return (
    <MainIsland crumbs={crumbs} count={shown.length} actions={<>
      {folder && (
        <AttachButton owner={{ kind: 'folder', id: folder.id }} size={14}
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50" />
      )}
      <label className="flex h-7 w-56 items-center gap-1.5 rounded-md bg-muted/50 px-2 text-[12.5px] focus-within:bg-muted">
        <Search size={12} className="shrink-0 text-muted-foreground" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('Search names and contents')} aria-label={t('Search artifacts')}
          className="min-w-0 flex-1 bg-transparent outline-none" />
      </label>
    </>}>
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Column heads; the list scrolls under them. */}
        <IslandColumns>
          <span className="min-w-0 flex-1">{t('Name')}</span>
          {!open && <span className="hidden w-56 shrink-0 md:block">{t('Attached to')}</span>}
          {!open && <span className="hidden w-32 shrink-0 lg:block">{t('Added by')}</span>}
          <span className="w-20 shrink-0 text-right">{t('Updated')}</span>
        </IslandColumns>
        <div className={`min-h-0 flex-1 overflow-y-auto px-3 py-1 ${dropping ? 'bg-foreground/[0.04] outline-dashed outline-2 -outline-offset-4 outline-[var(--border-strong)]' : ''}`}
          onDragOver={folder ? (e) => { e.preventDefault(); setDropping(true); } : undefined}
          onDragLeave={folder ? () => setDropping(false) : undefined}
          onDrop={folder ? (e) => { e.preventDefault(); setDropping(false); drop(e.dataTransfer.files); } : undefined}>
          {loading ? <p className="px-[18px] py-6 text-[13px] text-muted-foreground">{t('Loading…')}</p>
            : !shown.length ? <p className="px-[18px] py-6 text-[13px] text-muted-foreground">{folder ? t('This folder is empty. Drop files here, or add them with the paperclip.') : files.length ? t('No files match.') : t('No artifacts yet. Make a folder and drop files into it, or attach them to Elements, Objects, Initiatives or CRM records.')}</p>
            : shown.map((f) => {
              const owner = ownerOf(f);
              const active = open?.id === f.id;
              return (
                <button key={f.id} type="button" onClick={() => select(active ? null : f)} aria-pressed={active}
                  className={`flex min-h-9 w-full items-center gap-3 rounded-md px-[18px] py-1.5 text-left transition-colors ${active ? 'bg-foreground/[0.08]' : 'hover:bg-foreground/[0.05]'}`}>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <FileTypeIcon name={f.name} mime={f.mime_type} />
                      <span className="truncate text-[13.5px] text-foreground" title={f.name}>{nameOf(f)}</span>
                      {f.versions > 1 && <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">v{f.versions}</span>}
                    </span>
                    {/* Where the search matched inside the file. */}
                    {settled && snippets.get(f.id) && (
                      <span className="mt-0.5 block truncate pl-6 text-[12px] text-muted-foreground">{snippets.get(f.id)}</span>
                    )}
                  </span>
                  {!open && (
                    <span className="hidden w-56 shrink-0 truncate text-[12.5px] text-muted-foreground md:block">
                      <span className="text-muted-foreground/70">{t(OWNER_LABEL[owner.kind])} · </span>{f.owner_label ?? '—'}
                    </span>
                  )}
                  {!open && <span className="hidden w-32 shrink-0 truncate text-[12.5px] text-muted-foreground lg:block">{who(f)}</span>}
                  <span className="w-20 shrink-0 text-right text-[12px] tabular-nums text-muted-foreground">{formatAge(f.created_at, true)}</span>
                </button>
              );
            })}
        </div>
      </div>

      {open && <FilePane file={open} who={who(open)} onClose={() => select(null)} />}
    </div>
    </MainIsland>
  );
}

/** The open file, beside the list: where it is attached, and the file itself. */
function FilePane({ file, who, onClose }: { file: SpaceFile; who: string; onClose: () => void }) {
  const { t } = useI18n();
  const owner = ownerOf(file);
  const trash = useTrashFile(file);
  const [ref, size] = useElementSize<HTMLDivElement>();
  return (
    <aside className="flex w-[min(58%,880px)] shrink-0 flex-col border-l border-border/60">
      <div className="flex shrink-0 items-start gap-2 px-4 pb-2 pt-4">
        <FileTypeIcon name={file.name} mime={file.mime_type} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-medium text-foreground" title={file.name}>{file.name}</div>
          <button type="button" onClick={() => openAttachmentOwner(file)} title={t('Open where it is attached')}
            className="group/owner mt-0.5 flex max-w-full items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground">
            <span className="truncate">{t(OWNER_LABEL[owner.kind])} · {file.owner_label ?? '—'}</span>
            <ArrowUpRight size={12} className="shrink-0 opacity-60 group-hover/owner:opacity-100" />
            <span className="shrink-0 text-muted-foreground/70">· {who} · {formatAge(file.created_at, true)}</span>
          </button>
        </div>
        {file.folder_id && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="icon-xs" aria-label={t('Move to')} title={t('Move to')}><FolderInput size={13} /></Button>
            </DropdownMenuTrigger>
            <MenuShell as="dropdown" align="end">
              <MoveToFolderItems app="files" domainId={file.domain_id} current={file.folder_id} onMove={(id) => { if (id) void moveFileToFolder(file, id).catch((e) => void appDialog.alert(e instanceof Error ? e.message : String(e))); }} />
            </MenuShell>
          </DropdownMenu>
        )}
        <Button type="button" variant="ghost" size="icon-xs" aria-label={t('Remove {name}', { name: file.name })} title={t('Remove {name}', { name: file.name })}
          onClick={() => void trash().then((done) => { if (done) onClose(); })}><Trash2 size={13} /></Button>
        <Button type="button" variant="ghost" size="icon-xs" aria-label={t('Close')} title={t('Close')} onClick={onClose}><X size={14} /></Button>
      </div>
      <div ref={ref} className="min-h-0 flex-1 px-4 pb-4">
        {size.h > 0 && (
          <AttachmentPreview key={file.id} file={file} owner={owner} height={Math.max(240, size.h - 4)}
            actions={canImport(file.name) ? <FileImportActions file={file} /> : undefined} />
        )}
      </div>
    </aside>
  );
}

/** The trash: every file removed in the Space and still inside its days,
 *  most recently removed first, each with Restore — wherever it was
 *  attached, so there is one place to look. */
function TrashList() {
  const { t } = useI18n();
  const { data: files, loading } = useSpaceAttachments(useActiveSpaceId(), true);
  return (
    <MainIsland crumbs={[{ id: 'trash', label: t('Deleted') }]} count={files.length}
      actions={<span className="pr-1 text-[12px] text-muted-foreground">{t('Removed files can be restored for {days} days, then they are erased.', { days: TRASH_DAYS })}</span>}>
      <IslandColumns>
        <span className="min-w-0 flex-1">{t('Name')}</span>
        <span className="hidden w-56 shrink-0 md:block">{t('Attached to')}</span>
        <span className="w-24 shrink-0 text-right">{t('Erased in')}</span>
        <span className="w-24 shrink-0" />
      </IslandColumns>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-1">
        {loading ? <p className="px-[18px] py-6 text-[13px] text-muted-foreground">{t('Loading…')}</p>
          : !files.length ? <p className="px-[18px] py-6 text-[13px] text-muted-foreground">{t('Nothing has been removed.')}</p>
          : files.map((f) => <TrashRow key={f.id} file={f} />)}
      </div>
    </MainIsland>
  );
}

function TrashRow({ file }: { file: SpaceFile }) {
  const { t } = useI18n();
  const owner = ownerOf(file);
  const { restore } = useAttachmentActions(owner);
  return (
    <div className="flex h-9 items-center gap-3 rounded-md px-[18px] hover:bg-foreground/[0.05]">
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span className="opacity-60"><FileTypeIcon name={file.name} mime={file.mime_type} /></span>
        <span className="truncate text-[13.5px] text-muted-foreground" title={file.name}>{nameOf(file)}</span>
      </span>
      <span className="hidden w-56 shrink-0 truncate text-[12.5px] text-muted-foreground md:block">
        <span className="text-muted-foreground/70">{t(OWNER_LABEL[owner.kind])} · </span>{file.owner_label ?? '—'}
      </span>
      <span className="w-24 shrink-0 text-right text-[12px] tabular-nums text-muted-foreground">{t('{n} days left', { n: trashDaysLeft(file.deleted_at!) })}</span>
      <span className="flex w-24 shrink-0 justify-end">
        <Button type="button" variant="ghost" size="xs" disabled={restore.isPending}
          onClick={() => restore.mutate(file)}>
          {restore.isPending ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}{t('Restore')}
        </Button>
      </span>
    </div>
  );
}

