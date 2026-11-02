'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { Check, Diff, History, Loader2, RotateCcw, Trash2 } from '@/ui/icons';
import { Button } from '@/ui/button';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { appDialog } from '@/Function/shared/appDialogStore';
import { DisclosureTriangle } from '@/Function/shared/DisclosureTriangle';
import { FilePreview, type FileEditor } from '@/Function/office/FilePreview';
import { FileTypeIcon } from '@/Function/office/fileTypeIcon';
import { DropdownMenu, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import { MenuShell, MenuSectionLabel, MENU_SEPARATOR } from '@/Function/shared/menu';
import { officeKindOf } from '@/Function/office/officePreview';
import { formatAge } from '@/Function/shared/dateUtils';
import { versionChain } from '@/Function/shared/fileVersions';
import { useWorkers } from '@/hooks/teamData';
import { useFilePresence } from '@/hooks/usePresence';
import { PresenceStack } from '@/Function/shared/PresenceStack';
import {
  TRASH_DAYS, attachmentSource, useAttachmentActions, useAttachments,
  type Attachment, type AttachmentOwner,
} from '@/hooks/attachmentData';

/**
 * The files attached to one thing — an Element, an Object, an Initiative,
 * a deal… — one row each: its kind's icon and title, then ▶ to open its
 * preview right under it (where Word and Excel can be edited and saved as
 * a new version). A bin moves a file to the trash, kept out of the list
 * for TRASH_DAYS and restored from Files. `actions` adds the caller's own
 * tools to a preview (what the file can become in Alcon).
 */
export function AttachmentList({ owner, actions, empty = null }: {
  owner: AttachmentOwner;
  actions?: (file: Attachment) => ReactNode;
  /** Shown when nothing is attached. */
  empty?: ReactNode;
}) {
  const { t } = useI18n();
  const { data: files, all } = useAttachments(owner);
  const fileActions = useAttachmentActions(owner);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  if (!files.length) return <>{empty}</>;
  return <>
    {files.length > 0 && (
      <section className="w-full" aria-label={t('Artifacts')}>
        <div className="-mx-2">
          {files.map((f) => {
            const dot = f.name.lastIndexOf('.');
            const title = dot > 0 ? f.name.slice(0, dot) : f.name;
            // A new version has a new id; the row stays open across it.
            const versions = versionChain(all, f.id);
            const isOpen = versions.some((v) => open.has(v.id));
            return (
              <div key={f.id} className="group/file">
                <div className="flex min-h-[2.125rem] items-center gap-2 rounded-lg px-2 py-1 hover:bg-foreground/[0.06]">
                  <FileTypeIcon name={f.name} mime={f.mime_type} />
                  <button type="button" onClick={() => toggle(f.id)} aria-expanded={isOpen} className="flex min-w-0 items-center gap-2 text-left">
                    <span className="truncate text-[14px] font-medium text-foreground" title={f.name}>{title}</span>
                    {versions.length > 1 && <span className="shrink-0 text-[11.5px] tabular-nums text-muted-foreground">v{versions.length}</span>}
                    <DisclosureTriangle open={isOpen} className="shrink-0 text-muted-foreground" />
                  </button>
                  <span className="flex-1" />
                  {/* A bin, not an ×: beside an open preview an × reads as
                      "close". It asks first, and the file goes to the trash
                      below, restorable for TRASH_DAYS. */}
                  <button type="button" aria-label={t('Remove {name}', { name: f.name })} title={t('Remove {name}', { name: f.name })}
                    onClick={async () => {
                      if (!await appDialog.confirm(t('Move “{name}” to the trash? It can be restored for {days} days.', { name: f.name, days: TRASH_DAYS }))) return;
                      fileActions.remove.mutate(f);
                    }}
                    className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-muted/50 hover:text-[var(--status-danger)] group-hover/file:opacity-100">
                    <Trash2 size={12} />
                  </button>
                </div>
                {isOpen && <div className="px-2 pb-2"><AttachmentPreview file={f} owner={owner} actions={actions?.(f)} /></div>}
              </div>
            );
          })}
        </div>
      </section>
    )}
  </>;
}

/** An attached file's preview; its edits are saved as the file's next
 *  version. With versions, a history menu shows an earlier one in place
 *  (read only) and can make it the newest again. */
export function AttachmentPreview({ file, owner, actions, height }: { file: Attachment; owner: AttachmentOwner; actions?: ReactNode; height?: number }) {
  const { t } = useI18n();
  const versions = versionChain(useAttachments(owner).all, file.id);
  // Who else has this file open, beside its tools.
  const viewers = useFilePresence(file.id);
  const { saveEdits, restoreVersion } = useAttachmentActions(owner);
  const editor = useMemo<FileEditor>(() => ({ save: (edits) => saveEdits.mutateAsync({ file, edits }) }), [file, saveEdits]);
  const workers = useWorkers().data;
  const who = (v: Attachment) => workers.find((w) => w.user_id === v.uploaded_by)?.name ?? t('Someone');
  // The version shown: the latest unless an earlier one was picked.
  const [pickedId, setPickedId] = useState<string | null>(null);
  const picked = versions.find((v) => v.id === pickedId && v.id !== file.id) ?? null;
  const shown = picked ?? file;
  const number = (v: Attachment) => versions.length - versions.indexOf(v);
  // Marking what this version changed from the one before it (Word, Excel).
  const [comparing, setComparing] = useState(false);
  const before = versions[versions.indexOf(shown) + 1] ?? null;
  const canCompare = !!before && ['xlsx', 'docx', 'pptx'].includes(officeKindOf(file.name) ?? '');

  const history = versions.length > 1 && (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="icon-xs" aria-label={t('Version history')} title={t('Version history')}><History size={13} /></Button>
      </DropdownMenuTrigger>
      <MenuShell as="dropdown" align="end" width="wide">
        <MenuSectionLabel>{t('Version history')}</MenuSectionLabel>
        {versions.map((v) => (
          <DropdownMenuItem key={v.id} onSelect={() => setPickedId(v.id === file.id ? null : v.id)}>
            <span className="w-7 shrink-0 tabular-nums text-muted-foreground">v{number(v)}</span>
            <span className="min-w-0 flex-1 truncate">{who(v)}</span>
            <span className="shrink-0 text-[11.5px] text-muted-foreground">{formatAge(v.created_at, true)}</span>
            {v.id === shown.id && <Check size={13} />}
          </DropdownMenuItem>
        ))}
        {['xlsx', 'docx', 'pptx'].includes(officeKindOf(file.name) ?? '') && <>
          <div className={MENU_SEPARATOR} />
          <DropdownMenuItem disabled={!before} onSelect={() => setComparing((c) => !c)}>
            <Diff size={13} /><span className="flex-1">{t('Show changes from the version before')}</span>{comparing && canCompare && <Check size={13} />}
          </DropdownMenuItem>
        </>}
      </MenuShell>
    </DropdownMenu>
  );

  return <>
    {picked && (
      <div className="mt-1 flex flex-wrap items-center gap-2 rounded-md bg-muted/50 px-2.5 py-1.5 text-[12.5px]">
        <History size={13} className="text-muted-foreground" />
        <span className="min-w-0 flex-1">
          {t('Version {n} of {total}, saved by {name} {age}', { n: number(picked), total: versions.length, name: who(picked), age: formatAge(picked.created_at, true) })}
        </span>
        <Button type="button" variant="ghost" size="xs" onClick={() => setPickedId(null)}>{t('Back to the latest')}</Button>
        <Button type="button" variant="secondary" size="xs" disabled={restoreVersion.isPending}
          onClick={async () => {
            if (!await appDialog.confirm(t('Make version {n} the latest? The versions after it stay in the history.', { n: number(picked) }))) return;
            restoreVersion.mutate(picked, { onSuccess: () => setPickedId(null) });
          }}>
          {restoreVersion.isPending ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}{t('Restore this version')}
        </Button>
      </div>
    )}
    <FilePreview file={shown} source={attachmentSource} editor={picked ? undefined : editor} compareTo={comparing && canCompare ? before : null} height={height}
      presence={viewers.length > 0 ? <PresenceStack viewers={viewers} size={18} /> : undefined}
      actions={history || (!picked && actions) ? <>{history}{!picked && actions}</> : undefined} />
  </>;
}
