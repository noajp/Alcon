'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { RotateCcw, Trash2 } from 'lucide-react';
import { Button } from '@/ui/button';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { appDialog } from '@/Function/shared/appDialogStore';
import { DisclosureTriangle } from '@/Function/shared/DisclosureTriangle';
import { FilePreview, type FileEditor } from '@/Function/office/FilePreview';
import { FileTypeIcon } from '@/Function/office/fileTypeIcon';
import {
  TRASH_DAYS, attachmentSource, trashDaysLeft, useAttachmentActions, useAttachments,
  type Attachment, type AttachmentOwner,
} from '@/hooks/attachmentData';

/**
 * The files attached to one thing — an Element, an Object, an Initiative,
 * a deal… — one row each: its kind's icon and title, then ▶ to open its
 * preview right under it (where Word and Excel can be edited and saved as
 * a new version). A bin moves a file to the trash, folded underneath with
 * the days each has left and Restore. `actions` adds the caller's own tools
 * to a preview (what the file can become in Alcon).
 */
export function AttachmentList({ owner, actions, empty = null }: {
  owner: AttachmentOwner;
  actions?: (file: Attachment) => ReactNode;
  /** Shown when nothing is attached (and nothing is in the trash). */
  empty?: ReactNode;
}) {
  const { t } = useI18n();
  const { data: files, trashed } = useAttachments(owner);
  const fileActions = useAttachmentActions(owner);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [trashOpen, setTrashOpen] = useState(false);
  const fail = (err: unknown) => void appDialog.alert(err instanceof Error ? err.message : String(err));
  const toggle = (id: string) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  if (!files.length && !trashed.length) return <>{empty}</>;
  return <>
    {files.length > 0 && (
      <section className="w-full" aria-label={t('Files')}>
        <div className="-mx-2">
          {files.map((f) => {
            const dot = f.name.lastIndexOf('.');
            const title = dot > 0 ? f.name.slice(0, dot) : f.name;
            // A new version has a new id; the row stays open across it.
            const isOpen = open.has(f.id) || (!!f.previous_id && open.has(f.previous_id));
            return (
              <div key={f.id} className="group/file">
                <div className="flex min-h-[2.125rem] items-center gap-2 rounded-lg px-2 py-1 hover:bg-foreground/[0.06]">
                  <FileTypeIcon name={f.name} mime={f.mime_type} />
                  <button type="button" onClick={() => toggle(f.id)} aria-expanded={isOpen} className="flex min-w-0 items-center gap-2 text-left">
                    <span className="truncate text-[14px] font-medium text-foreground" title={f.name}>{title}</span>
                    <DisclosureTriangle open={isOpen} className="shrink-0 text-muted-foreground" />
                  </button>
                  <span className="flex-1" />
                  {/* A bin, not an ×: beside an open preview an × reads as
                      "close". It asks first, and the file goes to the trash
                      below, restorable for TRASH_DAYS. */}
                  <button type="button" aria-label={t('Remove {name}', { name: f.name })} title={t('Remove {name}', { name: f.name })}
                    onClick={async () => {
                      if (!await appDialog.confirm(t('Move “{name}” to the trash? It can be restored for {days} days.', { name: f.name, days: TRASH_DAYS }))) return;
                      fileActions.remove.mutate(f, { onError: fail });
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
    {trashed.length > 0 && (
      <section className="-mt-1 w-full" aria-label={t('Deleted files')}>
        <button type="button" onClick={() => setTrashOpen((o) => !o)} aria-expanded={trashOpen}
          className="flex items-center gap-1.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground">
          <DisclosureTriangle open={trashOpen} />
          <Trash2 size={12} />
          {t('Deleted files')} <span className="tabular-nums">{trashed.length}</span>
        </button>
        {trashOpen && (
          <div className="-mx-2 mt-1">
            {trashed.map((f) => (
              <div key={f.id} className="flex min-h-[2rem] items-center gap-2 rounded-lg px-2 py-1 text-muted-foreground hover:bg-foreground/[0.06]">
                <span className="opacity-60"><FileTypeIcon name={f.name} mime={f.mime_type} /></span>
                <span className="min-w-0 truncate text-[13px] line-through decoration-muted-foreground/40" title={f.name}>{f.name}</span>
                <span className="flex-1" />
                <span className="shrink-0 text-[11.5px] tabular-nums">{t('{n} days left', { n: trashDaysLeft(f.deleted_at!) })}</span>
                <Button type="button" variant="ghost" size="xs" className="text-muted-foreground" onClick={() => fileActions.restore.mutate(f, { onError: fail })}>
                  <RotateCcw size={12} />{t('Restore')}
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>
    )}
  </>;
}

/** An attached file's preview; its edits are saved as the file's next version. */
function AttachmentPreview({ file, owner, actions }: { file: Attachment; owner: AttachmentOwner; actions?: ReactNode }) {
  const { saveEdits } = useAttachmentActions(owner);
  const editor = useMemo<FileEditor>(() => ({ save: (edits) => saveEdits.mutateAsync({ file, edits }) }), [file, saveEdits]);
  return <FilePreview file={file} source={attachmentSource} editor={editor} actions={actions} />;
}
