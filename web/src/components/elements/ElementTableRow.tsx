'use client';

import React, { useState } from 'react';
import type { ElementWithDetails, CustomColumnWithValues } from '@/hooks/useSupabase';
import type { Json } from '@/types/database';
import type { BuiltInColumn } from '@/components/columns';
import { CustomColumnCell } from '@/components/columns';
import { SubelementRow } from './SubelementRow';
import { Check, Circle, Clock, Send, CheckCircle2, XCircle, Ban } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuShortcut,
} from '@/components/ui/dropdown-menu';

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
}: ElementTableRowProps) {
  const [isSubelementsExpanded, setIsSubelementsExpanded] = useState(false);
  const hasSubelements = element.subelements && element.subelements.length > 0;

  // Linear-style status options
  const statusOptions = [
    { status: 'backlog', label: 'Backlog', icon: Circle, color: 'text-muted-foreground', shortcut: '1' },
    { status: 'todo', label: 'Todo', icon: Circle, color: 'text-muted-foreground', shortcut: '2' },
    { status: 'in_progress', label: 'In Progress', icon: Clock, color: 'text-yellow-500', shortcut: '3' },
    { status: 'review', label: 'In Review', icon: Send, color: 'text-cyan-400', shortcut: '4' },
    { status: 'done', label: 'Done', icon: CheckCircle2, color: 'text-green-500', shortcut: '5' },
    { status: 'blocked', label: 'Blocked', icon: XCircle, color: 'text-red-500', shortcut: '6' },
    { status: 'cancelled', label: 'Cancelled', icon: Ban, color: 'text-muted-foreground', shortcut: '7' },
  ];

  const currentStatus = statusOptions.find(s => s.status === element.status) || statusOptions[1];

  const priorityBadges: Record<string, { bg: string; text: string; label: string }> = {
    urgent: { bg: 'bg-[#fef2f2]', text: 'text-[#dc2626]', label: 'Urgent' },
    high: { bg: 'bg-[#fef2f2]', text: 'text-[#dc2626]', label: 'High' },
    medium: { bg: 'bg-[#f0fdf4]', text: 'text-[#152a45]', label: 'Normal' },
    low: { bg: 'bg-[#eff6ff]', text: 'text-[#2563eb]', label: 'Low' },
  };

  const statusBadges: Record<string, { bg: string; text: string; label: string }> = {
    todo: { bg: 'bg-card', text: 'text-muted-foreground', label: 'To Do' },
    in_progress: { bg: 'bg-[#fef3c7]', text: 'text-[#d97706]', label: 'In Progress' },
    review: { bg: 'bg-[#e0e7ff]', text: 'text-[#4f46e5]', label: 'Review' },
    done: { bg: 'bg-[#f0fdf4]', text: 'text-[#152a45]', label: 'Done' },
    blocked: { bg: 'bg-[#fef2f2]', text: 'text-[#dc2626]', label: 'Blocked' },
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
          <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${priority.bg} ${priority.text}`}>
            {priority.label}
          </span>
        );
      case 'status':
        return (
          <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${status.bg} ${status.text}`}>
            {status.label}
          </span>
        );
      case 'due_date':
        return element.due_date ? (
          <span className="text-xs text-muted-foreground whitespace-nowrap">{formatDueDate(element.due_date)}</span>
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
      <tr
        className={`group border-b border-border hover:bg-muted/30 transition-colors cursor-pointer ${isSelected ? 'bg-accent/50' : ''} ${isMultiSelected ? 'bg-primary/5' : ''}`}
        onClick={(e) => onSelect?.(e)}
      >
        {/* Row number */}
        <td className="px-2 py-2 text-[11px] text-muted-foreground/60 text-center">{rowNumber}</td>

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
