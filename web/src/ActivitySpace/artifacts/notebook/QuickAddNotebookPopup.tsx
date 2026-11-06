'use client';

import { NavNoteIcon } from '@/Frame/sidebar/NavIcons';
import { QuickCreatePopup } from '@/Function/shared/QuickCreatePopup';
import { useI18n } from '@/Function/i18n/I18nProvider';

/**
 * The sidebar's "+" in Notebook mode: the same quick-create card Objects and
 * Elements use, asking for the notebook's name. The notebook is seeded with
 * a first Section and page so it opens straight into the editor.
 */
export function QuickAddNotebookPopup({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (name: string) => void | Promise<void>;
}) {
  const { t } = useI18n();
  return (
    <QuickCreatePopup
      open={open}
      icon={<NavNoteIcon size={12} />}
      contextLabel={t('New Notebook')}
      ariaLabel={t('Quick add Notebook')}
      namePlaceholder={t('Notebook name…')}
      description={false}
      hint={t('Starts with one Section and an empty page')}
      onClose={onClose}
      onSubmit={({ name }) => onSubmit(name)}
    />
  );
}
