'use client';

import { useMemo } from 'react';
import type { ElementWithDetails } from '@/hooks/useSupabase';
import { useElementBlockers } from '@/hooks/useSupabase';
import type { ListSection } from '@/Function/shared/listTable/shared';
import { buildSections, useClosedWindow, type ListControlsState } from '@/Function/shared/listControls';
import { hasActiveFilter } from '@/Function/shared/listControls/types';
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
): { sections: ListSection[] | undefined; elements: ElementWithDetails[]; filtering: boolean } {
  const { user } = useAuthContext();
  const elementIds = useMemo(() => (controls ? elements.map((e) => e.id) : []), [elements, controls]);
  const blockers = useElementBlockers(elementIds);
  const blockedElementIds = useMemo(() => new Set(Object.keys(blockers)), [blockers]);
  const closedTimes = useClosedWindow(controls?.display.closed);
  return useMemo(() => {
    if (!controls) return { sections: objectSections, elements, filtering: false };
    const sections = buildSections(elements, objectSections, controls, user?.id ?? null, blockedElementIds, closedTimes);
    // `filtering` lets a view drop quick-create affordances whose new Element
    // the filter could hide the moment it is made.
    return { sections, elements: sectionElements(sections), filtering: hasActiveFilter(controls.filter) };
  }, [elements, objectSections, controls, user?.id, blockedElementIds, closedTimes]);
}
