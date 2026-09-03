'use client';

import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import {
  createElement,
  deleteElement,
  updateElement,
  addElementToObject,
  removeElementFromObject,
  type ElementWithDetails,
} from '@/hooks/useSupabase';
import { EntityActionsMenu, type ActionTarget } from '@/alcon/shared/EntityActionsMenu';

/**
 * "⋯" menu for an Element, wired to the breadcrumb in ElementDetailView.
 * Duplicate / Move to Object / Multi-home to Object / Delete. Targets are the
 * sibling Objects in the Element's primary Domain, fetched here so the menu is
 * self-contained across every mount (Object detail, Elements list, My Elements).
 */
const NO_TARGETS: ActionTarget[] = [];
const NO_IDS: string[] = [];

async function fetchElementActionTargets(
  elementId: string,
  primaryId: string | null,
): Promise<{ targets: ActionTarget[]; memberIds: string[] }> {
  // Primary Object → its Domain → sibling Objects in that Domain. The
  // membership lookup is independent of that chain, so it runs alongside.
  const [domainId, { data: mem }] = await Promise.all([
    (async () => {
      if (!primaryId) return null;
      const { data: primaryObj } = await supabase
        .from('objects')
        .select('domain_id')
        .eq('id', primaryId)
        .single();
      return (primaryObj?.domain_id as string | null) ?? null;
    })(),
    supabase.from('element_objects').select('object_id').eq('element_id', elementId),
  ]);
  const objQuery = supabase.from('objects').select('id, name, domain_id').order('order_index');
  const { data: objs } = domainId ? await objQuery.eq('domain_id', domainId) : await objQuery;
  const ids = (mem ?? []).map((m) => m.object_id as string);
  return {
    targets: (objs ?? []).map((o) => ({ id: o.id as string, name: o.name as string })),
    // Fall back to the primary FK if the junction has no rows yet.
    memberIds: ids.length > 0 ? ids : primaryId ? [primaryId] : [],
  };
}

export function ElementActionsMenu({
  element,
  onRefresh,
  onDeleted,
}: {
  element: ElementWithDetails;
  onRefresh?: () => void | Promise<void>;
  /** Navigate away after the Element is deleted (usually onBack). */
  onDeleted?: () => void;
}) {
  // Move / multi-home targets and current memberships, cached per Element so
  // reopening a detail (or the menu re-mounting) doesn't refetch them.
  const qc = useQueryClient();
  const targetsKey = useMemo(
    () => ['element', element.id, 'action-targets', element.object_id ?? ''] as const,
    [element.id, element.object_id],
  );
  const { data: targetData } = useQuery({
    queryKey: targetsKey,
    queryFn: () => fetchElementActionTargets(element.id, element.object_id ?? null),
  });
  const targets = targetData?.targets ?? NO_TARGETS;
  const memberIds = targetData?.memberIds ?? NO_IDS;
  const reload = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: targetsKey });
  }, [qc, targetsKey]);

  const duplicate = async () => {
    if (!element.object_id) return;
    try {
      await createElement({
        title: `${element.title} (copy)`,
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
    if (!window.confirm(`Delete "${element.title}"? This can't be undone.`)) return;
    try {
      await deleteElement(element.id);
      onDeleted?.();
      await onRefresh?.();
    } catch (e) { console.error('Delete Element failed', e); }
  };

  return (
    <EntityActionsMenu
      ariaLabel="Element actions"
      targets={targets}
      primaryId={element.object_id ?? null}
      memberIds={memberIds}
      moveLabel="Move to Object"
      multiHomeLabel="Multi-home to Object"
      targetEmptyLabel="No other Objects in this Domain"
      onDuplicate={duplicate}
      onMove={move}
      onToggleMultiHome={toggleMultiHome}
      onDelete={del}
    />
  );
}
