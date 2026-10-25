'use client';

import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/ui/dialog';
import { Button } from '@/ui/button';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { fetchElementDeletions, restoreElement, type ElementDeletion } from '@/ActivitySpace/execution/element/data';

/**
 * Elements deleted from this Object. Deleting keeps the Element and its
 * history (element_deletions); restoring brings back the same Element — same
 * id, same display id — with its people, comments and history.
 */
export function DeletedElementsDialog({ objectId, objectName, mine, onClose, onRestored }: {
  /** Deleted from this Object… */
  objectId?: string;
  objectName?: string;
  /** …or everything this user deleted or owned, Objects since deleted included. */
  mine?: string;
  onClose: () => void;
  onRestored: () => void;
}) {
  const { t, locale } = useI18n();
  const [rows, setRows] = useState<ElementDeletion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetchElementDeletions(objectId ? { objectId } : { mine: mine ?? '' })
      .then((found) => { if (live) setRows(found); })
      .catch((e) => { if (live) setError(e instanceof Error ? e.message : t('Could not read deleted Elements.')); });
    return () => { live = false; };
  }, [objectId, mine, t]);

  const restore = async (row: ElementDeletion) => {
    setBusy(row.id); setError(null);
    try {
      await restoreElement(row.id);
      setRows((current) => (current ?? []).filter((item) => item.id !== row.id));
      onRestored();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('Could not restore it.'));
    } finally { setBusy(null); }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{objectName ? t('Deleted from {name}', { name: objectName }) : t('Deleted Elements')}</DialogTitle>
        </DialogHeader>
        <p className="text-[12px] text-muted-foreground">{t('Deleted Elements are kept with their history. Restoring brings the same Element back, with its people, comments and history. One whose Object no longer exists comes back as your own Element.')}</p>
        {rows === null && !error && <p className="py-4 text-[13px] text-muted-foreground">{t('Reading…')}</p>}
        {rows !== null && rows.length === 0 && <p className="py-4 text-[13px] text-muted-foreground">{t('Nothing has been deleted here.')}</p>}
        {rows !== null && rows.length > 0 && (
          <ul className="max-h-80 overflow-y-auto">
            {rows.map((row) => (
              <li key={row.id} className="flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-muted/40">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px]">
                    {row.display_id && <span className="mr-1.5 text-[11px] tabular-nums text-muted-foreground">{row.display_id}</span>}
                    {row.title}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {new Date(row.deleted_at).toLocaleString(locale)}{row.deleted_by_name ? ` · ${row.deleted_by_name}` : ''}
                  </p>
                </div>
                <Button size="xs" variant="secondary" disabled={busy !== null} onClick={() => void restore(row)}>
                  {busy === row.id ? t('Restoring…') : t('Restore')}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {error && <p role="alert" className="text-[12px] text-[var(--status-danger)]">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
