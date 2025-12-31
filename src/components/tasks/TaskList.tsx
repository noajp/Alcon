'use client';

import * as React from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { Calendar, Flag, MoreHorizontal } from 'lucide-react';
import type { ElementWithDetails, ElementAssigneeWithWorker } from '@/hooks/useSupabase';

// Legacy alias - tasks are now elements
type TaskWithDetails = ElementWithDetails;

// ============================================
// Types
// ============================================
interface TaskGroup {
  id: string;
  name: string;
  color: string;
  tasks: TaskWithDetails[];
}

interface TaskListProps {
  groups: TaskGroup[];
  onTaskClick?: (taskId: string) => void;
  onTaskComplete?: (taskId: string, completed: boolean) => void;
  onStatusChange?: (taskId: string, status: string) => void;
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

const priorityConfig: Record<string, { label: string; color: string }> = {
  urgent: { label: 'Urgent', color: 'text-red-500' },
  high: { label: 'High', color: 'text-orange-500' },
  medium: { label: 'Medium', color: 'text-blue-500' },
  low: { label: 'Low', color: 'text-muted-foreground' },
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
// Section Arc Indicator
// ============================================
function SectionArc({
  isFirst,
  isLast,
  isOnly,
  color
}: {
  isFirst: boolean;
  isLast: boolean;
  isOnly: boolean;
  color: string;
}) {
  if (isOnly) {
    return (
      <div className="w-4 flex justify-center">
        <div
          className="w-1.5 h-1.5 rounded-full"
          style={{ backgroundColor: color }}
        />
      </div>
    );
  }

  return (
    <div className="w-4 flex flex-col items-center">
      {!isFirst && <div className="w-0.5 h-2 -mt-2" style={{ backgroundColor: color }} />}
      <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
      {!isLast && <div className="w-0.5 flex-1" style={{ backgroundColor: color }} />}
    </div>
  );
}

// ============================================
// Task Row
// ============================================
function TaskRow({
  task,
  groupColor,
  isFirst,
  isLast,
  isOnly,
  onClick,
  onComplete,
}: {
  task: TaskWithDetails;
  groupColor: string;
  isFirst: boolean;
  isLast: boolean;
  isOnly: boolean;
  onClick?: () => void;
  onComplete?: (completed: boolean) => void;
}) {
  const status = statusConfig[task.status || 'todo'] || statusConfig.todo;
  const priority = priorityConfig[task.priority || 'low'] || priorityConfig.low;
  const isDone = task.status === 'done';

  return (
    <TableRow
      className={cn(
        "group cursor-pointer transition-colors",
        isDone && "opacity-60"
      )}
      onClick={onClick}
    >
      {/* Arc + Checkbox */}
      <TableCell className="w-16 pr-0">
        <div className="flex items-center gap-2">
          <SectionArc
            isFirst={isFirst}
            isLast={isLast}
            isOnly={isOnly}
            color={groupColor}
          />
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
          {task.title}
        </span>
      </TableCell>

      {/* Assignee */}
      <TableCell className="w-40">
        <AssigneeAvatars
          assignees={task.assignees}
        />
      </TableCell>

      {/* Due Date */}
      <TableCell className="w-32">
        {task.due_date ? (
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Calendar className="size-3.5" />
            {new Date(task.due_date).toLocaleDateString('en-US', {
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
// Section Header Row
// ============================================
function SectionHeaderRow({
  name,
  color,
  taskCount
}: {
  name: string;
  color: string;
  taskCount: number;
}) {
  return (
    <TableRow className="hover:bg-transparent border-0">
      <TableCell colSpan={7} className="py-3">
        <div className="flex items-center gap-2">
          <div
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: color }}
          />
          <span className="font-semibold text-foreground">{name}</span>
          <span className="text-xs text-muted-foreground">
            {taskCount} {taskCount === 1 ? 'task' : 'tasks'}
          </span>
        </div>
      </TableCell>
    </TableRow>
  );
}

// ============================================
// Task List Component
// ============================================
export function TaskList({
  groups,
  onTaskClick,
  onTaskComplete,
}: TaskListProps) {
  if (groups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
          <Calendar className="size-6 text-muted-foreground" />
        </div>
        <h3 className="font-semibold text-foreground mb-1">No tasks yet</h3>
        <p className="text-sm text-muted-foreground">
          Create your first task to get started
        </p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="w-16">#</TableHead>
          <TableHead>Name</TableHead>
          <TableHead className="w-40">Assignee</TableHead>
          <TableHead className="w-32">Due Date</TableHead>
          <TableHead className="w-28">Status</TableHead>
          <TableHead className="w-24">Priority</TableHead>
          <TableHead className="w-10"></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {groups.map((group) => (
          <React.Fragment key={group.id}>
            {groups.length > 1 && (
              <SectionHeaderRow
                name={group.name}
                color={group.color}
                taskCount={group.tasks.length}
              />
            )}
            {group.tasks.map((task, index) => (
              <TaskRow
                key={task.id}
                task={task}
                groupColor={group.color}
                isFirst={index === 0}
                isLast={index === group.tasks.length - 1}
                isOnly={group.tasks.length === 1}
                onClick={() => onTaskClick?.(task.id)}
                onComplete={(completed) => onTaskComplete?.(task.id, completed)}
              />
            ))}
          </React.Fragment>
        ))}
      </TableBody>
    </Table>
  );
}

export default TaskList;
