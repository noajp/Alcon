'use client';

import { cn } from '@/lib/utils';

// Single source of truth for "show a Worker's avatar" — used everywhere a
// human or AI agent is referenced (assignee chips, member lists, mention
// pickers, etc.). Render <img> if avatar_url is set, otherwise the name's
// first letter inside a muted circle.
//
// Two exports:
//   <WorkerAvatar>      — a single circle. Has a visible ring by default
//                         so initials-only chips read as "this is an icon."
//   <WorkerAvatarStack> — overlapping row of up to `max` avatars + a "+N"
//                         counter when there are more.

export interface WorkerAvatarSubject {
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
  return (
    <span
      style={{ width: size, height: size }}
      title={title ?? worker?.name ?? undefined}
      className={cn(
        'inline-flex items-center justify-center rounded-full bg-muted text-foreground/70 text-[10px] font-semibold overflow-hidden shrink-0 ring-1 ring-border/60',
        className,
      )}
    >
      {worker?.avatar_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={worker.avatar_url} alt="" className="w-full h-full object-cover" />
      ) : (
        initial
      )}
    </span>
  );
}

interface WorkerAvatarStackProps {
  workers: (WorkerAvatarSubject | null | undefined)[];
  /** Max visible avatars before collapsing to a "+N" chip. Default 3. */
  max?: number;
  size?: number;
  className?: string;
  /** Extra class on each item — typically the overlap separator border
   *  (`border-card`, `border-background`, `border-white`, etc.). The stack
   *  drops the single-avatar ring so the border is the only outline. */
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
    <span className={cn('flex -space-x-1.5', className)}>
      {visible.map((w, i) => (
        <WorkerAvatar
          key={i}
          worker={w}
          size={size}
          // Strip the single-avatar ring; the overlap border carries the
          // outline so we don't double up.
          className={cn('ring-0 border border-card', itemClassName)}
        />
      ))}
      {remaining > 0 && (
        <span
          style={{ width: size, height: size }}
          className={cn(
            'inline-flex items-center justify-center rounded-full bg-card text-muted-foreground text-[10px] font-medium border border-card shrink-0',
            itemClassName,
          )}
        >
          +{remaining}
        </span>
      )}
    </span>
  );
}
