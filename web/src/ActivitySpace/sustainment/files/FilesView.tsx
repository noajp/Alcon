'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, Loader2, RotateCcw, Search, X } from '@/ui/icons';
import { Button } from '@/ui/button';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { AttachmentPreview } from '@/Function/shared/attachments/AttachmentList';
import { FileTypeIcon } from '@/Function/office/fileTypeIcon';
import { useElementSize } from '@/Function/office/officeViewParts';
import { openAttachmentOwner } from '@/Function/shared/attachments/openOwner';
import { formatAge } from '@/Function/shared/dateUtils';
import { useActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { fileKindOf } from '@/Function/files/filesRoute';
import { TRASH_DAYS, indexSpaceFiles, ownerOf, searchAttachments, trashDaysLeft, useAttachmentActions, useSpaceAttachments, type AttachmentOwnerKind, type SpaceFile } from '@/hooks/attachmentData';
import { appDialog } from '@/Function/shared/appDialogStore';
import { useWorkers } from '@/hooks/teamData';
import type { NavigationState } from '@/types/navigation';
import { FileImportActions, canImport } from '@/ActivitySpace/execution/element/FileImportActions';
import { KINDS, WHERE } from './FilesSidebar';

const OWNER_LABEL: Record<AttachmentOwnerKind, string> = {
  element: 'Element', object: 'Object', strategy: 'Initiative', portfolio: 'Portfolio', deal: 'Deal', company: 'Company',
};

const nameOf = (f: SpaceFile) => { const dot = f.name.lastIndexOf('.'); return dot > 0 ? f.name.slice(0, dot) : f.name; };

/**
 * Files: every file attached anywhere in the Space, newest first, as one
 * list. A file stays where it is attached (it is that thing's evidence,
 * seen by whoever can see that thing); this is the way in from the other
 * side. The sidebar narrows the list by where files sit or what they are;
 * a row opens its file beside the list (Word and Excel editable, with
 * versions) without losing the list.
 */
export function FilesView({ navigation, onNavigate }: { navigation: NavigationState; onNavigate: (nav: Partial<NavigationState>) => void }) {
  const route = navigation.files ?? {};
  return route.trash ? <TrashList /> : <FileList navigation={navigation} onNavigate={onNavigate} />;
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
    return files.filter((f) => (!route.where || ownerOf(f).kind === route.where)
      && (!route.kind || fileKindOf(f.name, f.mime_type) === route.kind)
      && matches(f));
  }, [files, settled, snippets, route.where, route.kind]);
  const open = files.find((f) => f.id === route.fileId) ?? null;
  const select = (f: SpaceFile | null) => onNavigate({ files: { ...route, fileId: f?.id ?? null } });
  const title = route.where ? t(WHERE.find((w) => w.id === route.where)!.label)
    : route.kind ? (route.kind === 'pdf' ? 'PDF' : t(KINDS.find((k) => k.id === route.kind)!.label))
    : t('All files');
  const who = (f: SpaceFile) => workers.find((w) => w.user_id === f.uploaded_by)?.name ?? t('Someone');

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-3 px-6 pb-3 pt-5">
          <h1 className="text-[17px] font-semibold text-foreground">{title}</h1>
          <span className="text-[13px] tabular-nums text-muted-foreground">{shown.length}</span>
          <span className="flex-1" />
          <label className="flex h-7 w-56 items-center gap-1.5 rounded-md bg-muted/50 px-2 text-[12.5px] focus-within:bg-muted">
            <Search size={12} className="shrink-0 text-muted-foreground" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('Search names and contents')} aria-label={t('Search files')}
              className="min-w-0 flex-1 bg-transparent outline-none" />
          </label>
        </div>

        {/* Column heads; the list scrolls under them. */}
        <div className="flex shrink-0 items-center gap-3 border-b border-border/60 px-6 pb-1.5 text-[11.5px] text-muted-foreground">
          <span className="min-w-0 flex-1">{t('Name')}</span>
          {!open && <span className="hidden w-56 shrink-0 md:block">{t('Attached to')}</span>}
          {!open && <span className="hidden w-32 shrink-0 lg:block">{t('Added by')}</span>}
          <span className="w-20 shrink-0 text-right">{t('Updated')}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-1">
          {loading ? <p className="px-3 py-6 text-[13px] text-muted-foreground">{t('Loading…')}</p>
            : !shown.length ? <p className="px-3 py-6 text-[13px] text-muted-foreground">{files.length ? t('No files match.') : t('No files are attached in this Space yet. Attach them to Elements, Objects, Initiatives or CRM records.')}</p>
            : shown.map((f) => {
              const owner = ownerOf(f);
              const active = open?.id === f.id;
              return (
                <button key={f.id} type="button" onClick={() => select(active ? null : f)} aria-pressed={active}
                  className={`flex min-h-9 w-full items-center gap-3 rounded-md px-3 py-1.5 text-left transition-colors ${active ? 'bg-foreground/[0.08]' : 'hover:bg-foreground/[0.05]'}`}>
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
  );
}

/** The open file, beside the list: where it is attached, and the file itself. */
function FilePane({ file, who, onClose }: { file: SpaceFile; who: string; onClose: () => void }) {
  const { t } = useI18n();
  const owner = ownerOf(file);
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
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 px-6 pb-3 pt-5">
        <div className="flex items-center gap-3">
          <h1 className="text-[17px] font-semibold text-foreground">{t('Deleted')}</h1>
          <span className="text-[13px] tabular-nums text-muted-foreground">{files.length}</span>
        </div>
        <p className="mt-0.5 text-[12.5px] text-muted-foreground">{t('Removed files can be restored for {days} days, then they are erased.', { days: TRASH_DAYS })}</p>
      </div>
      <div className="flex shrink-0 items-center gap-3 border-b border-border/60 px-6 pb-1.5 text-[11.5px] text-muted-foreground">
        <span className="min-w-0 flex-1">{t('Name')}</span>
        <span className="hidden w-56 shrink-0 md:block">{t('Attached to')}</span>
        <span className="w-24 shrink-0 text-right">{t('Erased in')}</span>
        <span className="w-24 shrink-0" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-1">
        {loading ? <p className="px-3 py-6 text-[13px] text-muted-foreground">{t('Loading…')}</p>
          : !files.length ? <p className="px-3 py-6 text-[13px] text-muted-foreground">{t('Nothing has been removed.')}</p>
          : files.map((f) => <TrashRow key={f.id} file={f} />)}
      </div>
    </div>
  );
}

function TrashRow({ file }: { file: SpaceFile }) {
  const { t } = useI18n();
  const owner = ownerOf(file);
  const { restore } = useAttachmentActions(owner);
  return (
    <div className="flex h-9 items-center gap-3 rounded-md px-3 hover:bg-foreground/[0.05]">
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
          onClick={() => restore.mutate(file, { onError: (e) => void appDialog.alert(e instanceof Error ? e.message : String(e)) })}>
          {restore.isPending ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}{t('Restore')}
        </Button>
      </span>
    </div>
  );
}
