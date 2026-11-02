'use client';

import { useI18n } from '@/Function/i18n/I18nProvider';
import { AttachmentList } from '@/Function/shared/attachments/AttachmentList';
import { AttachButton } from '@/Function/shared/attachments/AttachButton';
import type { AttachmentOwner } from '@/hooks/attachmentData';
import { FileImportActions, canImport } from '@/ActivitySpace/execution/element/FileImportActions';
import { RecordSection } from './CrmRecordPage';

/** A deal's or a company's files — the proposal sent, the contract, the
 *  quote — seen by whoever can see the record. */
export function CrmFiles({ owner }: { owner: AttachmentOwner }) {
  const { t } = useI18n();
  return <RecordSection title={t('Artifacts')} action={<AttachButton owner={owner} size={13}
    className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50" />}>
    <div className="max-w-2xl">
      <AttachmentList owner={owner} actions={(f) => (canImport(f.name) ? <FileImportActions file={f} /> : undefined)}
        empty={<p className="px-1.5 text-xs text-muted-foreground">{t('Proposals, quotes and contracts sent or received, kept with the record.')}</p>} />
    </div>
  </RecordSection>;
}
