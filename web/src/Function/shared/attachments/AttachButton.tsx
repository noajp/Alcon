'use client';

import { useRef } from 'react';
import { Loader2, Paperclip } from '@/ui/icons';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { appDialog } from '@/Function/shared/appDialogStore';
import { useAttachmentActions, type AttachmentOwner } from '@/hooks/attachmentData';

/** A paperclip that attaches files from this computer to `owner` — they
 *  list in its AttachmentList. The look is the caller's (`className`). */
export function AttachButton({ owner, className, size = 15 }: { owner: AttachmentOwner; className?: string; size?: number }) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement | null>(null);
  const { upload } = useAttachmentActions(owner);
  return <>
    <button type="button" onClick={() => input.current?.click()} disabled={upload.isPending}
      className={className} title={t('Attach a file')} aria-label={t('Attach a file')}>
      {upload.isPending ? <Loader2 size={size} className="animate-spin" /> : <Paperclip size={size} />}
    </button>
    <input ref={input} type="file" multiple hidden
      onChange={(e) => {
        const picked = Array.from(e.target.files ?? []);
        e.target.value = '';
        for (const f of picked) upload.mutate(f, { onError: (err) => void appDialog.alert(err instanceof Error ? err.message : String(err)) });
      }} />
  </>;
}
