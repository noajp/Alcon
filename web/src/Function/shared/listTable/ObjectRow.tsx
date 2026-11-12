'use client';

import { ItemIcon } from '@/Function/shared/itemIcon/ItemIcon';
import { memo } from 'react';
import type { AlconObjectWithChildren, Worker } from '@/hooks/useSupabase';
import { useSortable } from '@dnd-kit/sortable';
import type { Json } from '@/types/database';
import { ObjectIcon } from '@/Frame/icons';
import { type DataColumn } from '@/Function/shared/listTable/useListColumns';
import { OBJECT_DRAG_PREFIX, DROP_LINE_CLASS, DROP_LINE_SQUARE, dropLineVar, ROW_ROUND_BASE, ROW_ROUND_TO_LAST, LEAD_CELL, LEAD_CELL_HOVER, LEAD_CELL_SELECTED, selectionSquareClass, selectionSquareClassToLast } from './shared';
import { ObjectCell } from './cells';

// Object row — sortable + selectable, mirrors ElementRow at the structural
// level. The checkbox affordance, hover/selected bg, and sticky-left
// frozen first three columns all behave the same so Object lists and
// Element lists feel like one surface.
interface ObjectRowProps {
  obj: AlconObjectWithChildren;
  isSelected: boolean;
  hasSelectionRef: { readonly current: boolean };
  visibleColumns: DataColumn[];
  hasTrailingCol: boolean;
  elementTypes: string[];
  canRowSelect: boolean;
  onAddType?: (name: string) => void | Promise<void>;
  onRemoveType?: (name: string) => void | Promise<void>;
  dropEdge?: 'before' | 'after';
  selPrev?: boolean;
  selNext?: boolean;
  onSelectObject: (id: string) => void;
  onRowSelect: (id: string, mode: 'single' | 'range' | 'replace') => void;
  onObjectUpdate?: (objectId: string, updates: { type?: string | null; due_date?: string | null; lead_id?: string | null }) => void | Promise<void>;
  objectWorkers: Worker[];
  onObjectCustomColumnValueChange?: (columnId: string, objectId: string, value: Json) => void | Promise<void>;
}

export const ObjectRow = memo(function ObjectRow({
  obj, isSelected, hasSelectionRef, visibleColumns, hasTrailingCol,
  elementTypes, canRowSelect, onAddType, onRemoveType, dropEdge, selPrev, selNext, onSelectObject, onRowSelect,
  onObjectUpdate, objectWorkers, onObjectCustomColumnValueChange,
}: ObjectRowProps) {
  const dragId = OBJECT_DRAG_PREFIX + obj.id;
  // No sortable transform — rows stay static; the DragOverlay card and blue
  // drop line carry the feedback (see ElementRow for the rationale).
  const { setNodeRef, attributes, listeners, isDragging } = useSortable({ id: dragId });
  // Modifier-clicks are selection gestures (range / toggle) — don't let dnd
  // pick them up.
  const dragListeners = {
    ...listeners,
    onPointerDown: (e: React.PointerEvent) => {
      if (e.shiftKey || e.metaKey || e.ctrlKey) return;
      listeners?.onPointerDown?.(e);
    },
  };
  const dragStyle: React.CSSProperties = {
    opacity: isDragging ? 0.4 : undefined,
    ['--drop-line' as string]: dropLineVar(dropEdge),
  };
  return (
    <tr
      ref={setNodeRef}
      style={dragStyle}
      {...attributes}
      {...dragListeners}
      // The Object list never scrolls horizontally (overflow-x-hidden on the
      // wrap), so nothing can slide under the sticky Name cells — the selected
      // tint safely spans the full rounded band. Without a trailing "+"
      // column the band (rounding + tint) runs to the LAST cell (Elements);
      // with one it stops a cell short, mirroring the Element rows.
      className={`group cursor-pointer select-none leading-[1.4] [&>td]:transition-colors ${hasTrailingCol ? ROW_ROUND_BASE : ROW_ROUND_TO_LAST} ${isSelected ? (hasTrailingCol ? selectionSquareClass(selPrev, selNext) : selectionSquareClassToLast(selPrev, selNext)) : ''} ${DROP_LINE_CLASS} ${dropEdge ? DROP_LINE_SQUARE : ''} ${
        isSelected
          ? (hasTrailingCol
              ? '[&>td:not(:first-child):not(:last-child)]:bg-[var(--accent-default)]/15 dark:[&>td:not(:first-child):not(:last-child)]:bg-[var(--accent-default)]/20 [&:hover>td:not(:first-child):not(:last-child)]:bg-[var(--accent-default)]/20 dark:[&:hover>td:not(:first-child):not(:last-child)]:bg-[var(--accent-default)]/25'
              : '[&>td:not(:first-child)]:bg-[var(--accent-default)]/15 dark:[&>td:not(:first-child)]:bg-[var(--accent-default)]/20 [&:hover>td:not(:first-child)]:bg-[var(--accent-default)]/20 dark:[&:hover>td:not(:first-child)]:bg-[var(--accent-default)]/25')
          // Hover tints the cells after the lead one, which paints its own part (LEAD_CELL).
          : (hasTrailingCol ? '[&:hover>td:not(:first-child):not(:last-child)]:bg-foreground/[0.06]' : '[&:hover>td:not(:first-child)]:bg-foreground/[0.06]')
      }`}
      onClick={(e) => {
        if (canRowSelect && (e.shiftKey || e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          onRowSelect(obj.id, e.shiftKey ? 'range' : 'single');
          return;
        }
        if (canRowSelect && hasSelectionRef.current) {
          onRowSelect(obj.id, 'replace');
          return;
        }
        onSelectObject(obj.id);
      }}
    >
      {/* No checkbox: Shift- or ⌘-click selects (the bulk bar appears). */}
      <td className={`sticky left-0 z-10 bg-card w-13 pl-7.5 pr-1.5 py-2 ${LEAD_CELL} ${isSelected ? LEAD_CELL_SELECTED : LEAD_CELL_HOVER}`}>
        <div className="flex items-center text-muted-foreground/70">
          <ItemIcon icon={obj.icon} color={obj.color} fallback={<ObjectIcon size={16} />} />
        </div>
      </td>
      <td className="md:sticky md:left-13 z-10 bg-card pl-3.5 pr-0.5 py-2 min-w-0 max-w-0">
        <div className="list-row-inner flex items-center min-w-0 min-h-[1.875rem]">
          <span className="list-row-title text-[15px] font-medium text-foreground truncate flex-1 min-w-0">
            {obj.name}
          </span>
        </div>
      </td>
      {/* The Element rows' signals cell — an Object carries none. */}
      <td className="p-0" />
      {visibleColumns.map((col) => (
        <ObjectCell
          key={col.id}
          column={col}
          obj={obj}
          elementTypes={elementTypes}
          onObjectUpdate={onObjectUpdate}
          objectWorkers={objectWorkers}
          onAddType={onAddType}
          onRemoveType={onRemoveType}
          onObjectCustomColumnValueChange={onObjectCustomColumnValueChange}
        />
      ))}
      {hasTrailingCol && (
        <td className="table-cell w-8 px-1 py-2" />
      )}
    </tr>
  );
});
