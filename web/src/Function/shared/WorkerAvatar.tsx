'use client';

import type { ReactElement } from 'react';
import { cn } from '@/lib/utils';
import {
  Avatar,
  AvatarImage,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
} from '@/ui/avatar';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/ui/tooltip';
import { translate } from '@/Function/i18n/I18nProvider';
import { AiMark, aiProviderOf } from '@/Function/team/aiAgents';
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
  /** An AI agent's model: with its type, says whose logo it wears. */
  ai_model?: string | null;
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
  const provider = aiProviderOf(worker);
  return (
    <Avatar
      style={{ width: size, height: size }}
      title={title ?? (unreachable ? unreachableWorkerTitle(worker?.name) : worker?.name ?? undefined)}
      // No tabIndex/Tooltip here on purpose (el_QLT-008 review, ELE_QLT-036
      // considered and reverted it): almost every call site renders this as
      // the icon inside an already-interactive trigger — a board card's
      // assignee button, a table-row picker button, a DropdownMenuItem —
      // and a nested tabIndex=0 span there is either a genuine
      // nested-interactive keyboard trap (native buttons) or dead weight a
      // Radix menu's own roving focus never reaches (dropdown items),
      // confirmed by tracing both through their actual source. Fixing this
      // avatar's own a11y needs each caller to decide who the real focus
      // target is, which is a bigger, separate piece of work — the two
      // call sites where this avatar genuinely stands alone with no
      // interactive ancestor (`ResourceView`'s rows, `TeamRosterWidget`)
      // get the tooltip+tabIndex treatment directly via
      // `UnreachableAvatarTooltip` instead of through this component.
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
      {/* An AI agent of a known provider wears its logo; anyone else, their initial. */}
      {provider ? (
        <AvatarFallback className="bg-[var(--surface-raised)] text-foreground">
          <AiMark provider={provider} size={Math.round(size * 0.68)} />
        </AvatarFallback>
      ) : (
        <AvatarFallback className="bg-muted text-foreground/70 text-[10px] font-semibold">
          {initial}
        </AvatarFallback>
      )}
    </Avatar>
  );
}

interface WorkerAvatarStackProps {
  workers: (WorkerAvatarSubject | null | undefined)[];
  /** Max visible avatars before collapsing to a "+N" chip. Default 3. */
  max?: number;
  size?: number;
  className?: string;
  /** Extra class on each item. The overlap separator is an outside ring
   *  so the visible image diameter stays identical to a single avatar. */
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
            // Paint the separator outside the avatar so stacked images and
            // initials keep the same visible diameter as a single avatar.
            className={cn(isUnreachableWorker(w) ? 'ring-0' : 'ring-1 ring-card', itemClassName)}
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
      {translate(UNREACHABLE_WORKER_LABEL)}
    </span>
  );
}

/** Wraps an icon-only unreachable avatar in a Radix tooltip so its
 *  explanation is reachable by keyboard and screen reader, not only by
 *  hovering a `title` on an element nothing else marks as interactive
 *  (el_QLT-008 review, ELE_QLT-036). A reachable Worker's avatar passes
 *  through untouched — no tooltip, no new tab stop, no rendering change.
 *
 *  Use this only where the avatar itself is the focus target — nothing
 *  interactive already sits between it and the page. `WorkerAvatar`
 *  deliberately does NOT use this (see the comment on its own `title`):
 *  most of its call sites render it as the icon inside a button or a
 *  Radix menu item that is already the real interactive element, and a
 *  `tabIndex=0` there is a nested-interactive keyboard trap, not a fix.
 *  The two hand-rolled avatars that stand alone with no interactive
 *  ancestor (`TeamRosterWidget`, `ResourceView`) wrap their own markup
 *  with this directly, keyed off the same `unreachableMarkProps` they
 *  already read for the ring class. */
export function UnreachableAvatarTooltip({
  worker,
  name,
  children,
}: {
  worker: ReachSubject | null | undefined;
  name: string | null | undefined;
  children: ReactElement;
}) {
  if (!isUnreachableWorker(worker)) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{unreachableWorkerTitle(name)}</TooltipContent>
    </Tooltip>
  );
}
