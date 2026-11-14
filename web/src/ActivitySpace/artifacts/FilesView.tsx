'use client';

import { formatError } from '@/Function/shared/formatError';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, Folder as FolderIcon, FolderInput, Loader2, MoreHorizontal, Plus, RotateCcw, Search, Trash2, Upload, X } from '@/ui/icons';
import { Button } from '@/ui/button';
import { ViewTabs } from '@/Function/shared/ViewTabs';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { AttachmentPreview } from '@/Function/shared/attachments/AttachmentList';
import { FileTypeIcon } from '@/Function/office/fileTypeIcon';
import { useElementSize } from '@/Function/office/officeViewParts';
import { openAttachmentOwner } from '@/Function/shared/attachments/openOwner';
import { formatAge } from '@/Function/shared/dateUtils';
import { useActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { setActiveDomainId } from '@/Function/space/domainsStore';
import { TRASH_DAYS, indexSpaceFiles, ownerOf, searchAttachments, textSearchCaptionOf, trashDaysLeft, useAttachmentActions, useAttachmentTextStatus, useSpaceAttachments, type AttachmentOwnerKind, type SpaceFile } from '@/hooks/attachmentData';
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
import { MenuSectionLabel, MenuShell } from '@/Function/shared/menu';
import { ARTIFACT_DECKS_KEY, createArtifactFolder, ensureArtifactRoot, useNotebooksAndDecks, type ArtifactPlace } from '@/hooks/artifactData';
import { useSustainmentDomains } from '@/hooks/useSustainmentDomains';
import { useObjects } from '@/Function/sync/explorerData';
import { useCurrentUserId } from '@/providers/authContext';
import { DomainIcon, ObjectIcon } from '@/Function/shared/conceptIcons';
import { ItemIcon } from '@/Function/shared/itemIcon/ItemIcon';
import { useWorkspaceActions } from '@/Frame/WorkspaceActionsContext';
import { NavNoteIcon, NavSlidesIcon } from '@/Frame/sidebar/NavIcons';
import { createDeckInFolder, openDeck } from '@/ActivitySpace/artifacts/slides/artifactDecks';
import { setNextNotebookFolder } from '@/ActivitySpace/artifacts/notebook/notebookActions';
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

type ArtifactTab = NonNullable<FilesRoute['tab']>;
const TABS: { id: ArtifactTab; label: string }[] = [
  { id: 'space', label: 'Space' }, { id: 'domain', label: 'Domain' }, { id: 'object', label: 'Objects' }, { id: 'my', label: 'My' },
];

function ArtifactsBrowser({ navigation, onNavigate, onViewChange }: {
  navigation: NavigationState;
  onNavigate: (nav: Partial<NavigationState>) => void;
  onViewChange?: (view: string) => void;
}) {
  const { t } = useI18n();
  const route = navigation.files ?? {};
  const tab: ArtifactTab = route.tab ?? 'space';
  const folderId = route.folderId ?? null;
  const spaceId = useActiveSpaceId();
  const userId = useCurrentUserId();
  const { data: files, loading: filesLoading } = useSpaceAttachments(spaceId);
  const { data: folders } = useFolders('files');
  const { notebooks, decks, loading: othersLoading } = useNotebooksAndDecks(spaceId);
  const domains = useSustainmentDomains().data;
  const allObjects = useObjects().data.objects;
  // This Space's Objects: those in one of its Domains.
  const objects = useMemo(() => {
    const mine = new Set(domains.map((d) => d.id));
    return allObjects.filter((o) => o.domain_id && mine.has(o.domain_id));
  }, [allObjects, domains]);
  const workers = useWorkers().data;
  const { openCreate } = useWorkspaceActions();
  const qc = useQueryClient();

  const go = (next: FilesRoute) => onNavigate({ files: next });
  const here = (next: Partial<FilesRoute>) => go({ tab, domainId: route.domainId ?? null, objectId: route.objectId ?? null, ...next });

  // The place this tab is showing — null while choosing a Domain or an Object.
  const place: ArtifactPlace | null = tab === 'space' ? { scope: 'space' }
    : tab === 'my' ? (userId ? { scope: 'my', userId } : null)
    : tab === 'domain' ? (route.domainId ? { scope: 'domain', domainId: route.domainId } : null)
    : route.objectId ? { scope: 'object', objectId: route.objectId } : null;
  const inPlace = (f: Folder) => !!place && f.scope === place.scope
    && (place.scope !== 'domain' || f.domain_id === place.domainId)
    && (place.scope !== 'object' || f.object_id === place.objectId)
    && (place.scope !== 'my' || f.owner_id === place.userId);
  const root = folders.find((f) => f.is_root && inPlace(f)) ?? null;
  const folder = folders.find((f) => f.id === folderId) ?? null;
  const atTop = !folder;
  const parentKey = folder?.id ?? root?.id ?? '';

  // The path from the tab's top to the open folder.
  const path = useMemo(() => {
    const out: Folder[] = [];
    let cur = folder;
    const seen = new Set<string>();
    while (cur && !cur.is_root && !seen.has(cur.id)) { seen.add(cur.id); out.unshift(cur); cur = folders.find((f) => f.id === cur!.parent_id) ?? null; }
    return out;
  }, [folder, folders]);

  // Search: names everywhere you can see, and a file's text as well.
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

  // What this place holds at this level. At a tab's top: what is in its root
  // folder, and what was there before roots existed (Space's decks and
  // folders, your notebooks); an Object's top also lists what is attached to
  // it and its Elements.
  const legacyTop = (f: Folder) => atTop && !f.is_root && f.parent_id === null && inPlace(f);
  // Domain and Objects with none chosen: the top of every Domain's (or
  // Object's) tree at once, each row saying whose it is.
  const across = !place && (tab === 'domain' || tab === 'object');
  const acrossScope = tab === 'domain' ? 'domain' : 'object';
  const acrossRoots = useMemo(() => new Set(folders.filter((f) => f.is_root && f.scope === acrossScope).map((f) => f.id)), [folders, acrossScope]);
  const objectIds = useMemo(() => new Set(objects.map((o) => o.id)), [objects]);
  const shownFolders = q ? folders.filter((f) => !f.is_root && hit(f.name))
    : across ? folders.filter((f) => !f.is_root && f.scope === acrossScope && (f.parent_id === null || acrossRoots.has(f.parent_id)))
    : place ? folders.filter((f) => !f.is_root && (f.parent_id === parentKey || legacyTop(f))) : [];
  const shownNotebooks = q ? notebooks.filter((n) => hit(n.name))
    : across ? notebooks.filter((n) => !!n.folder_id && acrossRoots.has(n.folder_id))
    : place ? notebooks.filter((n) => (n.folder_id && n.folder_id === parentKey) || (atTop && tab === 'my' && !n.folder_id)) : [];
  const shownDecks = q ? decks.filter((d) => hit(d.name))
    : across ? decks.filter((d) => !!d.artifact_folder_id && acrossRoots.has(d.artifact_folder_id))
    : place ? decks.filter((d) => (d.artifact_folder_id && d.artifact_folder_id === parentKey) || (atTop && tab === 'space' && !d.artifact_folder_id)) : [];
  const shownFiles = q ? files.filter((f) => snippets.has(f.id) || hit(f.name) || hit(f.owner_label ?? ''))
    : across ? files.filter((f) => (!!f.folder_id && acrossRoots.has(f.folder_id))
      || (tab === 'object' && ((!!f.object_id && objectIds.has(f.object_id)) || (!!f.element_object_id && objectIds.has(f.element_object_id)))))
    : place ? files.filter((f) => (f.folder_id && f.folder_id === parentKey)
      || (atTop && place.scope === 'object' && (f.object_id === place.objectId || f.element_object_id === place.objectId))) : [];

  // Whose a row is, in Domain and Objects across: the Domain's (or Object's)
  // mark and name, which opens that Domain's (or Object's) own page.
  const openDomainPage = (id: string) => { setActiveDomainId(id); onNavigate({ objectId: null }); onViewChange?.('domain-overview'); };
  const openObjectPage = (id: string, domainId: string | null) => {
    if (domainId) setActiveDomainId(domainId);
    onNavigate({ objectId: id, objectDomainId: domainId ?? undefined });
    onViewChange?.('objects');
  };
  const folderById = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders]);
  const whereOf = (folderIdOf: string | null, objectId?: string | null): React.ReactNode => {
    if (!across) return undefined;
    const holder = folderIdOf ? folderById.get(folderIdOf) : undefined;
    if (tab === 'domain') {
      const d = domains.find((x) => x.id === holder?.domain_id);
      return d ? <WhereCell icon={<ItemIcon icon={d.icon} color={d.color} size={12} fallback={<DomainIcon size={12} />} />} name={d.name} onOpen={() => openDomainPage(d.id)} /> : null;
    }
    const o = objects.find((x) => x.id === (holder?.object_id ?? objectId));
    return o ? <WhereCell icon={<ItemIcon icon={o.icon} color={o.color} size={12} fallback={<ObjectIcon size={12} />} />} name={o.name} onOpen={() => openObjectPage(o.id, o.domain_id ?? null)} /> : null;
  };
  const total = shownFolders.length + shownNotebooks.length + shownDecks.length + shownFiles.length;

  const open = files.find((f) => f.id === route.fileId) ?? null;
  const select = (f: SpaceFile | null) => here({ folderId, fileId: f?.id ?? null });
  const who = (f: SpaceFile) => workers.find((w) => w.user_id === f.uploaded_by)?.name ?? t('Someone');

  const fail = (e: unknown) => void appDialog.alert(formatError(e));
  // Where something new goes: the open folder, else this tab's root.
  const target = async () => folder?.id ?? await ensureArtifactRoot(spaceId!, place!);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['folders'] });
    void qc.invalidateQueries({ queryKey: ['attachments-of'] });
    void qc.invalidateQueries({ queryKey: ['artifact-notebooks'] });
    void qc.invalidateQueries({ queryKey: ARTIFACT_DECKS_KEY });
  };
  const newFolder = async () => {
    const name = await appDialog.prompt(t('Folder name'), t('New folder'));
    if (!name?.trim()) return;
    try { const f = await createArtifactFolder(spaceId!, await target(), name); refresh(); here({ folderId: f.id }); }
    catch (e) { fail(e); }
  };
  const newNotebook = async () => {
    try { setNextNotebookFolder(await target()); refresh(); openCreate('notebook'); } catch (e) { fail(e); }
  };
  const newDeck = async () => {
    try {
      const into = await target();
      onViewChange?.('slides');
      await createDeckInFolder(into);
      refresh();
    } catch (e) { fail(e); }
  };
  const openNotebook = (id: string) => { onNavigate({ noteFolderId: id, noteSectionId: null, noteId: null }); onViewChange?.('note'); };
  const openSlides = (id: string) => { onViewChange?.('slides'); void openDeck(id); };

  // Uploads go into the open folder, or the tab's root.
  const [uploadInto, setUploadInto] = useState<string | null>(null);
  const { upload } = useAttachmentActions({ kind: 'folder', id: uploadInto ?? folder?.id ?? '' });
  const uploadInput = useRef<HTMLInputElement | null>(null);
  const pending = useRef<File[]>([]);
  useEffect(() => {
    if (!uploadInto || !pending.current.length) return;
    for (const f of pending.current) upload.mutate(f);
    pending.current = [];
  }, [uploadInto, upload]);
  const drop = async (list: FileList) => {
    const picked = Array.from(list);
    if (!picked.length || !place) return;
    try {
      const into = await target();
      if (into === (uploadInto ?? folder?.id)) { for (const f of picked) upload.mutate(f); return; }
      pending.current = picked;
      setUploadInto(into);
    } catch (e) { fail(e); }
  };
  const [dropping, setDropping] = useState(false);

  const placeName = tab === 'domain' ? domains.find((d) => d.id === route.domainId)?.name
    : tab === 'object' ? objects.find((o) => o.id === route.objectId)?.name : null;
  const crumbs: IslandCrumb[] = [
    { id: 'artifacts', label: t('Artifacts'), onClick: folder || placeName ? () => go({ tab }) : undefined },
    ...(placeName ? [{ id: 'place', label: placeName, onClick: folder ? () => here({ folderId: null }) : undefined }] : []),
    ...path.map((f, i) => ({ id: f.id, label: f.name, onClick: i < path.length - 1 ? () => here({ folderId: f.id }) : undefined })),
  ];

  const iconBtn = 'flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40';
  return (
    <MainIsland crumbs={crumbs} actions={<>
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
        <DropdownMenuTrigger asChild disabled={!spaceId}>
          <button type="button" className={iconBtn} disabled={!spaceId} title={t('Add')} aria-label={t('Add')}><Plus size={15} /></button>
        </DropdownMenuTrigger>
        {across ? (
          // Across Domains (or Objects), first say whose: that one opens.
          <MenuShell as="dropdown" align="end">
            <MenuSectionLabel>{t('Choose where first')}</MenuSectionLabel>
            {(tab === 'domain' ? domains : objects).map((x) => (
              <DropdownMenuItem key={x.id} onSelect={() => go(tab === 'domain' ? { tab, domainId: x.id } : { tab, objectId: x.id })} className="gap-2.5 text-[13px]">
                <ItemIcon icon={x.icon} color={x.color} size={14} fallback={tab === 'domain' ? <DomainIcon size={14} /> : <ObjectIcon size={14} />} />{x.name}
              </DropdownMenuItem>
            ))}
          </MenuShell>
        ) : (
        <MenuShell as="dropdown" align="end">
          <DropdownMenuItem onSelect={() => void newFolder()} className="gap-2.5 text-[13px]"><FolderIcon size={14} />{t('New folder')}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => uploadInput.current?.click()} className="gap-2.5 text-[13px]"><Upload size={14} />{t('Upload files')}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void newNotebook()} className="gap-2.5 text-[13px]"><NavNoteIcon size={14} />{t('Notebook')}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void newDeck()} className="gap-2.5 text-[13px]"><NavSlidesIcon size={14} />{t('Slide')}</DropdownMenuItem>
        </MenuShell>
        )}
      </DropdownMenu>
      <input ref={uploadInput} type="file" multiple hidden onChange={(e) => { const picked = e.target.files; if (picked) void drop(picked); e.target.value = ''; }} />
    </>}>
    {/* Whose artifacts: who sees what is put here is the tab's. */}
    <ViewTabs tabs={TABS} active={tab} onSelect={(id) => go({ tab: id })} label={t('Whose artifacts')} />
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <>
        <IslandColumns>
          <span className="min-w-0 flex-1">{t('Name')}</span>
          {across && <span className="w-40 shrink-0">{tab === 'domain' ? t('Domain') : t('Object')}</span>}
          {!open && <span className="hidden w-36 shrink-0 md:block">{t('Kind')}</span>}
          {!open && <span className="hidden w-24 shrink-0 lg:block">{t('Added by')}</span>}
          <span className="w-16 shrink-0 text-right">{t('Updated')}</span>
        </IslandColumns>
        <div className={`min-h-0 flex-1 overflow-y-auto px-3 py-1 ${dropping ? 'bg-foreground/[0.04] outline-dashed outline-2 -outline-offset-4 outline-[var(--border-strong)]' : ''}`}
          onDragOver={place ? (e) => { e.preventDefault(); setDropping(true); } : undefined}
          onDragLeave={place ? () => setDropping(false) : undefined}
          onDrop={place ? (e) => { e.preventDefault(); setDropping(false); void drop(e.dataTransfer.files); } : undefined}>
          {(filesLoading || othersLoading) && !total ? <p className="px-[18px] py-6 text-[13px] text-muted-foreground">{t('Loading…')}</p>
            : !total ? <p className="px-[18px] py-6 text-[13px] text-muted-foreground">{q ? t('Nothing matches.') : across ? t(tab === 'domain' ? 'No Domain has artifacts yet. Open a Domain from + to add some.' : 'No Object has artifacts yet. Open an Object from + to add some.') : <>{t('Nothing here yet. Drop files here, or add a folder, a notebook or a slide with +.')} {t(TAB_HINT[tab])}</>}</p>
            : <>
              {shownFolders.map((f) => (
                <FolderRow key={f.id} folder={f} where={whereOf(f.id)} onOpen={() => go({ tab: TAB_OF[f.scope], domainId: f.domain_id, objectId: f.object_id, folderId: f.id })} />
              ))}
              {shownNotebooks.map((n) => (
                <ItemRow key={n.id} where={whereOf(n.folder_id)} icon={<NavNoteIcon size={15} />} name={n.name} kind={t('Notebook')} updated={n.updated_at} onOpen={() => openNotebook(n.id)} />
              ))}
              {shownDecks.map((d) => (
                <ItemRow key={d.id} where={whereOf(d.artifact_folder_id)} icon={<NavSlidesIcon size={15} />} name={d.name} kind={t('Slide')} updated={d.updated_at} onOpen={() => openSlides(d.id)} />
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
                    {across && <span className="w-40 shrink-0" onClick={(e) => e.stopPropagation()}>{whereOf(f.folder_id, f.object_id ?? f.element_object_id)}</span>}
                    {!open && (
                      <span className="hidden w-36 shrink-0 truncate text-[12.5px] text-muted-foreground md:block">
                        {owner.kind === 'folder' ? t('File') : <><span className="text-muted-foreground/70">{t(OWNER_LABEL[owner.kind])} · </span>{f.owner_label ?? '—'}</>}
                      </span>
                    )}
                    {!open && <span className="hidden w-24 shrink-0 truncate text-[12.5px] text-muted-foreground lg:block">{who(f)}</span>}
                    <span className="w-16 shrink-0 text-right text-[12px] tabular-nums text-muted-foreground">{formatAge(f.created_at, true)}</span>
                  </button>
                );
              })}
            </>}
          {/* The trash, from the top of the Space tab. */}
          {tab === 'space' && atTop && !q && (
            <button type="button" onClick={() => go({ view: 'trash' })}
              className="mt-2 flex h-9 w-full items-center gap-2 rounded-md px-[18px] text-left text-[13px] text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground">
              <Trash2 size={14} />{t('Deleted')}
            </button>
          )}
        </div>
        </>
      </div>

      {open && <FilePane file={open} who={who(open)} onClose={() => select(null)} />}
    </div>
    </MainIsland>
  );
}

const TAB_OF: Record<Folder['scope'], ArtifactTab> = { space: 'space', domain: 'domain', object: 'object', my: 'my' };
const TAB_HINT: Record<ArtifactTab, string> = {
  space: 'Everyone in the Space sees these.',
  domain: 'Whoever sees the Domain sees these.',
  object: 'Whoever sees the Object sees these.',
  my: 'Only you see these.',
};

/** A folder in the list: opens on click; rename and delete from its "⋯". */
function FolderRow({ folder, where, onOpen }: { folder: Folder; where?: React.ReactNode; onOpen: () => void }) {
  const { t } = useI18n();
  const { rename, remove } = useFolderActions('files');
  const fail = (e: unknown) => void appDialog.alert(formatError(e));
  return (
    <div className="group/row flex h-9 items-center gap-3 rounded-md px-[18px] hover:bg-foreground/[0.05]">
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-2 text-left">
        <FolderIcon size={15} className="shrink-0 text-muted-foreground" />
        <span className="truncate text-[13.5px] text-foreground">{folder.name}</span>
      </button>
      {where !== undefined && <span className="w-40 shrink-0">{where}</span>}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label={t('More')} className="flex size-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity focus-visible:opacity-100 hover:bg-muted group-hover/row:opacity-100 data-[state=open]:opacity-100">
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

/** Whose a row is (a Domain or an Object): its mark and name in the same
 *  outlined pill as a list's Object and Label chips, opening its page. */
function WhereCell({ icon, name, onOpen }: { icon: React.ReactNode; name: string; onOpen: () => void }) {
  return (
    // A span, not a button: it sits inside a row that is itself a button.
    <span role="link" tabIndex={0} onClick={(e) => { e.stopPropagation(); onOpen(); }}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onOpen(); } }} title={name}
      className="inline-flex h-[22px] cursor-pointer min-w-0 max-w-full items-center gap-1.5 rounded-full border border-[var(--border-default)] px-2 text-[12px] font-normal text-[var(--text-secondary)] transition-colors hover:bg-foreground/[0.05] hover:text-foreground">
      <span className="shrink-0">{icon}</span>
      <span className="truncate">{name}</span>
    </span>
  );
}

/** A notebook or a deck in the list: opens in its editor. */
function ItemRow({ icon, name, kind, updated, where, onOpen }: { icon: React.ReactNode; name: string; kind: string; updated: string; where?: React.ReactNode; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="flex h-9 w-full items-center gap-3 rounded-md px-[18px] text-left hover:bg-foreground/[0.05]">
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span className="shrink-0 text-muted-foreground">{icon}</span>
        <span className="truncate text-[13.5px] text-foreground">{name}</span>
      </span>
      {where !== undefined && <span className="w-40 shrink-0" onClick={(e) => e.stopPropagation()}>{where}</span>}
      <span className="hidden w-36 shrink-0 truncate text-[12.5px] text-muted-foreground md:block">{kind}</span>
      <span className="hidden w-24 shrink-0 lg:block" />
      <span className="w-16 shrink-0 text-right text-[12px] tabular-nums text-muted-foreground">{formatAge(updated, true)}</span>
    </button>
  );
}

/** The open file, beside the list: where it is attached, and the file itself. */
function FilePane({ file, who, onClose }: { file: SpaceFile; who: string; onClose: () => void }) {
  const { t } = useI18n();
  const owner = ownerOf(file);
  const trash = useTrashFile(file);
  const textCaption = textSearchCaptionOf(useAttachmentTextStatus(file.id));
  const [ref, size] = useElementSize<HTMLDivElement>();
  // A file at the top of a tab sits in the tab's hidden root folder: say the
  // tab, not the root's name.
  const holder = useFolders('files').data.find((f) => f.id === file.folder_id);
  const where = owner.kind === 'folder' && holder?.is_root
    ? `${t('Artifacts')} · ${t(TABS.find((x) => x.id === TAB_OF[holder.scope])?.label ?? 'Space')}`
    : `${t(OWNER_LABEL[owner.kind])} · ${file.element_display_id ? `${file.element_display_id} · ` : ''}${file.owner_label ?? '—'}`;
  return (
    <aside className="flex w-[min(58%,880px)] shrink-0 flex-col border-l border-border/60">
      <div className="flex shrink-0 items-start gap-2 px-4 pb-2 pt-4">
        <FileTypeIcon name={file.name} mime={file.mime_type} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-medium text-foreground" title={file.name}>{file.name}</div>
          <button type="button" onClick={() => openAttachmentOwner(file)} title={t('Open where it is attached')}
            className="group/owner mt-0.5 flex max-w-full items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground">
            <span className="truncate">{where}</span>
            <ArrowUpRight size={12} className="shrink-0 opacity-60 group-hover/owner:opacity-100" />
            <span className="shrink-0 text-muted-foreground/70">· {who} · {formatAge(file.created_at, true)}</span>
          </button>
          {textCaption && <div className="mt-0.5 text-[12px] text-muted-foreground">{t(textCaption)}</div>}
        </div>
        {file.folder_id && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="icon-xs" aria-label={t('Move to')} title={t('Move to')}><FolderInput size={13} /></Button>
            </DropdownMenuTrigger>
            <MenuShell as="dropdown" align="end">
              <MoveToFolderItems app="files" domainId={file.domain_id} current={file.folder_id} onMove={(id) => { if (id) void moveFileToFolder(file, id).catch((e) => void appDialog.alert(formatError(e))); }} />
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
    <MainIsland crumbs={[{ id: 'artifacts', label: t('Artifacts'), onClick: onBack }, { id: 'trash', label: t('Deleted') }]}
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

