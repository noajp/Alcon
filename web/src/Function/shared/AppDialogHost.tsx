'use client';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/ui/dialog';
import { Button } from '@/ui/button';
import { answerAppDialog, cancelAppDialogs, getAppDialog, subscribeAppDialog, type AppDialogRequest } from './appDialogStore';
const empty = () => null;
export function AppDialogHost() {
  const request = useSyncExternalStore(subscribeAppDialog, getAppDialog, empty);
  useEffect(() => () => cancelAppDialogs(), []);
  return request ? <AppDialog key={request.id} request={request} /> : null;
}
function AppDialog({ request }: { request: AppDialogRequest }) {
  const input = useRef<HTMLInputElement>(null);
  const cancel = () => answerAppDialog(request.id, request.kind === 'confirm' ? false : null);
  const accept = () => answerAppDialog(request.id, request.kind === 'prompt' ? input.current?.value ?? '' : true);
  return <Dialog open onOpenChange={open => { if (!open) cancel(); }}>
    <DialogContent className="sm:max-w-[400px] p-6" showCloseButton={false} onOpenAutoFocus={event => {
      // A destructive confirmation must not be accepted by an accidental Enter.
      if (request.kind === 'confirm') { event.preventDefault(); document.getElementById(`app-dialog-cancel-${request.id}`)?.focus(); }
    }}>
      <DialogTitle className="text-[15px] font-semibold">{request.kind === 'alert' ? 'Notice' : request.kind === 'prompt' ? 'Enter value' : 'Confirm action'}</DialogTitle>
      <DialogDescription className="whitespace-pre-wrap text-[13px] text-muted-foreground">{request.message}</DialogDescription>
      <form className="space-y-4" onSubmit={event => { event.preventDefault(); if (request.kind !== 'confirm') accept(); }}>
        {request.kind === 'prompt' && <input ref={input} aria-label={request.message} defaultValue={request.initialValue} className="w-full rounded-md border-0 bg-muted/40 px-3 py-2 text-sm focus:bg-muted/60" />}
        <div className="flex justify-end gap-2">
          {request.kind !== 'alert' && <Button id={`app-dialog-cancel-${request.id}`} type="button" variant="secondary" onClick={cancel}>Cancel</Button>}
          <Button type="button" variant={request.kind === 'confirm' ? 'danger' : 'primary'} onClick={accept}>{request.kind === 'confirm' ? 'Confirm' : 'OK'}</Button>
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}
