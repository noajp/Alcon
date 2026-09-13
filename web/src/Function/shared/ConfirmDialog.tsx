'use client';

import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/ui/dialog';
import { Button } from '@/ui/button';

// One in-app confirmation for destructive actions. `window.confirm` is not
// usable here: an embedded browser (the desktop app's Browser pane) answers
// it with `false` instantly and shows nothing, so the action silently never
// runs. The shape follows the Object delete dialog in ObjectDetailView.
export function ConfirmDialog({ open, title, description, confirmLabel = 'Delete', busy = false, onConfirm, onCancel }: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) onCancel(); }}>
      <DialogContent className="sm:max-w-[360px] p-6" showCloseButton={false}>
        <div className="text-center">
          <DialogTitle className="text-[15px] font-semibold mb-1">{title}</DialogTitle>
          <DialogDescription className="text-[13px] text-muted-foreground mb-5">{description}</DialogDescription>
          <div className="flex flex-col gap-2">
            <Button variant="danger" size="md" onClick={onConfirm} disabled={busy} className="w-full">
              {busy ? `${confirmLabel}…` : confirmLabel}
            </Button>
            <Button variant="secondary" size="md" onClick={onCancel} disabled={busy} className="w-full">Cancel</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
