'use client';

import { useMemo } from 'react';
import type { ElementWithDetails } from '@/hooks/useSupabase';
import { useElementBlockers } from '@/hooks/useSupabase';
import type { ListSection } from '@/Function/shared/listTable/shared';
import { buildSections, type ListControlsState } from '@/Function/shared/listControls';
import { useAuthContext } from '@/providers/AuthProvider';
import { sectionElements } from './sectionElements';

// The same Filter / Display pipeline the List runs (ElementsList), for the
// views beside it — Board, Calendar, Gantt. Same inputs (signed-in user for
// the owner filter, dependency blockers for the Ready filter) so a filter set
// on the List narrows every tab identically. Without controls nothing is
// filtered and the input passes through.
export function useFilteredElements(
  elements: ElementWithDetails[],
  objectSections: ListSection[] | undefined,
  controls: ListControlsState | undefined,
): { sections: ListSection[] | undefined; elements: ElementWithDetails[] } {
  const { user } = useAuthContext();
  const elementIds = useMemo(() => (controls ? elements.map((e) => e.id) : []), [elements, controls]);
  const blockers = useElementBlockers(elementIds);
  const blockedElementIds = useMemo(() => new Set(Object.keys(blockers)), [blockers]);
  return useMemo(() => {
    if (!controls) return { sections: objectSections, elements };
    const sections = buildSections(elements, objectSections, controls, user?.id ?? null, blockedElementIds);
    return { sections, elements: sectionElements(sections) };
  }, [elements, objectSections, controls, user?.id, blockedElementIds]);
}
