'use client';

import { NavNoteIcon } from '@/shell/sidebar/NavIcons';
import { QuickCreatePopup } from '@/Function/shared/QuickCreatePopup';

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
  return (
    <QuickCreatePopup
      open={open}
      icon={<NavNoteIcon size={12} />}
      contextLabel="New Notebook"
      ariaLabel="Quick add Notebook"
      namePlaceholder="Notebook name…"
      description={false}
      hint="Starts with one Section and an empty page"
      onClose={onClose}
      onSubmit={({ name }) => onSubmit(name)}
    />
  );
}
