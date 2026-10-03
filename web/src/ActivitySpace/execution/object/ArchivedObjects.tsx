'use client';

import { useCallback, useState } from 'react';
import { Archive, ChevronRight } from 'lucide-react';
import { Button } from '@/ui/button';
import { appDialog } from '@/Function/shared/appDialogStore';
import { canManageObject } from '@/Function/shared/objectArchive';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { useCurrentUserId } from '@/providers/authContext';
import { restoreObject, useArchivedObjects } from '@/hooks/useObjectArchive';
import { useMyDomainRoles, useMyObjectRoles } from './useMyMemberships';

/** Whether the viewer manages a given Object (may archive / restore it). */
export function useManagesObject(): (object: { id: string; domain_id: string | null }) => boolean {
  const userId = useCurrentUserId();
  const { data: domainRoles } = useMyDomainRoles(userId);
  const { data: objectRoles } = useMyObjectRoles(userId);
  return useCallback(
    (object) => Boolean(userId) && canManageObject(domainRoles, objectRoles, object),
    [userId, domainRoles, objectRoles],
  );
}

function useRestore() {
  const { t } = useI18n();
  const [busyId, setBusyId] = useState<string | null>(null);
  const restore = async (objectId: string, onDone?: () => void) => {
    if (busyId) return;
    setBusyId(objectId);
    try {
      await restoreObject(objectId);
      onDone?.();
    } catch (e) {
      await appDialog.alert(e instanceof Error && e.message ? e.message : t('The Object could not be restored. Try again.'));
    } finally {
      setBusyId(null);
    }
  };
  return { busyId, restore };
}

/** Shown above an archived Object opened by id (link, search, the Archived list). */
export function ArchivedObjectBanner({
  object,
}: {
  object: { id: string; domain_id: string | null; archived_at?: string | null };
}) {
  const { t, locale } = useI18n();
  const managesObject = useManagesObject();
  const { busyId, restore } = useRestore();
  const when = object.archived_at ? new Date(object.archived_at).toLocaleDateString(locale) : null;
  return (
    <div className="flex items-center gap-3 border-b border-border/60 bg-muted/30 px-4 py-2 text-[12px] text-muted-foreground">
      <Archive size={13} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate">
        {when
          ? t('This Object was archived on {date}. It is hidden from lists and pickers.', { date: when })
          : t('This Object is archived. It is hidden from lists and pickers.')}
      </span>
      {managesObject(object) && (
        <Button
          variant="secondary"
          size="xs"
          disabled={busyId === object.id}
          onClick={() => { void restore(object.id); }}
        >
          {t('Restore')}
        </Button>
      )}
    </div>
  );
}

/**
 * The Domain's archived Objects, folded under the Objects list. Opening one
 * shows it read-only-by-intent with the banner above; managers restore here
 * or from that banner.
 */
export function ArchivedObjectsSection({
  domainId,
  onOpen,
}: {
  domainId: string | null;
  onOpen: (objectId: string) => void;
}) {
  const { t, locale } = useI18n();
  const { objects } = useArchivedObjects(domainId);
  const managesObject = useManagesObject();
  const { busyId, restore } = useRestore();
  const [open, setOpen] = useState(false);
  if (objects.length === 0) return null;
  return (
    <div className="border-t border-border/60 px-3 py-2">
      <Button
        variant="ghost"
        size="xs"
        align="start"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="text-muted-foreground"
      >
        <ChevronRight size={12} className={open ? 'rotate-90 transition-transform' : 'transition-transform'} />
        {t('Archived ({count})', { count: objects.length })}
      </Button>
      {open && (
        <ul className="mt-1">
          {objects.map((object) => (
            <li key={object.id} className="group flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted/40">
              <button
                type="button"
                onClick={() => onOpen(object.id)}
                className="min-w-0 flex-1 truncate text-left text-[13px] text-muted-foreground hover:text-foreground"
              >
                {object.name}
              </button>
              {object.archived_at && (
                <span className="shrink-0 text-[12px] text-muted-foreground/70">
                  {new Date(object.archived_at).toLocaleDateString(locale)}
                </span>
              )}
              {managesObject(object) && (
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={busyId === object.id}
                  onClick={() => { void restore(object.id); }}
                >
                  {t('Restore')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
