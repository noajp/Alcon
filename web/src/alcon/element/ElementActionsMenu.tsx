'use client';

import { useCallback, useEffect, useState } from 'react';
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
  const [targets, setTargets] = useState<ActionTarget[]>([]);
  const [memberIds, setMemberIds] = useState<string[]>([]);

  const reload = useCallback(async () => {
    try {
      // Primary Object → its Domain → sibling Objects in that Domain.
      const primaryId = element.object_id;
      let domainId: string | null = null;
      if (primaryId) {
        const { data: primaryObj } = await supabase
          .from('objects')
          .select('domain_id')
          .eq('id', primaryId)
          .single();
        domainId = (primaryObj?.domain_id as string | null) ?? null;
      }
      const objQuery = supabase.from('objects').select('id, name, domain_id').order('order_index');
      const { data: objs } = domainId
        ? await objQuery.eq('domain_id', domainId)
        : await objQuery;
      setTargets((objs ?? []).map((o) => ({ id: o.id as string, name: o.name as string })));

      // Current memberships (primary + multi-homed) from the junction.
      const { data: mem } = await supabase
        .from('element_objects')
        .select('object_id')
        .eq('element_id', element.id);
      const ids = (mem ?? []).map((m) => m.object_id as string);
      // Fall back to the primary FK if the junction has no rows yet.
      setMemberIds(ids.length > 0 ? ids : primaryId ? [primaryId] : []);
    } catch (e) {
      console.error('Failed to load Element action targets', e);
    }
  }, [element.id, element.object_id]);

  useEffect(() => { void reload(); }, [reload]);

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
