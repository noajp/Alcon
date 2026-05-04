'use client';

import React, { useState } from 'react';
import type { AlconObjectWithChildren, ElementWithDetails, ExplorerData } from '@/hooks/useSupabase';
import { moveObject } from '@/hooks/useSupabase';
import type { NavigationState } from '@/types/navigation';
import { ObjectIcon } from '@/shell/icons';
import { NavObjectsIcon } from '@/shell/sidebar/NavIcons';
import { ChevronDown, GripVertical, Check, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { IslandCard } from '@/shell/IslandCard';
import { ObjectDetailView } from '@/alcon/object/ObjectDetailView';
import { ObjectListView, type ListSection } from '@/alcon/object/ObjectListView';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel, DropdownMenuCheckboxItem } from '@/ui/dropdown-menu';
import { DndContext, PointerSensor, useSensor, useSensors, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
type SortableListeners = ReturnType<typeof useSortable>['listeners'];


type ObjListCol = 'sub' | 'elements' | 'progress';

function countObjDescendants(obj: AlconObjectWithChildren): { objects: number; elements: number } {
  const selfElements = obj.elements?.length ?? 0;
  let objCount = 0;
  let elCount = selfElements;
  if (obj.children?.length) {
    for (const c of obj.children) {
      objCount += 1;
      const sub = countObjDescendants(c);
      objCount += sub.objects;
      elCount += sub.elements;
    }
  }
  return { objects: objCount, elements: elCount };
}

// ============================================
// Object list — custom columns (localStorage-backed for now since the
// objects table doesn't have a generic property bag yet).
// ============================================
type ObjCustomCol = { id: string; name: string; type: 'text' | 'number' | 'date' };

function loadObjCustomCols(scope: string): ObjCustomCol[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(`obj_cust_cols_${scope}`);
    return raw ? (JSON.parse(raw) as ObjCustomCol[]) : [];
  } catch {
    return [];
  }
}

function saveObjCustomCols(scope: string, cols: ObjCustomCol[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(`obj_cust_cols_${scope}`, JSON.stringify(cols));
}

function loadObjCellValue(objId: string, colId: string): string {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem(`obj_cell_${objId}_${colId}`) ?? '';
}

function saveObjCellValue(objId: string, colId: string, val: string) {
  if (typeof window === 'undefined') return;
  if (val) window.localStorage.setItem(`obj_cell_${objId}_${colId}`, val);
  else window.localStorage.removeItem(`obj_cell_${objId}_${colId}`);
}

function ObjectCustomCell({ objectId, column }: { objectId: string; column: ObjCustomCol }) {
  const [value, setValue] = useState(() => loadObjCellValue(objectId, column.id));
  const [editing, setEditing] = useState(false);

  const commit = (next: string) => {
    setValue(next);
    saveObjCellValue(objectId, column.id, next);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        type={column.type === 'number' ? 'number' : column.type === 'date' ? 'date' : 'text'}
        defaultValue={value}
        autoFocus
        onClick={(e) => e.stopPropagation()}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
          else if (e.key === 'Escape') setEditing(false);
        }}
        className="w-full bg-transparent border-0 outline-none text-[12px] text-foreground placeholder:text-muted-foreground/40"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); setEditing(true); }}
      className="w-full text-left text-[12px] text-foreground hover:text-foreground truncate"
    >
      {value || <span className="text-muted-foreground/40">—</span>}
    </button>
  );
}

// ============================================
// Shared Object list row — matches ElementTableRow design exactly.
// ============================================
type ObjectListRowProps = {
  object: AlconObjectWithChildren;
  rowIndex?: number;
  showSub?: boolean;
  showElements?: boolean;
  showProgress?: boolean;
  customCols?: ObjCustomCol[];
  // depth for nested rendering (0 = top-level)
  depth?: number;
  // expand / collapse (only meaningful when the row has children)
  expandable?: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
  // checkbox
  checked?: boolean;
  onCheckToggle?: (e: React.MouseEvent) => void;
  // row click (navigate)
  onClick: () => void;
  // dnd
  dragRef?: (el: HTMLTableRowElement | null) => void;
  dragStyle?: React.CSSProperties;
  dragAttributes?: Record<string, unknown>;
  dragListeners?: Record<string, unknown>;
};

function ObjectListRow({
  object,
  rowIndex,
  showSub = true,
  showElements = true,
  showProgress = true,
  customCols = [],
  depth = 0,
  expandable = false,
  expanded = false,
  onToggleExpand,
  checked = false,
  onCheckToggle,
  onClick,
  dragRef,
  dragStyle,
  dragAttributes,
  dragListeners,
}: ObjectListRowProps) {
  const elementCount = object.elements?.length ?? 0;
  const doneCount = object.elements?.filter(e => e.status === 'done').length ?? 0;
  const progress = elementCount > 0 ? Math.round((doneCount / elementCount) * 100) : 0;
  const subCount = object.children?.length ?? 0;

  const rowStyle: React.CSSProperties = {
    ...(rowIndex !== undefined
      ? ({ ['--row-i' as keyof React.CSSProperties]: rowIndex } as React.CSSProperties)
      : {}),
    ...(dragStyle || {}),
  };

  return (
    <tr
      ref={dragRef}
      style={rowStyle}
      className="group hover:bg-muted/30 transition-colors cursor-pointer tracking-[-0.3px] leading-[1.4]"
      onClick={onClick}
    >
      {/* Drag handle gutter */}
      <td
        {...(dragAttributes || {})}
        {...(dragListeners || {})}
        onClick={(e) => e.stopPropagation()}
        className={`w-8 px-1 py-[3px] ${dragListeners ? 'cursor-grab active:cursor-grabbing' : ''}`}
        aria-label="Drag to reorder"
      >
        <div className={`flex items-center justify-center transition-colors ${
          dragListeners
            ? 'text-muted-foreground/30 group-hover:text-muted-foreground/70'
            : 'text-transparent group-hover:text-muted-foreground/20'
        }`}>
          <GripVertical size={12} />
        </div>
      </td>

      {/* Checkbox */}
      <td className="w-7 px-1 py-[3px]">
        <div className="flex items-center justify-center">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onCheckToggle?.(e); }}
            onMouseDown={(e) => e.stopPropagation()}
            aria-label={checked ? 'Uncheck' : 'Check'}
            className={`w-4 h-4 rounded-[2px] flex items-center justify-center transition-colors ${
              checked
                ? 'bg-emerald-500 hover:bg-emerald-600'
                : 'border border-muted-foreground/40 hover:border-foreground/60'
            }`}
          >
            {checked && <Check size={11} strokeWidth={3} className="text-white" />}
          </button>
        </div>
      </td>

      {/* Name — hover turns blue, click navigates */}
      <td className="pl-1 pr-2 py-[3px] select-none min-w-0">
        <div className="flex items-center gap-1.5 min-w-0" style={{ paddingLeft: depth * 16 }}>
          {expandable ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onToggleExpand?.(); }}
              onMouseDown={(e) => e.stopPropagation()}
              aria-label={expanded ? 'Collapse' : 'Expand'}
              className="w-4 h-4 inline-flex items-center justify-center text-muted-foreground/60 hover:text-foreground hover:bg-muted rounded transition-colors shrink-0"
            >
              <ChevronRight
                size={12}
                className={`transition-transform ${expanded ? 'rotate-90' : ''}`}
              />
            </button>
          ) : (
            <div className="w-4 shrink-0" />
          )}
          <span className="size-3.5 shrink-0 flex items-center justify-center text-muted-foreground">
            <ObjectIcon size={14} />
          </span>
          <span
            onClick={(e) => { e.stopPropagation(); onClick(); }}
            className="text-[13px] text-foreground hover:text-blue-500 hover:underline transition-colors truncate flex-1 min-w-0"
          >
            {object.name}
          </span>
        </div>
      </td>

      {showSub && (
        <td className="hidden md:table-cell px-3 py-[3px] text-xs text-muted-foreground w-20 text-right tabular-nums">
          {subCount > 0 ? `${subCount} sub` : '—'}
        </td>
      )}
      {showElements && (
        <td className="hidden md:table-cell px-3 py-[3px] text-xs text-muted-foreground w-28 text-right tabular-nums">
          {elementCount} elements
        </td>
      )}
      {showProgress && (
        <td className="hidden md:table-cell px-3 py-[3px] w-40">
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1.5 bg-muted/40 rounded-full overflow-hidden">
              <div className="h-full bg-foreground/70 rounded-full transition-all" style={{ width: `${progress}%` }} />
            </div>
            <span className="text-[10px] text-muted-foreground w-8 text-right tabular-nums">{progress}%</span>
          </div>
        </td>
      )}

      {/* Custom columns */}
      {customCols.map((col) => (
        <td
          key={col.id}
          className="hidden md:table-cell px-3 py-[3px] text-xs w-32"
        >
          <ObjectCustomCell objectId={object.id} column={col} />
        </td>
      ))}

      {/* Expand chevron */}
      <td className="w-10 px-1 py-[3px] text-center align-middle">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onClick(); }}
          className="w-5 h-5 inline-flex items-center justify-center text-muted-foreground/50 hover:text-foreground hover:bg-muted rounded transition-colors opacity-0 group-hover:opacity-100"
          aria-label="Open Object"
        >
          <ChevronRight size={12} />
        </button>
      </td>
    </tr>
  );
}

// Sortable wrapper for drag-and-drop
function SortableObjectListRow({
  object,
  rowIndex,
  cols,
  customCols,
  expandable,
  expanded,
  onToggleExpand,
  checked,
  onCheckToggle,
  onClick,
}: {
  object: AlconObjectWithChildren;
  rowIndex: number;
  cols: Set<ObjListCol>;
  customCols: ObjCustomCol[];
  expandable?: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
  checked?: boolean;
  onCheckToggle?: (e: React.MouseEvent) => void;
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: object.id });
  const dragStyle: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
    position: 'relative',
  };
  return (
    <ObjectListRow
      object={object}
      rowIndex={rowIndex}
      showSub={cols.has('sub')}
      showElements={cols.has('elements')}
      showProgress={cols.has('progress')}
      customCols={customCols}
      expandable={expandable}
      expanded={expanded}
      onToggleExpand={onToggleExpand}
      checked={checked}
      onCheckToggle={onCheckToggle}
      onClick={onClick}
      dragRef={setNodeRef}
      dragStyle={dragStyle}
      dragAttributes={attributes as unknown as Record<string, unknown>}
      dragListeners={listeners as unknown as Record<string, unknown>}
    />
  );
}

// ============================================
// Recursive renderer — emits the row + (when expanded) its descendants.
// Top-level rows opt into drag-and-drop via `sortable`; nested rows are
// rendered as plain rows since reordering across parents isn't supported.
// ============================================
function ObjectListTreeRows({
  object,
  rowIndex,
  depth,
  cols,
  customCols,
  checkedIds,
  expandedIds,
  onCheckToggle,
  onToggleExpand,
  onSelect,
  sortable = false,
}: {
  object: AlconObjectWithChildren;
  rowIndex: number;
  depth: number;
  cols: Set<ObjListCol>;
  customCols: ObjCustomCol[];
  checkedIds: Set<string>;
  expandedIds: Set<string>;
  onCheckToggle: (id: string) => void;
  onToggleExpand: (id: string) => void;
  onSelect: (id: string) => void;
  sortable?: boolean;
}) {
  const childObjects = object.children ?? [];
  // Pure Object tree — Elements live behind navigation, not in the list. The
  // chevron expands child Objects only.
  const expandable = childObjects.length > 0;
  const expanded = expandedIds.has(object.id);
  const sharedRowProps = {
    object,
    rowIndex,
    customCols,
    depth,
    expandable,
    expanded,
    onToggleExpand: () => onToggleExpand(object.id),
    checked: checkedIds.has(object.id),
    onCheckToggle: () => onCheckToggle(object.id),
    onClick: () => onSelect(object.id),
  };

  return (
    <>
      {sortable ? (
        <SortableObjectListRow cols={cols} {...sharedRowProps} />
      ) : (
        <ObjectListRow
          showSub={cols.has('sub')}
          showElements={cols.has('elements')}
          showProgress={cols.has('progress')}
          {...sharedRowProps}
        />
      )}
      {/* Child Objects — only when the user expands `>` */}
      {expandable && expanded && childObjects.map((child, i) => (
        <ObjectListTreeRows
          key={child.id}
          object={child}
          rowIndex={i}
          depth={depth + 1}
          cols={cols}
          customCols={customCols}
          checkedIds={checkedIds}
          expandedIds={expandedIds}
          onCheckToggle={onCheckToggle}
          onToggleExpand={onToggleExpand}
          onSelect={onSelect}
        />
      ))}
    </>
  );
}

// ============================================
// Header row with column labels and "+" picker.
// ============================================
function ObjectListHeader({
  cols,
  customCols,
  onColToggle,
  onAddCustomCol,
  onDeleteCustomCol,
}: {
  cols: Set<ObjListCol>;
  customCols: ObjCustomCol[];
  onColToggle: (col: ObjListCol) => void;
  onAddCustomCol: (name: string, type: ObjCustomCol['type']) => void;
  onDeleteCustomCol: (id: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<ObjCustomCol['type']>('text');

  const submitAdd = () => {
    const name = newName.trim();
    if (!name) { setAdding(false); return; }
    onAddCustomCol(name, newType);
    setNewName('');
    setNewType('text');
    setAdding(false);
  };

  const BUILTIN: { id: ObjListCol; label: string }[] = [
    { id: 'sub', label: 'Sub-objects' },
    { id: 'elements', label: 'Elements' },
    { id: 'progress', label: 'Progress' },
  ];

  return (
    <thead className="bg-card">
      <tr>
        <th className="w-8 px-1 py-2 bg-card" />
        <th className="w-7 px-1 py-2 bg-card" />
        <th className="pl-1 pr-2 py-2 text-left text-[11px] font-medium text-muted-foreground bg-card">
          Name
        </th>
        {cols.has('sub') && (
          <th className="hidden md:table-cell w-20 px-3 py-2 text-right text-[11px] font-medium text-muted-foreground bg-card">
            Sub
          </th>
        )}
        {cols.has('elements') && (
          <th className="hidden md:table-cell w-28 px-3 py-2 text-right text-[11px] font-medium text-muted-foreground bg-card">
            Elements
          </th>
        )}
        {cols.has('progress') && (
          <th className="hidden md:table-cell w-40 px-3 py-2 text-left text-[11px] font-medium text-muted-foreground bg-card">
            Progress
          </th>
        )}
        {customCols.map((col) => (
          <th
            key={col.id}
            className="hidden md:table-cell w-32 px-3 py-2 text-left text-[11px] font-medium text-muted-foreground bg-card"
          >
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="inline-flex items-center gap-1 hover:text-foreground transition-colors">
                  {col.name}
                  <ChevronDown size={10} className="opacity-60" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[140px]">
                <DropdownMenuItem onClick={() => onDeleteCustomCol(col.id)} className="text-[12px] text-destructive focus:text-destructive">
                  <Trash2 size={11} className="mr-2" />
                  Delete column
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </th>
        ))}
        {/* + button to add column */}
        <th className="w-10 px-1 py-2 text-center bg-card">
          <DropdownMenu open={adding ? false : undefined}>
            <DropdownMenuTrigger asChild>
              <button
                className="w-5 h-5 inline-flex items-center justify-center text-muted-foreground/60 hover:text-foreground hover:bg-muted rounded transition-colors"
                aria-label="Add column"
              >
                <Plus size={12} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[180px]">
              <DropdownMenuLabel className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Built-in
              </DropdownMenuLabel>
              {BUILTIN.map(({ id, label }) => (
                <DropdownMenuCheckboxItem
                  key={id}
                  checked={cols.has(id)}
                  onCheckedChange={() => onColToggle(id)}
                  className="text-[13px]"
                >
                  {label}
                </DropdownMenuCheckboxItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Add custom column
              </DropdownMenuLabel>
              <div className="px-2 py-1.5 space-y-1.5" onClick={(e) => e.stopPropagation()}>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') submitAdd(); }}
                  placeholder="Column name"
                  className="w-full px-2 py-1 text-[12px] bg-card border border-border rounded focus:outline-none focus:ring-1 focus:ring-foreground/30"
                />
                <select
                  value={newType}
                  onChange={(e) => setNewType(e.target.value as ObjCustomCol['type'])}
                  className="w-full px-2 py-1 text-[12px] bg-card border border-border rounded focus:outline-none"
                >
                  <option value="text">Text</option>
                  <option value="number">Number</option>
                  <option value="date">Date</option>
                </select>
                <button
                  type="button"
                  onClick={submitAdd}
                  disabled={!newName.trim()}
                  className="w-full px-2 py-1 text-[12px] bg-foreground text-background rounded hover:bg-foreground/90 disabled:opacity-40 transition-colors"
                >
                  Add
                </button>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        </th>
      </tr>
    </thead>
  );
}

// ============================================
// ChildObjectsTable — sub-object section inside ObjectDetailView.
// ============================================
export function ChildObjectsTable({
  parentObjectId,
  children,
  onNavigate,
  onRefresh,
}: {
  parentObjectId: string;
  children: AlconObjectWithChildren[];
  onNavigate: (nav: Partial<NavigationState>) => void;
  onRefresh?: () => void;
}) {
  const scope = parentObjectId;
  const [cols, setCols] = useState<Set<ObjListCol>>(new Set(['elements', 'progress']));
  const [customCols, setCustomCols] = useState<ObjCustomCol[]>(() => loadObjCustomCols(scope));
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const newIndex = children.findIndex(c => c.id === over.id);
    if (newIndex < 0) return;
    try {
      await moveObject(String(active.id), parentObjectId, newIndex);
      onRefresh?.();
    } catch (err) {
      console.error('Failed to reorder child Object', err);
    }
  };

  const toggleCheck = (id: string) => {
    setCheckedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleCol = (col: ObjListCol) => {
    setCols(prev => {
      const next = new Set(prev);
      if (next.has(col)) next.delete(col); else next.add(col);
      return next;
    });
  };

  const addCustomCol = (name: string, type: ObjCustomCol['type']) => {
    const newCol: ObjCustomCol = { id: `c_${Date.now().toString(36)}`, name, type };
    const next = [...customCols, newCol];
    setCustomCols(next);
    saveObjCustomCols(scope, next);
  };

  const deleteCustomCol = (id: string) => {
    const next = customCols.filter(c => c.id !== id);
    setCustomCols(next);
    saveObjCustomCols(scope, next);
  };

  return (
    <div className="mb-6">
      <div className="overflow-x-auto">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={children.map(c => c.id)} strategy={verticalListSortingStrategy}>
            <table className="w-full min-w-max bg-card border-collapse">
              <ObjectListHeader
                cols={cols}
                customCols={customCols}
                onColToggle={toggleCol}
                onAddCustomCol={addCustomCol}
                onDeleteCustomCol={deleteCustomCol}
              />
              <tbody>
                {children.map((childObj, index) => (
                  <SortableObjectListRow
                    key={childObj.id}
                    object={childObj}
                    rowIndex={index}
                    cols={cols}
                    customCols={customCols}
                    checked={checkedIds.has(childObj.id)}
                    onCheckToggle={() => toggleCheck(childObj.id)}
                    onClick={() => onNavigate({ objectId: childObj.id })}
                  />
                ))}
              </tbody>
            </table>
          </SortableContext>
        </DndContext>
      </div>
    </div>
  );
}


export function findObjectById(objects: AlconObjectWithChildren[], objectId: string): AlconObjectWithChildren | null {
  for (const obj of objects) {
    if (obj.id === objectId) return obj;
    if (obj.children) {
      const found = findObjectById(obj.children, objectId);
      if (found) return found;
    }
  }
  return null;
}

export function collectAllElements(objects: AlconObjectWithChildren[]): ElementWithDetails[] {
  let elements: ElementWithDetails[] = [];
  for (const obj of objects) {
    if (obj.elements) elements = elements.concat(obj.elements);
    if (obj.children) elements = elements.concat(collectAllElements(obj.children));
  }
  return elements;
}

export function collectAllObjects(explorerData: ExplorerData): AlconObjectWithChildren[] {
  function flatten(objects: AlconObjectWithChildren[]): AlconObjectWithChildren[] {
    let result: AlconObjectWithChildren[] = [];
    for (const obj of objects) {
      result.push(obj);
      if (obj.children) result = result.concat(flatten(obj.children));
    }
    return result;
  }
  return flatten(explorerData.objects);
}

export function findObjectInExplorerData(explorerData: ExplorerData, objectId: string): AlconObjectWithChildren | null {
  return findObjectById(explorerData.objects, objectId);
}

export function MyObjectsList({
  explorerData,
  onSelect,
}: {
  explorerData: ExplorerData;
  onSelect: (objectId: string) => void;
  onRefresh?: () => void;
}) {
  const objects = explorerData.objects;

  if (objects.length === 0) {
    return <ObjectsEmptyState />;
  }

  // No synthetic section header at the Domain root — sections are gone.
  // Top-level Objects render flat under the column header, with the Add
  // Object footer at the bottom.
  const sections: ListSection[] = [
    { id: '_objects_root', name: '', objects },
  ];

  return (
    <div className="h-full flex flex-col overflow-hidden bg-card">
      <div className="flex-1 overflow-auto">
        <ObjectListView
          sections={sections}
          onSelectObject={onSelect}
          hideSectionHeaders
        />
      </div>
    </div>
  );
}

// ============================================
// My Objects Sidebar — flat list of top-level Objects (drag-reorderable).
// Children of each Object are rendered indented underneath; only top-level
// Objects can be dragged. Brief-generated Objects appear at the top.
// ============================================
export function MyObjectsSidebar({
  objects,
  selectedId,
  onSelect,
  onRefresh,
}: {
  objects: AlconObjectWithChildren[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRefresh?: () => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const newIndex = objects.findIndex((o) => o.id === over.id);
    if (newIndex < 0) return;
    try {
      await moveObject(String(active.id), null, newIndex);
      onRefresh?.();
    } catch (err) {
      console.error('Failed to reorder Object', err);
    }
  };

  return (
    <div className="w-[240px] flex-shrink-0 flex flex-col overflow-hidden bg-card border-r border-border">
      {/* Flat sortable list */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden pt-3 pb-2">
        {objects.length === 0 && (
          <div className="px-3 py-4 text-[11px] text-muted-foreground/60 text-center">
            No Objects yet
          </div>
        )}

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={objects.map((o) => o.id)} strategy={verticalListSortingStrategy}>
            {objects.map((obj) => (
              <SortableObjectRow
                key={obj.id}
                object={obj}
                selectedId={selectedId}
                onSelect={onSelect}
              />
            ))}
          </SortableContext>
        </DndContext>
      </div>
    </div>
  );
}

function SortableObjectRow({
  object,
  selectedId,
  onSelect,
}: {
  object: AlconObjectWithChildren;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: object.id,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <ObjectTreeRow
        object={object}
        selectedId={selectedId}
        onSelect={onSelect}
        depth={0}
        boldRoot
        dragAttributes={attributes}
        dragListeners={listeners}
      />
    </div>
  );
}

// Recursive tree row with chevron expand/collapse. Drag handle is only
// applied at depth 0 (top-level Objects); nested children are not draggable.
function ObjectTreeRow({
  object,
  selectedId,
  onSelect,
  depth,
  boldRoot,
  dragAttributes,
  dragListeners,
}: {
  object: AlconObjectWithChildren;
  selectedId: string | null;
  onSelect: (id: string) => void;
  depth: number;
  boldRoot?: boolean;
  dragAttributes?: React.HTMLAttributes<HTMLElement>;
  dragListeners?: SortableListeners;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = !!object.children?.length;
  const isSelected = object.id === selectedId;
  // 4px less than before so depth-0 Object icons line up with the System
  // pill's leading icon (px-3 outer + px-3 pill button = 24px from sidebar
  // left, exactly where the tree icon lands once we use 4 + depth*12).
  const indent = 4 + depth * 12;

  return (
    <div>
      <div
        className={`group w-full flex items-center h-[26px] mx-1 rounded-md transition-colors ${
          isSelected ? 'bg-accent text-foreground' : 'text-foreground hover:bg-muted/40'
        }`}
        style={{ paddingLeft: `${indent}px`, paddingRight: '8px' }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
            className="w-4 h-4 flex items-center justify-center flex-shrink-0 text-muted-foreground hover:text-foreground"
            aria-label={expanded ? 'Collapse' : 'Expand'}
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className={`transition-transform ${expanded ? 'rotate-90' : ''}`}
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        ) : (
          <div className="w-4 h-4 flex-shrink-0" />
        )}
        <button
          type="button"
          onClick={() => onSelect(object.id)}
          {...(dragAttributes || {})}
          {...(dragListeners || {})}
          className="flex-1 min-w-0 flex items-center gap-2 text-left cursor-pointer"
          title={object.name}
        >
          <div className="w-4 h-4 flex items-center justify-center flex-shrink-0 text-muted-foreground">
            <ObjectIcon size={13} />
          </div>
          <span className="text-[13px] truncate">
            {object.name}
          </span>
        </button>
      </div>

      {hasChildren && expanded && (
        <div>
          {object.children!.map((child) => (
            <ObjectTreeRow
              key={child.id}
              object={child}
              selectedId={selectedId}
              onSelect={onSelect}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}


export function ObjectTreeItem({ object, selectedId, onSelect, depth }: {
  object: AlconObjectWithChildren;
  selectedId: string | null;
  onSelect: (id: string) => void;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(true);
  const isSelected = selectedId === object.id;
  const hasChildren = object.children && object.children.length > 0;

  return (
    <div>
      <div
        className={`flex items-center h-[28px] cursor-pointer transition-colors rounded mx-1 ${
          isSelected ? 'bg-accent text-foreground' : 'hover:bg-muted/50'
        }`}
        style={{ paddingLeft: `${8 + depth * 14}px`, paddingRight: '8px' }}
        onClick={() => onSelect(object.id)}
      >
        <button
          className={`w-4 h-4 flex items-center justify-center flex-shrink-0 text-muted-foreground transition-transform ${
            hasChildren ? '' : 'invisible'
          } ${expanded ? 'rotate-90' : ''}`}
          onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
        <div className="w-4 h-4 flex items-center justify-center flex-shrink-0 text-muted-foreground ml-0.5 mr-1">
          <ObjectIcon size={13} />
        </div>
        <span className="text-[13px] truncate">{object.name}</span>
      </div>
      {expanded && hasChildren && object.children!.map(child => (
        <ObjectTreeItem key={child.id} object={child} selectedId={selectedId} onSelect={onSelect} depth={depth + 1} />
      ))}
    </div>
  );
}

export { IslandCard };

// ============================================
// Objects View - Shows object contents
// ============================================
export function ObjectsView({ explorerData, navigation, onNavigate, onRefresh }: {
  explorerData: ExplorerData;
  navigation: NavigationState;
  onNavigate: (nav: Partial<NavigationState>) => void;
  onRefresh?: () => void;
}) {
  // If an object is selected, show object detail
  if (navigation.objectId) {
    const selectedObject = findObjectInExplorerData(explorerData, navigation.objectId);
    if (!selectedObject) {
      // Stale selection (e.g. after system switch) — clear it
      onNavigate({ objectId: null });
      return null;
    }
    return (
      <ObjectDetailView
        object={selectedObject}
        onNavigate={onNavigate}
        onRefresh={onRefresh}
        explorerData={explorerData}
      />
    );
  }

  // No objects at all
  if (explorerData.objects.length === 0) {
    return <ObjectsEmptyState />;
  }

  // Objects exist but none selected
  return (
    <div className="flex-1 flex items-center justify-center bg-[var(--content-bg)]">
      <p className="text-[13px] text-muted-foreground">Select an Object from the sidebar</p>
    </div>
  );
}

function ObjectsEmptyState() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center py-20 px-6 select-none">
      <div className="grid grid-cols-2 gap-3 mb-6">
        {[0.18, 0.35, 0.55, 1].map((opacity, i) => (
          <div
            key={i}
            className="w-14 h-14 rounded-xl border-2 border-muted-foreground flex items-center justify-center"
            style={{ opacity, borderStyle: i === 0 ? 'dashed' : 'solid' }}
          >
            <NavObjectsIcon size={22} />
          </div>
        ))}
      </div>
      <h2 className="text-[15px] font-semibold text-foreground mb-1.5">Add Objects to this System</h2>
      <p className="text-[13px] text-muted-foreground text-center max-w-xs mb-2">
        Objects are mid-level structural units — projects, departments, or any container you want to organise.
      </p>
      <p className="text-[12px] text-muted-foreground/60 text-center max-w-xs mb-6">
        You can nest Objects infinitely and share them across multiple parents.
      </p>
      <button
        onClick={() => window.dispatchEvent(new CustomEvent('alcon:create-object'))}
        className="flex items-center gap-2 px-4 py-2 rounded-full bg-foreground text-background text-[13px] font-medium hover:bg-foreground/90 transition-colors"
      >
        <Plus size={14} />
        Create Object
      </button>
    </div>
  );
}

// OverviewView is now imported from @/components/overview/OverviewView

// ============================================
// Section Header Component (simple)
// ============================================
export function SectionHeader({ label }: { label: string }) {
  return (
    <div className="px-4 pt-6 pb-2">
      <div className="text-sm font-semibold text-foreground">
        {label}
      </div>
    </div>
  );
}

