'use client';

import type { ElementWithDetails } from '@/types/database';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/ui/dialog';
import { ElementCheckIn } from './ElementCheckIn';

export function CheckInDialog({ element, onClose, onSaved }: {
  element: ElementWithDetails;
  onClose: () => void;
  onSaved: () => void;
}) {
  return <Dialog open>
    <DialogContent showCloseButton={false} className="max-h-[90dvh] overflow-y-auto"
      onPointerDownOutside={event => event.preventDefault()} onEscapeKeyDown={event => event.preventDefault()}>
      <DialogTitle>Share an update</DialogTitle>
      <DialogDescription className="break-words">{element.title}</DialogDescription>
      <ElementCheckIn element={element} onCancel={onClose} onSaved={onSaved} />
    </DialogContent>
  </Dialog>;
}
