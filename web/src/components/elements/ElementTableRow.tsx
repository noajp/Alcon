'use client';

import React, { useState } from 'react';
import type { ElementWithDetails, CustomColumnWithValues, ExplorerData, AlconObjectWithChildren } from '@/hooks/useSupabase';
import { addElementToObject, removeElementFromObject, deleteElement, updateElement } from '@/hooks/useSupabase';
import type { Json } from '@/types/database';
import type { BuiltInColumn } from '@/components/columns';
import { CustomColumnCell } from '@/components/columns';
import { SubelementRow } from './SubelementRow';
import { Check, Circle, Clock, Send, CheckCircle2, XCircle, Ban, GripVertical, Link2, X } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuShortcut,
} from '@/components/ui/dropdown-menu';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuLabel,
} from '@/components/ui/context-menu';
import { ObjectPicker } from '@/components/objects/ObjectPicker';

// Flatten object tree to a lookup map of id -> name
function flattenObjectNames(objects: AlconObjectWithChildren[]): Map<string, string> {
  const map = new Map<string, string>();
  const walk = (objs: AlconObjectWithChildren[]) => {
    for (const o of objs) {
      map.set(o.id, o.name);
      if (o.children && o.children.length) walk(o.children);
    }
  };
  walk(objects);
  return map;
}

interface ElementTableRowProps {
  element: ElementWithDetails;
  rowNumber: number;
  rowIndex: number;
  isSelected?: boolean;
  isMultiSelected?: boolean;
  onSelect?: (event?: React.MouseEvent) => void;
  onStatusChange: (status: string) => void;
  onRefresh?: () => void;
  allElements?: ElementWithDetails[];
  customColumns?: CustomColumnWithValues[];
  onColumnValueChange?: (columnId: string, elementId: string, value: Json) => void;
  totalColumns?: number;
  builtInColumns?: BuiltInColumn[];
  selectedCells?: Set<string>;
  onCellMouseDown?: (rowIndex: number, colIndex: number, event: React.MouseEvent) => void;
  onCellMouseEnter?: (rowIndex: number, colIndex: number) => void;
  explorerData?: ExplorerData;
}

export function ElementTableRow({
  element,
  rowNumber,
  rowIndex,
  isSelected,
  isMultiSelected,
  onSelect,
  onStatusChange,
  onRefresh,
  allElements,
  customColumns,
  onColumnValueChange,
  totalColumns,
  builtInColumns,
  selectedCells,
  onCellMouseDown,
  onCellMouseEnter,
  explorerData,
}: ElementTableRowProps) {
  const [isSubelementsExpanded, setIsSubelementsExpanded] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const hasSubelements = element.subelements && element.subelements.length > 0;
  const isMultiHomed = element.isMultiHomed === true;
  const parentObjectIds = element.objectIds ?? [];

  const objectNameMap = React.useMemo(
    () => (explorerData ? flattenObjectNames(explorerData.objects) : new Map<string, string>()),
    [explorerData]
  );

  const handleMoveTo = async (newObjId: string) => {
    try {
      await updateElement(element.id, { object_id: newObjId });
      onRefresh?.();
    } catch (err) {
      console.error('Failed to move element', err);
    }
  };

  const handleAddTo = async (newObjId: string) => {
    try {
      await addElementToObject(element.id, newObjId, false);
      onRefresh?.();
    } catch (err) {
      console.error('Failed to add element to object', err);
    }
  };

  const handleRemoveFrom = async (objId: string) => {
    try {
      await removeElementFromObject(element.id, objId);
      onRefresh?.();
    } catch (err) {
      console.error('Failed to remove element from object', err);
    }
  };

  const handleDelete = async () => {
    try {
      await deleteElement(element.id);
      onRefresh?.();
    } catch (err) {
      console.error('Failed to delete element', err);
    }
  };

  // Sortable drag-and-drop
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: element.id,
  });

  const dragStyle: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
    position: 'relative',
    // CSS var consumed by .animate-row-in for staggered entrance
    ['--row-i' as keyof React.CSSProperties]: rowIndex,
  } as React.CSSProperties;

  // Status options - unified design tokens
  const statusOptions = [
    { status: 'backlog', label: 'Backlog', icon: Circle, color: 'text-neutral-400', shortcut: '1' },
    { status: 'todo', label: 'Todo', icon: Circle, color: 'text-neutral-500', shortcut: '2' },
    { status: 'in_progress', label: 'In Progress', icon: Clock, color: 'text-amber-600', shortcut: '3' },
    { status: 'review', label: 'In Review', icon: Send, color: 'text-blue-600', shortcut: '4' },
    { status: 'done', label: 'Done', icon: CheckCircle2, color: 'text-emerald-600', shortcut: '5' },
    { status: 'blocked', label: 'Blocked', icon: XCircle, color: 'text-red-600', shortcut: '6' },
    { status: 'cancelled', label: 'Cancelled', icon: Ban, color: 'text-neutral-400', shortcut: '7' },
  ];

  const currentStatus = statusOptions.find(s => s.status === element.status) || statusOptions[1];

  // Asana-style: text + dot, no colored background
  const priorityBadges: Record<string, { dot: string; text: string; label: string }> = {
    urgent: { dot: 'bg-red-500',    text: 'text-red-600',     label: 'Urgent' },
    high:   { dot: 'bg-amber-500',  text: 'text-amber-600',   label: 'High' },
    medium: { dot: 'bg-neutral-400',text: 'text-neutral-600', label: 'Normal' },
    low:    { dot: 'bg-neutral-300',text: 'text-neutral-400', label: 'Low' },
  };

  const statusBadges: Record<string, { dot: string; text: string; label: string }> = {
    todo:        { dot: 'bg-neutral-400', text: 'text-neutral-500', label: 'To Do' },
    in_progress: { dot: 'bg-amber-500',   text: 'text-amber-600',   label: 'In Progress' },
    review:      { dot: 'bg-blue-500',    text: 'text-blue-600',    label: 'Review' },
    done:        { dot: 'bg-emerald-500', text: 'text-emerald-600', label: 'Done' },
    blocked:     { dot: 'bg-red-500',     text: 'text-red-600',     label: 'Blocked' },
  };

  const priority = priorityBadges[element.priority || 'medium'] || priorityBadges.medium;
  const status = statusBadges[element.status || 'todo'] || statusBadges.todo;

  // Format due date
  const formatDueDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return null;
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' });
  };

  // Render built-in column cell
  const renderBuiltInCell = (col: BuiltInColumn) => {
    switch (col.builtinType) {
      case 'assignees':
        return (
          <div className="flex items-center -space-x-1">
            {element.assignees && element.assignees.length > 0 ? (
              <>
                {element.assignees.slice(0, 3).map((assignee, idx) => (
                  <div
                    key={assignee.id}
                    className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-muted-foreground border-2 border-white"
                    title={assignee.worker?.name || 'Unknown'}
                    style={{ zIndex: 3 - idx }}
                  >
                    {assignee.worker?.type === 'human' ? (
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                        <circle cx="12" cy="7" r="4" />
                      </svg>
                    ) : assignee.worker?.type === 'ai_agent' ? (
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="11" width="18" height="10" rx="2" />
                        <circle cx="12" cy="5" r="2" />
                        <path d="M12 7v4" />
                      </svg>
                    ) : (
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="2" y="8" width="20" height="14" rx="2" />
                        <path d="M12 2v6" />
                      </svg>
                    )}
                  </div>
                ))}
                {element.assignees.length > 3 && (
                  <div className="w-6 h-6 rounded-full bg-card flex items-center justify-center text-[10px] text-muted-foreground border-2 border-white font-medium">
                    +{element.assignees.length - 3}
                  </div>
                )}
              </>
            ) : (
              <span className="text-[10px] text-muted-foreground">-</span>
            )}
          </div>
        );
      case 'priority':
        return (
          <span className={`inline-flex items-center gap-1.5 text-[12px] ${priority.text}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${priority.dot}`} />
            {priority.label}
          </span>
        );
      case 'status':
        return (
          <span className={`inline-flex items-center gap-1.5 text-[12px] ${status.text}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />
            {status.label}
          </span>
        );
      case 'due_date':
        return element.due_date ? (
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {formatDueDate(element.due_date)}
            {element.due_time && (
              <span className="ml-1 tabular-nums">{element.due_time.slice(0, 5)}</span>
            )}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground flex items-center gap-1 whitespace-nowrap">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Add date
          </span>
        );
      default:
        return null;
    }
  };

  // Helper to check if a cell is selected
  const isCellSelected = (colIndex: number) => selectedCells?.has(`${rowIndex}-${colIndex}`);

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
      <tr
        ref={setNodeRef}
        style={dragStyle}
        className={`group border-b border-border/60 hover:bg-muted/30 transition-colors cursor-pointer animate-row-in ${isSelected ? 'bg-muted/40' : ''} ${isMultiSelected ? 'bg-muted/30' : ''}`}
        onClick={(e) => onSelect?.(e)}
      >
        {/* ID + drag handle */}
        <td className="px-2 py-2 text-[11px] text-muted-foreground/60 text-center font-mono">
          <div className="flex items-center gap-1 justify-center">
            <button
              type="button"
              {...attributes}
              {...listeners}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              className="opacity-0 group-hover:opacity-100 text-muted-foreground/40 hover:text-foreground cursor-grab active:cursor-grabbing flex items-center"
              aria-label="Drag to reorder"
            >
              <GripVertical size={12} />
            </button>
            <span>{element.display_id ? element.display_id.replace('el_', '') : rowNumber}</span>
          </div>
        </td>

        {/* Name cell */}
        <td
          className={`px-2 py-2 select-none min-w-0 ${isCellSelected(0) ? 'bg-primary/10' : ''}`}
          onMouseDown={(e) => {
            e.stopPropagation();
            onCellMouseDown?.(rowIndex, 0, e);
          }}
          onMouseEnter={() => onCellMouseEnter?.(rowIndex, 0)}
        >
          <div className="flex items-center gap-2 min-w-0">
            {/* Expand/Collapse button for subelements */}
            {hasSubelements ? (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setIsSubelementsExpanded(!isSubelementsExpanded);
                }}
                className="w-4 h-4 flex items-center justify-center text-muted-foreground hover:text-foreground rounded transition-colors opacity-0 group-hover:opacity-100"
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className={`transition-transform ${isSubelementsExpanded ? 'rotate-90' : ''}`}
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            ) : (
              <div className="w-4" />
            )}

            {/* Linear-style status selector */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  onClick={(e) => e.stopPropagation()}
                  className="size-3.5 shrink-0 flex items-center justify-center hover:scale-110 transition-transform"
                  title={currentStatus.label}
                >
                  <currentStatus.icon className={`size-3.5 ${currentStatus.color}`} strokeWidth={2} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[160px]" onClick={(e) => e.stopPropagation()}>
                {statusOptions.map((opt) => (
                  <DropdownMenuItem
                    key={opt.status}
                    onClick={() => onStatusChange(opt.status)}
                    className="flex items-center gap-2 text-[12px]"
                  >
                    <opt.icon className={`size-3.5 ${opt.color}`} strokeWidth={2} />
                    <span className="flex-1">{opt.label}</span>
                    {element.status === opt.status && (
                      <Check className="size-3.5 text-foreground" strokeWidth={2} />
                    )}
                    <DropdownMenuShortcut>{opt.shortcut}</DropdownMenuShortcut>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Title */}
            <span className={`text-sm font-medium truncate flex-1 min-w-0 ${element.status === 'done' ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
              {element.title}
            </span>

            {/* Multi-home indicator */}
            {isMultiHomed && (
              <span
                className="shrink-0 text-muted-foreground inline-flex items-center"
                title={`In ${parentObjectIds.length} projects`}
              >
                <Link2 size={12} />
              </span>
            )}

            {/* Subelement count badge */}
            {hasSubelements && (
              <span className="text-[10px] text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded-full shrink-0">
                {element.subelements!.filter(s => s.is_completed).length}/{element.subelements!.length}
              </span>
            )}
          </div>
        </td>

        {/* Built-in Columns (dynamically rendered) - hidden on small screens */}
        {builtInColumns?.filter(col => col.isVisible).map((col, idx) => {
          const colIndex = idx + 1;
          return (
            <td
              key={col.id}
              className={`hidden md:table-cell px-2 py-2 select-none ${isCellSelected(colIndex) ? 'bg-primary/10' : ''}`}
              onMouseDown={(e) => {
                e.stopPropagation();
                onCellMouseDown?.(rowIndex, colIndex, e);
              }}
              onMouseEnter={() => onCellMouseEnter?.(rowIndex, colIndex)}
            >
              {renderBuiltInCell(col)}
            </td>
          );
        })}

        {/* Custom Columns - hidden on small screens */}
        {customColumns?.map((col, idx) => {
          const colIndex = (builtInColumns?.filter(c => c.isVisible).length || 0) + 1 + idx;
          return (
            <td
              key={col.id}
              className={`hidden md:table-cell px-2 py-2 select-none ${isCellSelected(colIndex) ? 'bg-primary/10' : ''}`}
              onMouseDown={(e) => {
                e.stopPropagation();
                onCellMouseDown?.(rowIndex, colIndex, e);
              }}
              onMouseEnter={() => onCellMouseEnter?.(rowIndex, colIndex)}
            >
              <CustomColumnCell
                column={col}
                elementId={element.id}
                value={col.values?.[element.id]?.value ?? null}
                onChange={(value) => onColumnValueChange?.(col.id, element.id, value)}
              />
            </td>
          );
        })}

        {/* Empty cell for add column button - hidden on small screens */}
        <td className="hidden md:table-cell px-2 py-1.5"></td>
      </tr>
        </ContextMenuTrigger>
        <ContextMenuContent className="min-w-[200px]">
          <ContextMenuItem onClick={(e) => { e.stopPropagation(); onSelect?.(); }}>
            Open
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            disabled={!explorerData}
            onClick={(e) => { e.stopPropagation(); setMoveOpen(true); }}
          >
            Move to project...
          </ContextMenuItem>
          <ContextMenuItem
            disabled={!explorerData}
            onClick={(e) => { e.stopPropagation(); setAddOpen(true); }}
          >
            Add to project...
          </ContextMenuItem>
          {isMultiHomed && parentObjectIds.length > 0 && (
            <>
              <ContextMenuSeparator />
              <ContextMenuLabel className="text-[11px] text-muted-foreground">
                Currently in:
              </ContextMenuLabel>
              {parentObjectIds.map((oid) => (
                <ContextMenuItem
                  key={oid}
                  onClick={(e) => { e.stopPropagation(); handleRemoveFrom(oid); }}
                  className="flex items-center justify-between gap-2 text-[12px]"
                >
                  <span className="truncate">{objectNameMap.get(oid) ?? oid}</span>
                  <X size={12} className="text-muted-foreground shrink-0" />
                </ContextMenuItem>
              ))}
            </>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem onClick={(e) => { e.stopPropagation(); console.log('Duplicate element', element.id); }}>
            Duplicate
          </ContextMenuItem>
          <ContextMenuItem
            onClick={(e) => { e.stopPropagation(); handleDelete(); }}
            className="text-red-600 focus:text-red-600"
          >
            Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {explorerData && moveOpen && (
        <ObjectPicker
          open={moveOpen}
          onClose={() => setMoveOpen(false)}
          onSelect={handleMoveTo}
          title="Move to project"
          description="Choose the new primary project for this element."
          excludeIds={element.object_id ? [element.object_id] : []}
          explorerData={explorerData}
        />
      )}
      {explorerData && addOpen && (
        <ObjectPicker
          open={addOpen}
          onClose={() => setAddOpen(false)}
          onSelect={handleAddTo}
          title="Add to project"
          description="Add this element to an additional project (multi-home)."
          excludeIds={parentObjectIds}
          explorerData={explorerData}
        />
      )}

      {/* Expanded Subelements */}
      {isSubelementsExpanded && hasSubelements && element.subelements!.map((subelement) => (
        <tr key={subelement.id} className="bg-muted/10 border-b border-border">
          <td className="px-2 py-1.5"></td>
          <td className="px-2 py-1.5" colSpan={(totalColumns || 7) - 1}>
            <div className="flex items-center gap-1.5 pl-8">
              <SubelementRow subelement={subelement} onRefresh={onRefresh} />
            </div>
          </td>
        </tr>
      ))}

      {/* Inline Detail Panel - disabled, using side panel instead */}
    </>
  );
}
