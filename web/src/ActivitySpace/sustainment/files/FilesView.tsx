'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, Folder as FolderIcon, FolderInput, Loader2, MoreHorizontal, Plus, RotateCcw, Search, Trash2, Upload, X } from '@/ui/icons';
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
import { useFolderActions, useFolders, type Folder } from '@/hooks/folderData';
import { moveFileToFolder } from '@/hooks/attachmentData';
import { MoveToFolderItems } from '@/Function/shared/folders/FolderList';
import { IslandColumns, MainIsland, type IslandCrumb } from '@/Function/shared/MainIsland';
import { DropdownMenu, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import { MenuShell } from '@/Function/shared/menu';
import { ARTIFACT_DECKS_KEY, useNotebooksAndDecks } from '@/hooks/artifactData';
import { useWorkspaceActions } from '@/shell/WorkspaceActionsContext';
import { NavNoteIcon, NavSlidesIcon } from '@/shell/sidebar/NavIcons';
import { createDeckInFolder, openDeck } from '@/ActivitySpace/sustainment/slides/artifactDecks';
import { setNextNotebookFolder } from '@/ActivitySpace/sustainment/notebook/notebookActions';
import type { FilesRoute } from '@/Function/files/filesRoute';

const OWNER_LABEL: Record<AttachmentOwnerKind, string> = {
  element: 'Element', object: 'Object', strategy: 'Strategy', folder: 'Folder',
};

const nameOf = (f: SpaceFile) => { const dot = f.name.lastIndexOf('.'); return dot > 0 ? f.name.slice(0, dot) : f.name; };

/**
 * Artifacts: one folder tree per Space. Folders nest without limit and hold
 * files, notebooks and slide decks; at the top sit the folders, and the files
 * attached to Elements, Objects and Strategies (each says what it is attached
 * to). A file opens beside the list; a notebook or a deck opens in its editor.
 */
export function FilesView({ navigation, onNavigate, onViewChange }: {
  navigation: NavigationState;
  onNavigate: (nav: Partial<NavigationState>) => void;
  onViewChange?: (view: string) => void;
}) {
  const route = navigation.files ?? {};
  if (route.view === 'trash') return <TrashList onBack={() => onNavigate({ files: {} })} />;
  return <ArtifactsBrowser navigation={navigation} onNavigate={onNavigate} onViewChange={onViewChange} />;
}

function ArtifactsBrowser({ navigation, onNavigate, onViewChange }: {
  navigation: NavigationState;
  onNavigate: (nav: Partial<NavigationState>) => void;
  onViewChange?: (view: string) => void;
}) {
  const { t } = useI18n();
  const route = navigation.files ?? {};
  const folderId = route.folderId ?? null;
  const spaceId = useActiveSpaceId();
  const { data: files, loading: filesLoading } = useSpaceAttachments(spaceId);
  const { data: folders } = useFolders('files');
  const { notebooks, decks, loading: othersLoading } = useNotebooksAndDecks(spaceId);
  const workers = useWorkers().data;
  const { openCreate } = useWorkspaceActions();
  const qc = useQueryClient();

  const go = (next: FilesRoute) => onNavigate({ files: next });
  const folder = folders.find((f) => f.id === folderId) ?? null;
  const actions = useFolderActions('files', null, folderId);

  // The path from the top to the open folder.
  const path = useMemo(() => {
    const out: Folder[] = [];
    let cur = folder;
    const seen = new Set<string>();
    while (cur && !seen.has(cur.id)) { seen.add(cur.id); out.unshift(cur); cur = folders.find((f) => f.id === cur!.parent_id) ?? null; }
    return out;
  }, [folder, folders]);

  // Search: names everywhere, and a file's text as well.
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  useEffect(() => { if (spaceId) void indexSpaceFiles(spaceId); }, [spaceId, files.length]);
  const [settled, setSettled] = useState('');
  useEffect(() => { const id = setTimeout(() => setSettled(query.trim()), 250); return () => clearTimeout(id); }, [query]);
  const found = useQuery({
    queryKey: ['attachments-search', spaceId, settled],
    enabled: !!spaceId && settled.length > 0,
    queryFn: () => searchAttachments(spaceId!, settled, 100),
  });
  const snippets = useMemo(() => new Map((found.data ?? []).map((h) => [h.id, h.snippet])), [found.data]);
  const q = settled.toLowerCase();
  const hit = (name: string) => name.toLowerCase().includes(q);

  // What this folder holds — or, while searching, every match in the Space.
  const shownFolders = q ? folders.filter((f) => hit(f.name)) : folders.filter((f) => (f.parent_id ?? null) === folderId);
  const shownNotebooks = q ? notebooks.filter((n) => hit(n.name)) : notebooks.filter((n) => (n.folder_id ?? null) === folderId);
  const shownDecks = q ? decks.filter((d) => hit(d.name)) : decks.filter((d) => (d.artifact_folder_id ?? null) === folderId);
  const shownFiles = q
    ? files.filter((f) => snippets.has(f.id) || hit(f.name) || hit(f.owner_label ?? ''))
    : files.filter((f) => (f.folder_id ?? null) === folderId);
  const total = shownFolders.length + shownNotebooks.length + shownDecks.length + shownFiles.length;

  const open = files.find((f) => f.id === route.fileId) ?? null;
  const select = (f: SpaceFile | null) => go({ folderId, fileId: f?.id ?? null });
  const who = (f: SpaceFile) => workers.find((w) => w.user_id === f.uploaded_by)?.name ?? t('Someone');

  const fail = (e: unknown) => void appDialog.alert(e instanceof Error ? e.message : String(e));
  const newFolder = async () => {
    const name = await appDialog.prompt(t('Folder name'), t('New folder'));
    if (!name?.trim()) return;
    actions.create.mutate(name, { onSuccess: (f) => go({ folderId: f.id }), onError: fail });
  };
  const newNotebook = () => { setNextNotebookFolder(folderId); openCreate('notebook'); };
  const newDeck = () => {
    onViewChange?.('slides');
    void createDeckInFolder(folderId).then(() => qc.invalidateQueries({ queryKey: ARTIFACT_DECKS_KEY })).catch(fail);
  };
  const openNotebook = (id: string) => { onNavigate({ noteFolderId: id, noteSectionId: null, noteId: null }); onViewChange?.('note'); };
  const openSlides = (id: string) => { onViewChange?.('slides'); void openDeck(id); };

  // Files dropped on an open folder go into it.
  const { upload } = useAttachmentActions({ kind: 'folder', id: folder?.id ?? '' });
  const uploadInput = useRef<HTMLInputElement | null>(null);
  const [dropping, setDropping] = useState(false);
  const drop = (list: FileList) => { if (folder) for (const f of Array.from(list)) upload.mutate(f); };

  const crumbs: IslandCrumb[] = [
    { id: 'artifacts', label: t('Artifacts'), onClick: folder ? () => go({}) : undefined },
    ...path.map((f, i) => ({ id: f.id, label: f.name, onClick: i < path.length - 1 ? () => go({ folderId: f.id }) : undefined })),
  ];

  const iconBtn = 'flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground';
  return (
    <MainIsland crumbs={crumbs} count={total} actions={<>
      {searching ? (
        <label className="flex h-7 w-56 items-center gap-1.5 rounded-md bg-muted/50 px-2 text-[12.5px] focus-within:bg-muted">
          <Search size={12} className="shrink-0 text-muted-foreground" />
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('Search names and contents')} aria-label={t('Search artifacts')}
            onKeyDown={(e) => { if (e.key === 'Escape') { setQuery(''); setSearching(false); } }}
            className="min-w-0 flex-1 bg-transparent outline-none" />
          <button type="button" aria-label={t('Close')} onClick={() => { setQuery(''); setSearching(false); }} className="text-muted-foreground hover:text-foreground"><X size={12} /></button>
        </label>
      ) : (
        <button type="button" className={iconBtn} title={t('Search artifacts')} aria-label={t('Search artifacts')} onClick={() => setSearching(true)}><Search size={14} /></button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className={iconBtn} title={t('Add')} aria-label={t('Add')}><Plus size={15} /></button>
        </DropdownMenuTrigger>
        <MenuShell as="dropdown" align="end">
          <DropdownMenuItem onSelect={() => void newFolder()} className="gap-2.5 text-[13px]"><FolderIcon size={14} />{t('New folder')}</DropdownMenuItem>
          <DropdownMenuItem disabled={!folder} onSelect={() => uploadInput.current?.click()} className="gap-2.5 text-[13px]"
            title={folder ? undefined : t('Open a folder to upload into it')}><Upload size={14} />{t('Upload files')}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={newNotebook} className="gap-2.5 text-[13px]"><NavNoteIcon size={14} />{t('Notebook')}</DropdownMenuItem>
          <DropdownMenuItem onSelect={newDeck} className="gap-2.5 text-[13px]"><NavSlidesIcon size={14} />{t('Slide')}</DropdownMenuItem>
        </MenuShell>
      </DropdownMenu>
      <input ref={uploadInput} type="file" multiple hidden onChange={(e) => { const picked = e.target.files; if (picked) drop(picked); e.target.value = ''; }} />
    </>}>
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
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
          {(filesLoading || othersLoading) && !total ? <p className="px-[18px] py-6 text-[13px] text-muted-foreground">{t('Loading…')}</p>
            : !total ? <p className="px-[18px] py-6 text-[13px] text-muted-foreground">{q ? t('Nothing matches.') : folder ? t('This folder is empty. Drop files here, or add something with +.') : t('No artifacts yet. Add a folder, a notebook or a slide with +.')}</p>
            : <>
              {shownFolders.map((f) => (
                <FolderRow key={f.id} folder={f} onOpen={() => go({ folderId: f.id })} />
              ))}
              {shownNotebooks.map((n) => (
                <ItemRow key={n.id} icon={<NavNoteIcon size={15} />} name={n.name} kind={t('Notebook')} updated={n.updated_at} onOpen={() => openNotebook(n.id)} />
              ))}
              {shownDecks.map((d) => (
                <ItemRow key={d.id} icon={<NavSlidesIcon size={15} />} name={d.name} kind={t('Slide')} updated={d.updated_at} onOpen={() => openSlides(d.id)} />
              ))}
              {shownFiles.map((f) => {
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
                      {settled && snippets.get(f.id) && (
                        <span className="mt-0.5 block truncate pl-6 text-[12px] text-muted-foreground">{snippets.get(f.id)}</span>
                      )}
                    </span>
                    {!open && (
                      <span className="hidden w-56 shrink-0 truncate text-[12.5px] text-muted-foreground md:block">
                        {owner.kind === 'folder' ? '—' : <><span className="text-muted-foreground/70">{t(OWNER_LABEL[owner.kind])} · </span>{f.owner_label ?? '—'}</>}
                      </span>
                    )}
                    {!open && <span className="hidden w-32 shrink-0 truncate text-[12.5px] text-muted-foreground lg:block">{who(f)}</span>}
                    <span className="w-20 shrink-0 text-right text-[12px] tabular-nums text-muted-foreground">{formatAge(f.created_at, true)}</span>
                  </button>
                );
              })}
            </>}
          {/* The trash, from the top of the tree. */}
          {!folder && !q && (
            <button type="button" onClick={() => go({ view: 'trash' })}
              className="mt-2 flex h-9 w-full items-center gap-2 rounded-md px-[18px] text-left text-[13px] text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground">
              <Trash2 size={14} />{t('Deleted')}
            </button>
          )}
        </div>
      </div>

      {open && <FilePane file={open} who={who(open)} onClose={() => select(null)} />}
    </div>
    </MainIsland>
  );
}

/** A folder in the list: opens on click; rename and delete from its "⋯". */
function FolderRow({ folder, onOpen }: { folder: Folder; onOpen: () => void }) {
  const { t } = useI18n();
  const { rename, remove } = useFolderActions('files');
  const fail = (e: unknown) => void appDialog.alert(e instanceof Error ? e.message : String(e));
  return (
    <div className="group/row flex h-9 items-center gap-3 rounded-md px-[18px] hover:bg-foreground/[0.05]">
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-2 text-left">
        <FolderIcon size={15} className="shrink-0 text-muted-foreground" />
        <span className="truncate text-[13.5px] text-foreground">{folder.name}</span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label={t('More')} className="flex size-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-muted group-hover/row:opacity-100 data-[state=open]:opacity-100">
            <MoreHorizontal size={14} />
          </button>
        </DropdownMenuTrigger>
        <MenuShell as="dropdown" align="end">
          <DropdownMenuItem className="text-[13px]" onSelect={() => void appDialog.prompt(t('Folder name'), folder.name).then((name) => {
            if (name?.trim() && name.trim() !== folder.name) rename.mutate({ id: folder.id, name }, { onError: fail });
          })}>{t('Rename')}</DropdownMenuItem>
          <DropdownMenuItem className="text-[13px] text-[var(--status-danger)]" onSelect={() => remove.mutate(folder.id, { onError: fail })}>{t('Delete')}</DropdownMenuItem>
        </MenuShell>
      </DropdownMenu>
    </div>
  );
}

/** A notebook or a deck in the list: opens in its editor. */
function ItemRow({ icon, name, kind, updated, onOpen }: { icon: React.ReactNode; name: string; kind: string; updated: string; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="flex h-9 w-full items-center gap-3 rounded-md px-[18px] text-left hover:bg-foreground/[0.05]">
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span className="shrink-0 text-muted-foreground">{icon}</span>
        <span className="truncate text-[13.5px] text-foreground">{name}</span>
      </span>
      <span className="hidden w-56 shrink-0 truncate text-[12.5px] text-muted-foreground md:block">{kind}</span>
      <span className="hidden w-32 shrink-0 lg:block" />
      <span className="w-20 shrink-0 text-right text-[12px] tabular-nums text-muted-foreground">{formatAge(updated, true)}</span>
    </button>
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
function TrashList({ onBack }: { onBack: () => void }) {
  const { t } = useI18n();
  const { data: files, loading } = useSpaceAttachments(useActiveSpaceId(), true);
  return (
    <MainIsland crumbs={[{ id: 'artifacts', label: t('Artifacts'), onClick: onBack }, { id: 'trash', label: t('Deleted') }]} count={files.length}
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

