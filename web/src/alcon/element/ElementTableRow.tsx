'use client';

import React, { useState } from 'react';
import type { ElementWithDetails, CustomColumnWithValues, ExplorerData, AlconObjectWithChildren, Worker } from '@/hooks/useSupabase';
import { addElementToObject, removeElementFromObject, deleteElement, updateElement, fetchAllWorkers, addElementAssignee, removeElementAssignee } from '@/hooks/useSupabase';
import type { Json } from '@/types/database';
import type { BuiltInColumn } from '@/alcon/tag';
import { CustomColumnCell } from '@/alcon/tag';
import { SubelementRow } from './SubelementRow';
import { Check, Circle, Clock, Send, CheckCircle2, XCircle, Ban, GripVertical, Link2, X, ChevronRight } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuShortcut,
} from '@/ui/dropdown-menu';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuLabel,
} from '@/ui/context-menu';
import { ObjectPicker } from '@/alcon/object/ObjectPicker';

// Atom icon — Element marker (nucleus + 3 orbital ellipses + electron dots)
const AtomIcon = ({ className = '' }: { className?: string }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
    <ellipse cx="12" cy="12" rx="9.5" ry="3.5" />
    <ellipse cx="12" cy="12" rx="9.5" ry="3.5" transform="rotate(60 12 12)" />
    <ellipse cx="12" cy="12" rx="9.5" ry="3.5" transform="rotate(120 12 12)" />
    <circle cx="21.5" cy="12" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="6.8" cy="4.4" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="6.8" cy="19.6" r="1.2" fill="currentColor" stroke="none" />
  </svg>
);

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
  const [allWorkers, setAllWorkers] = useState<Worker[]>([]);
  const [assigneeDropdownOpen, setAssigneeDropdownOpen] = useState(false);
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

  const handlePriorityChange = async (priority: string) => {
    try { await updateElement(element.id, { priority: priority as 'medium' }); onRefresh?.(); } catch (e) { console.error(e); }
  };

  const handleDueDateChange = async (value: string) => {
    try { await updateElement(element.id, { due_date: value || null }); onRefresh?.(); } catch (e) { console.error(e); }
  };

  const handleAssigneeAdd = async (workerId: string) => {
    try { await addElementAssignee({ element_id: element.id, worker_id: workerId, role: 'assignee' }); setAssigneeDropdownOpen(false); onRefresh?.(); } catch (e) { console.error(e); }
  };

  const handleAssigneeRemove = async (assigneeId: string) => {
    try { await removeElementAssignee(assigneeId); onRefresh?.(); } catch (e) { console.error(e); }
  };

  const handleAssigneeDropdownOpen = (open: boolean) => {
    setAssigneeDropdownOpen(open);
    if (open && allWorkers.length === 0) {
      fetchAllWorkers().then(setAllWorkers).catch(console.error);
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

  const assignedWorkerIds = element.assignees?.map(a => a.worker_id) || [];
  const availableWorkers = allWorkers.filter(w => !assignedWorkerIds.includes(w.id));

  // Render built-in column cell — all cells are click-to-edit
  const renderBuiltInCell = (col: BuiltInColumn) => {
    const stopProp = (e: React.SyntheticEvent) => e.stopPropagation();

    switch (col.builtinType) {
      case 'assignees': {
        return (
          <DropdownMenu open={assigneeDropdownOpen} onOpenChange={handleAssigneeDropdownOpen}>
            <DropdownMenuTrigger asChild>
              <button
                onClick={stopProp}
                className="inline-flex items-center gap-1 hover:bg-muted/50 px-1 py-[3px].5 rounded transition-colors -mx-1"
              >
                {element.assignees && element.assignees.length > 0 ? (
                  <div className="flex items-center -space-x-1">
                    {element.assignees.slice(0, 3).map((assignee, idx) => (
                      <div
                        key={assignee.id}
                        className="w-5 h-5 rounded-full bg-muted flex items-center justify-center text-muted-foreground border border-white text-[9px] font-medium"
                        title={assignee.worker?.name || 'Unknown'}
                        style={{ zIndex: 3 - idx }}
                      >
                        {assignee.worker?.name?.charAt(0) || '?'}
                      </div>
                    ))}
                    {element.assignees.length > 3 && (
                      <div className="w-5 h-5 rounded-full bg-card flex items-center justify-center text-[9px] text-muted-foreground border border-white font-medium">
                        +{element.assignees.length - 3}
                      </div>
                    )}
                  </div>
                ) : (
                  <span className="text-[11px] text-muted-foreground/50">—</span>
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[180px]" onClick={stopProp}>
              {element.assignees && element.assignees.length > 0 && (
                <>
                  {element.assignees.map(a => (
                    <DropdownMenuItem
                      key={a.id}
                      onClick={() => handleAssigneeRemove(a.id)}
                      className="flex items-center gap-2 text-[12px]"
                    >
                      <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-medium text-primary flex-shrink-0">
                        {a.worker?.name?.charAt(0) || '?'}
                      </div>
                      <span className="flex-1">{a.worker?.name}</span>
                      <span className="text-muted-foreground text-[10px]">remove</span>
                    </DropdownMenuItem>
                  ))}
                  {availableWorkers.length > 0 && <DropdownMenuShortcut className="my-0.5 h-px bg-border block" />}
                </>
              )}
              {availableWorkers.length > 0 ? (
                availableWorkers.map(w => (
                  <DropdownMenuItem
                    key={w.id}
                    onClick={() => handleAssigneeAdd(w.id)}
                    className="flex items-center gap-2 text-[12px]"
                  >
                    <div className="w-5 h-5 rounded-full bg-muted flex items-center justify-center text-[10px]">{w.name.charAt(0)}</div>
                    {w.name}
                  </DropdownMenuItem>
                ))
              ) : allWorkers.length === 0 ? (
                <div className="px-3 py-2 text-[12px] text-muted-foreground">Loading...</div>
              ) : (
                <div className="px-3 py-2 text-[12px] text-muted-foreground">All assigned</div>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      }

      case 'priority': {
        const priorityOpts = [
          { value: 'urgent', dot: 'bg-red-500',     text: 'text-red-600',     label: 'Urgent' },
          { value: 'high',   dot: 'bg-amber-500',   text: 'text-amber-600',   label: 'High' },
          { value: 'medium', dot: 'bg-neutral-400', text: 'text-neutral-600', label: 'Normal' },
          { value: 'low',    dot: 'bg-neutral-300', text: 'text-neutral-400', label: 'Low' },
        ];
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                onClick={stopProp}
                className={`inline-flex items-center gap-1.5 text-[12px] ${priority.text} hover:bg-muted/50 px-1.5 py-0.5 rounded transition-colors -mx-1.5`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${priority.dot}`} />
                {priority.label}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[140px]" onClick={stopProp}>
              {priorityOpts.map(opt => (
                <DropdownMenuItem
                  key={opt.value}
                  onClick={() => handlePriorityChange(opt.value)}
                  className="flex items-center gap-2 text-[12px]"
                >
                  <span className={`w-2 h-2 rounded-full ${opt.dot}`} />
                  <span className={`flex-1 ${opt.text}`}>{opt.label}</span>
                  {(element.priority || 'medium') === opt.value && <Check className="size-3 text-foreground" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      }

      case 'status': {
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                onClick={stopProp}
                className={`inline-flex items-center gap-1.5 text-[12px] ${status.text} hover:bg-muted/50 px-1.5 py-0.5 rounded transition-colors -mx-1.5`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />
                {status.label}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[160px]" onClick={stopProp}>
              {statusOptions.map(opt => (
                <DropdownMenuItem
                  key={opt.status}
                  onClick={() => onStatusChange(opt.status)}
                  className="flex items-center gap-2 text-[12px]"
                >
                  <opt.icon className={`size-3.5 ${opt.color}`} strokeWidth={2} />
                  <span className="flex-1">{opt.label}</span>
                  {element.status === opt.status && <Check className="size-3 text-foreground" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      }

      case 'due_date': {
        return (
          <label
            onClick={stopProp}
            className="cursor-pointer inline-flex items-center gap-1 hover:bg-muted/50 px-1.5 py-0.5 rounded transition-colors -mx-1.5"
          >
            {element.due_date ? (
              <span className="text-[12px] text-foreground/80 whitespace-nowrap">
                {formatDueDate(element.due_date)}
                {element.due_time && (
                  <span className="ml-1 tabular-nums text-muted-foreground">{element.due_time.slice(0, 5)}</span>
                )}
              </span>
            ) : (
              <span className="text-[12px] text-muted-foreground/50 flex items-center gap-1 whitespace-nowrap">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
                Add date
              </span>
            )}
            <input
              type="date"
              value={element.due_date?.split('T')[0] || ''}
              onChange={(e) => { e.stopPropagation(); handleDueDateChange(e.target.value); }}
              onClick={stopProp}
              className="sr-only"
            />
          </label>
        );
      }

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
        className={`group border-b border-border/60 hover:bg-muted/30 transition-colors cursor-pointer animate-row-in tracking-[-0.3px] leading-[1.4] ${isSelected ? 'bg-muted/40' : ''} ${isMultiSelected ? 'bg-blue-500/[0.10]' : ''}`}
        onClick={(e) => onSelect?.(e)}
      >
        {/* Drag handle gutter — entire cell acts as drag target */}
        <td
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
          className="w-8 px-1 py-[3px] cursor-grab active:cursor-grabbing"
          aria-label="Drag to reorder"
        >
          <div className="flex items-center justify-center text-muted-foreground/30 group-hover:text-muted-foreground/70 transition-colors">
            <GripVertical size={12} />
          </div>
        </td>

        {/* Done checkbox */}
        <td className="w-7 px-1 py-[3px]">
          <div className="flex items-center justify-center">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onStatusChange(element.status === 'done' ? 'todo' : 'done'); }}
              onMouseDown={(e) => e.stopPropagation()}
              aria-label={element.status === 'done' ? 'Mark as todo' : 'Mark as done'}
              className={`w-4 h-4 rounded-[2px] flex items-center justify-center transition-colors ${
                element.status === 'done'
                  ? 'bg-emerald-500 hover:bg-emerald-600'
                  : 'border border-muted-foreground/40 hover:border-foreground/60'
              }`}
            >
              {element.status === 'done' && <Check size={11} strokeWidth={3} className="text-white" />}
            </button>
          </div>
        </td>

        {/* Name cell */}
        <td
          className={`pl-1 pr-2 py-[3px] select-none min-w-0 border-r border-border/40 ${isCellSelected(0) ? 'bg-primary/10' : ''}`}
          onMouseDown={(e) => {
            e.stopPropagation();
            onCellMouseDown?.(rowIndex, 0, e);
          }}
          onMouseEnter={() => onCellMouseEnter?.(rowIndex, 0)}
        >
          <div className="flex items-center gap-1.5 min-w-0">
            {/* Expand/Collapse button for subelements */}
            {hasSubelements ? (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setIsSubelementsExpanded(!isSubelementsExpanded);
                }}
                className="w-3 h-4 flex items-center justify-center text-muted-foreground hover:text-foreground rounded transition-colors opacity-0 group-hover:opacity-100"
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
              <div className="w-3" />
            )}

            {/* Element marker — atom icon, opens status menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  onClick={(e) => e.stopPropagation()}
                  className="size-3.5 shrink-0 flex items-center justify-center hover:scale-110 transition-transform text-muted-foreground/70"
                  title={currentStatus.label}
                >
                  <AtomIcon className="size-3.5" />
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
            <span className={`text-[13px] font-medium truncate flex-1 min-w-0 ${element.status === 'done' ? 'text-muted-foreground' : 'text-foreground'}`}>
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
              className={`hidden md:table-cell px-2 py-0 select-none border-r border-border/40 ${isCellSelected(colIndex) ? 'bg-primary/10' : ''}`}
              onClick={(e) => e.stopPropagation()}
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
              className={`hidden md:table-cell px-2 py-0 select-none border-r border-border/40 ${isCellSelected(colIndex) ? 'bg-primary/10' : ''}`}
              onClick={(e) => e.stopPropagation()}
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

        {/* Right-side expand button — opens properties panel with ID */}
        <td className="w-10 px-1 py-[3px] text-center align-middle">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onSelect?.(e); }}
            className="w-5 h-5 inline-flex items-center justify-center text-muted-foreground/50 hover:text-foreground hover:bg-muted rounded transition-colors opacity-0 group-hover:opacity-100"
            title="Open properties"
            aria-label="Open properties"
          >
            <ChevronRight size={12} />
          </button>
        </td>
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
          <td className="px-2 py-1.5"></td>
          <td className="px-2 py-1.5" colSpan={(totalColumns || 8) - 2}>
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
