'use client';

import * as React from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { Calendar, Flag, MoreHorizontal, CircleDot } from 'lucide-react';
import type { ElementWithDetails, ElementAssigneeWithWorker, Worker } from '@/hooks/useSupabase';

export interface FileGroup {
  id: string;
  name: string;
  color: string;
  elements: ElementWithDetails[];
}

interface ElementListProps {
  files: FileGroup[];
  onElementClick?: (elementId: string) => void;
  onElementComplete?: (elementId: string, completed: boolean) => void;
  onStatusChange?: (elementId: string, status: string) => void;
}

// ============================================
// Status & Priority Config
// ============================================
const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; className?: string }> = {
  todo: { label: 'To Do', variant: 'outline', className: 'text-muted-foreground' },
  in_progress: { label: 'In Progress', variant: 'default', className: 'bg-blue-500 hover:bg-blue-600' },
  done: { label: 'Done', variant: 'default', className: 'bg-emerald-500 hover:bg-emerald-600' },
  blocked: { label: 'Blocked', variant: 'destructive' },
};

const priorityConfig: Record<string, { label: string; color: string; dotColor: string }> = {
  urgent: { label: 'Urgent', color: 'text-red-500', dotColor: '#ef4444' },
  high: { label: 'High', color: 'text-orange-500', dotColor: '#f97316' },
  medium: { label: 'Medium', color: 'text-blue-500', dotColor: '#3b82f6' },
  low: { label: 'Low', color: 'text-muted-foreground', dotColor: '#10b981' },
};

// ============================================
// Assignee Avatar Stack
// ============================================
function AssigneeAvatars({
  assignees,
  max = 3
}: {
  assignees?: ElementAssigneeWithWorker[];
  max?: number;
}) {
  // Multiple assignees
  if (assignees && assignees.length > 0) {
    const displayAssignees = assignees.slice(0, max);
    const remaining = assignees.length - max;

    return (
      <div className="flex items-center">
        <div className="flex -space-x-2">
          {displayAssignees.map((a, index) => (
            <Avatar
              key={a.id}
              className="size-6 border-2 border-background"
              style={{ zIndex: max - index }}
            >
              <AvatarFallback className="text-[10px] bg-muted">
                {a.worker?.name?.charAt(0) || '?'}
              </AvatarFallback>
            </Avatar>
          ))}
          {remaining > 0 && (
            <Avatar className="size-6 border-2 border-background">
              <AvatarFallback className="text-[10px] bg-muted">
                +{remaining}
              </AvatarFallback>
            </Avatar>
          )}
        </div>
        {assignees.length === 1 && assignees[0].worker && (
          <span className="ml-2 text-sm text-muted-foreground truncate max-w-[100px]">
            {assignees[0].worker.name}
          </span>
        )}
      </div>
    );
  }

  return <span className="text-sm text-muted-foreground">—</span>;
}

// ============================================
// Element Row
// ============================================
function ElementRow({
  element,
  fileColor,
  rowNumber,
  isLast,
  onClick,
  onComplete,
}: {
  element: ElementWithDetails;
  fileColor: string;
  rowNumber: number;
  isLast: boolean;
  onClick?: () => void;
  onComplete?: (completed: boolean) => void;
}) {
  const status = statusConfig[element.status || 'todo'] || statusConfig.todo;
  const priority = priorityConfig[element.priority || 'low'] || priorityConfig.low;
  const isDone = element.status === 'done';

  return (
    <TableRow
      className={cn(
        "group cursor-pointer transition-colors hover:bg-muted/30",
        isDone && "opacity-60"
      )}
      onClick={onClick}
    >
      {/* Row Number */}
      <TableCell className="w-16 pr-0">
        <div className="flex items-center gap-3 pl-4">
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground font-mono w-5 text-right">{rowNumber}</span>
            <span className="text-[8px]" style={{ color: priority.dotColor }}>●</span>
          </div>
          <Checkbox
            checked={isDone}
            onCheckedChange={(checked) => {
              onComplete?.(checked as boolean);
            }}
            onClick={(e) => e.stopPropagation()}
            className="size-4"
          />
        </div>
      </TableCell>

      {/* Title */}
      <TableCell className="font-medium">
        <span className={cn(isDone && "line-through text-muted-foreground")}>
          {element.title}
        </span>
      </TableCell>

      {/* Assignee */}
      <TableCell className="w-40">
        <AssigneeAvatars
          assignees={element.assignees}
        />
      </TableCell>

      {/* Due Date */}
      <TableCell className="w-32">
        {element.due_date ? (
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Calendar className="size-3.5" />
            {new Date(element.due_date).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric'
            })}
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>

      {/* Status */}
      <TableCell className="w-28">
        <Badge
          variant={status.variant}
          className={cn("text-[11px]", status.className)}
        >
          {status.label}
        </Badge>
      </TableCell>

      {/* Priority */}
      <TableCell className="w-24">
        <div className={cn("flex items-center gap-1.5 text-sm font-medium", priority.color)}>
          <Flag className="size-3.5" />
          {priority.label}
        </div>
      </TableCell>

      {/* Actions */}
      <TableCell className="w-10">
        <button
          className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-muted transition-opacity"
          onClick={(e) => {
            e.stopPropagation();
            // TODO: Open dropdown menu
          }}
        >
          <MoreHorizontal className="size-4 text-muted-foreground" />
        </button>
      </TableCell>
    </TableRow>
  );
}

// ============================================
// File Header Row (Tab-style with rounded indent)
// ============================================
function FileHeaderRow({
  name,
  color,
  elementCount
}: {
  name: string;
  color: string;
  elementCount: number;
}) {
  return (
    <TableRow className="hover:bg-transparent border-0">
      <TableCell colSpan={7} className="py-2 px-0">
        <div className="flex items-center relative">
          {/* Tab-style header with rounded indent */}
          <div className="flex items-center">
            {/* File icon - 2 circles connected by line (○─○) */}
            <div className="w-6 h-6 flex items-center justify-center gap-0.5 mr-2">
              <div className="w-1.5 h-1.5 rounded-full bg-black" />
              <div className="w-2 h-px bg-black" />
              <div className="w-1.5 h-1.5 rounded-full bg-black" />
            </div>
            <span className="font-semibold text-foreground">{name}</span>
            <span className="ml-2 text-xs text-muted-foreground px-2 py-0.5 bg-muted rounded-full">
              {elementCount}
            </span>
          </div>
        </div>
      </TableCell>
    </TableRow>
  );
}

// ============================================
// Element List Component
// ============================================
export function ElementList({
  files,
  onElementClick,
  onElementComplete,
}: ElementListProps) {
  if (files.length === 0 || files.every(f => f.elements.length === 0)) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
          <CircleDot className="size-6 text-muted-foreground" />
        </div>
        <h3 className="font-semibold text-foreground mb-1">No elements yet</h3>
        <p className="text-sm text-muted-foreground">
          Create your first element to get started
        </p>
      </div>
    );
  }

  let globalRowNumber = 0;

  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent border-b border-border">
          <TableHead className="w-16 text-xs font-medium text-muted-foreground">#</TableHead>
          <TableHead className="text-xs font-medium text-muted-foreground">Name</TableHead>
          <TableHead className="w-40 text-xs font-medium text-muted-foreground">Assignee</TableHead>
          <TableHead className="w-32 text-xs font-medium text-muted-foreground">Due Date</TableHead>
          <TableHead className="w-28 text-xs font-medium text-muted-foreground">Status</TableHead>
          <TableHead className="w-24 text-xs font-medium text-muted-foreground">Priority</TableHead>
          <TableHead className="w-10"></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {files.map((file) => {
          const fileElements = file.elements;

          return (
            <React.Fragment key={file.id}>
              {/* File Header (Tab) */}
              {fileElements.length > 0 && (
                <FileHeaderRow
                  name={file.name}
                  color={file.color}
                  elementCount={fileElements.length}
                />
              )}
              {/* Elements with vertical line grouping */}
              {fileElements.map((element, index) => {
                globalRowNumber++;
                return (
                  <ElementRow
                    key={element.id}
                    element={element}
                    fileColor={file.color}
                    rowNumber={globalRowNumber}
                    isLast={index === fileElements.length - 1}
                    onClick={() => onElementClick?.(element.id)}
                    onComplete={(completed) => onElementComplete?.(element.id, completed)}
                  />
                );
              })}
            </React.Fragment>
          );
        })}
      </TableBody>
    </Table>
  );
}

export default ElementList;
