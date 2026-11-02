'use client';

import { useMemo } from 'react';
import type { ElementWithDetails, Worker, CustomColumnWithValues } from '@/hooks/useSupabase';
import { updateElement, useElementBlockers } from '@/hooks/useSupabase';
import { ListTable } from '@/Function/shared/listTable/ListTable';
import type { ListSection } from '@/Function/shared/listTable/shared';
import type { ColumnId, DataColumn } from '@/Function/shared/listTable/useListColumns';
import type { ElementUpdate, Json } from '@/types/database';
import {
  applyClosedWindow,
  buildSections,
  type ListControlsState,
} from '@/Function/shared/listControls';
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

  // ---- ListTable passthroughs ----
  /** localStorage key for the visible-column set. Distinct keys let
   *  Domain root vs per-Object views remember their own choice. */
  colStorageKey: string;
  elementTypes?: string[];
  /** Extra non-builtin columns appended after the builtins (e.g. My
   *  Elements' cross-Object "Objects" column). */
  extraColumns?: DataColumn[];
  /** Override the default visible-column set for this surface. */
  defaultVisibleColumns?: ColumnId[];
  /** Add a new Element type to the Domain (from the Type cell "+"). */
  onAddType?: (name: string) => void | Promise<void>;
  /** Remove an Element type from the Domain (Type cell edit mode "×"). */
  onRemoveType?: (name: string) => void | Promise<void>;
  /** Header "+" handler for a section. When omitted, no "+" appears. */
  onAddElement?: (section?: ListSection) => void;
  /** Optional rich-list features used by the Object detail surface.
   *  When the host doesn't need them (e.g. the Domain-wide Elements
   *  view), they stay undefined. */
  customColumns?: CustomColumnWithValues[];
  onCustomColumnValueChange?: (columnId: string, elementId: string, value: Json) => void | Promise<void>;
  onEditColumn?: (column: CustomColumnWithValues) => void;
  onAddColumn?: (anchor?: DOMRect) => void;
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
  extraColumns,
  defaultVisibleColumns,
  onAddType,
  onRemoveType,
  onAddElement,
  customColumns,
  onCustomColumnValueChange,
  onAddColumn,
  onEditColumn,
  selectedElementIds,
  onElementRowSelect,
  onElementUpdateOverride,
}: ElementsListProps) {
  const { user } = useAuthContext();

  // Dependency blockers for everything in scope — fetched BEFORE filtering,
  // since the Ready filter is one of the things that reads them. Fetched once
  // here and handed to the table, so the row marker and the filter can never
  // disagree about which Elements are waiting.
  const elementIds = useMemo(() => elements.map((e) => e.id), [elements]);
  const blockers = useElementBlockers(elementIds);
  const blockedElementIds = useMemo(
    () => new Set(Object.keys(blockers)),
    [blockers],
  );

  // Filter / group pipeline. Three shapes:
  //   - 'object'  → keep the caller's per-Object partition (section per
  //                 Object), filtered + ordered within each band.
  //   - 'none'    → one flat anonymous section (Object headers ignored).
  //   - anything  → flatten then re-bucket by the chosen field.
  // Filter / group / order — shared with the Gantt via buildSections so both
  // surfaces bucket identically.
  // Closed Elements are trimmed to the Display's window first, so every
  // grouping sees the same rows.
  const sections = useMemo<ListSection[]>(() => {
    const closed = controls.display.closed;
    const now = new Date();
    const inWindow = applyClosedWindow(elements, closed, now);
    const sectionsInWindow = objectSections?.map((sec) => ({ ...sec, elements: applyClosedWindow(sec.elements ?? [], closed, now) }));
    return buildSections(inWindow, sectionsInWindow, controls, user?.id ?? null, blockedElementIds);
  }, [elements, objectSections, controls, user?.id, blockedElementIds]);

  // Hide the band whenever there's a single anonymous section (no group name)
  // — e.g. default 'object' grouping with no Object partition, or 'none'. A
  // nameless band is just a bare count, which reads as stray chrome.
  const hideSectionHeaders = sections.length <= 1 && !sections[0]?.name;

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
    <ListTable
      sections={sections}
      onSelectObject={(id) => onSelectObject?.(id)}
      onSelectElement={(id) => onSelectElement?.(id)}
      onElementUpdate={handleElementUpdate}
      onRefresh={onRefresh}
      blockers={blockers}
      colStorageKey={colStorageKey}
      elementTypes={elementTypes}
      extraColumns={extraColumns}
      defaultVisibleColumns={defaultVisibleColumns}
      onAddType={onAddType}
      onRemoveType={onRemoveType}
      hideSectionHeaders={hideSectionHeaders}
      onAddElement={onAddElement}
      customColumns={customColumns}
      onCustomColumnValueChange={onCustomColumnValueChange}
      onAddColumn={onAddColumn}
          onEditColumn={onEditColumn}
      selectedElementIds={selectedElementIds}
      onElementRowSelect={onElementRowSelect}
    />
  );
}

// Re-export Worker so hosts that compute their own filter inputs can
// pull the type from a single barrel.
export type { Worker };
