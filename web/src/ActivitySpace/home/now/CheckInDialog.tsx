'use client';

import type { ElementWithDetails } from '@/types/database';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/ui/dialog';
import { ElementCheckIn } from './ElementCheckIn';
import { useI18n } from '@/Function/i18n/I18nProvider';

export function CheckInDialog({ element, onClose, onSaved }: {
  element: ElementWithDetails;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  return <Dialog open>
    <DialogContent showCloseButton={false} className="max-h-[90dvh] overflow-y-auto"
      onPointerDownOutside={event => event.preventDefault()} onEscapeKeyDown={event => event.preventDefault()}>
      <DialogTitle>{t('Share an update')}</DialogTitle>
      <DialogDescription className="break-words">{element.title}</DialogDescription>
      <ElementCheckIn element={element} onCancel={onClose} onSaved={onSaved} />
    </DialogContent>
  </Dialog>;
}
