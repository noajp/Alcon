'use client';

import { cn } from '@/lib/utils';
import {
  Avatar,
  AvatarImage,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
} from '@/ui/avatar';
import {
  UNREACHABLE_WORKER_LABEL,
  UNREACHABLE_WORKER_RING_CLASS,
  isUnreachableWorker,
  unreachableWorkerTitle,
  type ReachSubject,
} from './workerReach';

// Single source of truth for "show a Worker's avatar" — used everywhere a
// human or AI agent is referenced (assignee chips, member lists, mention
// pickers, etc.). Built on the shadcn/ui Avatar primitives (Radix Avatar):
// render the image when avatar_url is set, otherwise the name's first letter.
//
// Two exports:
//   <WorkerAvatar>      — a single circle. Has a visible ring by default
//                         so initials-only chips read as "this is an icon."
//                         A human Worker with no account swaps the ring for
//                         a dashed one and a title that says why — the one
//                         place the mark is drawn, so every chip agrees.
//   <WorkerAvatarStack> — overlapping row (AvatarGroup) of up to `max`
//                         avatars + a "+N" count when there are more.

export interface WorkerAvatarSubject extends ReachSubject {
  name?: string | null;
  avatar_url?: string | null;
}

interface WorkerAvatarProps {
  worker: WorkerAvatarSubject | null | undefined;
  /** Pixel diameter. Default 20px (matches assignee chips across the app). */
  size?: number;
  className?: string;
  title?: string;
}

export function WorkerAvatar({ worker, size = 20, className, title }: WorkerAvatarProps) {
  const initial = (worker?.name ?? '?').trim().charAt(0).toUpperCase() || '?';
  const unreachable = isUnreachableWorker(worker);
  return (
    <Avatar
      style={{ width: size, height: size }}
      title={title ?? (unreachable ? unreachableWorkerTitle(worker?.name) : worker?.name ?? undefined)}
      data-unreachable={unreachable || undefined}
      // The base ring is dropped, not overridden, when unreachable — cn's
      // tailwind-merge only dedupes classes in the same utility group, and
      // `ring-*`/`outline-*` are different groups, so appending the dashed
      // outline after a *kept* ring used to double them up instead of
      // swapping. The dashed outline still goes after `className` so a
      // stack's `ring-0` cannot strip it — the overlap border and the mark
      // are different facts and both must survive.
      className={cn(!unreachable && 'ring-1 ring-border/60', className, unreachable && UNREACHABLE_WORKER_RING_CLASS)}
    >
      {worker?.avatar_url ? (
        <AvatarImage src={worker.avatar_url} alt="" className="object-cover" />
      ) : null}
      <AvatarFallback className="bg-muted text-foreground/70 text-[10px] font-semibold">
        {initial}
      </AvatarFallback>
    </Avatar>
  );
}

interface WorkerAvatarStackProps {
  workers: (WorkerAvatarSubject | null | undefined)[];
  /** Max visible avatars before collapsing to a "+N" chip. Default 3. */
  max?: number;
  size?: number;
  className?: string;
  /** Extra class on each item — typically the overlap separator border
   *  (`border-card`, `border-background`, etc.). The stack drops the
   *  single-avatar ring so the border is the only outline. */
  itemClassName?: string;
}

export function WorkerAvatarStack({
  workers,
  max = 3,
  size = 20,
  className,
  itemClassName,
}: WorkerAvatarStackProps) {
  const filtered = workers.filter((w): w is WorkerAvatarSubject => !!w);
  const visible = filtered.slice(0, max);
  const remaining = filtered.length - visible.length;
  return (
    <AvatarGroup className={cn('-space-x-1.5', className)}>
      {visible.map((w, i) => (
        // Overlap means every avatar but the frontmost covers part of its
        // neighbor's edge — including a dashed unreachable ring, painted
        // outside the avatar's own box, which a later sibling's background
        // would otherwise paint over. Reverse the stacking order so the
        // leftmost (read first) avatar stays fully on top; the ones behind
        // it lose only the sliver already spent on the overlap border.
        <span key={i} className="relative" style={{ zIndex: visible.length - i }}>
          <WorkerAvatar
            worker={w}
            size={size}
            // Strip the single-avatar ring; the overlap border carries the
            // outline so we don't double up.
            className={cn('ring-0 border border-card', itemClassName)}
          />
        </span>
      ))}
      {remaining > 0 && (
        <span className="relative" style={{ zIndex: visible.length + 1 }}>
          <AvatarGroupCount
            style={{ width: size, height: size }}
            className={cn(
              'bg-card text-muted-foreground text-[10px] font-medium border border-card',
              itemClassName,
            )}
          >
            +{remaining}
          </AvatarGroupCount>
        </span>
      )}
    </AvatarGroup>
  );
}

/** A human Worker with no account, said in words at the point the reader is
 *  about to rely on the assignment reaching somebody — the picker row, the
 *  roster. The avatar's dashed ring carries the same fact everywhere else;
 *  this is the one place the words live, so every row that needs them
 *  imports this instead of re-typing the span. Silent for everyone it does
 *  not apply to. */
export function ReachHint({ worker }: { worker: WorkerAvatarSubject | null | undefined }) {
  if (!isUnreachableWorker(worker)) return null;
  return (
    <span
      className="shrink-0 text-[11px] text-muted-foreground"
      title={unreachableWorkerTitle(worker?.name)}
    >
      {UNREACHABLE_WORKER_LABEL}
    </span>
  );
}
