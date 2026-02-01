'use client';

import React, { useState, useRef, useEffect } from 'react';
import type { ElementWithDetails, CustomColumnWithValues } from '@/hooks/useSupabase';
import type { Json } from '@/types/database';
import type { BuiltInColumn } from '@/components/columns';
import { CustomColumnCell } from '@/components/columns';
import { SubelementRow } from './SubelementRow';
import { ElementInlineDetail } from './ElementInlineDetail';
import { Check, Send, ChevronDown } from 'lucide-react';

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
  const [showMarkDropdown, setShowMarkDropdown] = useState(false);
  const [selectedMarkType, setSelectedMarkType] = useState<'check' | 'send'>('check');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const hasSubelements = element.subelements && element.subelements.length > 0;

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowMarkDropdown(false);
      }
    };
    if (showMarkDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showMarkDropdown]);

  // Mark options
  const markOptions = [
    { type: 'check' as const, label: '完了', icon: Check, color: 'bg-green-500' },
    { type: 'send' as const, label: '送付済み', icon: Send, color: 'bg-blue-500' },
  ];

  const currentMark = markOptions.find(m => m.type === selectedMarkType) || markOptions[0];
  const isChecked = element.status === 'done' || element.status === 'review';

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
          <span className="text-xs text-muted-foreground">{formatDueDate(element.due_date)}</span>
        ) : (
          <span className="text-xs text-muted-foreground flex items-center gap-1">
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
          className={`px-2 py-2 select-none ${isCellSelected(0) ? 'bg-primary/10' : ''}`}
          onMouseDown={(e) => {
            e.stopPropagation();
            onCellMouseDown?.(rowIndex, 0, e);
          }}
          onMouseEnter={() => onCellMouseEnter?.(rowIndex, 0)}
        >
          <div className="flex items-center gap-2">
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

            {/* Connected checkbox with dropdown - shadcn style */}
            <div className="relative flex items-center" ref={dropdownRef}>
              {/* Left: Main checkbox - shadcn/ui style */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (isChecked) {
                    onStatusChange('todo');
                  } else {
                    onStatusChange(selectedMarkType === 'check' ? 'done' : 'review');
                  }
                }}
                className={`size-4 shrink-0 rounded-l-[4px] border shadow-sm transition-all flex items-center justify-center ${
                  isChecked
                    ? `${currentMark.color} border-transparent text-white`
                    : 'border-muted-foreground/60 bg-transparent'
                }`}
                title={currentMark.label}
              >
                {isChecked && <currentMark.icon className="size-3" strokeWidth={2.5} />}
              </button>

              {/* Right: Narrow dropdown button with thin down arrow */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowMarkDropdown(!showMarkDropdown);
                }}
                className="w-[11px] h-4 rounded-r-[4px] border border-l-0 border-muted-foreground/60 shadow-sm shrink-0 flex items-center justify-center transition-all"
              >
                <ChevronDown size={8} strokeWidth={1.5} className="text-muted-foreground" />
              </button>

              {/* Dropdown menu */}
              {showMarkDropdown && (
                <div className="absolute top-full left-0 mt-1 z-50 bg-popover border border-border rounded-md shadow-lg py-1 min-w-[100px]">
                  {markOptions.map((opt) => (
                    <button
                      key={opt.type}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedMarkType(opt.type);
                        setShowMarkDropdown(false);
                      }}
                      className={`w-full px-2 py-1.5 text-left text-[11px] hover:bg-accent flex items-center gap-2 ${
                        selectedMarkType === opt.type ? 'bg-accent/50' : ''
                      }`}
                    >
                      <div className={`size-3.5 rounded-[3px] flex items-center justify-center ${opt.color} text-white`}>
                        <opt.icon size={9} strokeWidth={2} />
                      </div>
                      <span>{opt.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Title */}
            <span className={`text-[13px] truncate ${element.status === 'done' ? 'text-muted-foreground' : 'text-foreground'}`}>
              {element.title}
            </span>

            {/* Subelement count badge */}
            {hasSubelements && (
              <span className="text-[10px] text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded-full">
                {element.subelements!.filter(s => s.is_completed).length}/{element.subelements!.length}
              </span>
            )}
          </div>
        </td>

        {/* Built-in Columns (dynamically rendered) */}
        {builtInColumns?.filter(col => col.isVisible).map((col, idx) => {
          const colIndex = idx + 1;
          return (
            <td
              key={col.id}
              className={`px-2 py-2 select-none ${isCellSelected(colIndex) ? 'bg-primary/10' : ''}`}
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

        {/* Custom Columns */}
        {customColumns?.map((col, idx) => {
          const colIndex = (builtInColumns?.filter(c => c.isVisible).length || 0) + 1 + idx;
          return (
            <td
              key={col.id}
              className={`px-2 py-2 select-none ${isCellSelected(colIndex) ? 'bg-primary/10' : ''}`}
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

        {/* Empty cell for add column button */}
        <td className="px-2 py-1.5"></td>
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

      {/* Inline Detail Panel */}
      {isSelected && (
        <tr>
          <td colSpan={totalColumns || 7} className="p-0">
            <ElementInlineDetail
              element={element}
              onClose={onSelect!}
              onRefresh={onRefresh}
              allElements={allElements}
              customColumns={customColumns}
              onColumnValueChange={onColumnValueChange}
              builtInColumns={builtInColumns}
            />
          </td>
        </tr>
      )}
    </>
  );
}
