'use client';

import { useI18n } from '@/Function/i18n/I18nProvider';
import { AttachmentList } from '@/Function/shared/attachments/AttachmentList';
import { AttachButton } from '@/Function/shared/attachments/AttachButton';
import { attachmentOwnerOf, useAttachments } from '@/hooks/attachmentData';
import { FileImportActions, canImport } from '@/ActivitySpace/execution/element/FileImportActions';
import { WidgetHeaderAction, useWidgetMeta } from '../WidgetFrame';
import type { WidgetProps } from '../types';

/**
 * The files attached to what the board is about — an Object's or an
 * Initiative's own evidence: the proposal, the analysis, the minutes. Each
 * previews in place (Word and Excel editable, saved as versions) and can
 * become a Note, a Table or a deck. Everyone who sees the board sees the
 * same files; the paperclip in the header attaches more.
 */
export function AttachmentsWidget({ host }: WidgetProps) {
  const { t } = useI18n();
  const owner = attachmentOwnerOf(host.subject);
  const { data } = useAttachments(owner);
  useWidgetMeta(data.length ? String(data.length) : null);
  if (!owner) return null;
  return <>
    {!host.readOnly && (
      <WidgetHeaderAction>
        <AttachButton owner={owner} size={13}
          className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50" />
      </WidgetHeaderAction>
    )}
    <AttachmentList owner={owner} actions={(f) => (canImport(f.name) ? <FileImportActions file={f} /> : undefined)}
      empty={<p className="py-1 text-sm text-muted-foreground">{t('Nothing attached yet. Attach a proposal, an analysis or minutes with the paperclip.')}</p>} />
  </>;
}
