'use client';

import { useMemo, useState } from 'react';
import { ArrowUpRight, Search, X } from 'lucide-react';
import { Button } from '@/ui/button';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { AttachmentPreview } from '@/Function/shared/attachments/AttachmentList';
import { FileTypeIcon } from '@/Function/office/fileTypeIcon';
import { useElementSize } from '@/Function/office/officeViewParts';
import { openInApp } from '@/Function/shared/appNavigation';
import { formatAge } from '@/Function/shared/dateUtils';
import { crmRoute, routeTo } from '@/Function/crm/crmRoute';
import { useActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { fileKindOf } from '@/Function/files/filesRoute';
import { ownerOf, useSpaceAttachments, type AttachmentOwnerKind, type SpaceFile } from '@/hooks/attachmentData';
import { useWorkers } from '@/hooks/teamData';
import type { NavigationState } from '@/types/navigation';
import { FileImportActions, canImport } from '@/ActivitySpace/execution/element/FileImportActions';
import { KINDS, WHERE } from './FilesSidebar';

const OWNER_LABEL: Record<AttachmentOwnerKind, string> = {
  element: 'Element', object: 'Object', strategy: 'Initiative', portfolio: 'Portfolio', deal: 'Deal', company: 'Company',
};

/** Opens what a file is attached to, where it lives in Alcon. */
function openOwner(f: SpaceFile) {
  const owner = ownerOf(f);
  if (owner.kind === 'element') openInApp('domain-elements', { objectId: f.element_object_id ?? null });
  else if (owner.kind === 'object') openInApp('objects', { objectId: owner.id });
  else if (owner.kind === 'strategy') openInApp('strategy', { strategyId: owner.id });
  else if (owner.kind === 'portfolio') openInApp('portfolio', { portfolioId: owner.id });
  else openInApp('crm', { crm: routeTo(crmRoute(undefined), owner.kind === 'deal' ? { view: 'deals', dealId: owner.id } : { view: 'companies', companyId: owner.id }) });
}

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
  const { t } = useI18n();
  const route = navigation.files ?? {};
  const { data: files, loading } = useSpaceAttachments(useActiveSpaceId());
  const workers = useWorkers().data;
  const [query, setQuery] = useState('');

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return files.filter((f) => (!route.where || ownerOf(f).kind === route.where)
      && (!route.kind || fileKindOf(f.name, f.mime_type) === route.kind)
      && (!q || f.name.toLowerCase().includes(q) || (f.owner_label ?? '').toLowerCase().includes(q)));
  }, [files, query, route.where, route.kind]);
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
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('Search files')} aria-label={t('Search files')}
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
                  className={`flex h-9 w-full items-center gap-3 rounded-md px-3 text-left transition-colors ${active ? 'bg-foreground/[0.08]' : 'hover:bg-foreground/[0.05]'}`}>
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <FileTypeIcon name={f.name} mime={f.mime_type} />
                    <span className="truncate text-[13.5px] text-foreground" title={f.name}>{nameOf(f)}</span>
                    {f.versions > 1 && <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">v{f.versions}</span>}
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
          <button type="button" onClick={() => openOwner(file)} title={t('Open where it is attached')}
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
