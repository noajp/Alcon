'use client';

import { appDialog } from '@/Function/shared/appDialogStore';

import { useCallback, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, Pencil, Trash2 } from 'lucide-react';
import {
  createObject,
  deleteObject,
  setObjectDomains,
  fetchObjectDomainIds,
  fileObjectUnderDomains,
  useDomains,
  type AlconObjectWithChildren,
} from '@/hooks/useSupabase';
import { EntityActionsMenu, type ActionTarget } from '@/Function/shared/EntityActionsMenu';
import { DropdownMenuItem } from '@/ui/dropdown-menu';
import { RenamePrefixDialog } from './RenamePrefixDialog';
import { DeletedElementsDialog } from './DeletedElementsDialog';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { isArchivedObject } from '@/Function/shared/objectArchive';
import { archiveObject, restoreObject } from '@/hooks/useObjectArchive';
import { useManagesObject } from './ArchivedObjects';

/**
 * "⋯" menu for an Object, wired next to the Object name in the hierarchy
 * header. Duplicate / Move to Domain / Multi-home to Domain / Delete. Targets
 * are every Domain the user belongs to; membership is the object_domains
 * junction (primary kept in sync with objects.domain_id via setObjectDomains).
 */
const NO_IDS: string[] = [];

export function ObjectActionsMenu({
  object,
  onRefresh,
  onDeleted,
}: {
  object: AlconObjectWithChildren;
  onRefresh?: () => void | Promise<void>;
  /** Navigate away after the Object is deleted or archived (close detail → Domain view). */
  onDeleted?: () => void;
}) {
  const { data: domains } = useDomains();
  const { t } = useI18n();
  const managesObject = useManagesObject();
  const archived = isArchivedObject(object);
  const [renameOpen, setRenameOpen] = useState(false);
  const [deletedOpen, setDeletedOpen] = useState(false);
  // Domain membership (primary first), cached per Object.
  const qc = useQueryClient();
  const membershipKey = useMemo(() => ['object', object.id, 'domain-ids'] as const, [object.id]);
  const { data: fetchedIds } = useQuery({
    queryKey: membershipKey,
    queryFn: () => fetchObjectDomainIds(object.id),
  });
  const memberIds = fetchedIds ?? NO_IDS;
  const primaryId = memberIds[0] ?? object.domain_id ?? null;
  const reload = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: membershipKey });
  }, [qc, membershipKey]);

  const targets: ActionTarget[] = domains.map((d) => ({ id: d.id, name: d.name }));

  // Keep the current primary first so setObjectDomains preserves it.
  const ordered = (ids: string[], primary: string | null) => {
    const set = Array.from(new Set(ids.filter(Boolean)));
    return primary && set.includes(primary)
      ? [primary, ...set.filter((id) => id !== primary)]
      : set;
  };

  const duplicate = async () => {
    try {
      // The copy lands in the primary Domain; the other Domains need someone
      // who manages them, so file it there one by one and say what was skipped.
      const primary = object.domain_id ?? memberIds[0] ?? null;
      const created = await createObject({
        name: `${object.name} (copy)`,
        description: object.description ?? null,
        color: object.color ?? null,
        domain_id: primary,
        domain_ids: primary ? [primary] : undefined,
      });
      const refused = await fileObjectUnderDomains(created.id, memberIds.filter((id) => id !== primary));
      await onRefresh?.();
      if (refused.length > 0) {
        const names = refused.map((id) => domains.find((d) => d.id === id)?.name ?? id).join(', ');
        await appDialog.alert(t('The copy was not filed under {names}. Only owners or admins of those Domains can file it there.', { names }));
      }
    } catch (e) {
      console.error('Duplicate Object failed', e);
      if (e instanceof Error && e.message) await appDialog.alert(e.message);
    }
  };

  const move = async (domainId: string) => {
    try {
      // domainId becomes the new primary; keep any other memberships.
      await setObjectDomains(object.id, [domainId, ...memberIds.filter((id) => id !== domainId)]);
      await onRefresh?.();
      await reload();
    } catch (e) {
      // Moving needs an owner/admin of both Domains; say why it was refused.
      console.error('Move Object failed', e);
      if (e instanceof Error && e.message) await appDialog.alert(e.message);
    }
  };

  const toggleMultiHome = async (domainId: string, isMember: boolean) => {
    try {
      const next = isMember
        ? memberIds.filter((id) => id !== domainId)
        : [...memberIds, domainId];
      await setObjectDomains(object.id, ordered(next, primaryId));
      await onRefresh?.();
      await reload();
    } catch (e) {
      console.error('Multi-home Object failed', e);
      if (e instanceof Error && e.message) await appDialog.alert(e.message);
    }
  };

  const del = async () => {
    if (!await appDialog.confirm(
      `Delete "${object.name}"? Its Elements that live only here are deleted too. This can't be undone.`,
    )) return;
    try {
      await deleteObject(object.id);
      onDeleted?.();
      await onRefresh?.();
    } catch (e) { console.error('Delete Object failed', e); }
  };

  // Archiving hides the Object from lists and pickers and keeps its data; the
  // Domain's Archived list (and the banner on the Object) restores it.
  const toggleArchive = async () => {
    try {
      if (archived) {
        await restoreObject(object.id);
      } else {
        if (!await appDialog.confirm(t('Archive "{name}"? It leaves lists and pickers, and its Elements leave My Elements. Its data stays, and it can be restored from the Domain’s Archived list.', { name: object.name }))) return;
        await archiveObject(object.id);
        onDeleted?.();
      }
      await onRefresh?.();
    } catch (e) {
      console.error('Archive Object failed', e);
      if (e instanceof Error && e.message) await appDialog.alert(e.message);
    }
  };

  return (
    <>
      <EntityActionsMenu
        ariaLabel={t('Object actions')}
        targets={targets}
        primaryId={primaryId}
        memberIds={memberIds}
        moveLabel={t('Move to Domain')}
        multiHomeLabel={t('Multi-home to Domain')}
        targetEmptyLabel={t('No Domains')}
        onDuplicate={duplicate}
        onMove={move}
        onToggleMultiHome={toggleMultiHome}
        onDelete={del}
      >
        <DropdownMenuItem onClick={() => setRenameOpen(true)} className="gap-2 text-[13px]">
          <Pencil size={13} className="text-muted-foreground" /> Rename ID prefix
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setDeletedOpen(true)} className="gap-2 text-[13px]">
          <Trash2 size={13} className="text-muted-foreground" /> Deleted Elements
        </DropdownMenuItem>
        {managesObject(object) && (
          <DropdownMenuItem onClick={() => { void toggleArchive(); }} className="gap-2 text-[13px]">
            {archived
              ? <><ArchiveRestore size={13} className="text-muted-foreground" /> {t('Restore')}</>
              : <><Archive size={13} className="text-muted-foreground" /> {t('Archive')}</>}
          </DropdownMenuItem>
        )}
      </EntityActionsMenu>
      {deletedOpen && (
        <DeletedElementsDialog
          objectId={object.id}
          objectName={object.name}
          onClose={() => setDeletedOpen(false)}
          onRestored={() => { void onRefresh?.(); }}
        />
      )}
      {renameOpen && (
        <RenamePrefixDialog
          object={object}
          onClose={() => setRenameOpen(false)}
          onRenamed={() => { void onRefresh?.(); }}
        />
      )}
    </>
  );
}
