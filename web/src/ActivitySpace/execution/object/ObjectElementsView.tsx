'use client';

import { Plus } from 'lucide-react';
import type { ElementWithDetails, CustomColumnWithValues } from '@/hooks/useSupabase';
import { updateElement } from '@/hooks/useSupabase';
import type { Json } from '@/types/database';
import type { ListControlsState } from '@/Function/shared/listControls';
import { ElementsList } from '@/ActivitySpace/execution/element/ElementsList';
import { ListTable, type ListSection } from '@/ActivitySpace/execution/object/ListTable';
import { NavMyTasksIcon } from '@/shell/sidebar/NavIcons';

// ObjectElementsView — the body of an Object detail's "Elements" tab.
// Extracted from ObjectDetailView so the Element surfaces read as one
// consistent family (ObjListView / MyElementsView / ElementsListView /
// ObjectElementsView). Purely presentational: the host (ObjectDetailView)
// still owns the data fetch, the custom-column hook, multi-select state,
// the bulk-action bar, and the quick-add popup. This component only turns
// "this Object's elements + controls" into the shared list surface:
//
//   - controls present → shared <ElementsList /> (filter / group / sort,
//     identical to the sidebar Elements view).
//   - controls omitted → legacy single-section <ListTable /> fallback
//     (stand-alone embedding without the Domain shell).
//   - no elements      → centered empty-state CTA.

export interface ObjectElementsViewProps {
  elements: ElementWithDetails[];
  objectId: string;
  objectName: string;
  /** Filter + display state from the Domain shell. When omitted, the
   *  legacy single-section ListTable fallback is rendered instead. */
  controls?: ListControlsState;
  elementTypes?: string[];
  customColumns?: CustomColumnWithValues[];
  onColumnValueChange?: (columnId: string, elementId: string, value: Json) => void | Promise<void>;
  onEditColumn?: (column: CustomColumnWithValues) => void;
  onAddColumn?: () => void;
  selectedElementIds: Set<string>;
  onElementRowSelect: (elementId: string, mode: 'single' | 'range' | 'replace', orderedIds?: string[]) => void;
  onSelectObject: (objectId: string) => void;
  onSelectElement: (elementId: string) => void;
  onRefresh?: () => void | Promise<void>;
  onAddType?: (name: string) => void | Promise<void>;
  onRemoveType?: (name: string) => void | Promise<void>;
  /** Empty-state CTA → opens the host's quick-add popup. */
  onAddEmpty: () => void;
  /** Section header "+" → opens the host's quick-add popup. The section comes
   *  along so the popup can open on whatever its band classifies by (status,
   *  assignee, label …). When omitted, no "+" appears. */
  onAddElement?: (section?: ListSection) => void;
}

export function ObjectElementsView({
  elements,
  objectId,
  objectName,
  controls,
  elementTypes,
  customColumns,
  onColumnValueChange,
  onAddColumn,
  onEditColumn,
  selectedElementIds,
  onElementRowSelect,
  onSelectObject,
  onSelectElement,
  onRefresh,
  onAddType,
  onRemoveType,
  onAddEmpty,
  onAddElement,
}: ObjectElementsViewProps) {
  const handleElementUpdate = async (
    elementId: string,
    updates: Parameters<typeof updateElement>[1],
  ) => {
    try {
      await updateElement(elementId, updates);
      await onRefresh?.();
    } catch (e) {
      console.error('Failed to update element:', e);
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-card">
      <div className={elements.length ? "flex-1 min-h-0" : "shrink-0"}>
      {controls ? (
        // Domain-shell case: route through the shared <ElementsList /> so
        // filter / grouping behaviour matches the sidebar Elements view.
        <ElementsList
          elements={elements}
          controls={controls}
          onSelectObject={onSelectObject}
          onSelectElement={onSelectElement}
          onRefresh={onRefresh}
          colStorageKey={`object:${objectId}`}
          elementTypes={elementTypes}
          onAddType={onAddType}
          onRemoveType={onRemoveType}
          customColumns={customColumns}
          onCustomColumnValueChange={onColumnValueChange}
          onAddColumn={onAddColumn}
          onEditColumn={onEditColumn}
          selectedElementIds={selectedElementIds}
          onElementRowSelect={onElementRowSelect}
          onElementUpdateOverride={handleElementUpdate}
          // Every section here belongs to the same Object, but grouping still
          // splits it into status / assignee / label bands — so the section
          // decides what the new Element inherits, not where it lands.
          onAddElement={onAddElement}
        />
      ) : (
        // Stand-alone fallback when no controls are wired (legacy embedding
        // without the Domain shell). Preserves the single-section layout.
        <ListTable
          sections={[
            { id: '_all', name: objectName, objects: [], elements } satisfies ListSection,
          ]}
          onSelectObject={onSelectObject}
          onSelectElement={onSelectElement}
          hideSectionHeaders
          colStorageKey={`object:${objectId}`}
          elementTypes={elementTypes}
          customColumns={customColumns}
          onCustomColumnValueChange={onColumnValueChange}
          onAddColumn={onAddColumn}
          onEditColumn={onEditColumn}
          onElementUpdate={handleElementUpdate}
          selectedElementIds={selectedElementIds}
          onElementRowSelect={onElementRowSelect}
          onAddElement={onAddElement}
        />
      )}
      </div>
      {elements.length === 0 && <ElementsEmptyState onAdd={onAddEmpty} />}
    </div>
  );
}

function ElementsEmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center flex-1 py-20 px-6 select-none">
      <div className="grid grid-cols-2 gap-3 mb-6">
        {[0.18, 0.35, 0.55, 1].map((opacity, i) => (
          <div
            key={i}
            className="w-14 h-14 rounded-xl border-2 border-muted-foreground flex items-center justify-center"
            style={{ opacity, borderStyle: i === 0 ? 'dashed' : 'solid' }}
          >
            <NavMyTasksIcon size={22} />
          </div>
        ))}
      </div>
      <h2 className="text-[15px] font-semibold text-foreground mb-1.5">Add Elements to this Object</h2>
      <p className="text-[13px] text-muted-foreground text-center max-w-xs mb-2">
        Elements are the smallest unit you track — anything actionable or worth recording.
      </p>
      <p className="text-[12px] text-muted-foreground/60 text-center max-w-xs mb-6">
        You can also add sections, set priorities, assignees, and due dates.
      </p>
      <button
        onClick={onAdd}
        className="flex items-center gap-2 px-4 py-2 rounded-full bg-foreground text-background text-[13px] font-medium hover:bg-foreground/90 transition-colors"
      >
        <Plus size={14} />
        Create Element
      </button>
    </div>
  );
}
