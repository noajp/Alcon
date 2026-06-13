import * as React from 'react';
import { Check, X } from 'lucide-react';
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/ui/dropdown-menu';
import { WorkerAvatar, type WorkerAvatarSubject } from './WorkerAvatar';

// Single source of truth for the assignee picker dropdown CONTENT. Triggers
// legitimately differ per view (avatar stack in table rows, RailRow in the
// detail panel, a lone avatar on board cards) — so this wraps only the
// DropdownMenuContent. Usage:
//
//   <DropdownMenu>
//     <DropdownMenuTrigger>…view-specific trigger…</DropdownMenuTrigger>
//     <AssigneeMenuContent assignees={…} workers={…} onAdd={…} onRemove={…} />
//   </DropdownMenu>

/** Structural subset of ElementAssigneeWithWorker — keeps this component
 *  decoupled from the data layer. */
export interface AssigneeEntry {
  id: string;
  worker_id?: string | null;
  worker?: (WorkerAvatarSubject & { id?: string }) | null;
}

export interface AssignableWorker extends WorkerAvatarSubject {
  id: string;
}

interface AssigneeMenuContentProps
  extends Omit<React.ComponentProps<typeof DropdownMenuContent>, 'children'> {
  assignees?: AssigneeEntry[] | null;
  /** Full worker list — the available (not yet assigned) set is derived here. */
  workers: AssignableWorker[];
  onAdd: (workerId: string) => void;
  onRemove: (assigneeId: string) => void;
  /** 'add-remove' (default): current assignees (X to remove) above the
   *  available workers. 'toggle': one list of all workers, a check marks
   *  assigned, clicking toggles — the board-card interaction. */
  variant?: 'add-remove' | 'toggle';
}

export function AssigneeMenuContent({
  assignees,
  workers,
  onAdd,
  onRemove,
  variant = 'add-remove',
  ...contentProps
}: AssigneeMenuContentProps) {
  const current = assignees ?? [];
  const assigneeWorkerId = (a: AssigneeEntry) => a.worker_id ?? a.worker?.id;

  if (variant === 'toggle') {
    return (
      <DropdownMenuContent {...contentProps}>
        {workers.length === 0 && (
          <div className="px-2 py-1.5 text-[12px] text-muted-foreground">No workers</div>
        )}
        {workers.map((w) => {
          const existing = current.find((a) => assigneeWorkerId(a) === w.id);
          return (
            <DropdownMenuItem
              key={w.id}
              onClick={() => (existing ? onRemove(existing.id) : onAdd(w.id))}
              className="gap-2 text-[13px]"
            >
              <WorkerAvatar worker={w} size={20} />
              <span className="flex-1 truncate">{w.name}</span>
              {existing && <Check size={12} className="text-muted-foreground" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    );
  }

  const assignedIds = new Set(current.map(assigneeWorkerId).filter(Boolean));
  const available = workers.filter((w) => !assignedIds.has(w.id));

  return (
    <DropdownMenuContent {...contentProps}>
      {current.length > 0 && (
        <>
          {current.map((a) => (
            <DropdownMenuItem
              key={a.id}
              onClick={() => onRemove(a.id)}
              className="flex items-center gap-2 text-[12px]"
            >
              <WorkerAvatar worker={a.worker} size={20} />
              <span className="flex-1">{a.worker?.name}</span>
              <X size={12} className="text-muted-foreground shrink-0" />
            </DropdownMenuItem>
          ))}
          {available.length > 0 && <DropdownMenuSeparator />}
        </>
      )}
      {available.length > 0 ? (
        available.map((w) => (
          <DropdownMenuItem
            key={w.id}
            onClick={() => onAdd(w.id)}
            className="flex items-center gap-2 text-[12px]"
          >
            <WorkerAvatar worker={w} size={20} />
            {w.name}
          </DropdownMenuItem>
        ))
      ) : workers.length === 0 ? (
        <div className="px-3 py-2 text-[12px] text-muted-foreground">Loading...</div>
      ) : (
        <div className="px-3 py-2 text-[12px] text-muted-foreground">All assigned</div>
      )}
    </DropdownMenuContent>
  );
}
