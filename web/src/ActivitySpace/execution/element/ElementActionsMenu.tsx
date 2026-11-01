'use client';

import { appDialog } from '@/Function/shared/appDialogStore';

import { useCallback, useMemo } from 'react';
import { ShieldCheck, Waypoints } from '@/ui/icons';
import { DropdownMenuItem } from '@/ui/dropdown-menu';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createElement,
  deleteElement,
  updateElement,
  addElementToObject,
  removeElementFromObject,
  type ElementWithDetails,
  invalidateElementDetail,
} from '@/hooks/useSupabase';
import { EntityActionsMenu, type ActionTarget } from '@/Function/shared/EntityActionsMenu';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { fetchElementMoveTargets, fetchElementObjectIds } from '@/hooks/elementData';

/**
 * "⋯" menu for an Element, wired to the breadcrumb in ElementDetailView.
 * Duplicate / Move to Object / Multi-home to Object, then what the page can
 * add to the Element — a dependency, approval — then Delete.
 * Targets are the
 * sibling Objects in the Element's primary Domain, fetched here so the menu is
 * self-contained across every mount (Object detail, Elements list, My Elements).
 */
const NO_TARGETS: ActionTarget[] = [];
const NO_IDS: string[] = [];


export function ElementActionsMenu({
  element,
  onRefresh,
  onDeleted,
  onAddDependency,
  onOpenApproval,
}: {
  element: ElementWithDetails;
  onRefresh?: () => void | Promise<void>;
  /** Navigate away after the Element is deleted (usually onBack). */
  onDeleted?: () => void;
  /** Opens the page's dependency picker. */
  onAddDependency?: () => void;
  /** Opens the page's approval panel. */
  onOpenApproval?: () => void;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const primaryId = element.object_id ?? null;
  const { data: fetchedTargets } = useQuery({
    queryKey: ['action-targets', primaryId ?? 'all'],
    queryFn: () => fetchElementMoveTargets(primaryId),
    gcTime: 5 * 60_000,
  });
  const membersKey = useMemo(
    () => ['element', element.id, 'homes', primaryId ?? ''] as const,
    [element.id, primaryId],
  );
  const { data: fetchedMemberIds } = useQuery({
    queryKey: membersKey,
    queryFn: () => fetchElementObjectIds(element.id, primaryId),
  });
  const targets = fetchedTargets ?? NO_TARGETS;
  const memberIds = fetchedMemberIds ?? NO_IDS;
  // After a move / multi-home every facet of this Element is stale (member
  // Objects island, Properties union), not just the menu's own membership.
  const reload = useCallback(async () => {
    invalidateElementDetail(element.id);
    await qc.invalidateQueries({ queryKey: membersKey });
  }, [qc, membersKey, element.id]);

  const duplicate = async () => {
    if (!element.object_id) return;
    try {
      await createElement({
        title: t('{title} (copy)', { title: element.title }),
        object_id: element.object_id,
        description: element.description ?? null,
        status: element.status ?? undefined,
        priority: element.priority ?? undefined,
        start_date: element.start_date ?? null,
        due_date: element.due_date ?? null,
        estimated_hours: element.estimated_hours ?? null,
      });
      await onRefresh?.();
    } catch (e) { console.error('Duplicate Element failed', e); }
  };

  const move = async (objectId: string) => {
    try {
      await updateElement(element.id, { object_id: objectId });
      await onRefresh?.();
      await reload();
    } catch (e) { console.error('Move Element failed', e); }
  };

  const toggleMultiHome = async (objectId: string, isMember: boolean) => {
    try {
      if (isMember) await removeElementFromObject(element.id, objectId);
      else await addElementToObject(element.id, objectId);
      await onRefresh?.();
      await reload();
    } catch (e) { console.error('Multi-home Element failed', e); }
  };

  const del = async () => {
    if (!await appDialog.confirm(t('Delete “{name}”? This can’t be undone.', { name: element.title }))) return;
    try {
      await deleteElement(element.id);
      onDeleted?.();
      await onRefresh?.();
    } catch (e) { console.error('Delete Element failed', e); }
  };

  return (
    <EntityActionsMenu
      ariaLabel={t('Element actions')}
      targets={targets}
      primaryId={element.object_id ?? null}
      memberIds={memberIds}
      moveLabel={t('Move to Object')}
      multiHomeLabel={t('Multi-home to Object')}
      targetEmptyLabel={t('No other Objects in this Domain')}
      onDuplicate={duplicate}
      onMove={move}
      onToggleMultiHome={toggleMultiHome}
      onDelete={del}
    >
      {onAddDependency && (
        <DropdownMenuItem onSelect={() => setTimeout(onAddDependency, 0)} className="gap-2.5 py-1.5 text-[13px]">
          <Waypoints size={15} className="text-muted-foreground" /> {t('Add dependency')}
        </DropdownMenuItem>
      )}
      {onOpenApproval && (
        <DropdownMenuItem onSelect={() => setTimeout(onOpenApproval, 0)} className="gap-2.5 py-1.5 text-[13px]">
          <ShieldCheck size={15} className="text-muted-foreground" /> {t('Approval')}
        </DropdownMenuItem>
      )}
    </EntityActionsMenu>
  );
}
