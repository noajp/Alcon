'use client';

import { useMemo } from 'react';
import type { ElementWithDetails, Worker, CustomColumnWithValues } from '@/hooks/useSupabase';
import { updateElement } from '@/hooks/useSupabase';
import { ObjectListView, type ListSection } from '@/alcon/object/ObjectListView';
import type { ElementUpdate, Json } from '@/types/database';
import {
  applyFilter,
  effectiveGroupBy,
  groupAndOrder,
  type ListControlsState,
} from '@/alcon/shared/listControls';
import { useAuthContext } from '@/providers/AuthProvider';

// ElementsList — canonical "Element list" surface. Same filter →
// grouping → table pipeline for every host:
//
//   - Object detail's Elements tab passes a single Object's elements.
//   - The sidebar Elements route passes the whole Domain's elements
//     plus a pre-baked per-Object section partition.
//   - "My Elements" could adopt it later for assignee-scoped lists.
//
// The host owns the data fetch, the filter state (so its TabBar can
// render the matching ListControls UI), the add-element popup, and
// the detail-view drill-in (since detail mode usually wants to take
// over the whole pane). This component is purely the table.

export interface ElementsListProps {
  /** All elements in scope. Filter / grouping is applied inside. */
  elements: ElementWithDetails[];
  /** Filter + display state, owned by the host. */
  controls: ListControlsState;
  /** When groupBy='none', preserve this per-Object section partition
   *  (e.g. "__domain__" + per-Object). When omitted, the un-grouped
   *  view is a single anonymous section. */
  objectSections?: ListSection[];

  /** Row click → open the host's detail view. */
  onSelectElement?: (elementId: string) => void;
  /** Click on a section's Object name / icon (when objectSections is
   *  populated) → drill into that Object. */
  onSelectObject?: (objectId: string) => void;
  /** Refresh callback after an inline edit lands. */
  onRefresh?: () => void | Promise<void>;

  // ---- ObjectListView passthroughs ----
  /** localStorage key for the visible-column set. Distinct keys let
   *  Domain root vs per-Object views remember their own choice. */
  colStorageKey: string;
  elementTypes?: string[];
  /** Header "+" handler for a section. When omitted, no "+" appears. */
  onAddElement?: (section?: ListSection) => void;
  /** Optional rich-list features used by the Object detail surface.
   *  When the host doesn't need them (e.g. the Domain-wide Elements
   *  view), they stay undefined. */
  customColumns?: CustomColumnWithValues[];
  onCustomColumnValueChange?: (columnId: string, elementId: string, value: Json) => void | Promise<void>;
  onAddColumn?: () => void;
  selectedElementIds?: Set<string>;
  onElementRowSelect?: (elementId: string, mode: 'single' | 'range' | 'replace', orderedIds?: string[]) => void;
  /** Override the default updateElement call (used when the host wants
   *  to do extra bookkeeping after each edit). */
  onElementUpdateOverride?: (elementId: string, updates: ElementUpdate) => void | Promise<void>;
}

export function ElementsList({
  elements,
  controls,
  objectSections,
  onSelectElement,
  onSelectObject,
  onRefresh,
  colStorageKey,
  elementTypes,
  onAddElement,
  customColumns,
  onCustomColumnValueChange,
  onAddColumn,
  selectedElementIds,
  onElementRowSelect,
  onElementUpdateOverride,
}: ElementsListProps) {
  const { user } = useAuthContext();

  // Filter / group pipeline. The two branches that used to live
  // duplicated in ElementsByObjectView and ObjectDetailView.
  const effGroupBy = effectiveGroupBy(controls.filter, controls.display.groupBy);
  const sections = useMemo<ListSection[]>(() => {
    if (effGroupBy === 'none') {
      if (objectSections && objectSections.length > 0) {
        // Preserve the caller's per-Object partition; filter within
        // each band.
        const out: ListSection[] = [];
        for (const sec of objectSections) {
          const els = applyFilter(sec.elements ?? [], controls.filter, {
            currentUserId: user?.id ?? null,
          });
          if (els.length === 0) continue;
          out.push({ ...sec, elements: els });
        }
        return out;
      }
      // Single anonymous section.
      const filtered = applyFilter(elements, controls.filter, {
        currentUserId: user?.id ?? null,
      });
      if (filtered.length === 0) return [];
      return [{ id: '_all', name: '', objects: [], elements: filtered }];
    }
    // Explicit grouping — flatten then regroup by the user's choice.
    const filtered = applyFilter(elements, controls.filter, {
      currentUserId: user?.id ?? null,
    });
    return groupAndOrder(filtered, { ...controls.display, groupBy: effGroupBy });
  }, [elements, objectSections, controls, effGroupBy, user?.id]);

  const hideSectionHeaders = effGroupBy === 'none' && sections.length <= 1;

  const handleElementUpdate = onElementUpdateOverride ?? (async (
    elementId: string,
    updates: ElementUpdate,
  ) => {
    try {
      await updateElement(elementId, updates);
      await onRefresh?.();
    } catch (e) {
      console.error('Failed to update element', e);
    }
  });

  return (
    <ObjectListView
      sections={sections}
      onSelectObject={(id) => onSelectObject?.(id)}
      onSelectElement={(id) => onSelectElement?.(id)}
      onElementUpdate={handleElementUpdate}
      colStorageKey={colStorageKey}
      elementTypes={elementTypes}
      hideSectionHeaders={hideSectionHeaders}
      onAddElement={onAddElement}
      customColumns={customColumns}
      onCustomColumnValueChange={onCustomColumnValueChange}
      onAddColumn={onAddColumn}
      selectedElementIds={selectedElementIds}
      onElementRowSelect={onElementRowSelect}
    />
  );
}

// Re-export Worker so hosts that compute their own filter inputs can
// pull the type from a single barrel.
export type { Worker };
