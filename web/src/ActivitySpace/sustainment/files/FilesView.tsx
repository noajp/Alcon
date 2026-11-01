'use client';

import { useMemo, useState } from 'react';
import { ArrowUpRight, Search } from 'lucide-react';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { DisclosureTriangle } from '@/Function/shared/DisclosureTriangle';
import { PageIcon, PAGE_TITLE, PAGE_TITLE_WEIGHT } from '@/Function/shared/PageHead';
import { AttachmentPreview } from '@/Function/shared/attachments/AttachmentList';
import { FileTypeIcon } from '@/Function/office/fileTypeIcon';
import { openInApp } from '@/Function/shared/appNavigation';
import { formatAge } from '@/Function/shared/dateUtils';
import { crmRoute, routeTo } from '@/Function/crm/crmRoute';
import { useActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { FilesIcon } from '@/Function/shared/conceptIcons';
import { ownerOf, useSpaceAttachments, type AttachmentOwnerKind, type SpaceFile } from '@/hooks/attachmentData';
import { useWorkers } from '@/hooks/teamData';
import { FileImportActions, canImport } from '@/ActivitySpace/execution/element/FileImportActions';

/** What a file is attached to, as the filter groups it. */
type OwnerGroup = 'all' | 'execution' | 'strategy' | 'crm';
const OWNER_GROUP: Record<AttachmentOwnerKind, Exclude<OwnerGroup, 'all'>> = {
  element: 'execution', object: 'execution', strategy: 'strategy', portfolio: 'strategy', deal: 'crm', company: 'crm',
};
const OWNER_LABEL: Record<AttachmentOwnerKind, string> = {
  element: 'Element', object: 'Object', strategy: 'Initiative', portfolio: 'Portfolio', deal: 'Deal', company: 'Company',
};

/** What a file is, as the filter groups it. */
type TypeGroup = 'all' | 'doc' | 'sheet' | 'deck' | 'pdf' | 'image' | 'other';
/** Pure. A file's kind, from its name and type. */
function typeOf(f: SpaceFile): Exclude<TypeGroup, 'all'> {
  const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
  if (['docx', 'doc', 'odt', 'rtf', 'txt', 'md'].includes(ext)) return 'doc';
  if (['xlsx', 'xls', 'csv', 'ods', 'tsv'].includes(ext)) return 'sheet';
  if (['pptx', 'ppt', 'odp', 'key'].includes(ext)) return 'deck';
  if (ext === 'pdf') return 'pdf';
  if (f.mime_type?.startsWith('image/')) return 'image';
  return 'other';
}

/** Opens what a file is attached to, where it lives in Alcon. */
function openOwner(f: SpaceFile) {
  const owner = ownerOf(f);
  if (owner.kind === 'element') openInApp('domain-elements', { objectId: f.element_object_id ?? null });
  else if (owner.kind === 'object') openInApp('objects', { objectId: owner.id });
  else if (owner.kind === 'strategy') openInApp('strategy', { strategyId: owner.id });
  else if (owner.kind === 'portfolio') openInApp('portfolio', { portfolioId: owner.id });
  else openInApp('crm', { crm: routeTo(crmRoute(undefined), owner.kind === 'deal' ? { view: 'deals', dealId: owner.id } : { view: 'companies', companyId: owner.id }) });
}

/**
 * Files: every file attached anywhere in the Space — to Elements, Objects,
 * Initiatives, Portfolios, deals and companies — in one list, newest first.
 * A file stays where it is attached (it is that thing's evidence, seen by
 * whoever can see that thing); this is the way in from the other side:
 * find a file by its name, its kind or where it sits, preview it (Word and
 * Excel editable, with its versions) and go to what it is attached to.
 */
export function FilesView() {
  const { t } = useI18n();
  const spaceId = useActiveSpaceId();
  const { data: files, loading } = useSpaceAttachments(spaceId);
  const workers = useWorkers().data;
  const [query, setQuery] = useState('');
  const [ownerGroup, setOwnerGroup] = useState<OwnerGroup>('all');
  const [typeGroup, setTypeGroup] = useState<TypeGroup>('all');
  const [openId, setOpenId] = useState<string | null>(null);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return files.filter((f) => (ownerGroup === 'all' || OWNER_GROUP[ownerOf(f).kind] === ownerGroup)
      && (typeGroup === 'all' || typeOf(f) === typeGroup)
      && (!q || f.name.toLowerCase().includes(q) || (f.owner_label ?? '').toLowerCase().includes(q)));
  }, [files, query, ownerGroup, typeGroup]);

  const chip = <T extends string>(group: string, value: T, current: T, label: string, set: (v: T) => void) => (
    <button key={`${group}-${value}`} type="button" onClick={() => set(value)} aria-pressed={value === current}
      className={`h-7 rounded-full px-3 text-[12.5px] transition-colors ${value === current ? 'bg-foreground/10 text-foreground' : 'text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground'}`}>
      {label}
    </button>
  );

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-8 py-8">
        <div className="flex items-center gap-3">
          <PageIcon><FilesIcon size={18} /></PageIcon>
          <h1 className={PAGE_TITLE} style={PAGE_TITLE_WEIGHT}>{t('Files')}</h1>
          {files.length > 0 && <span className="text-sm tabular-nums text-muted-foreground">{files.length}</span>}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{t('Every file attached in this Space, where it is attached.')}</p>

        <div className="mt-6 flex flex-wrap items-center gap-2">
          <label className="flex h-8 min-w-56 flex-1 items-center gap-2 rounded-md bg-muted/50 px-2.5 text-[13px] focus-within:bg-muted">
            <Search size={13} className="text-muted-foreground" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('Search by file name or where it is attached')}
              aria-label={t('Search files')} className="min-w-0 flex-1 bg-transparent outline-none" />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1">
          {chip('owner', 'all', ownerGroup, t('Everywhere'), setOwnerGroup)}
          {chip('owner', 'execution', ownerGroup, t('Execution'), setOwnerGroup)}
          {chip('owner', 'strategy', ownerGroup, t('Strategy'), setOwnerGroup)}
          {chip('owner', 'crm', ownerGroup, t('CRM'), setOwnerGroup)}
          <span className="mx-2 h-4 w-px bg-border/60" />
          {chip('type', 'all', typeGroup, t('All kinds'), setTypeGroup)}
          {chip('type', 'doc', typeGroup, t('Documents'), setTypeGroup)}
          {chip('type', 'sheet', typeGroup, t('Spreadsheets'), setTypeGroup)}
          {chip('type', 'deck', typeGroup, t('Presentations'), setTypeGroup)}
          {chip('type', 'pdf', typeGroup, 'PDF', setTypeGroup)}
          {chip('type', 'image', typeGroup, t('Images'), setTypeGroup)}
          {chip('type', 'other', typeGroup, t('Other'), setTypeGroup)}
        </div>

        <div className="mt-4 -mx-2">
          {loading ? <p className="px-2 py-6 text-sm text-muted-foreground">{t('Loading…')}</p>
            : !shown.length ? <p className="px-2 py-6 text-sm text-muted-foreground">{files.length ? t('No files match.') : t('No files are attached in this Space yet. Attach them to Elements, Objects, Initiatives or CRM records.')}</p>
            : shown.map((f) => {
              const owner = ownerOf(f);
              const open = openId === f.id;
              const dot = f.name.lastIndexOf('.');
              return (
                <div key={f.id}>
                  <div className="flex min-h-[2.375rem] items-center gap-3 rounded-lg px-2 py-1 hover:bg-foreground/[0.06]">
                    <button type="button" onClick={() => setOpenId(open ? null : f.id)} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                      <FileTypeIcon name={f.name} mime={f.mime_type} />
                      <span className="truncate text-[14px] font-medium text-foreground" title={f.name}>{dot > 0 ? f.name.slice(0, dot) : f.name}</span>
                      {f.versions > 1 && <span className="shrink-0 text-[11.5px] tabular-nums text-muted-foreground">v{f.versions}</span>}
                      <DisclosureTriangle open={open} className="shrink-0 text-muted-foreground" />
                    </button>
                    <button type="button" onClick={() => openOwner(f)} title={t('Open where it is attached')}
                      className="group/owner flex w-36 min-w-0 shrink-0 lg:w-64 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left text-[12.5px] text-muted-foreground hover:bg-muted hover:text-foreground">
                      <span className="shrink-0 text-muted-foreground/70">{t(OWNER_LABEL[owner.kind])}</span>
                      <span className="truncate">{f.owner_label ?? '—'}</span>
                      <ArrowUpRight size={12} className="shrink-0 opacity-0 group-hover/owner:opacity-100" />
                    </button>
                    <span className="hidden w-32 shrink-0 truncate text-[12.5px] text-muted-foreground md:block">
                      {workers.find((w) => w.user_id === f.uploaded_by)?.name ?? t('Someone')}
                    </span>
                    <span className="w-20 shrink-0 text-right text-[12px] tabular-nums text-muted-foreground">{formatAge(f.created_at, true)}</span>
                  </div>
                  {open && <div className="px-2 pb-3">
                    <AttachmentPreview file={f} owner={owner} actions={canImport(f.name) ? <FileImportActions file={f} /> : undefined} />
                  </div>}
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}
