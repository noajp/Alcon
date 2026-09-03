'use client';

import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createObject,
  deleteObject,
  setObjectDomains,
  fetchObjectDomainIds,
  useDomains,
  type AlconObjectWithChildren,
} from '@/hooks/useSupabase';
import { EntityActionsMenu, type ActionTarget } from '@/alcon/shared/EntityActionsMenu';

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
  /** Navigate away after the Object is deleted (close detail → Domain view). */
  onDeleted?: () => void;
}) {
  const { data: domains } = useDomains();
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
      await createObject({
        name: `${object.name} (copy)`,
        description: object.description ?? null,
        color: object.color ?? null,
        domain_id: object.domain_id ?? null,
        domain_ids: memberIds.length > 0 ? memberIds : undefined,
      });
      await onRefresh?.();
    } catch (e) { console.error('Duplicate Object failed', e); }
  };

  const move = async (domainId: string) => {
    try {
      // domainId becomes the new primary; keep any other memberships.
      await setObjectDomains(object.id, [domainId, ...memberIds.filter((id) => id !== domainId)]);
      await onRefresh?.();
      await reload();
    } catch (e) { console.error('Move Object failed', e); }
  };

  const toggleMultiHome = async (domainId: string, isMember: boolean) => {
    try {
      const next = isMember
        ? memberIds.filter((id) => id !== domainId)
        : [...memberIds, domainId];
      await setObjectDomains(object.id, ordered(next, primaryId));
      await onRefresh?.();
      await reload();
    } catch (e) { console.error('Multi-home Object failed', e); }
  };

  const del = async () => {
    if (!window.confirm(
      `Delete "${object.name}"? Its Elements that live only here are deleted too. This can't be undone.`,
    )) return;
    try {
      await deleteObject(object.id);
      onDeleted?.();
      await onRefresh?.();
    } catch (e) { console.error('Delete Object failed', e); }
  };

  return (
    <EntityActionsMenu
      ariaLabel="Object actions"
      targets={targets}
      primaryId={primaryId}
      memberIds={memberIds}
      moveLabel="Move to Domain"
      multiHomeLabel="Multi-home to Domain"
      targetEmptyLabel="No Domains"
      onDuplicate={duplicate}
      onMove={move}
      onToggleMultiHome={toggleMultiHome}
      onDelete={del}
    />
  );
}
