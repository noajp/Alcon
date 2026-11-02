'use client';

import { useState } from 'react';
import { ChevronDown, Plus } from '@/ui/icons';
import { Button } from '@/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/ui/dialog';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuItem } from '@/ui/dropdown-menu';
import { MenuShell, MENU_ROW } from '@/Function/shared/menu';
import { useExplorerData } from '@/Function/shared/ExplorerDataContext';
import { useOperationsAction } from '@/hooks/useOperationsAction';
import { useI18n } from '@/Function/i18n/I18nProvider';

export function OperationsAction({ tableId, rowId, title, detail, label, createdId, onCreated }: {
  tableId: string;
  rowId: string;
  title: string;
  detail: string;
  label?: string;
  createdId?: string;
  onCreated: (id: string) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} disabled={!!createdId}>
        {!createdId && <Plus size={14} />}{createdId ? t('Created {id}', { id: createdId }) : label ?? t('Create Element')}
      </Button>
      {open && <ActionDialog tableId={tableId} rowId={rowId} title={title} detail={detail}
        onClose={() => setOpen(false)} onCreated={id => { onCreated(id); setOpen(false); }} />}
    </>
  );
}

function ActionDialog({ tableId, rowId, title: initialTitle, detail: initialDetail, onClose, onCreated }: {
  tableId: string; rowId: string; title: string; detail: string;
  onClose: () => void; onCreated: (id: string) => void;
}) {
  const { t } = useI18n();
  const { objects } = useExplorerData();
  const [title, setTitle] = useState(initialTitle);
  const [detail, setDetail] = useState(initialDetail);
  const [objectId, setObjectId] = useState<string | null>(null);
  const { create, saving, error } = useOperationsAction();
  const targetValid = !objectId || objects.some(object => object.id === objectId);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!targetValid) return;
    try {
      const element = await create({ tableId, rowId, title, detail, objectId });
      if (element) onCreated(element.display_id ?? element.id);
    } catch { /* The hook exposes the error and keeps this draft open. */ }
  }
  return (
    <Dialog open onOpenChange={next => { if (!next && !saving) onClose(); }}>
      <DialogContent showCloseButton={!saving}>
        <DialogTitle>{t('Create Element')}</DialogTitle>
        <DialogDescription>{t('Choose where to act. The source record and this analysis will be attached to the description.')}</DialogDescription>
        <form onSubmit={submit} className="space-y-4">
          <label className="block space-y-2 text-sm">
            <span>{t('Title')}</span>
            <input autoFocus required value={title} disabled={saving} onChange={event => setTitle(event.target.value)}
              className="h-8 w-full rounded-sm bg-transparent px-2 hover:bg-muted/40 focus:bg-muted/60" />
          </label>
          <label className="block space-y-2 text-sm">
            <span>{t('Reason and next step')}</span>
            <textarea value={detail} rows={5} disabled={saving} onChange={event => setDetail(event.target.value)}
              className="w-full resize-y rounded-sm bg-transparent p-2 hover:bg-muted/40 focus:bg-muted/60" />
          </label>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="sm" align="start" disabled={saving}>
                {t('Save to: {name}', { name: objectId ? objects.find(object => object.id === objectId)?.name ?? t('Choose Object') : t('My Elements') })}<ChevronDown size={14} />
              </Button>
            </DropdownMenuTrigger>
            <MenuShell as="dropdown" width="standard" align="start">
              <DropdownMenuItem className={MENU_ROW} onSelect={() => setObjectId(null)}>{t('My Elements')}</DropdownMenuItem>
              {objects.map(object => <DropdownMenuItem key={object.id} className={MENU_ROW} onSelect={() => setObjectId(object.id)}>{object.name}</DropdownMenuItem>)}
            </MenuShell>
          </DropdownMenu>
          {error && <p role="alert" className="text-sm text-destructive">{t(error)}</p>}
          {!targetValid && <p role="alert" className="text-sm text-destructive">{t('Choose an available Object.')}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>{t('Cancel')}</Button>
            <Button type="submit" variant="primary" disabled={saving || !title.trim() || !targetValid}>{saving ? t('Creating…') : t('Create Element')}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
